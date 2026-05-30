import type { Token } from './container.js';
import type { DatabaseService } from '../database/index.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';
import type { EventStore } from '../events/event-store.js';
import type { IntelligenceService } from '../services/intelligence.js';
import type { IntelligenceQueueService } from '../services/intelligence-queue.js';
import type { KnowledgeGraphService } from '../services/knowledge-graph.js';
import type { EmbeddingService } from '../services/embedding.js';
import type { SamplingService } from '../services/sampling.js';
import type { ValidationService } from '../services/validation.js';
import type { WatchService } from '../services/watch.js';
import type { SelfRepairService } from '../services/repair.js';
import type { LockingService } from '../services/locking.js';
import type { MissionService } from '../services/mission.js';
import type { FederationService } from '../services/federation.js';
import type { CapabilityService } from '../services/capability.js';
import type { WorkspaceConfigService } from '../services/workspace-config.js';
import type { WorkspaceService } from '../services/workspace.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { MessageBus } from '../agents/message-bus.js';
import type { TaskGraph } from '../orchestration/task-graph.js';
import type { TaskScheduler } from '../orchestration/scheduler.js';
import type { ConflictResolver } from '../orchestration/conflict-resolver.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { AuditLog } from '../resilience/audit-log.js';
import type { MetricsCollector } from '../metrics/collector.js';
import type { MemoryStream } from '../cognitive/memory-stream.js';
import type { ReflectionEngine } from '../cognitive/reflection-engine.js';
import type { SkillLibrary } from '../cognitive/skill-library.js';
import type { LanguageAgentTreeSearch } from '../cognitive/tree-search.js';
import type { TemporalGraphService } from '../services/temporal-graph.js';
import type { SwarmOrchestrator } from '../orchestration/swarm-orchestrator.js';
import type { NegotiationService } from '../orchestration/negotiation.js';
import type { ConsensusService } from '../orchestration/consensus.js';
import type { CapabilityTokenService } from '../governance/capability-token.js';
import type { TrustEngine } from '../governance/trust-engine.js';
import type { PolicyEngine } from '../governance/policy-engine.js';
import type { AnomalyDetector } from '../governance/anomaly-detection.js';
import type { EventProcessor } from '../streaming/event-processor.js';
import type { PredictiveHealthMonitor } from '../streaming/predictive-health.js';
import type { KnowledgeDistiller } from '../streaming/knowledge-distiller.js';
import type { HierarchicalMemory } from '../streaming/hierarchical-memory.js';

export const TOKENS = {
  Database: Symbol.for('ctx:Database') as Token<DatabaseService>,
  EventBus: Symbol.for('ctx:EventBus') as Token<WorkspaceEventBus>,
  EventStore: Symbol.for('ctx:EventStore') as Token<EventStore>,
  Intelligence: Symbol.for('ctx:Intelligence') as Token<IntelligenceService>,
  IntelligenceQueue: Symbol.for('ctx:IntelligenceQueue') as Token<IntelligenceQueueService>,
  KnowledgeGraph: Symbol.for('ctx:KnowledgeGraph') as Token<KnowledgeGraphService>,
  Embedding: Symbol.for('ctx:Embedding') as Token<EmbeddingService>,
  Sampling: Symbol.for('ctx:Sampling') as Token<SamplingService>,
  Validation: Symbol.for('ctx:Validation') as Token<ValidationService>,
  Watch: Symbol.for('ctx:Watch') as Token<WatchService>,
  Repair: Symbol.for('ctx:Repair') as Token<SelfRepairService>,
  Locking: Symbol.for('ctx:Locking') as Token<LockingService>,
  Mission: Symbol.for('ctx:Mission') as Token<MissionService>,
  Federation: Symbol.for('ctx:Federation') as Token<FederationService>,
  Capability: Symbol.for('ctx:Capability') as Token<CapabilityService>,
  WorkspaceConfig: Symbol.for('ctx:WorkspaceConfig') as Token<WorkspaceConfigService>,
  Workspace: Symbol.for('ctx:Workspace') as Token<WorkspaceService>,
  AgentRegistry: Symbol.for('ctx:AgentRegistry') as Token<AgentRegistry>,
  MessageBus: Symbol.for('ctx:MessageBus') as Token<MessageBus>,
  TaskGraph: Symbol.for('ctx:TaskGraph') as Token<TaskGraph>,
  TaskScheduler: Symbol.for('ctx:TaskScheduler') as Token<TaskScheduler>,
  ConflictResolver: Symbol.for('ctx:ConflictResolver') as Token<ConflictResolver>,
  CircuitBreaker: Symbol.for('ctx:CircuitBreaker') as Token<CircuitBreaker>,
  AuditLog: Symbol.for('ctx:AuditLog') as Token<AuditLog>,
  Metrics: Symbol.for('ctx:Metrics') as Token<MetricsCollector>,
  MemoryStream: Symbol.for('ctx:MemoryStream') as Token<MemoryStream>,
  ReflectionEngine: Symbol.for('ctx:ReflectionEngine') as Token<ReflectionEngine>,
  SkillLibrary: Symbol.for('ctx:SkillLibrary') as Token<SkillLibrary>,
  TreeSearch: Symbol.for('ctx:TreeSearch') as Token<LanguageAgentTreeSearch>,
  TemporalGraph: Symbol.for('ctx:TemporalGraph') as Token<TemporalGraphService>,
  SwarmOrchestrator: Symbol.for('ctx:SwarmOrchestrator') as Token<SwarmOrchestrator>,
  Negotiation: Symbol.for('ctx:Negotiation') as Token<NegotiationService>,
  Consensus: Symbol.for('ctx:Consensus') as Token<ConsensusService>,
  CapabilityToken: Symbol.for('ctx:CapabilityToken') as Token<CapabilityTokenService>,
  TrustEngine: Symbol.for('ctx:TrustEngine') as Token<TrustEngine>,
  PolicyEngine: Symbol.for('ctx:PolicyEngine') as Token<PolicyEngine>,
  AnomalyDetector: Symbol.for('ctx:AnomalyDetector') as Token<AnomalyDetector>,
  EventProcessor: Symbol.for('ctx:EventProcessor') as Token<EventProcessor>,
  PredictiveHealth: Symbol.for('ctx:PredictiveHealth') as Token<PredictiveHealthMonitor>,
  KnowledgeDistiller: Symbol.for('ctx:KnowledgeDistiller') as Token<KnowledgeDistiller>,
  HierarchicalMemory: Symbol.for('ctx:HierarchicalMemory') as Token<HierarchicalMemory>,
} as const;

export type ServiceToken = typeof TOKENS[keyof typeof TOKENS];
