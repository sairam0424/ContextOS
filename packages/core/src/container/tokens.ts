import type { Token } from './container.js';
import type { DatabaseService } from '../database/index.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { MessageBus } from '../agents/message-bus.js';
import type { TaskGraph } from '../orchestration/task-graph.js';
import type { TaskScheduler } from '../orchestration/scheduler.js';
import type { ConflictResolver } from '../orchestration/conflict-resolver.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { AuditLog } from '../resilience/audit-log.js';
import type { MetricsCollector } from '../metrics/collector.js';

export const TOKENS = {
  Database: Symbol.for('ctx:Database') as Token<DatabaseService>,
  EventBus: Symbol.for('ctx:EventBus') as Token<WorkspaceEventBus>,
  Intelligence: Symbol.for('ctx:Intelligence') as Token<unknown>,
  IntelligenceQueue: Symbol.for('ctx:IntelligenceQueue') as Token<unknown>,
  KnowledgeGraph: Symbol.for('ctx:KnowledgeGraph') as Token<unknown>,
  Embedding: Symbol.for('ctx:Embedding') as Token<unknown>,
  Sampling: Symbol.for('ctx:Sampling') as Token<unknown>,
  Validation: Symbol.for('ctx:Validation') as Token<unknown>,
  Watch: Symbol.for('ctx:Watch') as Token<unknown>,
  Repair: Symbol.for('ctx:Repair') as Token<unknown>,
  Locking: Symbol.for('ctx:Locking') as Token<unknown>,
  Mission: Symbol.for('ctx:Mission') as Token<unknown>,
  Federation: Symbol.for('ctx:Federation') as Token<unknown>,
  Capability: Symbol.for('ctx:Capability') as Token<unknown>,
  WorkspaceConfig: Symbol.for('ctx:WorkspaceConfig') as Token<unknown>,
  Workspace: Symbol.for('ctx:Workspace') as Token<unknown>,
  AgentRegistry: Symbol.for('ctx:AgentRegistry') as Token<AgentRegistry>,
  MessageBus: Symbol.for('ctx:MessageBus') as Token<MessageBus>,
  TaskGraph: Symbol.for('ctx:TaskGraph') as Token<TaskGraph>,
  TaskScheduler: Symbol.for('ctx:TaskScheduler') as Token<TaskScheduler>,
  ConflictResolver: Symbol.for('ctx:ConflictResolver') as Token<ConflictResolver>,
  CircuitBreaker: Symbol.for('ctx:CircuitBreaker') as Token<CircuitBreaker>,
  AuditLog: Symbol.for('ctx:AuditLog') as Token<AuditLog>,
  Metrics: Symbol.for('ctx:Metrics') as Token<MetricsCollector>,
} as const;

export type ServiceToken = typeof TOKENS[keyof typeof TOKENS];
