import type { SubjectKind } from "./enforcement-surface.js";

/**
 * WHAT each gated subject is allowed to do — the read/write classification the
 * trust boundary evaluates policy against.
 *
 * Split out of `enforcement.ts` because it is DATA with its own review rhythm:
 * these two maps change every time a tool or resource is added, while the gate
 * itself does not. `enforcement.test.ts` pins both against the live
 * registrations in BOTH directions, so neither can drift silently.
 *
 * `enforcement.ts` re-exports everything here, so it stays the single import
 * site for the subsystem.
 */

/** The two things a call can do to workspace state. */
export type ToolAction = "read" | "write";

/**
 * Every registered tool MUST appear here. An unlisted tool is treated as
 * `write` (fail closed) AND reported loudly by `auditClassificationCoverage` at
 * boot, so adding a tool without classifying it is noisy rather than silently
 * unguarded.
 *
 * Derived from the 39 live `server.tool("name"` registrations in `src/tools/`,
 * NOT from `mcp.json` (stale at 17) — `enforcement.test.ts` asserts the map and
 * the live registration list agree exactly, in both directions.
 */
export const TOOL_ACTIONS: Readonly<Record<string, ToolAction>> = Object.freeze(
  {
    // ── read ──────────────────────────────────────────────────────────────────
    cognitive_retrieve: "read",
    governance_check_trust: "read",
    governance_evaluate_policy: "read",
    graph_impact_predict: "read",
    graph_query: "read",
    graph_rag_search: "read",
    graph_temporal_query: "read",
    graph_time_travel: "read",
    intelligence_health: "read",
    intelligence_patterns: "read",
    predictive_impact: "read",
    search_fused: "read",
    skill_search: "read",
    swarm_status: "read",
    workspace_context: "read",
    workspace_lock_status: "read",
    workspace_pulse: "read",
    workspace_read: "read",
    workspace_sample: "read",
    workspace_search: "read",
    workspace_validate: "read",
    // ── write ─────────────────────────────────────────────────────────────────
    cognitive_observe: "write",
    cognitive_reflect: "write",
    governance_issue_token: "write",
    intelligence_distill: "write",
    skill_store: "write",
    swarm_consensus: "write",
    swarm_negotiate: "write",
    swarm_spawn: "write",
    // Fetches an external page and writes it under projects/<project>/web/.
    workspace_browse: "write",
    workspace_daily_update: "write",
    // Mutates lock state, so it is a write even though it reads to decide.
    workspace_lock_acquire: "write",
    workspace_lock_release: "write",
    workspace_log_decision: "write",
    workspace_memory_update: "write",
    // `action: create | complete | archive | activate` all mutate mission files.
    workspace_mission: "write",
    workspace_notify: "write",
    workspace_prune: "write",
    workspace_write: "write",
  },
);

/**
 * The resource surface, classified exactly like `TOOL_ACTIONS`.
 *
 * `resources/read context://workspace/health` returned precisely the `getPulse()`
 * payload that the gated `workspace_pulse` tool REFUSES in deny mode — the same
 * data through an ungated door, with no audit record. Read-only, so there was no
 * integrity impact, but an inconsistent trust boundary is one a caller learns to
 * route around. Consistency wins: resources are gated the same way, with the same
 * fail-closed default.
 *
 * Keyed by the registered NAME, not by URI, because that is the id a policy
 * targets (`mcp:resource:workspace_health`). `resources/read` arrives with a URI,
 * so `resourceSubject` in `enforcement-surface.ts` resolves it back to the name
 * the same way the SDK's own read handler does. An unresolvable URI is recorded
 * verbatim and fails closed to `write`.
 *
 * `enforcement.test.ts` pins this map against the live `registerResources()`
 * registrations in BOTH directions, exactly as it does for `TOOL_ACTIONS`.
 */
export const RESOURCE_ACTIONS: Readonly<Record<string, ToolAction>> =
  Object.freeze({
    // Wraps samplingService.getPulse() — identical payload to `workspace_pulse`.
    workspace_health: "read",
    // Read-only projection of the knowledge graph.
    project_graph: "read",
  });

/** Action map for a subject kind. Unlisted names fail closed to `write`. */
export function actionsFor(
  kind: SubjectKind,
): Readonly<Record<string, ToolAction>> {
  return kind === "resource" ? RESOURCE_ACTIONS : TOOL_ACTIONS;
}
