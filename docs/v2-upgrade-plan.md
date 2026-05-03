# ContextOS v2.0 — Architectural Upgrade Plan

> Research-based. Every issue identified by reading the actual source code.  
> Status: **PLANNING** | Branch target: `feat/v2-architecture`

---

## Executive Summary

Six confirmed bugs exist in v1.12.0 that silently corrupt or block core features. Twelve architectural gaps limit scalability and multi-agent use. This plan addresses them in five phases spanning v1.13.x through v2.2.0, prioritizing zero-regression hardening before any new capability work.

**Keystone dependency**: Phase 2 begins by building `WorkspaceConfigService` (a `workspace_config` SQLite table). It unblocks 5 other features — dynamic buckets, vector provider tracking, Janitor token budgets, federation peers, and per-workspace settings. Everything else in Phase 2 depends on it.

---

## Confirmed Bugs (Pre-existing in v1.12.0)

| # | Bug | Impact | Severity |
|---|-----|--------|----------|
| B1 | Vector dimension mismatch — no `dimension` column in `vec_documents`; Gemini=768D vs local=384D silently produce garbage cosine scores | Semantic search returns wrong results when provider is switched | Critical |
| B2 | CLI version hardcoded at `"1.1.0"` in `workspace-cli/src/index.ts:27` | `context-os --version` lies | Low |
| B3 | `daily/` absent from `ALLOWED_BUCKETS` in `context.ts` | Sentinel never watches/indexes daily logs | Medium |
| B4 | Grep fallback ignores `includePrivate` — scans full workspace in `intelligence.ts:71` | Private docs leaked via deep search | High |
| B5 | Intelligence queue silently drops failed embeddings — `removeFromQueue` on error with no retry | Permanent "pending" ghost docs after any embedding failure | Medium |
| B6 | AetherGraph bucket clustering is dead code — references `node.metadata?.bucketId` which `KnowledgeGraphService` never populates | Planet/moon clustering force has no effect since v1.6.1 | Low |

---

## Architectural Gaps

| # | Gap | Current State |
|---|-----|---------------|
| G1 | `ALLOWED_BUCKETS` hardcoded in `context.ts` | Blocks multi-tenant and per-workspace config |
| G2 | `EmbeddingService` instantiated 3× independently | TransformersProvider loaded up to 3× into memory |
| G3 | `KnowledgeGraphService.getGraph()` fully rebuilds on every call | O(n) DB reads per dashboard poll |
| G4 | Affinity limited to 2-degree BFS, hardcoded 0.3× decay | Misses long-range knowledge chains |
| G5 | Missions referenced in rendering but not implemented | Orange dodecahedra never appear; feature is dead |
| G6 | Janitor Agent has no token budget | Sustained failures = unbounded Gemini API spend |
| G7 | No search pagination | All results limited to top-20, no way to page |
| G8 | MCP gap: no `workspace_validate`, `workspace_lock`, `workspace_prune`, `workspace_pulse` tools | Agents can't self-validate writes or coordinate locks |
| G9 | `App.tsx` is 337-line monolith — state, WebSocket, and all UI panels entangled | Untestable; no component isolation |
| G10 | "Acquire Concurrency Lock" button is a no-op stub in the inspector | LockingService exists but dashboard can't invoke it |
| G11 | `CapabilityService.match()` is boolean substring check | No scoring; wrong capability chosen for edge-case queries |
| G12 | MCP only exposes stdio transport | No HTTP/SSE for web-native agent clients |

---

## Phase 1 — Foundation Hardening `v1.13.x`

**Goal**: Fix all 6 confirmed bugs. Zero new features.  
**Risk**: All changes are additive (new columns via `migrateSchema`, filter additions, constant changes).

### 1.1 — Vector dimension tracking [B1]

**Files**: `packages/core/src/services/database.ts`

