# Phase 3: Orchestration Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build task decomposition (DAG), a scheduler that assigns work respecting dependencies, and conflict resolution for concurrent file access. These primitives enable parallel, swarm, and hierarchical orchestration modes.

**Architecture:** A `TaskGraph` decomposes missions into a DAG of tasks with dependency edges. A `TaskScheduler` pulls ready tasks (all deps met) and assigns them to agents via the MessageBus. A `ConflictResolver` manages read/write lock upgrades and soul-based priority when agents contend for the same resource.

**Tech Stack:** TypeScript (strict, ESNext, NodeNext), SQLite (better-sqlite3), existing AgentRegistry + MessageBus + EventBus.

---

## File Structure

### New Files

```
packages/core/src/orchestration/
  types.ts              — TaskNode, TaskGraph, MissionProgress interfaces
  task-graph.ts         — DAG construction and validation
  scheduler.ts          — TaskScheduler (assign, complete, fail, getReady)
  conflict-resolver.ts  — Read/write lock upgrade + soul-based priority
  index.ts              — Barrel exports

packages/core/src/tests/
  task-graph.test.ts
  scheduler.test.ts
  conflict-resolver.test.ts
```

### Modified Files

```
packages/core/src/database/schema.ts     — Add task_nodes + task_dependencies tables
packages/core/src/container/tokens.ts    — Add orchestration tokens
packages/core/src/container/defaults.ts  — Register orchestration services
packages/core/src/index.ts               — Export orchestration modules
```

---

## Task 1: Define Orchestration Types + Schema

## Task 2: Implement TaskGraph (DAG Construction + Validation)

## Task 3: Implement TaskScheduler

## Task 4: Implement ConflictResolver

## Task 5: Wire Up + Final Validation
