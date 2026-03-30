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
