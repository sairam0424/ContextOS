# Phase 1: Service Composability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate singleton coupling so services can be injected, tested in isolation, and instantiated per-workspace. Introduce an event bus to decouple the watch/repair/indexing pipeline. This unblocks multi-agent support in Phase 2.

**Architecture:** A lightweight `ServiceContainer` with typed tokens, lazy resolution, and scoped child containers. An `EventBus` decouples the watch service from indexing, validation, and repair. Services receive dependencies via constructor parameters with fallback to the shared singleton for backward compatibility during migration.

**Tech Stack:** TypeScript (strict, ESNext, NodeNext), Node.js EventEmitter (for event bus), existing Mocha + assert tests.

---

## File Structure

### New Files

```
packages/core/src/container/
  tokens.ts              — Typed service tokens (Symbol.for)
  container.ts           — ServiceContainer class (register, resolve, createScope)
  index.ts              — Re-exports

packages/core/src/events/
  types.ts              — Event type definitions
  event-bus.ts          — WorkspaceEventBus implementation
  index.ts             — Re-exports

packages/core/src/tests/
  container.test.ts    — ServiceContainer unit tests
  event-bus.test.ts    — EventBus unit tests
```

### Modified Files

```
packages/core/src/services/watch.ts         — Emit events instead of calling services directly
packages/core/src/services/intelligence-queue.ts — Accept EventBus, emit on failure
packages/core/src/index.ts                  — Export new modules
```

---

## Task 1: Create Service Tokens

**Files:**
- Create: `packages/core/src/container/tokens.ts`

- [ ] **Step 1: Create tokens module**

```typescript
export const TOKENS = {
  Database: Symbol.for('ctx:Database'),
  EventBus: Symbol.for('ctx:EventBus'),
  Intelligence: Symbol.for('ctx:Intelligence'),
  IntelligenceQueue: Symbol.for('ctx:IntelligenceQueue'),
  KnowledgeGraph: Symbol.for('ctx:KnowledgeGraph'),
  Embedding: Symbol.for('ctx:Embedding'),
  Sampling: Symbol.for('ctx:Sampling'),
  Validation: Symbol.for('ctx:Validation'),
  Watch: Symbol.for('ctx:Watch'),
  Repair: Symbol.for('ctx:Repair'),
  Locking: Symbol.for('ctx:Locking'),
  Mission: Symbol.for('ctx:Mission'),
  Federation: Symbol.for('ctx:Federation'),
  Capability: Symbol.for('ctx:Capability'),
  WorkspaceConfig: Symbol.for('ctx:WorkspaceConfig'),
  Workspace: Symbol.for('ctx:Workspace'),
} as const;

export type ServiceToken = typeof TOKENS[keyof typeof TOKENS];
```

- [ ] **Step 2: Create barrel**

Create `packages/core/src/container/index.ts`:

```typescript
export { TOKENS, type ServiceToken } from './tokens.js';
export { ServiceContainer } from './container.js';
```

- [ ] **Step 3: Verify compilation**

```bash
cd packages/core && npx tsc --noEmit
```

Note: This will fail because `container.ts` doesn't exist yet. That's fine — we'll create it in Task 2.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/container/tokens.ts packages/core/src/container/index.ts
git commit -m "feat(core): add service container tokens"
```

---

## Task 2: Create ServiceContainer

**Files:**
- Create: `packages/core/src/container/container.ts`
- Create: `packages/core/src/tests/container.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/tests/container.test.ts`:

```typescript
import assert from 'node:assert';
import { ServiceContainer } from '../container/container.js';

