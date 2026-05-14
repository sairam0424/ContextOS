import type { AgentRegistry } from '../agents/registry.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('circuit-breaker');

interface ErrorRecord {
  timestamps: number[];
}

export interface CircuitBreakerConfig {
  maxFailures: number;
  windowMs: number;
}

export class CircuitBreaker {
  private errors = new Map<string, ErrorRecord>();
  private config: CircuitBreakerConfig;

  constructor(private registry: AgentRegistry, config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      maxFailures: config?.maxFailures ?? 5,
      windowMs: config?.windowMs ?? 60000,
    };
  }

  recordFailure(agentId: string): { tripped: boolean } {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    if (!this.errors.has(agentId)) {
      this.errors.set(agentId, { timestamps: [] });
    }

    const record = this.errors.get(agentId)!;
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    record.timestamps.push(now);

    if (record.timestamps.length >= this.config.maxFailures) {
      this.registry.quarantine(agentId, `Circuit breaker tripped: ${record.timestamps.length} failures in ${this.config.windowMs}ms`);
      this.errors.delete(agentId);
      log.warn({ agentId, failures: record.timestamps.length }, 'Circuit breaker tripped');
      return { tripped: true };
    }

    return { tripped: false };
  }

  recordSuccess(agentId: string): void {
    this.errors.delete(agentId);
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
