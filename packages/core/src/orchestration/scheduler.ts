import type { RawDB } from '../database/types.js';
import { TaskGraph } from './task-graph.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import type { TaskNode } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('scheduler');

export class TaskScheduler {
  private graph: TaskGraph;

  constructor(
    private db: RawDB,
    private registry: AgentRegistry,
    private messageBus: MessageBus
  ) {
    this.graph = new TaskGraph(db);
  }

  assignNext(missionId: string): TaskNode | null {
    const ready = this.graph.getReady(missionId);
    if (ready.length === 0) return null;

    const task = ready[0];
    const agents = this.registry.getActive();
    if (agents.length === 0) {
      log.warn({ taskId: task.id }, 'No active agents available');
      return null;
    }

    const agent = agents[0];
    this.graph.assign(task.id, agent.id);

    this.messageBus.send({
      from: 'scheduler',
      to: agent.id,
      intent: 'task.assign',
      payload: { taskId: task.id, title: task.title, description: task.description },
    });

    log.info({ taskId: task.id, agentId: agent.id }, 'Task assigned');
    return this.graph.getTask(task.id)!;
  }

  complete(taskId: string, result?: unknown): void {
    this.graph.complete(taskId, result);
    log.info({ taskId }, 'Task completed');
  }

  fail(taskId: string, error: string): void {
    this.graph.fail(taskId, error);
  }

  getProgress(missionId: string) {
    return this.graph.getProgress(missionId);
  }

  getGraph(): TaskGraph {
    return this.graph;
  }
}