describe('ServiceContainer', function () {
  it('registers and resolves a service', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Greeter');

    container.register(token, () => ({ greet: () => 'hello' }));
    const service = container.resolve<{ greet: () => string }>(token);

    assert.strictEqual(service.greet(), 'hello');
  });

  it('returns same instance on subsequent resolves (singleton within container)', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Counter');
    let count = 0;

    container.register(token, () => ({ id: ++count }));

    const a = container.resolve<{ id: number }>(token);
    const b = container.resolve<{ id: number }>(token);

    assert.strictEqual(a.id, b.id);
    assert.strictEqual(count, 1);
  });

  it('throws on unregistered token', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Missing');

    assert.throws(() => container.resolve(token), /No factory registered/);
  });

  it('createScope inherits parent registrations', () => {
    const parent = new ServiceContainer();
    const token = Symbol.for('test:Shared');

    parent.register(token, () => ({ value: 42 }));

    const child = parent.createScope();
    const service = child.resolve<{ value: number }>(token);

    assert.strictEqual(service.value, 42);
  });

  it('createScope can override parent registrations', () => {
    const parent = new ServiceContainer();
    const token = Symbol.for('test:Override');

    parent.register(token, () => ({ value: 'parent' }));

    const child = parent.createScope();
    child.register(token, () => ({ value: 'child' }));

    assert.strictEqual(parent.resolve<{ value: string }>(token).value, 'parent');
    assert.strictEqual(child.resolve<{ value: string }>(token).value, 'child');
  });
});
```

- [ ] **Step 2: Create container implementation**

Create `packages/core/src/container/container.ts`:

```typescript
type Factory<T> = (container: ServiceContainer) => T;

export class ServiceContainer {
  private factories = new Map<symbol, Factory<unknown>>();
  private instances = new Map<symbol, unknown>();
  private parent: ServiceContainer | null;

  constructor(parent: ServiceContainer | null = null) {
    this.parent = parent;
  }

  register<T>(token: symbol, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
    this.instances.delete(token);
  }

  resolve<T>(token: symbol): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const factory = this.factories.get(token) ?? this.parent?.getFactory(token);
    if (!factory) {
      throw new Error(`No factory registered for token: ${String(token)}`);
    }

    const instance = factory(this);
    this.instances.set(token, instance);
    return instance as T;
  }

  has(token: symbol): boolean {
    return this.factories.has(token) || (this.parent?.has(token) ?? false);
  }

  createScope(): ServiceContainer {
    return new ServiceContainer(this);
  }

  private getFactory(token: symbol): Factory<unknown> | undefined {
    return this.factories.get(token) ?? this.parent?.getFactory(token);
  }
}
```

- [ ] **Step 3: Build and run tests**

```bash
cd packages/core && npm run build && /opt/homebrew/bin/node ../../node_modules/.bin/mocha dist/tests/container.test.js
```

Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/container/container.ts packages/core/src/container/index.ts packages/core/src/tests/container.test.ts
git commit -m "feat(core): implement ServiceContainer with scoped resolution"
```

---

## Task 3: Create Event Types

**Files:**
- Create: `packages/core/src/events/types.ts`

- [ ] **Step 1: Create event types**

```typescript
export type WorkspaceEvent =
  | { type: 'file.changed'; path: string; kind: 'add' | 'change' }
  | { type: 'file.deleted'; path: string }
  | { type: 'index.updated'; path: string }
  | { type: 'validation.failed'; path: string; issues: string[] }
  | { type: 'repair.started'; path: string }
  | { type: 'repair.completed'; path: string; success: boolean }
  | { type: 'embedding.ready'; path: string; docId: number }
  | { type: 'embedding.failed'; path: string; docId: number; error: string }
  | { type: 'lock.acquired'; path: string; agentId: string }
  | { type: 'lock.released'; path: string; agentId: string }
  | { type: 'agent.focused'; path: string; agentId: string }
  | { type: 'pulse.updated'; healthScore: number };

export type EventType = WorkspaceEvent['type'];

export type EventPayload<T extends EventType> = Extract<WorkspaceEvent, { type: T }>;

export type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/events/types.ts
git commit -m "feat(core): define workspace event types"
```

---

## Task 4: Create EventBus

**Files:**
- Create: `packages/core/src/events/event-bus.ts`
- Create: `packages/core/src/events/index.ts`
- Create: `packages/core/src/tests/event-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/tests/event-bus.test.ts`:

