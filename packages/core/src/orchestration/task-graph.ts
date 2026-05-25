import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { TaskNode, CreateTaskOpts, TaskStatus, MissionProgress, RetryConfig } from './types.js';
import type { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';
import { validateName } from '../validation.js';

const log = createChildLogger('task-graph');

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export class TaskGraph {
  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  addTask(opts: CreateTaskOpts): TaskNode {
    const validatedTitle = validateName(opts.title, 256);
    const validatedDescription = validateName(opts.description, 4096);

    const id = randomUUID();
    const now = Date.now();
    const deps = opts.dependencies ?? [];
    const priority = opts.priority ?? 0;
    const requiredCapabilities = opts.requiredCapabilities ?? [];
    const retryConfig = opts.retryConfig ? JSON.stringify({ ...DEFAULT_RETRY_CONFIG, ...opts.retryConfig }) : null;

    this.db.prepare(`
      INSERT INTO task_nodes (id, mission_id, title, description, timeout, created_at, priority, required_capabilities, retry_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, opts.missionId, validatedTitle, validatedDescription, opts.timeout ?? 300, now, priority, JSON.stringify(requiredCapabilities), retryConfig);

    for (const depId of deps) {
      this.db.prepare(`INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)`).run(id, depId);
    }

    log.debug({ taskId: id, missionId: opts.missionId, deps, priority }, 'Task added to graph');

    return {
      id,
      missionId: opts.missionId,
      title: validatedTitle,
      description: validatedDescription,
      status: 'pending',
      dependencies: deps,
      timeout: opts.timeout ?? 300,
      retries: 0,
      priority,
      requiredCapabilities,
      createdAt: now,
    };
  }

  getTask(taskId: string): TaskNode | undefined {
    const row = this.db.prepare(`SELECT * FROM task_nodes WHERE id = ?`).get(taskId) as any;
    if (!row) return undefined;
    return this.toNode(row);
  }

  getTasksForMission(missionId: string): TaskNode[] {
    const rows = this.db.prepare(`SELECT * FROM task_nodes WHERE mission_id = ?`).all(missionId) as any[];
    return rows.map(r => this.toNode(r));
  }

  getReady(missionId: string): TaskNode[] {
    const rows = this.db.prepare(`
      SELECT tn.* FROM task_nodes tn
      WHERE tn.mission_id = ? AND tn.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM task_dependencies td
        JOIN task_nodes dep ON td.depends_on = dep.id
        WHERE td.task_id = tn.id AND dep.status != 'completed'
      )
    `).all(missionId) as any[];
    return rows.map(r => this.toNode(r));
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    this.db.prepare(`UPDATE task_nodes SET status = ? WHERE id = ?`).run(status, taskId);
  }

  assign(taskId: string, agentId: string): boolean {
    const now = Date.now();
    const result = this.db.prepare(
      `UPDATE task_nodes SET status = 'assigned', assigned_to = ?, assigned_at = ? WHERE id = ? AND status = 'pending'`
    ).run(agentId, now, taskId);
    if (result.changes > 0) {
      this.eventBus.emit({ type: 'task.assigned', taskId, agentId });
      return true;
    }
    return false;
  }

  resetToPending(taskId: string): void {
    this.db.prepare(
      `UPDATE task_nodes SET status = 'pending', assigned_to = NULL, assigned_at = NULL WHERE id = ?`
    ).run(taskId);
    log.info({ taskId }, 'Task reset to pending');
  }

  getAssignedTasks(missionId: string): TaskNode[] {
    const rows = this.db.prepare(
      `SELECT * FROM task_nodes WHERE mission_id = ? AND status = 'assigned'`
    ).all(missionId) as any[];
    return rows.map(r => this.toNode(r));
  }

  getAssignedAt(taskId: string): number | undefined {
    const row = this.db.prepare(`SELECT assigned_at FROM task_nodes WHERE id = ?`).get(taskId) as any;
    return row?.assigned_at ?? undefined;
  }

  complete(taskId: string, result?: unknown): void {
    this.db.prepare(`UPDATE task_nodes SET status = 'completed', result = ? WHERE id = ?`).run(
      result ? JSON.stringify(result) : null, taskId
    );
    this.eventBus.emit({ type: 'task.completed', taskId });
  }

  fail(taskId: string, error: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    // Determine retry config from stored config or defaults
    const row = this.db.prepare(`SELECT retry_config FROM task_nodes WHERE id = ?`).get(taskId) as any;
    const retryConfig: RetryConfig = row?.retry_config
      ? JSON.parse(row.retry_config)
      : DEFAULT_RETRY_CONFIG;

    if (task.retries < retryConfig.maxRetries) {
      const attempt = task.retries + 1;
      const delay = Math.min(
        retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, task.retries),
        retryConfig.maxDelayMs
      );
      const nextRetryAt = Date.now() + delay;

      this.db.prepare(`UPDATE task_nodes SET status = 'pending', assigned_to = NULL, retries = retries + 1 WHERE id = ?`).run(taskId);
      this.eventBus.emit({ type: 'task.retried', taskId, attempt, nextRetryAt });
      log.warn({ taskId, attempt, nextRetryAt, delay }, 'Task failed, retrying with backoff');
    } else {
      this.db.prepare(`UPDATE task_nodes SET status = 'failed', result = ? WHERE id = ?`).run(JSON.stringify({ error }), taskId);
      this.eventBus.emit({ type: 'task.failed', taskId });
      log.error({ taskId }, 'Task permanently failed');
    }
  }

  getProgress(missionId: string): MissionProgress {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM task_nodes WHERE mission_id = ? GROUP BY status
    `).all(missionId) as Array<{ status: string; count: number }>;

    const counts = Object.fromEntries(rows.map(r => [r.status, r.count]));
    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return {
      missionId,
      total,
      pending: counts['pending'] ?? 0,
      assigned: counts['assigned'] ?? 0,
      inProgress: counts['in_progress'] ?? 0,
      completed: counts['completed'] ?? 0,
      failed: counts['failed'] ?? 0,
    };
  }

  validateDAG(missionId: string): { valid: boolean; cycles?: string[] } {
    const tasks = this.getTasksForMission(missionId);
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (taskId: string): boolean => {
      if (inStack.has(taskId)) {
        cycles.push(taskId);
        return true;
      }
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      inStack.add(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (const dep of task.dependencies) {
          if (dfs(dep)) return true;
        }
      }

      inStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (dfs(task.id)) break;
    }

    return cycles.length > 0 ? { valid: false, cycles } : { valid: true };
  }

  private toNode(row: any): TaskNode {
    const deps = this.db.prepare(`SELECT depends_on FROM task_dependencies WHERE task_id = ?`).all(row.id) as any[];
    return {
      id: row.id,
      missionId: row.mission_id,
      title: row.title,
      description: row.description,
      assignedTo: row.assigned_to ?? undefined,
      status: row.status as TaskStatus,
      dependencies: deps.map(d => d.depends_on),
      result: row.result ? JSON.parse(row.result) : undefined,
      timeout: row.timeout,
      retries: row.retries,
      priority: row.priority ?? 0,
      requiredCapabilities: row.required_capabilities ? JSON.parse(row.required_capabilities) : [],
      createdAt: row.created_at,
    };
  }
}
