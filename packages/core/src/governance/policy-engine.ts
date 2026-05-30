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

  constructor(db: RawDB, trustEngine: TrustEngine) {
    this.db = db;
    this.trustEngine = trustEngine;
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

    for (const row of rows) {
      const rules: PolicyRule[] = JSON.parse(row.rules);
      for (const rule of rules) {
        if (this.matchesCondition(rule.condition, agentId, resource, action)) {
          const allowed = rule.effect === 'allow';
          return {
            allowed,
            effect: rule.effect,
            matchedPolicy: row.name,
            reason: `Policy '${row.name}' matched with effect '${rule.effect}'`,
          };
        }
      }
    }

    return {
      allowed: true,
      effect: 'allow',
      matchedPolicy: null,
      reason: 'No policy matched',
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

  private matchesCondition(condition: PolicyCondition, agentId: string, resource: string, action: string): boolean {
    switch (condition.type) {
      case 'trust_below': {
        const score = this.trustEngine.getScore(agentId);
        return score.overall < condition.threshold;
      }
      case 'resource_matches': {
        const regex = new RegExp(condition.pattern);
        return regex.test(resource);
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
