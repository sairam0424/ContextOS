import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';
export type AnomalyType = 'rate_spike' | 'unauthorized_access' | 'behavior_drift' | 'resource_abuse';

export interface AnomalyAlert {
  readonly id: string;
  readonly agentId: string;
  readonly type: AnomalyType;
  readonly severity: AnomalySeverity;
  readonly evidence: Record<string, unknown>;
  readonly detectedAt: number;
  readonly resolved: boolean;
}

/** A normalized name->probability distribution over tools/resources. */
export type Distribution = Readonly<Record<string, number>>;

interface AlertRow {
  id: string;
  agent_id: string;
  type: string;
  severity: string;
  evidence: string;
  detected_at: number;
  resolved: number;
}

interface BaselineRow {
  agent_id: string;
  distribution: string;
  registered_at: number;
}

/**
 * Behavior-drift sensitivity. Jensen-Shannon divergence is bounded in [0, 1]
 * (log base 2): 0 == identical, 1 == maximally different. Below this threshold
 * an agent's live tool/resource mix is treated as consistent with its frozen
 * admission baseline.
 */
const DRIFT_THRESHOLD = 0.25;

/**
 * Minimum number of observed tool calls before drift is evaluated. Without this,
 * a single off-baseline call would diverge maximally and produce false positives.
 */
const MIN_DRIFT_OBSERVATIONS = 5;

