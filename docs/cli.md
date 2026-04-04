# ContextOS CLI (`workspace`)

The `workspace` CLI is the primary developer interface for ContextOS. It provides tools for project scaffolding, daily logging, decision tracking, and workspace validation.

## Installation

```bash
npm install -g @contextos/cli
```

## Commands

### `workspace init <name>`
Initialize a new project within the workspace.
- Creates directory structure
- Generates initial `context.md` and `soul.md`

### `workspace daily <project> "<message>"`
Append a message to the current day's log for a project.
- Automatically handles date-based file creation
- Formats message with timestamp

### `workspace decision <project> --title "<title>"`
Record an Architectural Decision Record (ADR) for a project.
- Generates a unique ADR ID
- Prompts for context, decision, and rationale

### `workspace validate`
Audit the entire workspace for schema compliance.
- Validates all `soul.md`, `context.md`, `memory.md`, and `decisions.md` files
- Checks for required front-matter fields
- Reports errors with line numbers and descriptions

## Development

To run locally:
```bash
cd workspace-cli
npm install
npm run build
npm start -- <command>
```
