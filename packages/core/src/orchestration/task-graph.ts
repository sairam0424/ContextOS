import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { TaskNode, CreateTaskOpts, TaskStatus, MissionProgress } from './types.js';
import type { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';
import { validateName } from '../validation.js';

const log = createChildLogger('task-graph');

export class TaskGraph {
  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  addTask(opts: CreateTaskOpts): TaskNode {
    const validatedTitle = validateName(opts.title, 256);
    const validatedDescription = validateName(opts.description, 4096);

    const id = randomUUID();
    const now = Date.now();
    const deps = opts.dependencies ?? [];

    this.db.prepare(`
      INSERT INTO task_nodes (id, mission_id, title, description, timeout, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, opts.missionId, validatedTitle, validatedDescription, opts.timeout ?? 300, now);

    for (const depId of deps) {
      this.db.prepare(`INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)`).run(id, depId);
    }

    log.debug({ taskId: id, missionId: opts.missionId, deps }, 'Task added to graph');

    return {
      id,
      missionId: opts.missionId,
      title: validatedTitle,
      description: validatedDescription,
      status: 'pending',
      dependencies: deps,
      timeout: opts.timeout ?? 300,
      retries: 0,
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
    const tasks = this.getTasksForMission(missionId);
    return tasks.filter(t => {
      if (t.status !== 'pending') return false;
      return t.dependencies.every(depId => {
        const dep = tasks.find(d => d.id === depId);
        return dep?.status === 'completed';
      });
    });
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    this.db.prepare(`UPDATE task_nodes SET status = ? WHERE id = ?`).run(status, taskId);
  }

  assign(taskId: string, agentId: string): boolean {
    const result = this.db.prepare(
      `UPDATE task_nodes SET status = 'assigned', assigned_to = ? WHERE id = ? AND status = 'pending'`
    ).run(agentId, taskId);
    if (result.changes > 0) {
      this.eventBus.emit({ type: 'task.assigned', taskId, agentId });
      return true;
    }
    return false;
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

    if (task.retries < 2) {
      this.db.prepare(`UPDATE task_nodes SET status = 'pending', assigned_to = NULL, retries = retries + 1 WHERE id = ?`).run(taskId);
      log.warn({ taskId, retries: task.retries + 1 }, 'Task failed, retrying');
    } else {
      this.db.prepare(`UPDATE task_nodes SET status = 'failed', result = ? WHERE id = ?`).run(JSON.stringify({ error }), taskId);
      this.eventBus.emit({ type: 'task.failed', taskId });
      log.error({ taskId }, 'Task permanently failed');
    }
  }

  getProgress(missionId: string): MissionProgress {
    const tasks = this.getTasksForMission(missionId);
    return {
      missionId,
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      assigned: tasks.filter(t => t.status === 'assigned').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }

  validateDAG(missionId: string): { valid: boolean; cycles?: string[] } {
    const tasks = this.getTasksForMission(missionId);
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

      const task = tasks.find(t => t.id === taskId);
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
      createdAt: row.created_at,
    };
  }
}
