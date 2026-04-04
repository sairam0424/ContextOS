---
name: knowledge-extraction
description: Extract structured learnings from logs and projects
triggers: [project complete, retrospective]
---

# Knowledge Extraction Protocol

#hot #permanent

## Overview
This meta-skill provides a structured procedure for converting project activity into persistent, reusable knowledge.

## Procedure

### 1. Identify Target
- Review the project structure for:
  - `decisions.md` (or `ADR-*` logs)
  - `changelog.md`
  - `daily/*.md` (recent logs)
  - `memory.md`

### 2. Analytical Extraction
Extract the following from the target documents:
- **Key Insights**: What did we learn about the problem domain?
- **Recurring Patterns**: Did we solve a problem that we've seen before?
- **Mistakes & Anti-patterns**: What should we avoid next time?
- **Refined Best Practices**: Have any of our existing rules changed?

### 3. Knowledge Base Conversion
Convert the extracted insights into dedicated files within:
- `knowledge/learnings/[topic].md` (for new learnings)
- `knowledge/domains/[relevant-domain].md` (to update existing domains)

### 4. Lifecycle Tagging
Apply the appropriate lifecycle tags to the extracted knowledge:
- #permanent: Fundamental truths and patterns.
- #warm: Recent learnings that still need validation.
- #cold: Historical context that is no longer active but valuable for reference.

## Example Conversion
If a project on "Agentic Routing" found that static rules are insufficient, the extraction process would:
1. Identify the insight from `decisions.md`.
2. Update `knowledge/domains/ai-agents.md` with a "Refined Pattern" about dynamic routing.
3. Tag the update as #hot until validated.

## Metadata
- Tags: #meta-skill #knowledge #extraction #permanent
