import type { AgentRegistry } from '../agents/registry.js';
import type { RawDB } from '../database/types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('circuit-breaker');

interface ErrorRecord {
  timestamps: number[];
  trippedAt?: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  maxFailures: number;
  windowMs: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private errors = new Map<string, ErrorRecord>();
  private config: CircuitBreakerConfig;

  constructor(
    private registry: AgentRegistry,
    config?: Partial<CircuitBreakerConfig>,
    private db?: RawDB
  ) {
    this.config = {
      maxFailures: config?.maxFailures ?? 5,
      windowMs: config?.windowMs ?? 60000,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
    };
  }

  recordFailure(agentId: string): { tripped: boolean } {
    const now = Date.now();
    const state = this.getState(agentId);

    // In half-open state, a single failure re-trips immediately
    if (state === 'half-open') {
      const record = this.errors.get(agentId)!;
      record.trippedAt = now;
      this.registry.quarantine(agentId, 'Circuit breaker re-tripped: probe request failed in half-open state');
      log.warn({ agentId }, 'Circuit breaker re-tripped from half-open state');
      this.persistState(agentId);
      return { tripped: true };
    }

    const cutoff = now - this.config.windowMs;

    if (!this.errors.has(agentId)) {
      this.errors.set(agentId, { timestamps: [] });
    }

    const record = this.errors.get(agentId)!;
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    record.timestamps.push(now);

    if (record.timestamps.length >= this.config.maxFailures) {
      record.trippedAt = now;
      this.registry.quarantine(agentId, `Circuit breaker tripped: ${record.timestamps.length} failures in ${this.config.windowMs}ms`);
      log.warn({ agentId, failures: record.timestamps.length }, 'Circuit breaker tripped');
      this.persistState(agentId);
      return { tripped: true };
    }

    this.persistState(agentId);
    return { tripped: false };
  }

  recordSuccess(agentId: string): void {
    const state = this.getState(agentId);

    if (state === 'half-open') {
      // Probe succeeded — close the breaker and reactivate
      this.errors.delete(agentId);
      this.registry.reactivate(agentId, 'Circuit breaker probe succeeded');
      log.info({ agentId }, 'Circuit breaker closed after successful probe');
      this.persistState(agentId);
      return;
    }

    this.errors.delete(agentId);
    this.persistState(agentId);
  }

  getState(agentId: string): CircuitState {
    this.restoreState(agentId);
    const record = this.errors.get(agentId);
    if (!record || !record.trippedAt) {
      return 'closed';
    }

    const elapsed = Date.now() - record.trippedAt;
    if (elapsed >= this.config.resetTimeoutMs) {
      return 'half-open';
    }

    return 'open';
  }

  canExecute(agentId: string): boolean {
    this.restoreState(agentId);
    const state = this.getState(agentId);
    return state === 'closed' || state === 'half-open';
  }

  getFailureCount(agentId: string): number {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    const record = this.errors.get(agentId);
    if (!record) return 0;
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    return record.timestamps.length;
  }

  reset(agentId: string): void {
    this.errors.delete(agentId);
    this.persistState(agentId);
  }

  private persistState(agentId: string): void {
    if (!this.db) return;
    const record = this.errors.get(agentId);
    const now = Date.now();

    if (!record) {
      this.db.prepare(`
        INSERT OR REPLACE INTO circuit_breaker_state (id, state, tripped_at, error_count, last_error, updated_at)
        VALUES (?, 'closed', NULL, 0, NULL, ?)
      `).run(agentId, now);
      return;
    }

    const state = record.trippedAt
      ? (Date.now() - record.trippedAt >= this.config.resetTimeoutMs ? 'half-open' : 'open')
      : 'closed';

    this.db.prepare(`
      INSERT OR REPLACE INTO circuit_breaker_state (id, state, tripped_at, error_count, last_error, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `).run(agentId, state, record.trippedAt ?? null, record.timestamps.length, now);
  }

  private restoreState(agentId: string): void {
    if (!this.db) return;
    if (this.errors.has(agentId)) return;

    const row = this.db.prepare(`SELECT * FROM circuit_breaker_state WHERE id = ?`).get(agentId) as any;
    if (!row) return;

    if (row.state === 'closed' && row.error_count === 0) return;

    const record: ErrorRecord = {
      timestamps: [],
      trippedAt: row.tripped_at ?? undefined,
    };

    // Reconstruct timestamps based on error_count (spread within window)
    const now = Date.now();
    for (let i = 0; i < row.error_count; i++) {
      record.timestamps.push(now - (row.error_count - i) * 100);
    }

    this.errors.set(agentId, record);
  }
}