export class AnomalyDetector {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly slidingWindows: Map<string, number[]> = new Map();
  /** Live tool/resource call counts per agent, compared against the frozen baseline. */
  private readonly liveCounts: Map<string, Map<string, number>> = new Map();
  /** In-memory cache of frozen baselines (persisted in agent_baselines). */
  private readonly baselines: Map<string, Distribution> = new Map();

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
    this.ensureBaselineTable();
  }

  /**
   * Snapshot an agent's expected tool/resource distribution at REGISTRATION and
   * freeze it as the immutable drift reference. Re-registering an agent that
   * already has a frozen baseline is a no-op (the reference must NOT drift with
   * the agent — that is the whole point of re-anchoring). Pass either raw counts
   * or probabilities; the snapshot is normalized to a probability distribution.
   */
  registerBaseline(agentId: string, expected: Readonly<Record<string, number>>): Distribution {
    const existing = this.getBaseline(agentId);
    if (existing) return existing;

    const frozen = normalize(expected);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_baselines (agent_id, distribution, registered_at)
         VALUES (?, ?, ?)`
      )
      .run(agentId, JSON.stringify(frozen), Date.now());

    // Re-read to honor any concurrently-inserted row (INSERT OR IGNORE may skip ours).
    return this.getBaseline(agentId) ?? frozen;
  }

  /** Returns the frozen admission baseline for an agent, or null if none registered. */
  getBaseline(agentId: string): Distribution | null {
    const cached = this.baselines.get(agentId);
    if (cached) return cached;

    const row = this.db
      .prepare('SELECT agent_id, distribution, registered_at FROM agent_baselines WHERE agent_id = ?')
      .get(agentId) as BaselineRow | undefined;
    if (!row) return null;

    const distribution = JSON.parse(row.distribution) as Distribution;
    this.baselines.set(agentId, distribution);
    return distribution;
  }

  /**
   * Record an agent action. `tool` is the tool/resource the agent invoked; when
   * supplied it is accumulated into the live distribution used for drift
   * detection. Rate-spike tracking (timestamp window) is unaffected by `tool`.
   */
  recordAction(agentId: string, tool?: string): void {
    const now = Date.now();
    const timestamps = this.slidingWindows.get(agentId) ?? [];
    const cutoff = now - 3_600_000;
    const pruned = [...timestamps.filter(t => t > cutoff), now];
    this.slidingWindows.set(agentId, pruned);

    if (tool !== undefined) {
      const counts = this.liveCounts.get(agentId) ?? new Map<string, number>();
      const next = new Map(counts);
      next.set(tool, (next.get(tool) ?? 0) + 1);
      this.liveCounts.set(agentId, next);
    }
  }

  detectRateSpike(agentId: string): AnomalyAlert | null {
    const now = Date.now();
    const timestamps = this.slidingWindows.get(agentId);
    if (!timestamps || timestamps.length === 0) return null;

    const oneMinuteAgo = now - 60_000;
    const currentRate = timestamps.filter(t => t > oneMinuteAgo).length;

    const oneHourAgo = now - 3_600_000;
    const historicalTimestamps = timestamps.filter(t => t > oneHourAgo);
    const historicalRate = historicalTimestamps.length / 60;

    if (historicalRate === 0) return null;

    const ratio = currentRate / historicalRate;

    if (ratio <= 3) return null;

    const severity = this.ratioToSeverity(ratio);

    const alert: AnomalyAlert = {
      id: randomUUID(),
      agentId,
      type: 'rate_spike',
      severity,
      evidence: { currentRate, historicalRate, ratio },
      detectedAt: now,
      resolved: false,
    };

    this.persistAlert(alert);
    this.emitDetected(alert);

    return alert;
  }

  /**
   * Compare an agent's live tool/resource distribution against its FROZEN
   * admission baseline using Jensen-Shannon divergence. Because the reference is
   * frozen at registration (it does not drift with the agent), this detects the
   * gradual behavioral drift that detectRateSpike is structurally blind to.
   * Returns null when no baseline is registered or insufficient observations.
   */
  detectBehaviorDrift(agentId: string): AnomalyAlert | null {
    const baseline = this.getBaseline(agentId);
    if (!baseline) return null;

    const counts = this.liveCounts.get(agentId);
    if (!counts || counts.size === 0) return null;

    const totalObservations = [...counts.values()].reduce((sum, n) => sum + n, 0);
    if (totalObservations < MIN_DRIFT_OBSERVATIONS) return null;

    const current = normalize(Object.fromEntries(counts));
    const divergence = jensenShannonDivergence(baseline, current);

    if (divergence <= DRIFT_THRESHOLD) return null;

    const alert: AnomalyAlert = {
      id: randomUUID(),
      agentId,
      type: 'behavior_drift',
      severity: this.divergenceToSeverity(divergence),
      evidence: { divergence, threshold: DRIFT_THRESHOLD, baseline, current, totalObservations },
      detectedAt: Date.now(),
      resolved: false,
    };

    this.persistAlert(alert);
    this.emitDetected(alert);

    return alert;
  }

  detectAll(agentId: string): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];

    const rateSpike = this.detectRateSpike(agentId);
    if (rateSpike) {
      alerts.push(rateSpike);
    }

    const drift = this.detectBehaviorDrift(agentId);
    if (drift) {
      alerts.push(drift);
    }

    return alerts;
  }

  getAlerts(agentId?: string, resolved?: boolean): AnomalyAlert[] {
    let query = 'SELECT * FROM anomaly_alerts WHERE 1=1';
    const params: unknown[] = [];

    if (agentId !== undefined) {
      query += ' AND agent_id = ?';
      params.push(agentId);
    }

    if (resolved !== undefined) {
      query += ' AND resolved = ?';
      params.push(resolved ? 1 : 0);
    }

    query += ' ORDER BY detected_at DESC';

    const rows = this.db.prepare(query).all(...params) as AlertRow[];
    return rows.map(row => this.rowToAlert(row));
  }

  resolveAlert(alertId: string): void {
    this.db.prepare('UPDATE anomaly_alerts SET resolved = 1 WHERE id = ?').run(alertId);
  }

  getAgentRate(agentId: string): number {
    const now = Date.now();
    const timestamps = this.slidingWindows.get(agentId);
    if (!timestamps) return 0;

    const oneMinuteAgo = now - 60_000;
    return timestamps.filter(t => t > oneMinuteAgo).length;
  }

  private ratioToSeverity(ratio: number): AnomalySeverity {
    if (ratio > 10) return 'critical';
    if (ratio > 5) return 'high';
    return 'medium';
  }

  private divergenceToSeverity(divergence: number): AnomalySeverity {
    if (divergence > 0.75) return 'critical';
    if (divergence > 0.5) return 'high';
    return 'medium';
  }

  private emitDetected(alert: AnomalyAlert): void {
    this.eventBus.emit({
      type: 'governance.anomaly_detected' as any,
      agentId: alert.agentId,
      alertId: alert.id,
      severity: alert.severity,
    } as any);
  }

  private ensureBaselineTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_baselines (
        agent_id TEXT PRIMARY KEY,
        distribution TEXT NOT NULL DEFAULT '{}',
        registered_at INTEGER NOT NULL
      )
    `);
  }

  private persistAlert(alert: AnomalyAlert): void {
    this.db.prepare(
      `INSERT INTO anomaly_alerts (id, agent_id, type, severity, evidence, detected_at, resolved)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(alert.id, alert.agentId, alert.type, alert.severity, JSON.stringify(alert.evidence), alert.detectedAt);
  }

  private rowToAlert(row: AlertRow): AnomalyAlert {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type as AnomalyType,
      severity: row.severity as AnomalySeverity,
      evidence: JSON.parse(row.evidence),
      detectedAt: row.detected_at,
      resolved: row.resolved === 1,
    };
  }
}

/** Normalize raw counts/weights into a probability distribution (sums to 1). */
function normalize(weights: Readonly<Record<string, number>>): Distribution {
  const total = Object.values(weights).reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total === 0) return {};
  return Object.fromEntries(
    Object.entries(weights).map(([key, w]) => [key, Math.max(0, w) / total])
  );
}

/**
 * Jensen-Shannon divergence (log base 2, bounded in [0, 1]) between two
 * probability distributions. Symmetric and always finite, unlike raw KL
 * divergence — which is why it is preferred for baseline-vs-current comparison.
 */
function jensenShannonDivergence(p: Distribution, q: Distribution): number {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  const m: Record<string, number> = {};
  for (const key of keys) {
    m[key] = ((p[key] ?? 0) + (q[key] ?? 0)) / 2;
  }
  return 0.5 * klDivergence(p, m, keys) + 0.5 * klDivergence(q, m, keys);
}

/** KL(a || b) in bits, summed over the shared key set. */
function klDivergence(a: Distribution, b: Distribution, keys: Set<string>): number {
  let sum = 0;
  for (const key of keys) {
    const ai = a[key] ?? 0;
    const bi = b[key] ?? 0;
    if (ai > 0 && bi > 0) {
      sum += ai * Math.log2(ai / bi);
    }
  }
  return sum;
}
