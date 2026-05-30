import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';
import type { TaskScheduler } from './scheduler.js';
import type { AgentRegistry } from '../agents/registry.js';

export type TopologyMode = 'supervisor' | 'peer_swarm' | 'hierarchical' | 'round_robin';
export type SwarmStatus = 'active' | 'stalled' | 'replanning' | 'completed' | 'aborted';
export type TickResult = 'progressing' | 'stalled' | 'replanning' | 'complete';

export interface SwarmConfig {
  readonly topology: TopologyMode;
  readonly stallThreshold: number;
  readonly maxReplans: number;
  readonly tickIntervalMs: number;
}

export interface TaskLedger {
  readonly missionId: string;
  readonly facts: readonly string[];
  readonly hypotheses: readonly string[];
  readonly planSteps: readonly string[];
  readonly revisionCount: number;
  readonly createdAt: number;
}

export interface ProgressLedger {
  readonly missionId: string;
  readonly currentStep: number;
  readonly completedSteps: readonly string[];
  readonly activeAssignment: { readonly taskId: string; readonly agentId: string } | null;
  readonly stallCount: number;
  readonly lastProgressAt: number;
}

export interface SwarmSession {
  readonly id: string;
  readonly missionId: string;
  readonly topology: TopologyMode;
  readonly taskLedger: TaskLedger;
  readonly progressLedger: ProgressLedger;
  readonly status: SwarmStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface SwarmSessionRow {
  id: string;
  mission_id: string;
  topology: string;
  task_ledger: string;
  progress_ledger: string;
  status: string;
  created_at: number;
  updated_at: number;
}

const DEFAULT_CONFIG: SwarmConfig = {
  topology: 'supervisor',
  stallThreshold: 5,
  maxReplans: 3,
  tickIntervalMs: 5000,
};

function rowToSession(row: SwarmSessionRow): SwarmSession {
  return {
    id: row.id,
    missionId: row.mission_id,
    topology: row.topology as TopologyMode,
    taskLedger: JSON.parse(row.task_ledger) as TaskLedger,
    progressLedger: JSON.parse(row.progress_ledger) as ProgressLedger,
    status: row.status as SwarmStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SwarmOrchestrator {
  private configs = new Map<string, SwarmConfig>();

  constructor(
    private db: RawDB,
    private eventBus: WorkspaceEventBus,
    private scheduler: TaskScheduler,
    private registry: AgentRegistry
  ) {}

  spawn(missionId: string, config?: Partial<SwarmConfig>): SwarmSession {
    const resolvedConfig: SwarmConfig = { ...DEFAULT_CONFIG, ...config };
    const id = randomUUID();
    const now = Date.now();

    const taskLedger: TaskLedger = {
      missionId,
      facts: [],
      hypotheses: [],
      planSteps: [],
      revisionCount: 0,
      createdAt: now,
    };

    const progressLedger: ProgressLedger = {
      missionId,
      currentStep: 0,
      completedSteps: [],
      activeAssignment: null,
      stallCount: 0,
      lastProgressAt: now,
    };

    this.db.prepare(
      `INSERT INTO swarm_sessions (id, mission_id, topology, task_ledger, progress_ledger, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, missionId, resolvedConfig.topology, JSON.stringify(taskLedger), JSON.stringify(progressLedger), now, now);

    this.configs.set(id, resolvedConfig);

    this.eventBus.emit({ type: 'swarm.spawned', sessionId: id, missionId, topology: resolvedConfig.topology });

    return {
      id,
      missionId,
      topology: resolvedConfig.topology,
      taskLedger,
      progressLedger,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  tick(sessionId: string): TickResult {
    const row = this.db.prepare(`SELECT * FROM swarm_sessions WHERE id = ?`).get(sessionId) as SwarmSessionRow | undefined;
    if (!row) return 'complete';

    const session = rowToSession(row);
    if (session.status !== 'active') return 'complete';

    const config = this.configs.get(sessionId) ?? DEFAULT_CONFIG;
    const progress = this.scheduler.getProgress(session.missionId);

    if (progress.total > 0 && progress.completed + progress.failed === progress.total) {
      this.complete(sessionId);
      return 'complete';
    }

    const now = Date.now();
    const timeSinceProgress = now - session.progressLedger.lastProgressAt;

    if (timeSinceProgress > config.tickIntervalMs * 2) {
      const updatedStallCount = session.progressLedger.stallCount + 1;
      const updatedProgressLedger: ProgressLedger = {
        ...session.progressLedger,
        stallCount: updatedStallCount,
      };

      if (updatedStallCount >= config.stallThreshold) {
        this.db.prepare(
          `UPDATE swarm_sessions SET progress_ledger = ?, status = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(updatedProgressLedger), 'replanning', now, sessionId);

        this.eventBus.emit({ type: 'swarm.stalled', sessionId, stallCount: updatedStallCount });
        return 'replanning';
      }

      this.db.prepare(
        `UPDATE swarm_sessions SET progress_ledger = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(updatedProgressLedger), now, sessionId);

      return 'stalled';
    }

    const assigned = this.scheduler.assignNext(session.missionId);

    if (assigned) {
      const updatedProgressLedger: ProgressLedger = {
        ...session.progressLedger,
        activeAssignment: { taskId: assigned.id, agentId: assigned.assignedTo! },
        stallCount: 0,
        lastProgressAt: now,
        currentStep: session.progressLedger.currentStep + 1,
      };

      this.db.prepare(
        `UPDATE swarm_sessions SET progress_ledger = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(updatedProgressLedger), now, sessionId);
    }

    return 'progressing';
  }

  replan(sessionId: string, newFacts?: readonly string[]): SwarmSession | null {
    const row = this.db.prepare(`SELECT * FROM swarm_sessions WHERE id = ?`).get(sessionId) as SwarmSessionRow | undefined;
    if (!row) return null;

    const session = rowToSession(row);
    const config = this.configs.get(sessionId) ?? DEFAULT_CONFIG;

    if (session.taskLedger.revisionCount >= config.maxReplans) {
      this.abort(sessionId, 'max_replans_exceeded');
      return null;
    }

    const now = Date.now();

    const updatedTaskLedger: TaskLedger = {
      ...session.taskLedger,
      facts: newFacts ? [...session.taskLedger.facts, ...newFacts] : session.taskLedger.facts,
      revisionCount: session.taskLedger.revisionCount + 1,
    };

    const resetProgressLedger: ProgressLedger = {
      missionId: session.missionId,
      currentStep: 0,
      completedSteps: [...session.progressLedger.completedSteps],
      activeAssignment: null,
      stallCount: 0,
      lastProgressAt: now,
    };

    this.db.prepare(
      `UPDATE swarm_sessions SET task_ledger = ?, progress_ledger = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(updatedTaskLedger), JSON.stringify(resetProgressLedger), 'active', now, sessionId);

    this.eventBus.emit({ type: 'swarm.replanned', sessionId, revisionCount: updatedTaskLedger.revisionCount });

    return {
      ...session,
      taskLedger: updatedTaskLedger,
      progressLedger: resetProgressLedger,
      status: 'active',
      updatedAt: now,
    };
  }

  getSession(sessionId: string): SwarmSession | null {
    const row = this.db.prepare(`SELECT * FROM swarm_sessions WHERE id = ?`).get(sessionId) as SwarmSessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  getActiveSessions(): SwarmSession[] {
    const rows = this.db.prepare(`SELECT * FROM swarm_sessions WHERE status = 'active'`).all() as SwarmSessionRow[];
    return rows.map(rowToSession);
  }

  abort(sessionId: string, reason?: string): void {
    const row = this.db.prepare(`SELECT mission_id FROM swarm_sessions WHERE id = ?`).get(sessionId) as { mission_id: string } | undefined;
    const now = Date.now();

    this.db.prepare(
      `UPDATE swarm_sessions SET status = ?, updated_at = ? WHERE id = ?`
    ).run('aborted', now, sessionId);

    this.eventBus.emit({ type: 'swarm.aborted', sessionId, missionId: row?.mission_id ?? sessionId, reason });
  }

  complete(sessionId: string): void {
    const row = this.db.prepare(`SELECT mission_id FROM swarm_sessions WHERE id = ?`).get(sessionId) as { mission_id: string } | undefined;
    const now = Date.now();

    this.db.prepare(
      `UPDATE swarm_sessions SET status = ?, updated_at = ? WHERE id = ?`
    ).run('completed', now, sessionId);

    this.eventBus.emit({ type: 'swarm.completed', sessionId, missionId: row?.mission_id ?? sessionId });
  }
}
