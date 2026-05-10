import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { TaskScheduler } from '../orchestration/scheduler.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import { WorkspaceEventBus } from '../events/event-bus.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-scheduler');

describe('TaskScheduler', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let scheduler: TaskScheduler;
  let registry: AgentRegistry;

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'scheduler.db'));
    initializeSchema(db);
    migrateSchema(db);
    const eventBus = new WorkspaceEventBus();
    registry = new AgentRegistry(db, eventBus);
    const messageBus = new MessageBus(db, eventBus);
    scheduler = new TaskScheduler(db, registry, messageBus);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('returns null when no tasks are ready', () => {
    const result = scheduler.assignNext('empty-mission');
    assert.strictEqual(result, null);
  });

  it('assigns a ready task to an active agent', () => {
    registry.register({ name: 'worker-1', capabilities: ['code'] });
    const graph = scheduler.getGraph();
    graph.addTask({ missionId: 'mission-sched', title: 'Task A', description: 'Do work' });

    const assigned = scheduler.assignNext('mission-sched');
    assert.ok(assigned);
    assert.strictEqual(assigned.status, 'assigned');
    assert.ok(assigned.assignedTo);
  });

  it('completes a task', () => {
    const graph = scheduler.getGraph();
    const tasks = graph.getTasksForMission('mission-sched');
    const task = tasks[0];

    scheduler.complete(task.id, { output: 'done' });
    const updated = graph.getTask(task.id);
    assert.strictEqual(updated?.status, 'completed');
  });

  it('reports progress', () => {
    const progress = scheduler.getProgress('mission-sched');
    assert.strictEqual(progress.completed, 1);
  });
});
