# anti-patterns.md

## Engineering Anti-Patterns

- **"Magic" Fixes**: Solving a problem without documenting the mechanism or updating common agent knowledge.
- **Flat Hierarchies**: Dumping configuration or data into the root without indexing it in the relevant scope ring.
- **Permission Overstretching**: Attempting to execute commands in restricted directories without verifying access.

## Decision Anti-Patterns

- **Un-indexed ADRs**: Making architectural changes without updating the global `decisions.md`.
- **Placeholder Dependency**: Relying on "TBD" or generic statements for core configuration.
- **Context Siloing**: Keeping decisions or logic in memory rather than a persistent file.

## Agent Interaction Anti-Patterns

- **Sycophancy**: Wasting context with polite but useless phrases.
- **Ambiguous Drafting**: Creating instructions that require more than one clarify-response cycle.
- **Instruction Skipping**: Skipping sections of a structured prompt or protocol.
