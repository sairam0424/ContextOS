import type { RawDB } from '../database/types.js';
import { TaskGraph } from './task-graph.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import type { WorkspaceEventBus } from '../events/index.js';
import type { AgentRecord } from '../agents/types.js';
import type { TaskNode } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('scheduler');

export class TaskScheduler {
  private graph: TaskGraph;

  constructor(
    private db: RawDB,
    private registry: AgentRegistry,
    private messageBus: MessageBus,
    private eventBus: WorkspaceEventBus
  ) {
    this.graph = new TaskGraph(db, eventBus);
  }

  assignNext(missionId: string): TaskNode | null {
    const ready = this.graph.getReady(missionId);
    if (ready.length === 0) return null;

    // Sort ready tasks by priority DESC (highest priority first)
    const sortedTasks = [...ready].sort((a, b) => b.priority - a.priority);

    const allAgents = this.registry.getActive();
    if (allAgents.length === 0) {
      log.warn({ missionId }, 'No active agents available');
      return null;
    }

    // Least-loaded selection helper
    const agentTaskCounts = new Map<string, number>();
    for (const a of allAgents) {
      const row = this.db.prepare(
        `SELECT COUNT(*) as count FROM task_nodes WHERE assigned_to = ? AND status = 'assigned'`
      ).get(a.id) as { count: number } | undefined;
      agentTaskCounts.set(a.id, row?.count ?? 0);
    }

    for (const task of sortedTasks) {
      // Filter agents by required capabilities if specified
      let candidates: AgentRecord[];
      if (task.requiredCapabilities.length > 0) {
        candidates = allAgents.filter(agent =>
          task.requiredCapabilities.every(cap =>
            agent.capabilities.some(ac => ac.toLowerCase().includes(cap.toLowerCase()))
          )
        );
        if (candidates.length === 0) {
          log.debug({ taskId: task.id, requiredCapabilities: task.requiredCapabilities }, 'No agents match required capabilities');
          continue;
        }
      } else {
        candidates = allAgents;
      }

      // Pick least-loaded from matching candidates
      const sortedCandidates = [...candidates].sort((a, b) =>
        (agentTaskCounts.get(a.id) ?? 0) - (agentTaskCounts.get(b.id) ?? 0)
      );
      const agent = sortedCandidates[0];

      const assigned = this.graph.assign(task.id, agent.id);
      if (!assigned) {
        log.debug({ taskId: task.id }, 'Task already claimed, trying next');
        continue;
      }

      this.messageBus.send({
        from: 'scheduler',
        to: agent.id,
        intent: 'task.assign',
        payload: { taskId: task.id, title: task.title, description: task.description },
      });

      log.info({ taskId: task.id, agentId: agent.id, priority: task.priority }, 'Task assigned');
      return this.graph.getTask(task.id)!;
    }

    return null;
  }

  complete(taskId: string, result?: unknown): void {
    this.graph.complete(taskId, result);
    log.info({ taskId }, 'Task completed');
  }

  fail(taskId: string, error: string): void {
    this.graph.fail(taskId, error);
  }

  enforceTimeouts(missionId: string): TaskNode[] {
    const assignedTasks = this.graph.getAssignedTasks(missionId);
    const now = Date.now();
    const timedOut: TaskNode[] = [];

    for (const task of assignedTasks) {
      const assignedAt = this.graph.getAssignedAt(task.id);
      if (!assignedAt) continue;

      const timeoutMs = task.timeout * 1000;
      if (now - assignedAt > timeoutMs) {
        this.graph.fail(task.id, 'Task timed out');
        log.warn({ taskId: task.id, missionId, timeoutSeconds: task.timeout }, 'Task timed out, marked as failed');
        timedOut.push(task);
      }
    }

    return timedOut;
  }

  releaseOrphanedTasks(missionId: string): TaskNode[] {
    const assignedTasks = this.graph.getAssignedTasks(missionId);
    const released: TaskNode[] = [];

    for (const task of assignedTasks) {
      if (!task.assignedTo) continue;

      const agent = this.registry.getById(task.assignedTo);
      if (!agent || agent.status === 'quarantined') {
        this.graph.resetToPending(task.id);
        log.warn(
          { taskId: task.id, agentId: task.assignedTo, reason: agent ? 'quarantined' : 'missing' },
          'Releasing orphaned task back to pending'
        );
        released.push(task);
      }
    }

    return released;
  }

  getProgress(missionId: string) {
    return this.graph.getProgress(missionId);
  }

  getGraph(): TaskGraph {
    return this.graph;
  }
}
