import { ServiceContainer } from './container/container.js';
import { TOKENS } from './container/tokens.js';
import { DatabaseService } from './database/index.js';
import { WorkspaceEventBus } from './events/event-bus.js';
import { EventStore } from './events/event-store.js';
import { AgentRegistry } from './agents/registry.js';
import { MessageBus } from './agents/message-bus.js';
import { TaskGraph } from './orchestration/task-graph.js';
import { TaskScheduler } from './orchestration/scheduler.js';
import { ConflictResolver } from './orchestration/conflict-resolver.js';
import { CircuitBreaker } from './resilience/circuit-breaker.js';
import { AuditLog } from './resilience/audit-log.js';
import { IntelligenceService } from './services/intelligence.js';
import { IntelligenceQueueService } from './services/intelligence-queue.js';
import { KnowledgeGraphService } from './services/knowledge-graph.js';
import { EmbeddingService } from './services/embedding.js';
import { SamplingService } from './services/sampling.js';
import { ValidationService } from './services/validation.js';
import { WatchService } from './services/watch.js';
import { SelfRepairService } from './services/repair.js';
import { LockingService } from './services/locking.js';
import { MissionService } from './services/mission.js';
import { FederationService } from './services/federation.js';
import { CapabilityService } from './services/capability.js';
import { WorkspaceConfigService } from './services/workspace-config.js';
import { WorkspaceService } from './services/workspace.js';
import { MetricsCollector } from './metrics/collector.js';
import { MemoryStream } from './cognitive/memory-stream.js';
import { ReflectionEngine } from './cognitive/reflection-engine.js';
import { SkillLibrary } from './cognitive/skill-library.js';
import { LanguageAgentTreeSearch } from './cognitive/tree-search.js';
import { TemporalGraphService } from './services/temporal-graph.js';
import { SwarmOrchestrator } from './orchestration/swarm-orchestrator.js';
import { NegotiationService } from './orchestration/negotiation.js';
import { ConsensusService } from './orchestration/consensus.js';
import { CapabilityTokenService } from './governance/capability-token.js';
import { TrustEngine } from './governance/trust-engine.js';
import { PolicyEngine } from './governance/policy-engine.js';
import { AnomalyDetector } from './governance/anomaly-detection.js';
import { EventProcessor } from './streaming/event-processor.js';
import { PredictiveHealthMonitor } from './streaming/predictive-health.js';
import { KnowledgeDistiller } from './streaming/knowledge-distiller.js';
import { HierarchicalMemory } from './streaming/hierarchical-memory.js';
import { GitIntelligenceService } from './services/git-intelligence.js';
import { MultiModalFusionService } from './services/fusion-scoring.js';
import { GraphRAGService } from './services/graph-rag.js';
import { PredictiveFailureService } from './resilience/predictive-failure.js';

/**
 * Configuration for initializing a ContextOS instance.
 */
export interface ContextOSConfig {
  /** Absolute path to the workspace root directory. */
  workspaceRoot: string;
  /** Optional override for database file path. Defaults to `<workspaceRoot>/.context-db/context.db`. */
  dbPath?: string;
}

/**
 * The fully-wired ContextOS system facade.
 * All services are lazily resolved from the DI container on first access.
 */
export interface ContextOS {
  readonly container: ServiceContainer;
  readonly agents: AgentRegistry;
  readonly tasks: TaskGraph;
  readonly scheduler: TaskScheduler;
  readonly events: WorkspaceEventBus;
  readonly database: DatabaseService;
  readonly audit: AuditLog;
  readonly circuitBreaker: CircuitBreaker;
  readonly conflicts: ConflictResolver;
  readonly messages: MessageBus;
  /** Gracefully closes database connections and releases resources. */
  shutdown(): void;
}

/**
 * Creates a fully-wired ContextOS instance with all services registered in the DI container.
 *
 * This is the recommended entry point for new code. It avoids module-level singletons
 * and gives callers full control over lifecycle and configuration.
 *
 * @example
 * ```typescript
 * const ctx = createContextOS({ workspaceRoot: '/path/to/workspace' });
 * const agent = ctx.agents.register({ name: 'my-agent', capabilities: ['read'] });
 * ctx.shutdown(); // clean up when done
 * ```
 */
