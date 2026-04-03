# agent-routing.md

## Purpose
Defines how agents load and interact with workspace context.

## Boot Sequence

### Step 1 — Identity
Load:
- root/soul.md
- root/personality.md

### Step 2 — Org
Load:
- orgs/personal/standards.md
- orgs/personal/tools.md

### Step 3 — Project
Load:
- CONTEXT.md
- memory.md
- phases.md

### Step 4 — Tasks
Load:
- tasks/active.md

---

## Agent Types

### Builder Agent
- Writes code
- Updates memory.md
- Logs decisions

### Reviewer Agent
- Reviews code
- Validates decisions

### Research Agent
- Gathers context
- Updates knowledge/

---

## Routing Rules

- Never load unrelated projects
- Always prefer local context over global
- Only load necessary files

---

## Write-Back Targets

- memory.md → every session
- decisions.md → on decision
- changelog.md → on change