```typescript
import assert from 'node:assert';
import { WorkspaceEventBus } from '../events/event-bus.js';

describe('WorkspaceEventBus', function () {
  it('emits and receives typed events', () => {
    const bus = new WorkspaceEventBus();
    const received: any[] = [];

    bus.on('file.changed', (event) => {
      received.push(event);
    });

    bus.emit({ type: 'file.changed', path: 'test.md', kind: 'add' });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].path, 'test.md');
    assert.strictEqual(received[0].kind, 'add');
  });

  it('supports multiple handlers for same event type', () => {
    const bus = new WorkspaceEventBus();
    let count = 0;

    bus.on('file.deleted', () => { count++; });
    bus.on('file.deleted', () => { count++; });

    bus.emit({ type: 'file.deleted', path: 'gone.md' });

    assert.strictEqual(count, 2);
  });

  it('unsubscribe removes handler', () => {
    const bus = new WorkspaceEventBus();
    let count = 0;

    const unsub = bus.on('file.changed', () => { count++; });
    bus.emit({ type: 'file.changed', path: 'a.md', kind: 'change' });
    unsub();
    bus.emit({ type: 'file.changed', path: 'b.md', kind: 'change' });

    assert.strictEqual(count, 1);
  });

  it('once resolves on next matching event', async () => {
    const bus = new WorkspaceEventBus();

    const promise = bus.once('embedding.ready');
    bus.emit({ type: 'embedding.ready', path: 'doc.md', docId: 1 });

    const event = await promise;
    assert.strictEqual(event.docId, 1);
  });

  it('does not cross-fire between event types', () => {
    const bus = new WorkspaceEventBus();
    let received = false;

    bus.on('file.deleted', () => { received = true; });
    bus.emit({ type: 'file.changed', path: 'x.md', kind: 'add' });

    assert.strictEqual(received, false);
  });
});
```

- [ ] **Step 2: Create event bus implementation**

Create `packages/core/src/events/event-bus.ts`:

```typescript
import type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './types.js';

type Unsubscribe = () => void;

export class WorkspaceEventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();

  on<T extends EventType>(type: T, handler: EventHandler<T>): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  once<T extends EventType>(type: T): Promise<EventPayload<T>> {
    return new Promise((resolve) => {
      const unsub = this.on(type, (event) => {
        unsub();
        resolve(event);
      });
    });
  }

  emit(event: WorkspaceEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(event as any);
    }
  }
}
```

- [ ] **Step 3: Create barrel**

Create `packages/core/src/events/index.ts`:

```typescript
export { WorkspaceEventBus } from './event-bus.js';
export type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './types.js';
```

- [ ] **Step 4: Build and run tests**

```bash
cd packages/core && npm run build && /opt/homebrew/bin/node ../../node_modules/.bin/mocha dist/tests/event-bus.test.js
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/ packages/core/src/tests/event-bus.test.ts
git commit -m "feat(core): implement WorkspaceEventBus with typed events"
```

---

## Task 5: Export New Modules from Core Barrel

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports for container and events**

Add these lines to `packages/core/src/index.ts`:

```typescript
export { ServiceContainer, TOKENS } from './container/index.js';
export type { ServiceToken } from './container/index.js';
export { WorkspaceEventBus } from './events/index.js';
export type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './events/index.js';
```

- [ ] **Step 2: Build full monorepo**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: All packages build clean

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export ServiceContainer and EventBus from core barrel"
```

---

## Task 6: Wire EventBus into WatchService

**Files:**
- Modify: `packages/core/src/services/watch.ts`

- [ ] **Step 1: Refactor WatchService to emit events**

The watch service currently calls `validationService`, `repairService`, `globalIndexer`, and `samplingService` directly. Refactor it to accept an optional `WorkspaceEventBus` and emit events, while keeping backward compatibility (if no bus provided, call services directly as before).

Update the constructor and key methods:

```typescript
import { WorkspaceEventBus } from '../events/index.js';

export class WatchService extends EventEmitter {
    private watcher: FSWatcher | null = null;
    private repairCount: Map<string, number> = new Map();
    private repairing = new Set<string>();
    private pruneInterval: NodeJS.Timeout | null = null;
    private eventBus: WorkspaceEventBus | null;

    constructor(eventBus?: WorkspaceEventBus) {
        super();
        this.eventBus = eventBus ?? null;
    }
```

In `handleEvent`, after detecting a change, emit to the bus:
```typescript
this.eventBus?.emit({ type: 'file.changed', path: relativePath, kind: 'change' });
```

In `handleDeletion`:
```typescript
this.eventBus?.emit({ type: 'file.deleted', path: relativePath });
```

Keep all existing direct service calls for now — the event bus is additive, not replacing.

- [ ] **Step 2: Update singleton export**

Change the singleton at the bottom to not pass a bus (backward compat):
```typescript
export const watchService = new WatchService();
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: Builds clean

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/watch.ts
git commit -m "feat(core): wire EventBus into WatchService (additive, backward-compatible)"
```

---

## Task 7: Wire EventBus into IntelligenceQueueService

**Files:**
- Modify: `packages/core/src/services/intelligence-queue.ts`

- [ ] **Step 1: Add EventBus support**

Update `IntelligenceQueueService` to accept an optional `WorkspaceEventBus`:

```typescript
import { WorkspaceEventBus } from '../events/index.js';

export class IntelligenceQueueService {
    private dbService: DatabaseService;
    private embeddingService: EmbeddingService;
    private eventBus: WorkspaceEventBus | null;
    private isRunning: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private batchSize: number = 5;

