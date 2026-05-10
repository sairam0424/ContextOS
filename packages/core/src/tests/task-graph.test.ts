import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { TaskGraph } from '../orchestration/task-graph.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-taskgraph');

describe('TaskGraph', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let graph: TaskGraph;
  const missionId = 'mission-001';

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'tasks.db'));
    initializeSchema(db);
    migrateSchema(db);
    graph = new TaskGraph(db);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('adds tasks and retrieves them by mission', () => {
    graph.addTask({ missionId, title: 'Setup', description: 'Initialize project' });
    graph.addTask({ missionId, title: 'Build', description: 'Compile code' });

    const tasks = graph.getTasksForMission(missionId);
    assert.strictEqual(tasks.length, 2);
  });

  it('respects dependencies — only ready tasks have all deps completed', () => {
    const setup = graph.getTasksForMission(missionId).find(t => t.title === 'Setup')!;
    const buildTask = graph.addTask({ missionId, title: 'Deploy', description: 'Ship it', dependencies: [setup.id] });

    const ready = graph.getReady(missionId);
    const readyTitles = ready.map(t => t.title);
    assert.ok(!readyTitles.includes('Deploy'), 'Deploy should not be ready (Setup not complete)');

    graph.complete(setup.id);
    const readyAfter = graph.getReady(missionId);
    assert.ok(readyAfter.some(t => t.title === 'Deploy'), 'Deploy should be ready after Setup completes');
  });

  it('assigns a task to an agent', () => {
    const ready = graph.getReady(missionId);
    const task = ready[0];
    graph.assign(task.id, 'agent-x');

    const updated = graph.getTask(task.id);
    assert.strictEqual(updated?.status, 'assigned');
    assert.strictEqual(updated?.assignedTo, 'agent-x');
  });

  it('fails a task with retry', () => {
    const tasks = graph.getTasksForMission(missionId);
    const buildTask = tasks.find(t => t.title === 'Build')!;
    graph.assign(buildTask.id, 'agent-y');

    graph.fail(buildTask.id, 'timeout');
    const retried = graph.getTask(buildTask.id);
    assert.strictEqual(retried?.status, 'pending');
    assert.strictEqual(retried?.retries, 1);
  });

  it('reports progress', () => {
    const progress = graph.getProgress(missionId);
    assert.strictEqual(progress.total, 3);
    assert.ok(progress.completed >= 1);
  });

  it('validates DAG (no cycles)', () => {
    const result = graph.validateDAG(missionId);
    assert.strictEqual(result.valid, true);
  });
});
