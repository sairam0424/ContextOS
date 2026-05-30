import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export interface TemporalEdge {
  readonly id: number;
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly weight: number;
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly confidence: number;
  readonly evidence: number;
  readonly decayRate: number;
}

export interface TemporalQuery {
  readonly pointInTime?: number;
  readonly rangeStart?: number;
  readonly rangeEnd?: number;
  readonly minConfidence?: number;
  readonly includeExpired?: boolean;
}

export interface NodeMetric {
  readonly nodeId: string;
  readonly metricType: string;
  readonly value: number;
  readonly computedAtVersion: number;
}

export interface NodeEvent {
  readonly id: number;
  readonly nodeId: string;
  readonly eventType: string;
  readonly timestamp: number;
  readonly agentId: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface Hyperedge {
  readonly id: number;
  readonly type: string;
  readonly weight: number;
  readonly members: ReadonlyArray<{ nodeId: string; role: string }>;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
}

export interface ImpactResult {
  readonly nodeId: string;
  readonly impactScore: number;
  readonly depth: number;
  readonly path: string;
}

interface TemporalEdgeRow {
  id: number;
  source: string;
  target: string;
  type: string;
  weight: number;
  valid_from: number;
  valid_until: number | null;
  confidence: number;
  evidence: number;
  decay_rate: number;
}

interface NodeEventRow {
  id: number;
  node_id: string;
  event_type: string;
  timestamp: number;
  agent_id: string | null;
  metadata: string;
}

interface HyperedgeRow {
  id: number;
  type: string;
  weight: number;
  metadata: string;
  created_at: number;
}

interface HyperedgeMemberRow {
  hyperedge_id: number;
  node_id: string;
  role: string;
}

interface NodeMetricRow {
  node_id: string;
  metric_type: string;
  value: number;
  computed_at_version: number;
}

interface ImpactRow {
  node_id: string;
  impact_score: number;
  depth: number;
  path: string;
}

function rowToTemporalEdge(row: TemporalEdgeRow): TemporalEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    type: row.type,
    weight: row.weight,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    confidence: row.confidence,
    evidence: row.evidence,
    decayRate: row.decay_rate,
  };
}

