# agent-routing.md

## Purpose

Defines how agents load and interact with workspace context.

## Boot Sequence

### Step 1 — Identity

Load:

- root/soul.md
- root/personality.md

## Log Syncing

- Sync personal logs to `orgs/personal/log/`
- Sync team logs to `orgs/team/log/`
- Compress logs older than 30 days into `archive/log/`

### Step 2 — Org

Load:

- orgs/personal/standards.md
- orgs/personal/tools.md

### Step 3 — Project

Load:

- CONTEXT.md
- memory.md
- soul.md
- decisions.md

## Routing Rules

- Prefer `orgs/` patterns over `root/` defaults.
- Always append session logs to the current project memory.
- Validate all path requests against the allowed-bucket list.
