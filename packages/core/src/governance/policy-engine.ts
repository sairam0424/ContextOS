import type { RawDB } from '../database/types.js';
import type { TrustEngine } from './trust-engine.js';

export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

export type PolicyCondition =
  | { readonly type: 'trust_below'; readonly threshold: number }
  | { readonly type: 'resource_matches'; readonly pattern: string }
  | { readonly type: 'action_type'; readonly action: string }
  | { readonly type: 'rate_exceeded'; readonly maxPerMinute: number }
  | { readonly type: 'compound'; readonly operator: 'AND' | 'OR'; readonly conditions: readonly PolicyCondition[] };

export interface PolicyRule {
  readonly condition: PolicyCondition;
  readonly effect: PolicyEffect;
}

export interface Policy {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly rules: readonly PolicyRule[];
  readonly priority: number;
  readonly enabled: boolean;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly effect: PolicyEffect;
  readonly matchedPolicy: string | null;
  readonly reason: string;
}

/**
 * Default effect applied when NO policy rule matches. Cedar/OPA-style engines
 * default-DENY: absence of an explicit allow is a denial. This is configurable
 * (and explicit) so the safe default can be asserted in tests.
 */
export type DefaultEffect = 'allow' | 'deny';

export interface PolicyEngineOptions {
  readonly defaultEffect?: DefaultEffect;
}

interface PolicyRow {
  id: number;
  name: string;
  description: string;
  rules: string;
  priority: number;
  enabled: number;
}

interface RateEntry {
  count: number;
  windowStart: number;
}

export class PolicyEngine {
  private readonly db: RawDB;
  private readonly trustEngine: TrustEngine;
  private readonly rateCounters: Map<string, RateEntry> = new Map();
  private readonly defaultEffect: DefaultEffect;

  constructor(db: RawDB, trustEngine: TrustEngine, options: PolicyEngineOptions = {}) {
    this.db = db;
    this.trustEngine = trustEngine;
    this.defaultEffect = options.defaultEffect ?? 'deny';
  }

  addPolicy(opts: {
    readonly name: string;
    readonly description?: string;
    readonly rules: PolicyRule[];
    readonly priority?: number;
  }): Policy {
    const { name, description = '', rules, priority = 0 } = opts;

    const result = this.db.prepare(
      `INSERT INTO policies (name, description, rules, priority, enabled)
       VALUES (?, ?, ?, ?, 1)`
    ).run(name, description, JSON.stringify(rules), priority);

    return {
      id: Number(result.lastInsertRowid),
      name,
      description,
      rules,
      priority,
      enabled: true,
    };
  }

  removePolicy(policyId: number): void {
    this.db.prepare('DELETE FROM policies WHERE id = ?').run(policyId);
  }

  enablePolicy(policyId: number): void {
    this.db.prepare('UPDATE policies SET enabled = 1 WHERE id = ?').run(policyId);
  }

  disablePolicy(policyId: number): void {
    this.db.prepare('UPDATE policies SET enabled = 0 WHERE id = ?').run(policyId);
  }