- Add `dimension INTEGER NOT NULL DEFAULT 0` to `vec_documents` via `migrateSchema()`.
- In `upsertVector()`: write `embedding.length` to the column.
- In `searchHybrid()`: add `WHERE v.dimension = ?` using the current provider's known dimension before the cosine call. Mismatched rows are silently skipped (safe fallback to FTS).
- Existing rows get `dimension = 0` → no semantic results on first run → FTS takes over → embeddings regenerate with correct dimension on next queue pass. **No data loss.**

### 1.2 — CLI version from package.json [B2]

**Files**: `workspace-cli/src/index.ts`

```ts
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');
program.version(version);
```

### 1.3 — Add `daily/` to ALLOWED_BUCKETS [B3]

**Files**: `packages/core/src/context.ts`

Add `"daily"` to the `ALLOWED_BUCKETS` array. `WatchService` derives `pathsToWatch` directly from it — no other changes needed.

### 1.4 — Privacy filter in grep fallback [B4]

**Files**: `packages/core/src/services/intelligence.ts`

After the grep results are parsed (line ~80), add a filter pass:
```ts
.filter(result => {
  if (options.includePrivate) return true;
  const doc = this.dbService.getDocumentByPath(result.path);
  return !doc?.is_private;
})
```

### 1.5 — Intelligence queue retry with dead-letter [B5]

**Files**: `packages/core/src/services/database.ts`, `packages/core/src/services/intelligence-queue.ts`

- `migrateSchema()`: add `retry_count INTEGER DEFAULT 0`, `last_error TEXT` to `intelligence_queue`.
- In `processNext()` catch block: increment `retry_count` and persist `last_error`.
  - If `retry_count < 3`: reset `intelligence_status` to `'pending'`, leave in queue.
  - If `retry_count >= 3`: remove from queue, set `intelligence_status = 'failed'` on document (observable via status queries and HUD).

### 1.6 — Fix dead bucket clustering [B6]

**Files**: `packages/core/src/services/knowledge-graph.ts`

In `getGraph()`, when building document nodes, derive `bucketId` from the first path segment:
```ts
metadata: {
  bucketId: doc.path.split('/')[0],
  // ... existing fields
}
```
Add one `'bucket'` node per distinct `bucketId` with `type: 'bucket'` and `val: 50`. The d3Force cluster in `AetherGraph.tsx` already reads these fields — no frontend changes needed.

---

## Phase 2 — Intelligence Layer Upgrade `v2.0.0`

**Goal**: Workspace config backbone, provider safety, queue throughput, graph caching, missions, Janitor budget.  
**Prerequisite**: Phase 1 complete.

### 2.1 — WorkspaceConfigService [G1 keystone]

**Files to create**: `packages/core/src/services/workspace-config.ts`  
**Files to modify**: `packages/core/src/services/database.ts`, `packages/core/src/context.ts`, `packages/core/src/services/watch.ts`

