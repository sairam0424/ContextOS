# ContextOS v2: Multi-Agent Orchestration Platform

**Date**: 2026-05-08
**Status**: PROPOSED
**Branch**: `feat/v2-architecture`
**Author**: sairam + claude (architectural review)

---

## North Star

ContextOS v2 becomes a composable intelligence platform where multiple AI agents work independently, coordinate as swarms, or operate in orchestrator-worker hierarchies — all sharing a unified workspace graph with conflict-free state management.

---

## Current State (v1.12.0)

### Strengths to Preserve

| Area | What Works |
|------|-----------|
| Hybrid Search | FTS5 + sqlite-vec + grep fallback with affinity reranking |
| Security Model | Allowed-bucket whitelist + path canonicalization + read-only enforcement |
| Identity Layer | Soul abstraction (soul.md, decisions.md, personality.md) |
| Monorepo Structure | Clean separation: core -> cli/mcp/dashboard with Turbo |
| Dual Transport | HTTP/SSE + stdio for web-native and CLI agents |

### Architectural Debt

| ID | Problem | Impact |
|----|---------|--------|
| D1 | `database.ts` is 639-line god-object (schema + migrations + queries + connection) | Blocks multi-workspace support |
| D2 | All services are process-global singletons | Cannot run two agents on two projects in same process |
| D3 | No structured logging or tracing | Impossible to debug multi-agent interactions |
| D4 | No agent identity model | Agents are anonymous; locks have `agentId` but no registry |
| D5 | Watch service mixes 4 responsibilities (monitoring + validation + repair + indexing) | Cannot extend without risk |
| D6 | Dashboard served inline from CLI command (265 lines) | Mixed concerns, hard to test |
| D7 | Tests require compile-then-run (tsc -> mocha dist/) | Slow feedback loop |

### Known Bugs (from v2-upgrade-plan.md)

| ID | Bug | Fix Phase |
|----|-----|-----------|
| B1 | Vector dimension mismatch (768D Gemini vs 384D local) causes silent failures | Phase 0 |
| B3 | `daily/` absent from ALLOWED_BUCKETS | Phase 0 |
| B5 | Intelligence queue silently drops failed embeddings | Phase 0 |
| B6 | AetherGraph bucket clustering dead code | Phase 0 |

---

## Target Architecture

### Orchestration Patterns Supported

```
1. PARALLEL AUTONOMY
   Agent A ──lock(file1)──► work ──unlock──►
   Agent B ──lock(file2)──► work ──unlock──►
   (No communication needed; lock-based isolation)

2. COORDINATED SWARM
   Agent A ──broadcast("find auth bugs")──►
   Agent B ◄── responds with findings
   Agent C ◄── responds with findings
   Aggregator merges results
   (Broadcast + collect; no central authority)

3. HIERARCHICAL DELEGATION
   Orchestrator ──decompose mission──► task DAG
        ├── assign(task1) ──► Worker A ──► report(result1)
        ├── assign(task2) ──► Worker B ──► report(result2)
        └── assign(task3, depends=[1,2]) ──► Worker C
   (Central authority with dependency awareness)
```

### Layered Architecture (v2)

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                            │
│  CLI (Commander)  │  MCP (stdio+HTTP)  │  Aether HUD (React) │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                  ORCHESTRATION LAYER (NEW)                    │
│  AgentRegistry │ MessageBus │ TaskScheduler │ ConflictResolver│
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                  SERVICE LAYER (Refactored)                   │
│  Intelligence │ KnowledgeGraph │ Embedding │ Validation │ ... │
│  (All injectable via ServiceContainer)                        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                  INFRASTRUCTURE LAYER                         │
│  DatabasePool │ EventBus │ Logger (pino) │ ConfigStore        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                  PERSISTENCE LAYER                            │
│  SQLite (per-workspace) │ File System │ Git (audit trail)     │
└─────────────────────────────────────────────────────────────┘
```

### Key New Abstractions

```typescript
// --- Infrastructure ---

interface ServiceContainer {
  register<T>(token: symbol, factory: ServiceFactory<T>): void;
  resolve<T>(token: symbol): T;
  createScope(workspace: string): ServiceContainer;
}

interface WorkspaceEventBus {
  emit<T extends EventType>(event: T, payload: EventPayload<T>): void;
  on<T extends EventType>(event: T, handler: (payload: EventPayload<T>) => void): Unsubscribe;
}

