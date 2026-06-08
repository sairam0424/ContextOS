import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export type TrustDimension = 'reliability' | 'timeliness' | 'accuracy' | 'compliance' | 'resourceEfficiency';

export interface TrustScore {
  readonly agentId: string;
  readonly overall: number;
  readonly reliability: number;
  readonly timeliness: number;
  readonly accuracy: number;
  readonly compliance: number;
  readonly resourceEfficiency: number;
  readonly lastUpdated: number;
}

export interface TrustEvent {
  readonly id: number;
  readonly agentId: string;
  readonly eventType: 'success' | 'failure' | 'violation' | 'timeout';
  readonly dimension: TrustDimension;
  readonly delta: number;
  readonly reason: string;
  readonly timestamp: number;
}

interface TrustScoreRow {
  agent_id: string;
  overall: number;
  reliability: number;
  timeliness: number;
  accuracy: number;
  compliance: number;
  resource_efficiency: number;
  last_updated: number;
}

interface TrustEventRow {
  id: number;
  agent_id: string;
  event_type: TrustEvent['eventType'];
  dimension: TrustDimension;
  delta: number;
  reason: string;
  timestamp: number;
}

const EVENT_TYPE_TARGETS: Record<TrustEvent['eventType'], number> = {
  success: 1.0,
  failure: 0.0,
  violation: 0.0,
  timeout: 0.3,
};

const DIMENSION_COLUMN_MAP: Record<TrustDimension, string> = {
  reliability: 'reliability',
  timeliness: 'timeliness',
  accuracy: 'accuracy',
  compliance: 'compliance',
  resourceEfficiency: 'resource_efficiency',
};

/**
 * The complete set of physical column names that may ever be interpolated into
 * a trust_scores UPDATE. SQL parameter binding cannot parameterize an
 * identifier, so the dimension column name is the one value spliced into the
 * query string — every such splice MUST be proven to come from this whitelist.
 */
const TRUST_SCORE_COLUMNS: ReadonlySet<string> = new Set(Object.values(DIMENSION_COLUMN_MAP));

/**
 * Provably closes the only non-parameterized path in this module: rejects any
 * column name that is not a known trust_scores dimension column before it can
 * reach query construction. Defends against a poisoned/extended map or an
 * out-of-enum dimension reaching the SQL sink.
 */
function assertTrustScoreColumn(columnName: string): string {
  if (!TRUST_SCORE_COLUMNS.has(columnName)) {
    throw new Error(`Refusing to build trust_scores query with unknown column '${columnName}'`);
  }
  return columnName;
}

export class TrustEngine {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly alpha: number = 0.1;

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  recordEvent(opts: {
    readonly agentId: string;
    readonly eventType: TrustEvent['eventType'];
    readonly dimension: TrustDimension;
    readonly reason: string;
  }): TrustScore {
    const { agentId, eventType, dimension, reason } = opts;
    const timestamp = Date.now();
    const target = EVENT_TYPE_TARGETS[eventType];

    this.ensureScoreExists(agentId);

    const currentScore = this.getScoreRow(agentId)!;
    // Whitelist-guard the dimension column before it is interpolated into SQL:
    // this is the only identifier spliced into a query string in this module.
    const columnName = assertTrustScoreColumn(DIMENSION_COLUMN_MAP[dimension]);
    const oldValue = currentScore[columnName as keyof TrustScoreRow] as number;
    const newValue = oldValue * (1 - this.alpha) + target * this.alpha;
    const delta = newValue - oldValue;

    this.db.prepare(
      `INSERT INTO trust_events (agent_id, event_type, dimension, delta, reason, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(agentId, eventType, dimension, delta, reason, timestamp);

    this.db.prepare(
      `UPDATE trust_scores SET ${columnName} = ?, last_updated = ? WHERE agent_id = ?`
    ).run(newValue, timestamp, agentId);

    const updatedRow = this.getScoreRow(agentId)!;
    const overall = (updatedRow.reliability + updatedRow.timeliness + updatedRow.accuracy + updatedRow.compliance + updatedRow.resource_efficiency) / 5;

    this.db.prepare(
      'UPDATE trust_scores SET overall = ?, last_updated = ? WHERE agent_id = ?'
    ).run(overall, timestamp, agentId);

    if (overall < 0.3) {
      this.eventBus.emit({
        type: 'agent.quarantined' as any,
        agentId,
        reason: 'Trust score below threshold',
      } as any);
    }

    return {
      agentId,
      overall,
      reliability: updatedRow.reliability,
      timeliness: updatedRow.timeliness,
      accuracy: updatedRow.accuracy,
      compliance: updatedRow.compliance,
      resourceEfficiency: updatedRow.resource_efficiency,
      lastUpdated: timestamp,
    };
  }

  getScore(agentId: string): TrustScore {
    this.ensureScoreExists(agentId);
    const row = this.getScoreRow(agentId)!;
    return this.rowToScore(row);
  }

  getHistory(agentId: string, limit: number = 50): TrustEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM trust_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(agentId, limit) as TrustEventRow[];

    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      eventType: row.event_type,
      dimension: row.dimension,
      delta: row.delta,
      reason: row.reason,
      timestamp: row.timestamp,
    }));
  }

  getTopAgents(limit: number = 10): TrustScore[] {
    const rows = this.db.prepare(
      'SELECT * FROM trust_scores ORDER BY overall DESC LIMIT ?'
    ).all(limit) as TrustScoreRow[];

    return rows.map(row => this.rowToScore(row));
  }

  resetScore(agentId: string): void {
    this.ensureScoreExists(agentId);
    const now = Date.now();
    // Build the per-dimension SET clause from the same whitelist used on the
    // hot path so both reset and recordEvent share one provably-safe source of
    // column identifiers (no second list to drift out of sync).
    const dimensionSet = Object.values(DIMENSION_COLUMN_MAP)
      .map(col => `${assertTrustScoreColumn(col)} = 0.5`)
      .join(', ');
    this.db.prepare(
      `UPDATE trust_scores SET ${dimensionSet}, overall = 0.5, last_updated = ? WHERE agent_id = ?`
    ).run(now, agentId);
  }

  private ensureScoreExists(agentId: string): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT OR IGNORE INTO trust_scores (agent_id, overall, reliability, timeliness, accuracy, compliance, resource_efficiency, last_updated)
       VALUES (?, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, ?)`
    ).run(agentId, now);
  }

  private getScoreRow(agentId: string): TrustScoreRow | undefined {
    return this.db.prepare(
      'SELECT * FROM trust_scores WHERE agent_id = ?'
    ).get(agentId) as TrustScoreRow | undefined;
  }

  private rowToScore(row: TrustScoreRow): TrustScore {
    return {
      agentId: row.agent_id,
      overall: row.overall,
      reliability: row.reliability,
      timeliness: row.timeliness,
      accuracy: row.accuracy,
      compliance: row.compliance,
      resourceEfficiency: row.resource_efficiency,
      lastUpdated: row.last_updated,
    };
  }
}