function rowToNodeEvent(row: NodeEventRow): NodeEvent {
  return {
    id: row.id,
    nodeId: row.node_id,
    eventType: row.event_type,
    timestamp: row.timestamp,
    agentId: row.agent_id,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

function rowToHyperedge(row: HyperedgeRow, members: HyperedgeMemberRow[]): Hyperedge {
  return {
    id: row.id,
    type: row.type,
    weight: row.weight,
    members: members
      .filter(m => m.hyperedge_id === row.id)
      .map(m => ({ nodeId: m.node_id, role: m.role })),
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  };
}

function rowToNodeMetric(row: NodeMetricRow): NodeMetric {
  return {
    nodeId: row.node_id,
    metricType: row.metric_type,
    value: row.value,
    computedAtVersion: row.computed_at_version,
  };
}

export class TemporalGraphService {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  addTemporalEdge(
    source: string,
    target: string,
    type: string,
    opts?: { weight?: number; confidence?: number; decayRate?: number }
  ): TemporalEdge {
    const weight = opts?.weight ?? 1.0;
    const confidence = opts?.confidence ?? 1.0;
    const decayRate = opts?.decayRate ?? 0.95;
    const now = Date.now();

    const existing = this.db.prepare(
      `SELECT * FROM temporal_edges
       WHERE source = ? AND target = ? AND type = ? AND valid_until IS NULL`
    ).get(source, target, type) as TemporalEdgeRow | undefined;

    if (existing) {
      const newEvidence = existing.evidence + 1;
      const newWeight = weight;
      this.db.prepare(
        `UPDATE temporal_edges SET evidence = ?, weight = ? WHERE id = ?`
      ).run(newEvidence, newWeight, existing.id);

      return {
        ...rowToTemporalEdge(existing),
        evidence: newEvidence,
        weight: newWeight,
      };
    }

    const result = this.db.prepare(
      `INSERT INTO temporal_edges (source, target, type, weight, valid_from, valid_until, confidence, evidence, decay_rate)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?)`
    ).run(source, target, type, weight, now, confidence, decayRate);

    return {
      id: Number(result.lastInsertRowid),
      source,
      target,
      type,
      weight,
      validFrom: now,
      validUntil: null,
      confidence,
      evidence: 1,
      decayRate,
    };
  }

  expireEdge(edgeId: number): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE temporal_edges SET valid_until = ? WHERE id = ?`
    ).run(now, edgeId);
  }

  getEdgesAtTime(
    timestamp: number,
    opts?: { nodeId?: string; minConfidence?: number; limit?: number }
  ): TemporalEdge[] {
    const minConfidence = opts?.minConfidence ?? 0;
    const limit = opts?.limit ?? 1000;

    if (opts?.nodeId) {
      const rows = this.db.prepare(
        `SELECT * FROM temporal_edges
         WHERE valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
         AND (source = ? OR target = ?)
         AND confidence >= ?
         LIMIT ?`
      ).all(timestamp, timestamp, opts.nodeId, opts.nodeId, minConfidence, limit) as TemporalEdgeRow[];
      return rows.map(rowToTemporalEdge);
    }

    const rows = this.db.prepare(
      `SELECT * FROM temporal_edges
       WHERE valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
       AND confidence >= ?
       LIMIT ?`
    ).all(timestamp, timestamp, minConfidence, limit) as TemporalEdgeRow[];
    return rows.map(rowToTemporalEdge);
  }

  getEdgesInRange(
    start: number,
    end: number,
    opts?: { nodeId?: string; minConfidence?: number; limit?: number }
  ): TemporalEdge[] {
    const minConfidence = opts?.minConfidence ?? 0;
    const limit = opts?.limit ?? 1000;

    if (opts?.nodeId) {
      const rows = this.db.prepare(
        `SELECT * FROM temporal_edges
         WHERE valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?)
         AND (source = ? OR target = ?)
         AND confidence >= ?
         LIMIT ?`
      ).all(end, start, opts.nodeId, opts.nodeId, minConfidence, limit) as TemporalEdgeRow[];
      return rows.map(rowToTemporalEdge);
    }

    const rows = this.db.prepare(
      `SELECT * FROM temporal_edges
       WHERE valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?)
       AND confidence >= ?
       LIMIT ?`
    ).all(end, start, minConfidence, limit) as TemporalEdgeRow[];
    return rows.map(rowToTemporalEdge);
  }

  getEffectiveWeight(edge: TemporalEdge, atTime?: number): number {
    const now = atTime ?? Date.now();
    const daysSinceObserved = (now - edge.validFrom) / 86400000;
    return edge.weight * edge.confidence * Math.pow(edge.decayRate, daysSinceObserved);
  }

  recordNodeEvent(
    nodeId: string,
    eventType: string,
    opts?: { agentId?: string; metadata?: Record<string, unknown> }
  ): NodeEvent {
    const now = Date.now();
    const agentId = opts?.agentId ?? null;
    const metadata = opts?.metadata ?? {};

    const result = this.db.prepare(
      `INSERT INTO node_events (node_id, event_type, timestamp, agent_id, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(nodeId, eventType, now, agentId, JSON.stringify(metadata));

    return {
      id: Number(result.lastInsertRowid),
      nodeId,
      eventType,
      timestamp: now,
      agentId,
      metadata,
    };
  }

  getNodeTimeline(nodeId: string, limit?: number): NodeEvent[] {
    const effectiveLimit = limit ?? 50;
    const rows = this.db.prepare(
      `SELECT * FROM node_events WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(nodeId, effectiveLimit) as NodeEventRow[];
    return rows.map(rowToNodeEvent);
  }

  predictImpact(nodeId: string, depth?: number): ImpactResult[] {
    const maxDepth = depth ?? 2;
    const decayPerHop = 0.6;

    const rows = this.db.prepare(
      `WITH RECURSIVE impact_tree(node_id, impact_score, depth, path) AS (
        SELECT
          CASE WHEN source = ? THEN target ELSE source END,
          weight * confidence * 1.0,
          1,
          ? || ' -> ' || CASE WHEN source = ? THEN target ELSE source END
        FROM temporal_edges
        WHERE (source = ? OR target = ?) AND valid_until IS NULL

        UNION ALL

        SELECT
          CASE WHEN te.source = it.node_id THEN te.target ELSE te.source END,
          it.impact_score * te.weight * te.confidence * ${decayPerHop},
          it.depth + 1,
          it.path || ' -> ' || CASE WHEN te.source = it.node_id THEN te.target ELSE te.source END
        FROM temporal_edges te
        JOIN impact_tree it ON (te.source = it.node_id OR te.target = it.node_id)
        WHERE te.valid_until IS NULL
          AND it.depth < ?
          AND it.path NOT LIKE '%' || CASE WHEN te.source = it.node_id THEN te.target ELSE te.source END || '%'
      )
      SELECT node_id, MAX(impact_score) as impact_score, MIN(depth) as depth, path
      FROM impact_tree
      GROUP BY node_id
      ORDER BY impact_score DESC`
    ).all(nodeId, nodeId, nodeId, nodeId, nodeId, maxDepth) as ImpactRow[];

    return rows.map(row => ({
      nodeId: row.node_id,
      impactScore: row.impact_score,
      depth: row.depth,
      path: row.path,
    }));
  }

  createHyperedge(
    type: string,
    memberNodeIds: string[],
    opts?: { weight?: number; roles?: Map<string, string>; metadata?: Record<string, unknown> }
  ): Hyperedge {
    const weight = opts?.weight ?? 1.0;
    const metadata = opts?.metadata ?? {};
    const roles = opts?.roles ?? new Map<string, string>();
    const now = Date.now();

    const result = this.db.prepare(
      `INSERT INTO hyperedges (type, weight, metadata, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(type, weight, JSON.stringify(metadata), now);

    const hyperedgeId = Number(result.lastInsertRowid);

    const insertMember = this.db.prepare(
      `INSERT INTO hyperedge_members (hyperedge_id, node_id, role) VALUES (?, ?, ?)`
    );

    const members: Array<{ nodeId: string; role: string }> = [];
    for (const nodeId of memberNodeIds) {
      const role = roles.get(nodeId) ?? 'member';
      insertMember.run(hyperedgeId, nodeId, role);
      members.push({ nodeId, role });
    }

    return {
      id: hyperedgeId,
      type,
      weight,
      members,
      metadata,
      createdAt: now,
    };
  }

  getHyperedgesForNode(nodeId: string): Hyperedge[] {
    const hyperedgeRows = this.db.prepare(
      `SELECT h.* FROM hyperedges h
       JOIN hyperedge_members hm ON h.id = hm.hyperedge_id
       WHERE hm.node_id = ?`
    ).all(nodeId) as HyperedgeRow[];

    if (hyperedgeRows.length === 0) return [];

    const ids = hyperedgeRows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    const memberRows = this.db.prepare(
      `SELECT * FROM hyperedge_members WHERE hyperedge_id IN (${placeholders})`
    ).all(...ids) as HyperedgeMemberRow[];

    return hyperedgeRows.map(row => rowToHyperedge(row, memberRows));
  }

  pruneDecayedEdges(minConfidence?: number): number {
    const threshold = minConfidence ?? 0.05;
    const now = Date.now();

    const activeEdges = this.db.prepare(
      `SELECT * FROM temporal_edges WHERE valid_until IS NULL`
    ).all() as TemporalEdgeRow[];

    const edgeIdsToPrune: number[] = [];
    for (const row of activeEdges) {
      const daysSinceObserved = (now - row.valid_from) / 86400000;
      const effectiveConfidence = row.confidence * Math.pow(row.decay_rate, daysSinceObserved);
      if (effectiveConfidence < threshold) {
        edgeIdsToPrune.push(row.id);
      }
    }

    if (edgeIdsToPrune.length === 0) return 0;

    const placeholders = edgeIdsToPrune.map(() => '?').join(',');
    this.db.prepare(
      `DELETE FROM temporal_edges WHERE id IN (${placeholders})`
    ).run(...edgeIdsToPrune);

    return edgeIdsToPrune.length;
  }

  updateNodeMetric(
    nodeId: string,
    metricType: string,
    value: number,
    graphVersion: number
  ): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO node_metrics (node_id, metric_type, value, computed_at_version)
       VALUES (?, ?, ?, ?)`
    ).run(nodeId, metricType, value, graphVersion);
  }

  getNodeMetrics(nodeId: string): NodeMetric[] {
    const rows = this.db.prepare(
      `SELECT * FROM node_metrics WHERE node_id = ?`
    ).all(nodeId) as NodeMetricRow[];
    return rows.map(rowToNodeMetric);
  }
}