type WorkspaceEvent =
  | { type: 'file.changed'; path: string; kind: 'add' | 'change' | 'unlink' }
  | { type: 'lock.acquired'; path: string; agentId: string }
  | { type: 'lock.released'; path: string; agentId: string }
  | { type: 'agent.registered'; agentId: string; capabilities: string[] }
  | { type: 'agent.heartbeat'; agentId: string }
  | { type: 'agent.deregistered'; agentId: string; reason: string }
  | { type: 'task.assigned'; taskId: string; agentId: string }
  | { type: 'task.completed'; taskId: string; result: TaskResult }
  | { type: 'message.received'; message: AgentMessage };

// --- Agent Identity ---

interface AgentRecord {
  id: string;                    // UUID
  name: string;                  // Human-readable (e.g., "code-reviewer")
  capabilities: string[];        // Matched via TF-IDF routing
  status: 'active' | 'idle' | 'quarantined';
  transport: 'stdio' | 'http';
  lastHeartbeat: number;         // Unix timestamp
  registeredAt: number;
  metadata: Record<string, unknown>;
}

interface AgentRegistry {
  register(opts: RegisterOpts): Promise<AgentRecord>;
  heartbeat(agentId: string): Promise<void>;
  deregister(agentId: string, reason: string): Promise<void>;
  findByCapability(intent: string): Promise<AgentRecord[]>;
  getActive(): Promise<AgentRecord[]>;
  quarantine(agentId: string, reason: string): Promise<void>;
}

// --- Messaging ---

interface AgentMessage {
  id: string;                    // Message UUID
  correlationId?: string;        // For request-reply threading
  from: string;                  // Sender agent ID
  to: string | '*';              // Target agent ID or broadcast
  intent: string;                // Action type (e.g., "task.assign", "finding.share")
  payload: unknown;              // Intent-specific data
  timestamp: number;
  ttl?: number;                  // Message expiry (seconds)
}

interface MessageBus {
  send(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<string>;
  subscribe(agentId: string, filter?: MessageFilter): AsyncIterable<AgentMessage>;
  acknowledge(messageId: string): Promise<void>;
  getUndelivered(agentId: string): Promise<AgentMessage[]>;
}

// --- Orchestration ---

interface TaskNode {
  id: string;
  missionId: string;
  title: string;
  description: string;
  assignedTo?: string;           // Agent ID
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];        // Task IDs that must complete first
  result?: TaskResult;
  timeout: number;               // Seconds before reassignment
  retries: number;
}

interface TaskScheduler {
  decompose(missionId: string, dag: TaskNode[]): Promise<void>;
  assignNext(agentId: string): Promise<TaskNode | null>;
  complete(taskId: string, result: TaskResult): Promise<void>;
  fail(taskId: string, error: string): Promise<void>;
  getReady(): Promise<TaskNode[]>;  // Tasks with all dependencies met
  getProgress(missionId: string): Promise<MissionProgress>;
}