New `workspace_config` SQLite table (key/value):
```sql
CREATE TABLE IF NOT EXISTS workspace_config (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

`WorkspaceConfigService` exposes `get(key, default?)` and `set(key, value)`.  
On first startup, seed with `allowed_buckets` = current hardcoded list. `ALLOWED_BUCKETS` in `context.ts` becomes a runtime call to `workspaceConfigService.getBuckets()`. `WatchService` reads from config at start, not the static import. Backward compat: auto-seeds default list if key absent.

### 2.2 — Vector provider safety [B1 deep fix, G2 partial]

**Files**: `packages/core/src/services/workspace-config.ts`, `packages/core/src/services/database.ts`, `packages/core/src/services/embedding.ts`

- On `EmbeddingService` construction, read `embedding.provider` and `embedding.dimension` from `workspace_config`.
- If current provider dimension differs from stored dimension: log a warning, wipe `vec_documents`, reset all `intelligence_status = 'pending'`, re-queue everything. Destructive but explicit and logged — no silent corruption.
- Add `getSharedEmbeddingService()` factory (mirrors `getSharedDatabase()`) to fix triple-instantiation of `EmbeddingService` [G2].

### 2.3 — Intelligence queue batching [G2 completion]

**Files**: `packages/core/src/services/database.ts`, `packages/core/src/services/intelligence-queue.ts`

- Add `getBatchFromQueue(n: number)` method (LIMIT n query).
- Replace serial `processNext()` with `processBatch(batchSize = 5)` using `Promise.allSettled`.
- `start()` signature: `{ intervalMs?: number, batchSize?: number }`.
- ~5× throughput improvement. Individual failures still trigger retry logic from Phase 1.5.

### 2.4 — KnowledgeGraph incremental cache [G3]

**Files**: `packages/core/src/services/database.ts`, `packages/core/src/services/knowledge-graph.ts`

- Store a `graph_version` integer in `graph_metadata` (existing table). Increment it in every `upsertDocument`, `upsertEdge`, `upsertSymbol`.
- `KnowledgeGraphService` holds `{ graph, version }` in memory.
- `getGraph()`: read current `graph_version`; if matches cached version → return cache (O(1)). If different → full rebuild + update.
- Dashboard polls become essentially free when the workspace is idle.

### 2.5 — Missions data model [G5]

**Files to create**: `packages/core/src/services/mission.ts`, `workspace-cli/src/commands/mission.ts`, `workspace-mcp/src/tools/mission.ts`  
**Files to modify**: `packages/core/src/services/database.ts`, `packages/core/src/services/knowledge-graph.ts`

New `missions` table:
```sql
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  priority INTEGER DEFAULT 1,
  created_at INTEGER,
  due_at INTEGER,
  metadata TEXT
);
```

`MissionService`: `create`, `list`, `update`, `complete`, `archive`.  
`KnowledgeGraphService.getGraph()`: join on `missions.path` → emit `type: 'mission'` nodes with edges to owning documents. Orange dodecahedra in the HUD will now actually appear.  
CLI: `context-os mission create|list|complete`.  
MCP: `workspace_mission` tool.

### 2.6 — Janitor Agent token budget [G6]

**Files**: `packages/core/src/services/repair.ts`

Read two keys from `workspace_config`:
- `janitor.maxRepairsPerHour` (default: `20`)
- `janitor.maxOutputTokens` (default: `1024`)

Add `repairCallsThisHour` counter (reset every 3600000ms via `setInterval`). Before calling Gemini: check counter; if exceeded, log warning, return `false`. Pass `maxOutputTokens` in `generationConfig`. Existing 8000-char content truncation stays.

---

## Phase 3 — Protocol Parity `v2.0.0` (parallel with Phase 2)

**Goal**: Close the MCP capability gap and make the dashboard testable.

### 3.1 — New MCP tools [G8]

**Files to create in `workspace-mcp/src/tools/`**:

**`validate.ts`** — `workspace_validate`
```ts
{ path: z.string().optional() }
// Returns: { valid, issues[], totalChecked }
```
Calls `validationService.validateFile(path)` or full workspace scan. Closes the write → validate loop entirely in-protocol.

**`lock.ts`** — `workspace_lock_acquire`, `workspace_lock_release`, `workspace_lock_status`
```ts
// acquire/release: { filePath: z.string(), agentId: z.string() }
// status:          { filePath: z.string() }
```
Wires `LockingService` into MCP. The inspector "Acquire Lock" button in the dashboard will use this via WebSocket→action relay.

**`prune.ts`** — `workspace_prune`
```ts
{ target: z.enum(['tmp','stale','all']).default('all'), dryRun: z.boolean().default(true) }
// Returns: { removed: string[], skipped: string[], dryRun: boolean }
```

**`pulse.ts`** — `workspace_pulse`
```ts
{} // no inputs
// Returns: WorkspacePulse (health score, top tags, intelligence queue depth)
```

Register all four in `workspace-mcp/src/index.ts`.

### 3.2 — Dashboard refactor [G9, G10]

**Files to create in `workspace-dashboard/src/`**:

```
hooks/
  useWebSocket.ts       — connection, reconnect, send(), event callbacks
  useWorkspaceState.ts  — pulse, graphData, focusedNodeId (pure derived state)
