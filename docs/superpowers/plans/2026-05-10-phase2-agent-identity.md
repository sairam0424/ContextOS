# Phase 2: Agent Identity & Communication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents first-class entities with identity, lifecycle, heartbeat detection, and message passing. This enables all three orchestration patterns (parallel, swarm, hierarchical) in Phase 3.

**Architecture:** An `AgentRegistry` manages agent lifecycle (register, active, deregister/quarantine). A `MessageBus` enables point-to-point and broadcast communication between agents. Both backed by SQLite tables for durability, integrated with EventBus for real-time notification.

**Tech Stack:** TypeScript (strict, ESNext, NodeNext), SQLite (better-sqlite3), EventBus (Phase 1), Mocha + assert tests.

---

## File Structure

### New Files

```
packages/core/src/agents/
  types.ts              — Agent and message interfaces
  registry.ts           — AgentRegistry class
  message-bus.ts        — MessageBus class
  index.ts              — Barrel exports

packages/core/src/tests/
  agent-registry.test.ts
  message-bus.test.ts
```

### Modified Files

```
packages/core/src/database/schema.ts     — Add agents + agent_messages tables
packages/core/src/database/index.ts      — Add getRawDb() accessor
packages/core/src/container/tokens.ts    — Add AgentRegistry + MessageBus tokens
packages/core/src/container/defaults.ts  — Register new services
packages/core/src/index.ts               — Export agent modules
```

---

## Task 1: Define Agent Types + Add Schema Tables

Create `packages/core/src/agents/types.ts` with AgentRecord, RegisterOpts, AgentMessage, SendMessageOpts, AgentStatus interfaces.

Add `agents` and `agent_messages` tables to `packages/core/src/database/schema.ts` in the `initializeSchema` function.

Add `getRawDb()` method to DatabaseService in `packages/core/src/database/index.ts`.

## Task 2: Implement AgentRegistry + Tests

Create `packages/core/src/agents/registry.ts` with register, heartbeat, deregister, quarantine, getActive, getById, findByCapability, getStale methods.

Create `packages/core/src/tests/agent-registry.test.ts` testing full lifecycle.

## Task 3: Implement MessageBus + Tests

Create `packages/core/src/agents/message-bus.ts` with send (direct + broadcast), getUndelivered, getBroadcasts, acknowledge, getByCorrelation.

Create `packages/core/src/tests/message-bus.test.ts` testing delivery, acknowledgment, broadcast, correlation, TTL expiry.

## Task 4: Wire Up — Barrel, Container, Exports

Create `packages/core/src/agents/index.ts` barrel.
Add `AgentRegistry` and `MessageBus` tokens.
Register both in `createDefaultContainer()`.
Export from `packages/core/src/index.ts`.

## Task 5: Final Validation

Clean build, all tests pass, downstream compiles, tag phase2-complete.