interface ConflictResolver {
  acquireRead(path: string, agentId: string): Promise<boolean>;
  upgradeToWrite(path: string, agentId: string): Promise<boolean>;
  resolveConflict(path: string, agents: string[]): Promise<string>;  // Winner agent ID
  merge(path: string, versions: FileVersion[]): Promise<MergeResult>;
}
```

---

## Phased Roadmap

### Phase 0: Foundation Hardening

**Duration**: 1-2 weeks
**Goal**: Fix bugs and decompose the database god-object

#### Deliverables

1. **Fix vector dimension mismatch (B1)**
   - Store `provider` + `dimensions` columns in `vec_documents`
   - Search queries filter by matching dimensions
   - Display warning in pulse when mixed providers detected

2. **Fix ALLOWED_BUCKETS (B3)**
   - Add `daily/` to bucket whitelist in `context.ts`
   - Add validation test for all expected buckets

3. **Fix dead-letter visibility (B5)**
   - Emit `embedding.failed` event on queue failure
   - Include failed count in pulse health score calculation
   - Surface in `workspace_pulse` MCP tool output

4. **Decompose database.ts**
   - `database/schema.ts` — table definitions and migrations
   - `database/connection.ts` — connection management, WAL mode, pragmas
   - `database/queries/` — organized by domain (documents, graph, locks, config)
   - `database/index.ts` — re-exports for backward compatibility

5. **Add structured logging**
   - Install `pino` with JSON output
   - Replace all `console.log/error` in core services
   - Add request ID propagation for tracing agent actions
   - Log levels: `trace` (queries), `debug` (service calls), `info` (agent actions), `warn` (degradation), `error` (failures)

#### Exit Criteria

- [ ] All 4 bugs fixed with regression tests
- [ ] database.ts split into 4+ files, no file exceeds 200 lines
- [ ] `pino` logger in all core services
- [ ] Existing tests pass, no new test failures

---

### Phase 1: Service Composability

**Duration**: 2-3 weeks
**Goal**: Eliminate singletons; make services injectable, testable, multi-instance

#### Deliverables

1. **ServiceContainer**
   ```typescript
   // packages/core/src/container.ts
   class ServiceContainer {
     private registry = new Map<symbol, ServiceFactory>();
     private instances = new Map<symbol, unknown>();

     register<T>(token: symbol, factory: ServiceFactory<T>): void;
     resolve<T>(token: symbol): T;
     createScope(overrides?: Map<symbol, ServiceFactory>): ServiceContainer;
   }
   ```
   - Lazy instantiation (resolve on first access)
   - Scoped containers for per-workspace isolation
   - Type-safe tokens via `Symbol.for('ServiceName')`

2. **Constructor Injection for All Services**
   - Every service receives dependencies as constructor params
   - No more `import { getSharedDatabase } from './database'` inside service bodies
   - Backward-compatible factory functions for existing callers

3. **WorkspaceEventBus**
   ```typescript
   // packages/core/src/events.ts
   class WorkspaceEventBus {
     private handlers = new Map<string, Set<Handler>>();

     emit<T>(type: string, payload: T): void;
     on<T>(type: string, handler: (payload: T) => void): () => void;
     once<T>(type: string): Promise<T>;
   }
   ```
   - Typed events (file.changed, lock.acquired, agent.registered, etc.)
   - Synchronous dispatch (no async queue overhead for local events)
   - `once()` for request-reply patterns

4. **Extract Watch Service responsibilities**
   - `FileWatcher` — Chokidar wrapper, emits `file.changed` events only
   - `IndexingPipeline` — subscribes to `file.changed`, runs indexer
   - `ValidationPipeline` — subscribes to `file.changed`, runs validation
   - `RepairPipeline` — subscribes to `validation.failed`, triggers repair

5. **DatabasePool**
   - Per-workspace SQLite connections
   - Health checks (WAL checkpoint, integrity check on startup)
   - Automatic cleanup on workspace deregistration

#### Exit Criteria

- [ ] Zero singleton imports in service files
- [ ] ServiceContainer tested with scope isolation
- [ ] EventBus tested with typed events
- [ ] Watch service decomposed into 4 focused modules
- [ ] All existing tests pass via backward-compatible factories

---

### Phase 2: Agent Identity & Communication

**Duration**: 2-3 weeks
**Goal**: Agents become first-class entities with identity, lifecycle, and messaging

#### Deliverables

1. **Agent Registry Service**
   - New `agents` table: id, name, capabilities (JSON), status, transport, last_heartbeat, registered_at, metadata
   - Registration flow: agent connects -> registers with capabilities -> receives ID
   - Heartbeat: 30s interval, 90s timeout before marking stale
   - Quarantine: error budget exceeded -> agent isolated from task assignment

2. **Agent Session Lifecycle**
   ```
   REGISTER ─► ACTIVE ─► (heartbeat loop) ─► DEREGISTER
                 │                                  │
                 └── (timeout/errors) ──► QUARANTINED ──► DEREGISTER
   ```
   - On deregister: release all held locks, reassign in-progress tasks
   - On quarantine: block from new assignments, notify orchestrator

3. **Message Bus**
   - New `agent_messages` table: id, correlation_id, from_agent, to_agent, intent, payload (JSON), timestamp, delivered_at, ttl
   - Direct messages: `to = agentId`
   - Broadcasts: `to = '*'` (delivered to all active agents)
   - Async delivery via EventBus (`message.received` event)
   - Undelivered queue: messages sent while agent was offline, delivered on reconnect

4. **Intent Protocol**
   - Standard intents:
     - `task.assign` / `task.complete` / `task.fail`
     - `finding.share` (swarm knowledge sharing)
     - `decision.propose` / `decision.vote` (consensus)
     - `lock.request` / `lock.granted` (cooperative locking)
   - Custom intents: any string, payload schema validated by receiver

5. **Capability-Based Routing**
   - Upgrade existing TF-IDF matcher from `capability.ts`
   - New method: `agentRegistry.findByCapability(intent)` returns ranked agents
   - Routing considers: capability score * availability * error budget

#### MCP Integration

New MCP tools:
- `agent_register` — Register this agent session with capabilities
- `agent_heartbeat` — Keep session alive
- `agent_send_message` — Send message to another agent or broadcast
- `agent_receive_messages` — Poll for undelivered messages
- `agent_list_active` — List currently active agents

#### Exit Criteria

- [ ] Agents can register, heartbeat, and deregister
- [ ] Messages delivered between agents (direct + broadcast)
- [ ] Capability routing returns ranked agents for a given intent
- [ ] Stale agent detection works (90s timeout)
- [ ] Integration tests for full agent lifecycle

---

### Phase 3: Orchestration Primitives

**Duration**: 2-3 weeks
**Goal**: Build coordination patterns that make multi-agent work reliable

#### Deliverables

1. **Mission Decomposition**
   - Extend `missions` table with `parent_mission_id` for sub-tasks
   - New `task_dependencies` table: task_id, depends_on_task_id
   - DAG validation: reject cycles, compute critical path
   - Auto-assignment: when dependencies met, find best agent via capability routing

2. **Task Scheduler**
   - Pull-based: agents request next task (`assignNext`)
   - Push-based: orchestrator assigns specific tasks
   - Timeout handling: unfinished tasks after TTL -> mark failed, reassign
   - Retry policy: configurable per-task (default: 2 retries)

3. **Conflict Resolution**
   - **Read/Write Lock Upgrade**: Multiple readers, exclusive writer
   - **Optimistic Locking**: Version numbers on documents; reject stale writes
   - **Soul-Based Resolution**: When two agents conflict, consult soul.md ranked values to determine winner
   - **Three-Way Merge**: For document conflicts, attempt structural merge before escalating

4. **Consensus Protocol (Lightweight)**
   - Use case: multi-agent architectural decisions
   - Flow: propose -> vote (within timeout) -> accept/reject based on majority
   - Tie-breaking: orchestrator's vote wins; if no orchestrator, soul.md values decide
   - Result logged as ADR in `decisions.md`

5. **Progress Tracking**
   - `MissionProgress`: { total, pending, assigned, completed, failed, criticalPath }
   - Real-time updates via EventBus
   - Aether HUD: mission nodes show completion percentage as fill level
   - CLI: `context-os mission progress <missionId>` shows DAG with status

#### Exit Criteria

- [ ] Mission decomposition creates valid DAGs
- [ ] Task scheduler assigns work respecting dependencies
- [ ] Conflict resolution handles concurrent file edits
- [ ] Consensus protocol completes within timeout
- [ ] Progress visible in both CLI and dashboard

---

### Phase 4: Observability & Resilience

**Duration**: 1-2 weeks
**Goal**: See what's happening, recover gracefully

#### Deliverables

1. **OpenTelemetry Integration**
   - Trace spans: search queries, embedding pipelines, agent message delivery
   - Metrics: active agents, message throughput, task completion rate, lock contention
   - Export: local JSON file + optional OTLP endpoint (configurable)

2. **Agent Activity Panel (Aether HUD)**
   - New dashboard tab: shows active agents as avatars on graph
   - Agent → node connection lines (what each agent is working on)
   - Message flow visualization (arrows between agents)
   - Lock contention heatmap (red = high contention paths)

3. **Circuit Breaker**
   - Per-agent error budget: 5 failures in 60s -> quarantine
   - Per-service circuit breaker: embedding provider down -> skip, don't block
   - Configurable thresholds in WorkspaceConfig

4. **Audit Trail**
   - All agent actions logged to `agent_audit_log` table
   - Merkle-linked entries (each entry hashes previous)
   - Exportable as JSONL for compliance/debugging
   - Tamper detection: verify chain integrity on demand

5. **Graceful Degradation**
   - Embedding queue backpressure: when queue > 100, pause new ingestion
   - Search fallback: if semantic fails, degrade to FTS5 + grep (never return empty)
   - Agent timeout: if no agents available for task, queue with exponential backoff

#### Exit Criteria

- [ ] Traces exported for key operations
- [ ] Dashboard shows agent activity in real-time
- [ ] Circuit breaker quarantines failing agents
- [ ] Audit trail passes integrity verification
- [ ] System degrades gracefully under load (no crashes)

---

### Phase 5: Testing & CI Hardening (Parallel with Phases 3-4)

**Duration**: 1-2 weeks
**Goal**: Ship with confidence

#### Deliverables

1. **Vitest Migration**
   - Replace Mocha + Chai with Vitest in all workspaces
   - Enable native TypeScript execution (no compile step for tests)
   - Watch mode for development (`vitest --watch`)
   - Coverage reporting via `@vitest/coverage-v8`

2. **Integration Test Suite**
   - MCP tool tests: mock transport, verify tool responses
   - CLI command tests: mock fs, verify output and side effects
   - API tests: HTTP transport round-trip with test server

3. **Multi-Agent Test Harness**
   ```typescript
   // packages/core/src/tests/harness.ts
   class MultiAgentTestHarness {
     createAgent(name: string, capabilities: string[]): TestAgent;
     runScenario(scenario: OrchestrationType, tasks: Task[]): Promise<ScenarioResult>;
     assertNoDeadlocks(): void;
     assertAllTasksCompleted(): void;
     getMessageLog(): AgentMessage[];
   }
   ```
   - Simulate 3+ agents in controlled scenarios
   - Deterministic scheduling for reproducible tests
   - Deadlock detection assertions

4. **Coverage Gates**
   - Minimum 80% line coverage per workspace
   - CI fails on coverage regression
   - Exclude: generated files, type declarations

5. **E2E Smoke Tests**
   - `context-os init` -> `context-os search` round trip
   - MCP stdio handshake + tool call
   - Dashboard WebSocket connection + pulse data
   - Multi-agent register -> message -> deregister flow

#### Exit Criteria

- [ ] Vitest running in all workspaces
- [ ] Integration tests cover all 13 MCP tools
- [ ] Multi-agent harness tests 3 orchestration modes
- [ ] Coverage > 80% enforced in CI
- [ ] E2E smoke tests pass in GitHub Actions

---

## Dependency Graph

```
Phase 0 (Foundation) ─────────────────────────────────────┐
    │                                                      │
    ▼                                                      │