export function createContextOS(config: ContextOSConfig): ContextOS {
  const container = new ServiceContainer();

  const dbPath = config.dbPath ?? `${config.workspaceRoot}/.context-db/context.db`;

  // --- Register all service factories ---

  container.register(TOKENS.Database, () => new DatabaseService(config.workspaceRoot, dbPath));

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());

  container.register(TOKENS.AgentRegistry, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new AgentRegistry(db.getRawDb(), bus);
  });

  container.register(TOKENS.MessageBus, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new MessageBus(db.getRawDb(), bus);
  });

  container.register(TOKENS.TaskGraph, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new TaskGraph(db.getRawDb(), bus);
  });

  container.register(TOKENS.TaskScheduler, (c) => {
    const db = c.resolve(TOKENS.Database);
    const registry = c.resolve(TOKENS.AgentRegistry);
    const msgBus = c.resolve(TOKENS.MessageBus);
    const bus = c.resolve(TOKENS.EventBus);
    return new TaskScheduler(db.getRawDb(), registry, msgBus, bus);
  });

  container.register(TOKENS.ConflictResolver, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new ConflictResolver(db.getRawDb());
  });

  container.register(TOKENS.CircuitBreaker, (c) => {
    const registry = c.resolve(TOKENS.AgentRegistry);
    return new CircuitBreaker(registry);
  });

  container.register(TOKENS.AuditLog, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new AuditLog(db.getRawDb());
  });

  container.register(TOKENS.EventStore, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new EventStore(db.getRawDb());
  });

  container.register(TOKENS.Embedding, () => {
    return new EmbeddingService(process.env.GEMINI_API_KEY, process.env.OLLAMA_MODEL);
  });

  container.register(TOKENS.Intelligence, () => {
    return new IntelligenceService();
  });

  container.register(TOKENS.IntelligenceQueue, (c) => {
    const db = c.resolve(TOKENS.Database);
    const embedding = c.resolve(TOKENS.Embedding);
    const bus = c.resolve(TOKENS.EventBus);
    return new IntelligenceQueueService(db, embedding, bus);
  });

  container.register(TOKENS.KnowledgeGraph, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new KnowledgeGraphService(db);
  });

  container.register(TOKENS.Sampling, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new SamplingService(db);
  });

  container.register(TOKENS.Validation, () => {
    return new ValidationService();
  });

  container.register(TOKENS.Watch, (c) => {
    const bus = c.resolve(TOKENS.EventBus);
    return new WatchService(bus);
  });

  container.register(TOKENS.Repair, () => {
    return new SelfRepairService();
  });

  container.register(TOKENS.Locking, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new LockingService(db);
  });

  container.register(TOKENS.Mission, () => {
    return new MissionService();
  });

  container.register(TOKENS.Federation, () => {
    return new FederationService();
  });

  container.register(TOKENS.Capability, () => {
    return new CapabilityService();
  });

  container.register(TOKENS.WorkspaceConfig, () => {
    return new WorkspaceConfigService();
  });

  container.register(TOKENS.Workspace, () => {
    return new WorkspaceService();
  });

  container.register(TOKENS.Metrics, () => {
    return new MetricsCollector();
  });

  container.register(TOKENS.MemoryStream, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new MemoryStream(db.getRawDb(), bus);
  });

  container.register(TOKENS.ReflectionEngine, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    const memory = c.resolve(TOKENS.MemoryStream);
    return new ReflectionEngine(db.getRawDb(), bus, memory);
  });

  container.register(TOKENS.SkillLibrary, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new SkillLibrary(db.getRawDb());
  });

  container.register(TOKENS.TreeSearch, () => {
    return new LanguageAgentTreeSearch();
  });

  container.register(TOKENS.TemporalGraph, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new TemporalGraphService(db.getRawDb(), bus);
  });

  container.register(TOKENS.SwarmOrchestrator, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    const scheduler = c.resolve(TOKENS.TaskScheduler);
    const registry = c.resolve(TOKENS.AgentRegistry);
    return new SwarmOrchestrator(db.getRawDb(), bus, scheduler, registry);
  });

  container.register(TOKENS.Negotiation, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new NegotiationService(db.getRawDb(), bus);
  });

  container.register(TOKENS.Consensus, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new ConsensusService(db.getRawDb(), bus);
  });

  container.register(TOKENS.CapabilityToken, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new CapabilityTokenService(db.getRawDb(), bus);
  });

  container.register(TOKENS.TrustEngine, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new TrustEngine(db.getRawDb(), bus);
  });

  container.register(TOKENS.PolicyEngine, (c) => {
    const db = c.resolve(TOKENS.Database);
    const trust = c.resolve(TOKENS.TrustEngine);
    return new PolicyEngine(db.getRawDb(), trust);
  });

  container.register(TOKENS.AnomalyDetector, (c) => {
    const db = c.resolve(TOKENS.Database);
    const bus = c.resolve(TOKENS.EventBus);
    return new AnomalyDetector(db.getRawDb(), bus);
  });

  container.register(TOKENS.EventProcessor, (c) => {
    const bus = c.resolve(TOKENS.EventBus);
    return new EventProcessor(bus);
  });

  container.register(TOKENS.PredictiveHealth, (c) => {
    const bus = c.resolve(TOKENS.EventBus);
    return new PredictiveHealthMonitor(bus);
  });

  container.register(TOKENS.KnowledgeDistiller, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new KnowledgeDistiller(db.getRawDb());
  });

  container.register(TOKENS.HierarchicalMemory, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new HierarchicalMemory(db.getRawDb());
  });

  container.register(TOKENS.GitIntelligence, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new GitIntelligenceService(db.getRawDb(), config.workspaceRoot);
  });

  container.register(TOKENS.FusionScoring, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new MultiModalFusionService(db.getRawDb());
  });

  container.register(TOKENS.GraphRAG, (c) => {
    const db = c.resolve(TOKENS.Database);
    return new GraphRAGService(db.getRawDb());
  });

  container.register(TOKENS.PredictiveFailure, (c) => {
    const bus = c.resolve(TOKENS.EventBus);
    return new PredictiveFailureService(bus);
  });

  // --- Resolve the service graph (lazy singletons instantiated on first access) ---

  const database = container.resolve(TOKENS.Database);
  const events = container.resolve(TOKENS.EventBus);
  const agents = container.resolve(TOKENS.AgentRegistry);
  const messages = container.resolve(TOKENS.MessageBus);
  const tasks = container.resolve(TOKENS.TaskGraph);
  const scheduler = container.resolve(TOKENS.TaskScheduler);
  const conflicts = container.resolve(TOKENS.ConflictResolver);
  const circuitBreaker = container.resolve(TOKENS.CircuitBreaker);
  const audit = container.resolve(TOKENS.AuditLog);

  return Object.freeze({
    container,
    agents,
    tasks,
    scheduler,
    events,
    database,
    audit,
    circuitBreaker,
    conflicts,
    messages,
    shutdown() {
      database.close();
    },
  });
}
