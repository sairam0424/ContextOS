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

interface AlertRow {
  id: string;
  agent_id: string;
  type: string;
  severity: string;
  evidence: string;
  detected_at: number;
  resolved: number;
}

export class AnomalyDetector {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly slidingWindows: Map<string, number[]> = new Map();

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  recordAction(agentId: string): void {
    const now = Date.now();
    const timestamps = this.slidingWindows.get(agentId) ?? [];
    const cutoff = now - 3_600_000;
    const pruned = [...timestamps.filter(t => t > cutoff), now];
    this.slidingWindows.set(agentId, pruned);
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

    this.eventBus.emit({
      type: 'governance.anomaly_detected' as any,
      agentId,
      alertId: alert.id,
      severity,
    } as any);

    return alert;
  }

  detectAll(agentId: string): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];

    const rateSpike = this.detectRateSpike(agentId);
    if (rateSpike) {
      alerts.push(rateSpike);
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