Phase 1 (Service Composability) ──────────────────┐        │
    │                                             │        │
    ▼                                             ▼        │
Phase 2 (Agent Identity) ──────────┐     Phase 5 (Testing) │
    │                              │        (starts here)  │
    ▼                              │             │         │
Phase 3 (Orchestration) ──────────►├─────────────┤         │
    │                              │             │         │
    ▼                              │             ▼         │
Phase 4 (Observability) ──────────►└──── All tests green ──┘
```

## Timeline

| Phase | Weeks | Cumulative | Parallelism |
|-------|-------|------------|-------------|
| Phase 0 | 1-2 | 2 | None (sequential) |
| Phase 1 | 2-3 | 5 | None (sequential) |
| Phase 2 | 2-3 | 8 | None (sequential) |
| Phase 3 | 2-3 | 11 | Phase 5 starts |
| Phase 4 | 1-2 | 13 | Phase 5 continues |
| Phase 5 | 1-2 | — | Parallel with 3-4 |

**Total**: ~10-14 weeks

---

## Design Principles

1. **Soul-Governed Decisions**: When agents conflict, soul.md ranked values resolve disputes — not arbitrary tie-breaking.

2. **Message Primitives Over Mode-Specific Code**: All orchestration modes (parallel, swarm, hierarchical) emerge from two primitives: message passing + lock management.

3. **Graceful Degradation Over Hard Failure**: Every subsystem has a fallback — embedding fails → keyword search, agent timeout → task requeue, consensus fails → soul decides.

4. **Observability Built-In**: Every agent action is traced, every message is logged, every state transition emits an event.

5. **File-First Configuration**: Config lives in git-trackable files with SQLite as a read cache — not the reverse.

6. **Backward Compatibility**: Each phase preserves existing CLI/MCP interfaces. New capabilities are additive.

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| DI migration breaks existing tests | Medium | Medium | Backward-compatible factory functions during transition |
| Message bus becomes bottleneck | Low | High | SQLite WAL + in-memory EventBus for local; only persist for durability |
| Agent heartbeat storms at scale | Medium | Low | Coalesce heartbeats; batch acknowledgments |
| Merge conflicts in concurrent writes | Medium | High | Pessimistic locking by default; optimistic only when explicitly opted-in |
| Vitest migration disrupts CI | Low | Medium | Run both Mocha and Vitest in parallel during transition week |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Agents supported concurrently | 5+ without degradation |
| Message delivery latency (local) | < 50ms p95 |
| Task scheduling overhead | < 100ms per assignment |
| Lock acquisition time | < 10ms |
| Test coverage | > 80% all workspaces |
| Build time (full) | < 60s |
| Search latency (hybrid) | < 200ms p95 |

---

## Open Questions

1. **Persistence for messages**: SQLite table vs. append-only log file? (Recommendation: SQLite for queryability + Merkle integrity)
2. **Agent authentication**: Bearer tokens per agent, or workspace-level shared secret? (Recommendation: per-agent tokens for audit trail)
3. **Federation + multi-agent**: Should federated workspaces share agent registries? (Recommendation: no — agents are workspace-local; federation is search-only)
4. **Dashboard SSR**: Should the Aether HUD move to a separate process? (Recommendation: yes in Phase 4, keep embedded for now)
5. **Soul-based conflict resolution algorithm**: How do soul.md ranked values translate to numeric agent priority scores? (Recommendation: each value keyword gets a weight; agent actions are scored by alignment with value keywords; highest alignment score wins)
