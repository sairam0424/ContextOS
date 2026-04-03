# CLAUDE.md - ContextOS Rules

## Mandatory Write-Back Protocol

At the end of EVERY session:

1. Update memory.md with:
   - Current state
   - Completed tasks
   - Next steps
   - Open questions

2. Log all decisions to decisions.md:
   - Use ADR format
   - Include rationale

3. Update changelog.md if:
   - Feature added
   - Bug fixed
   - Structure changed

4. Update daily log:
   ~/.workspace/daily/YYYY-MM-DD.md

## Enforcement Rules

- If memory.md is not updated → session is incomplete
- If decisions are made but not logged → invalid session
- Never skip write-back

---

## Technical Standards
- Formatting: `npx prettier --write .`
- Linting: `npm run lint`
- Testing: `npm test`
