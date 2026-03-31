# AGENTS_LEARNING.md

This file tracks agentic intelligence, mistakes, and architectural evolutions within the Context OS. It must be read by all agents at the start of a session.

## ❌ Mistakes & Mitigations

### 1. Restricted Path Access (`~/.workspace`)

- **Mistake**: Attempting to initialize the workspace at `~/.workspace/` and global Claude config at `~/.claude/` on a restricted system.
- **Mitigation**: Switched to a localized root at `/Users/sairamugge/Desktop/ContextOS/` and created a local `.claude/` proxy directory.
- **Learning**: Always verify directory write permissions before building core infrastructure.

### 2. Artifact Path Ambiguity

- **Mistake**: Attempting to write implementation plans and task lists directly to the workspace root when they must reside in the session's artifact directory.
- **Mitigation**: Standardized on `<appDataDir>/brain/<conversation-id>/` for artifact storage.
- **Learning**: Explicitly check the `<artifacts>` system instructions for path requirements.

---

## ✅ Best Practices

### 1. Master Index First

Always read `WORKSPACE.md` before performing any operation. It contains the most up-to-date context loading rules and scope definitions.

### 2. Status-First Operations

Maintain a `task.md` or equivalent to track progress. This prevents redundant work and provides a clear handoff point for future agents.

### 3. Absolute Path Normalization

Use absolute paths within the localized workspace root (`/Users/sairamugge/Desktop/ContextOS/`) to prevent ambiguity across tool calls.

---

## 🚫 Anti-Patterns

### 1. "Generic" Redundancy

Avoid creating duplicate or vague directories (e.g., `temp/`, `stuff/`). Stick to the established Scaffolding.

### 2. Information Silos

Do not perform major architectural changes without updating `root/decisions.md` (ADR).

---

## 🏗️ Architectural Patterns to Avoid

### 1. Flat Hierarchies

Never dump files directly into the root. Every file must have a designated "Ring" (Root, Org, Project, Skills, Knowledge).

### 2. Un-indexed Memory Blocks

Do not create complex knowledge structures without updating the Master Index (`WORKSPACE.md`).

---

## 🚀 Self-Improvement Protocol (Gravity V2 Upgrade)

### 1. The Double-Hook Loop

Every agent session must now follow the **Double-Hook** workflow:

- **Hook 1 (Start)**: Load the `AGENTS_LEARNING.md` file immediately after `WORKSPACE.md`.
- **Hook 2 (End)**: Before ending the session, summarize all new technical debt, architectural decisions, and error-mitigation patterns into this file.

### 2. Recursive Intelligence

Agents are required to "Upgrade" their operational baseline by checking this file for task-specific anti-patterns before executing any `run_command` or `write_to_file` operations.

### 3. Cross-Agent Handoff

Treat this file as the primary handoff mechanism. If a task is interrupted, the latest entry here must provide the next agent with the "Mental Model" of the current problem state.

---

## Session Notes — 2026-03-31

### New Insights
- Writing to `~/.workspace` requires elevated permissions in this environment; plan for explicit approvals.
- Creating time-series memory assets outside the repo avoids unindexed root changes but still needs sandbox escalation.

### Decisions
- Implemented Day 3 memory scaffolding directly in `~/.workspace` to match spec rather than creating a new top-level directory in the repo.

### Patterns to Reuse
- Compute ISO week from date to keep weekly filenames consistent.
- Keep daily logs concise with one activity entry and explicit “Context for Tomorrow” to support handoff.