components/
  HudHeader.tsx
  HudSidebar.tsx
  HudFooter.tsx
  NodeInspector.tsx     — extracted from App.tsx lines 194–292
  GraphFilterBar.tsx    — floating search input over AetherGraph
```

`App.tsx` → ~40 lines of layout composition after extraction.

**Wire "Acquire Concurrency Lock"** [G10]:
- `NodeInspector` sends `{ type: 'action', action: 'acquire_lock', payload: { path, agentId: 'dashboard' } }` via `useWebSocket.send()`.
- Dashboard WebSocket server handles `acquire_lock` → calls `lockingService.acquire()` → broadcasts `lock_update`.
- `useWorkspaceState` handles `lock_update` → updates node's `metadata.lock` immutably.
- `AetherGraph` already colors locked nodes red — visual feedback is already wired.

**Add `GraphFilterBar`**:
- Floating `position: absolute` input above the graph.
- `filterQuery` state in `useWorkspaceState`.
- `AetherGraph` derives `visibleGraphData` via `useMemo`: show nodes matching query or connected to a matching node.

**Testing strategy** — Vitest + React Testing Library (zero config in Vite):
- `useWebSocket.ts`: mock `WebSocket` global, assert exponential backoff doubles, assert cleanup on unmount.
- `useWorkspaceState.ts`: feed mock WS messages, assert state transitions.
- `NodeInspector.tsx`: render with mock node, assert lock button calls `send()` with correct payload.
- `GraphFilterBar`: assert filter reduces visible node count.
- Skip direct Three.js testing; cover with Playwright E2E smoke test.

---

## Phase 4 — Advanced Intelligence `v2.1.0`

### 4.1 — Multi-hop BFS via recursive CTE [G4]

**Files**: `packages/core/src/services/database.ts`

Replace the manual 2-degree BFS in `getAffinities()` with a single SQL recursive CTE:

```sql
WITH RECURSIVE traversal(id, weight, depth) AS (
  SELECT target, weight, 1 FROM edges WHERE source = :anchor
  UNION ALL
  SELECT e.target, t.weight * 0.4, t.depth + 1
  FROM edges e JOIN traversal t ON e.source = t.id
  WHERE t.depth < :maxHops AND t.weight * 0.4 > :minWeight
)
SELECT id, MAX(weight) as affinity FROM traversal GROUP BY id
```

New signature: `getAffinities(nodePath: string, maxHops = 3, minWeight = 0.05)`.  
Remove manual 1st/2nd degree queries. Faster (single DB round-trip), more accurate.

### 4.2 — Search pagination [G7]

**Files**: `packages/core/src/services/database.ts`, `packages/core/src/services/intelligence.ts`, `workspace-mcp/src/tools/search.ts`

`searchHybrid` accepts `limit` and `offset`: pass `OFFSET ?` to both FTS5 and semantic queries.  
Public `search()` API gains `{ limit?: number, offset?: number }` options.  
MCP `workspace_search` gains `offset?: number` parameter.

### 4.3 — TF-IDF capability routing [G11]

**Files**: `packages/core/src/services/capability.ts`

Replace boolean substring sort with a TF-IDF scorer:
- Build inverted index over `expertise[]` terms on `reload()`.
- Score incoming `intent` tokens, return records sorted by score descending.
- `affinity` field becomes the tie-breaker (already on `CapabilityRecord`).
- No new dependencies — 50-line implementation.

### 4.4 — Cross-workspace federation (high-level)

**Files to create**: `packages/core/src/services/federation.ts`  
**Files to modify**: `packages/core/src/services/intelligence.ts`

- `federation.peers` config key in `workspace_config` (JSON array of peer base URLs).
- `FederationService.search()`: fan out to all peers via `Promise.allSettled`, merge and re-rank by score.
- `SearchResult` gains `workspaceOrigin?: string`.
- Deduplication by `path + workspaceOrigin`.
- Purely additive; each peer is already a running MCP/HTTP server.

---

## Phase 5 — Interactive Aether `v2.2.0`

### 5.1 — Multi-transport MCP [G12]

**Files to create**: `workspace-mcp/src/server.ts` (shared McpServer factory), `workspace-mcp/src/server-http.ts`

- Extract shared `McpServer` factory from `index.ts`.
- `server-http.ts`: uses `StreamableHTTPServerTransport` from MCP SDK on `MCP_HTTP_PORT` (default `3001`).
- Port `3000` = dashboard WebSocket; `3001` = MCP HTTP. No collision.
- Two npm scripts: `mcp:stdio` (existing, unchanged) and `mcp:http`.
- Auth: optional JWT bearer tokens via `jose`. `MCP_AUTH_REQUIRED=true` to enforce. Default off — Claude Desktop/Cursor work with zero changes.

### 5.2 — Right-click contextual actions

**Files to create**: `workspace-dashboard/src/components/ContextMenu.tsx`  
**Files to modify**: `workspace-dashboard/src/components/AetherGraph.tsx`, `workspace-dashboard/src/App.tsx`

- `AetherGraph` exposes `onNodeRightClick(node, event)` prop (add to `Props`).
- `ContextMenu` renders at `position: fixed` from mouse event coordinates.
- Actions vary by `node.type`: document → [Open, Copy Path, Lock, Find Similar]; tag → [Filter, Copy]; symbol → [Copy Signature]; mission → [Set Active, Archive].
- `contextMenu: { node, x, y } | null` state in `useWorkspaceState`.

### 5.3 — Timeline / history panel

**Files to create**: `workspace-dashboard/src/components/TimelinePanel.tsx`  
**Files to modify**: Dashboard WebSocket server

- Slide-in from footer (clock icon trigger).
- Data source: `access_log` table already in SQLite. New endpoint `GET /api/history?path=&limit=50`.
- Renders `{ timestamp, eventType, agentId, path }` as vertical timeline.
- No new data model required.

### 5.4 — Large graph performance (LOD)

**Files**: `workspace-dashboard/src/components/AetherGraph.tsx`

- **Visibility threshold**: At >150 nodes, set `nodeVisibility` to hide nodes with `val < 2` (low-heat isolated nodes). "Show All" toggle in `GraphFilterBar`.
- **LOD**: Replace `nodeThreeObject` with `MeshBasicMaterial` (no phong/emissive) for nodes beyond 200-unit camera radius. Check via `onEngineTick`.
- **Edge culling**: Only render `link.weight > 0.3` by default. Edge weight slider in `GraphFilterBar`.
- **Cooldown**: Reduce `cooldownTicks` from 100 to 50 when node count > 150.

---

## Implementation Order

```
v1.13.x  ──── Phase 1 (all 6 bug fixes) — ~3 days
              ↓