    constructor(db?: DatabaseService, embeddingService?: EmbeddingService, eventBus?: WorkspaceEventBus) {
        this.dbService = db || getSharedDatabase();
        this.embeddingService = embeddingService || getSharedEmbeddingService();
        this.eventBus = eventBus ?? null;
    }
```

In `processItem`, after successful embedding:
```typescript
this.eventBus?.emit({ type: 'embedding.ready', path: doc.path, docId: item.doc_id });
```

On max retries failure:
```typescript
this.eventBus?.emit({ type: 'embedding.failed', path: doc.path ?? 'unknown', docId: item.doc_id, error: errMsg });
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: Builds clean

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/intelligence-queue.ts
git commit -m "feat(core): wire EventBus into IntelligenceQueueService"
```

---

## Task 8: Create Default Container Factory

**Files:**
- Create: `packages/core/src/container/defaults.ts`
- Modify: `packages/core/src/container/index.ts`

- [ ] **Step 1: Create default container factory**

Create `packages/core/src/container/defaults.ts`:

```typescript
import { ServiceContainer } from './container.js';
import { TOKENS } from './tokens.js';
import { getSharedDatabase } from '../database/index.js';
import { WorkspaceEventBus } from '../events/index.js';

export function createDefaultContainer(): ServiceContainer {
  const container = new ServiceContainer();

  container.register(TOKENS.EventBus, () => new WorkspaceEventBus());
  container.register(TOKENS.Database, () => getSharedDatabase());

  return container;
}
```

- [ ] **Step 2: Update barrel**

Add to `packages/core/src/container/index.ts`:

```typescript
export { createDefaultContainer } from './defaults.js';
```

- [ ] **Step 3: Update core barrel**

Add to `packages/core/src/index.ts`:

```typescript
export { createDefaultContainer } from './container/index.js';
```

- [ ] **Step 4: Build**

```bash
cd /Users/sairamugge/Desktop/ContextOS && npm run build
```

Expected: Builds clean

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/container/ packages/core/src/index.ts
git commit -m "feat(core): add createDefaultContainer factory with standard registrations"
```

---

## Task 9: Final Validation

**Files:** None (verification only)

- [ ] **Step 1: Clean build**

```bash
cd /Users/sairamugge/Desktop/ContextOS && rm -rf .turbo/cache packages/core/dist workspace-cli/dist workspace-mcp/dist && npm run build
```

Expected: All 4 packages build clean

- [ ] **Step 2: Run existing tests**

```bash
cd packages/core && /opt/homebrew/bin/node ../../node_modules/.bin/mocha 'dist/tests/**/*.test.js'
```

Expected: All tests pass

- [ ] **Step 3: Verify downstream**

```bash
cd workspace-mcp && npx tsc --noEmit && cd ../workspace-cli && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 4: Tag completion**

```bash
git tag phase1-complete
```

---

## Summary

| Task | What | Lines |
|------|------|-------|
| 1 | Service tokens | ~20 |
| 2 | ServiceContainer + tests | ~50 + ~60 |
| 3 | Event types | ~20 |
| 4 | EventBus + tests | ~35 + ~55 |
| 5 | Export from core barrel | ~5 |
| 6 | Wire EventBus into WatchService | ~10 delta |
| 7 | Wire EventBus into IntelligenceQueue | ~10 delta |
| 8 | Default container factory | ~15 |
| 9 | Final validation | — |

**Phase 1 exit criteria:**
- [ ] ServiceContainer with register/resolve/createScope working
- [ ] WorkspaceEventBus with typed events operational
- [ ] WatchService emits file.changed/file.deleted events
- [ ] IntelligenceQueue emits embedding.ready/embedding.failed events
- [ ] All existing tests pass
- [ ] Full monorepo build clean
- [ ] Default container factory available for Phase 2
