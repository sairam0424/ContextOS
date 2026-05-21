import type { AgentRegistry } from '../agents/registry.js';
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

  constructor(private registry: AgentRegistry, config?: Partial<CircuitBreakerConfig>) {
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
      return { tripped: true };
    }

    return { tripped: false };
  }

  recordSuccess(agentId: string): void {
    const state = this.getState(agentId);

    if (state === 'half-open') {
      // Probe succeeded — close the breaker and reactivate
      this.errors.delete(agentId);
      this.registry.reactivate(agentId, 'Circuit breaker probe succeeded');
      log.info({ agentId }, 'Circuit breaker closed after successful probe');
      return;
    }

    this.errors.delete(agentId);
  }

  getState(agentId: string): CircuitState {
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
  }
}