v2.0.0   ──── Phase 2.1 (WorkspaceConfigService) ← KEYSTONE
              ├── Phase 2.2–2.6 (intelligence upgrades)
              └── Phase 3 (MCP parity + dashboard refactor, parallel)
              ↓
v2.1.0   ──── Phase 4 (advanced intelligence + pagination + federation)
              ↓
v2.2.0   ──── Phase 5 (multi-transport + interactive Aether + LOD)
```

---

## Critical Files Map

| File | Phase | Change Type |
|------|-------|-------------|
| `packages/core/src/services/database.ts` | 1,2,3,4 | Extend schema + methods |
| `packages/core/src/services/intelligence.ts` | 1,4 | Bug fix + pagination |
| `packages/core/src/services/intelligence-queue.ts` | 1,2 | Retry + batching |
| `packages/core/src/services/knowledge-graph.ts` | 1,2 | Fix bucketId + version cache |
| `packages/core/src/services/embedding.ts` | 2 | Shared singleton factory |
| `packages/core/src/services/repair.ts` | 2 | Token budget |
| `packages/core/src/services/capability.ts` | 4 | TF-IDF scorer |
| `packages/core/src/context.ts` | 1,2 | Add daily + dynamic buckets |
| `packages/core/src/services/workspace-config.ts` | 2 | **CREATE** — keystone |
| `packages/core/src/services/mission.ts` | 2 | **CREATE** |
| `packages/core/src/services/federation.ts` | 4 | **CREATE** |
| `workspace-cli/src/index.ts` | 1 | Version from package.json |
| `workspace-cli/src/commands/mission.ts` | 2 | **CREATE** |
| `workspace-mcp/src/tools/validate.ts` | 3 | **CREATE** |
| `workspace-mcp/src/tools/lock.ts` | 3 | **CREATE** |
| `workspace-mcp/src/tools/prune.ts` | 3 | **CREATE** |
| `workspace-mcp/src/tools/pulse.ts` | 3 | **CREATE** |
| `workspace-mcp/src/tools/mission.ts` | 2 | **CREATE** |
| `workspace-mcp/src/index.ts` | 3 | Register new tools |
| `workspace-mcp/src/server.ts` | 5 | **CREATE** — shared factory |
| `workspace-mcp/src/server-http.ts` | 5 | **CREATE** — HTTP transport |
| `workspace-dashboard/src/App.tsx` | 3 | Extract to hooks + components |
| `workspace-dashboard/src/hooks/useWebSocket.ts` | 3 | **CREATE** |
| `workspace-dashboard/src/hooks/useWorkspaceState.ts` | 3 | **CREATE** |
| `workspace-dashboard/src/components/NodeInspector.tsx` | 3 | **CREATE** (extracted) |
| `workspace-dashboard/src/components/GraphFilterBar.tsx` | 3 | **CREATE** |
| `workspace-dashboard/src/components/ContextMenu.tsx` | 5 | **CREATE** |
| `workspace-dashboard/src/components/TimelinePanel.tsx` | 5 | **CREATE** |
| `workspace-dashboard/src/components/AetherGraph.tsx` | 5 | LOD + right-click |

---

## Verification Checklist (per phase)

### Phase 1
- [ ] `npm run test` passes all existing suites
- [ ] Switch embedding provider via env var → no crash, semantic search degrades to FTS gracefully
- [ ] `context-os --version` outputs `1.13.x`
- [ ] Create a file in `daily/` → Sentinel indexes it (visible in `context-os status`)
- [ ] Deep search with `includePrivate: false` → no private docs in results
- [ ] Manually corrupt a file to fail embedding → after 3 retries, `intelligence_status = 'failed'` in DB
- [ ] Launch dashboard → bucket clustering groups nodes by first path segment

### Phase 2
- [ ] Change `ALLOWED_BUCKETS` via config → `context-os watch` respects new list without code change
- [ ] `context-os mission create "Ship v2"` → orange dodecahedron appears in Aether HUD
- [ ] Trigger 25 rapid file changes → intelligence queue processes in batches (check `[Backbone]` log output)
- [ ] Repeated dashboard polls with no file changes → `getGraph()` returns cache (no DB queries logged)

### Phase 3
- [ ] `workspace_validate` via Claude Desktop → returns validation report
- [ ] `workspace_lock_acquire` via Claude → node turns red in dashboard
- [ ] `workspace_pulse` → returns health score and queue depth
- [ ] `App.tsx` < 60 lines after refactor
- [ ] Vitest suite passes for all new hooks/components

### Phase 4
- [ ] `getAffinities("projects/foo/context.md", 4)` returns 4-hop neighbors
- [ ] `workspace_search` with `offset: 20` returns next page of results
- [ ] `CapabilityService.match("refactor the authentication module")` returns more specific role than "General Architect"

### Phase 5
- [ ] `npx @context-os/mcp@latest --transport=http` starts on port 3001
- [ ] Right-click on graph node shows context menu with type-appropriate actions
- [ ] Clock icon in footer opens timeline showing last 50 access log entries
- [ ] Workspace with 200+ nodes: FPS stays above 30 (measure via browser devtools)