  evaluate(agentId: string, resource: string, action: string): PolicyDecision {
    this.incrementRateCounter(agentId);

    const rows = this.db.prepare(
      'SELECT * FROM policies WHERE enabled = 1 ORDER BY priority DESC'
    ).all() as PolicyRow[];

    // Collect every matching rule, then resolve with forbid-overrides
    // (Cedar/OPA semantics): a single 'deny' wins over any number of
    // 'allow's, and 'require_approval' wins over 'allow' but yields to 'deny'.
    let allowMatch: { policy: string; effect: PolicyEffect } | null = null;
    let approvalMatch: { policy: string; effect: PolicyEffect } | null = null;

    for (const row of rows) {
      const rules: PolicyRule[] = JSON.parse(row.rules);
      for (const rule of rules) {
        if (!this.matchesCondition(rule.condition, agentId, resource, action)) continue;

        if (rule.effect === 'deny') {
          // Deny wins immediately — no further evaluation can override it.
          return this.decide(false, 'deny', row.name);
        }
        if (rule.effect === 'require_approval' && approvalMatch === null) {
          approvalMatch = { policy: row.name, effect: 'require_approval' };
        } else if (rule.effect === 'allow' && allowMatch === null) {
          allowMatch = { policy: row.name, effect: 'allow' };
        }
      }
    }

    if (approvalMatch !== null) {
      return this.decide(false, 'require_approval', approvalMatch.policy);
    }
    if (allowMatch !== null) {
      return this.decide(true, 'allow', allowMatch.policy);
    }

    // No rule matched: apply the configured default. Defaults to DENY
    // (fail-closed) so absence of an explicit allow is a denial.
    const allowed = this.defaultEffect === 'allow';
    return {
      allowed,
      effect: this.defaultEffect,
      matchedPolicy: null,
      reason: `No policy matched — applying default effect '${this.defaultEffect}'`,
    };
  }

  getPolicies(): Policy[] {
    const rows = this.db.prepare('SELECT * FROM policies').all() as PolicyRow[];
    return rows.map(row => this.rowToPolicy(row));
  }

  getPolicy(policyId: number): Policy | null {
    const row = this.db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId) as PolicyRow | undefined;
    if (!row) return null;
    return this.rowToPolicy(row);
  }

  /** Build a PolicyDecision with a distinct, caller-routable reason per effect. */
  private decide(allowed: boolean, effect: PolicyEffect, policyName: string): PolicyDecision {
    const reason = effect === 'require_approval'
      ? `Policy '${policyName}' requires approval — route to elicitation`
      : `Policy '${policyName}' matched with effect '${effect}'`;
    return { allowed, effect, matchedPolicy: policyName, reason };
  }

  private matchesCondition(condition: PolicyCondition, agentId: string, resource: string, action: string): boolean {
    switch (condition.type) {
      case 'trust_below': {
        const score = this.trustEngine.getScore(agentId);
        return score.overall < condition.threshold;
      }
      case 'resource_matches': {
        // Anchored glob/prefix matching mirrors CapabilityTokenService.matchResource.
        // This deliberately avoids `new RegExp(condition.pattern)` — an
        // attacker-influenceable, unbounded regex is a ReDoS sink.
        return this.matchResource(condition.pattern, resource);
      }
      case 'action_type': {
        return action === condition.action;
      }
      case 'rate_exceeded': {
        const entry = this.rateCounters.get(agentId);
        if (!entry) return false;
        return entry.count > condition.maxPerMinute;
      }
      case 'compound': {
        if (condition.operator === 'AND') {
          return condition.conditions.every(c => this.matchesCondition(c, agentId, resource, action));
        }
        return condition.conditions.some(c => this.matchesCondition(c, agentId, resource, action));
      }
    }
  }

  /**
   * Safe glob/prefix resource matcher (mirrors CapabilityTokenService.matchResource).
   * Supports '*' (match-all), a trailing ':*' prefix wildcard, and exact match.
   * No regex — bounded, linear, not attacker-influenceable.
   */
  private matchResource(pattern: string, resource: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1);
      return resource.startsWith(prefix);
    }
    return pattern === resource;
  }

  private incrementRateCounter(agentId: string): void {
    const now = Date.now();
    const entry = this.rateCounters.get(agentId);

    if (!entry || (now - entry.windowStart) > 60_000) {
      this.rateCounters.set(agentId, { count: 1, windowStart: now });
      return;
    }

    this.rateCounters.set(agentId, { count: entry.count + 1, windowStart: entry.windowStart });
  }

  private rowToPolicy(row: PolicyRow): Policy {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      rules: JSON.parse(row.rules),
      priority: row.priority,
      enabled: row.enabled === 1,
    };
  }
}
