import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'mocha';
import Database from 'better-sqlite3';
import { initializeSchema } from '../database/schema.js';
import { MemoryStream } from '../cognitive/memory-stream.js';
import { ReflectionEngine } from '../cognitive/reflection-engine.js';
import { SkillLibrary } from '../cognitive/skill-library.js';
import { LanguageAgentTreeSearch } from '../cognitive/tree-search.js';

function createTestDb() {
  const db = new Database(':memory:');
  initializeSchema(db);
  return db;
}

function createMockEventBus() {
  const events: any[] = [];
  const mockEventBus = { emit: (event: any) => { events.push(event); } } as any;
  return { events, mockEventBus };
}

describe('MemoryStream', () => {
  let db: ReturnType<typeof createTestDb>;
  let stream: MemoryStream;
  let events: any[];
  let mockEventBus: any;

  beforeEach(() => {
    db = createTestDb();
    ({ events, mockEventBus } = createMockEventBus());
    stream = new MemoryStream(db, mockEventBus);
  });

  it('observe() stores a memory and returns it with correct fields', () => {
    const entry = stream.observe('agent-1', 'something happened', { type: 'observation' });
    assert.equal(entry.agentId, 'agent-1');
    assert.equal(entry.content, 'something happened');
    assert.equal(entry.type, 'observation');
    assert.equal(entry.accessCount, 0);
    assert.ok(entry.id > 0);
    assert.ok(entry.createdAt > 0);
  });

  it('observe() uses heuristic importance when not provided', () => {
    const entry = stream.observe('agent-1', 'a trivial note');
    assert.equal(entry.importance, 0.3);
  });

  it('observe() with explicit importance uses provided value', () => {
    const entry = stream.observe('agent-1', 'something', { importance: 0.75 });
    assert.equal(entry.importance, 0.75);
  });

  it('retrieve() returns memories sorted by three-factor score', () => {
    stream.observe('agent-1', 'error in production deployment crash', { importance: 0.9 });
    stream.observe('agent-1', 'trivial log message here', { importance: 0.1 });
    stream.observe('agent-1', 'error crash failure bug critical', { importance: 0.95 });

    const results = stream.retrieve('agent-1', 'error crash production');
    assert.ok(results.length >= 2);
    assert.ok(results[0].importance >= results[1].importance || results[0].content.includes('error'));
  });

  it('retrieve() filters by type when specified', () => {
    stream.observe('agent-1', 'observation content', { type: 'observation' });
    stream.observe('agent-1', 'reflection content', { type: 'reflection' });

    const results = stream.retrieve('agent-1', 'content', { type: 'reflection' });
    assert.ok(results.every(r => r.type === 'reflection'));
  });

  it('retrieve() updates access time and count', () => {
    stream.observe('agent-1', 'some memory content');
    const results = stream.retrieve('agent-1', 'memory content');
    assert.ok(results.length > 0);
    assert.equal(results[0].accessCount, 1);
  });

  it('getRecentMemories() returns most recent N entries', () => {
    db.prepare(
      "INSERT INTO memory_entries (agent_id, content, type, importance, created_at, accessed_at, access_count, parent_ids) VALUES (?, ?, ?, ?, ?, ?, 0, '[]')"
    ).run('agent-recent', 'old', 'observation', 0.3, 1000, 1000);
    db.prepare(
      "INSERT INTO memory_entries (agent_id, content, type, importance, created_at, accessed_at, access_count, parent_ids) VALUES (?, ?, ?, ?, ?, ?, 0, '[]')"
    ).run('agent-recent', 'mid', 'observation', 0.3, 2000, 2000);
    db.prepare(
      "INSERT INTO memory_entries (agent_id, content, type, importance, created_at, accessed_at, access_count, parent_ids) VALUES (?, ?, ?, ?, ?, ?, 0, '[]')"
    ).run('agent-recent', 'new', 'observation', 0.3, 3000, 3000);

    const recent = stream.getRecentMemories('agent-recent', 2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].content, 'new');
    assert.equal(recent[1].content, 'mid');
  });

  it('auto-reflection triggers when accumulated importance exceeds threshold', (done) => {
    const lowThresholdStream = new MemoryStream(db, mockEventBus, { reflectionThreshold: 1.0 });
    lowThresholdStream.observe('agent-1', 'error crash failure', { importance: 0.6 });
    lowThresholdStream.observe('agent-1', 'another error crash', { importance: 0.6 });

    setTimeout(() => {
      const reflectionEvent = events.find(e => e.type === 'memory.reflected');
      assert.ok(reflectionEvent, 'should have emitted memory.reflected event');
      done();
    }, 50);
  });

  it('scoreImportance() gives higher scores to error-related content', () => {
    const errorEntry = stream.observe('agent-1', 'critical error failure bug crash');
    const normalEntry = stream.observe('agent-1', 'simple text with no keywords');
    assert.ok(errorEntry.importance > normalEntry.importance);
  });
});

describe('ReflectionEngine', () => {
  let db: ReturnType<typeof createTestDb>;
  let engine: ReflectionEngine;
  let stream: MemoryStream;
  let events: any[];
  let mockEventBus: any;

  beforeEach(() => {
    db = createTestDb();
    ({ events, mockEventBus } = createMockEventBus());
    stream = new MemoryStream(db, mockEventBus);
    engine = new ReflectionEngine(db, mockEventBus, stream);
  });

  it('reflect() creates reflection and stores in memory stream', () => {
    const reflection = engine.reflect({
      agentId: 'agent-1',
      taskId: 'task-1',
      trial: 1,
      observation: 'test failed',
      diagnosis: 'missing null check',
      prescription: 'add null guard before access',
    });

    assert.equal(reflection.agentId, 'agent-1');
    assert.equal(reflection.taskId, 'task-1');
    assert.equal(reflection.trial, 1);
    assert.equal(reflection.validated, false);
    assert.ok(reflection.id > 0);

    const memories = stream.getRecentMemories('agent-1', 10);
    assert.ok(memories.some(m => m.content === 'add null guard before access'));
  });

  it('reflect() emits memory.reflected event', () => {
    engine.reflect({
      agentId: 'agent-1',
      taskId: 'task-1',
      trial: 1,
      observation: 'obs',
      diagnosis: 'diag',
      prescription: 'fix',
    });

    const reflectedEvents = events.filter(e => e.type === 'memory.reflected');
    assert.ok(reflectedEvents.length > 0);
    assert.equal(reflectedEvents[0].agentId, 'agent-1');
  });

  it('getReflectionsForTask() returns reflections ordered by trial', () => {
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 3, observation: 'o', diagnosis: 'd', prescription: 'p' });
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 1, observation: 'o', diagnosis: 'd', prescription: 'p' });
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 2, observation: 'o', diagnosis: 'd', prescription: 'p' });

    const results = engine.getReflectionsForTask('t1');
    assert.equal(results[0].trial, 1);
    assert.equal(results[1].trial, 2);
    assert.equal(results[2].trial, 3);
  });

  it('getRelevantReflections() returns reflections ranked by text overlap', () => {
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 1, observation: 'database connection timeout', diagnosis: 'd', prescription: 'increase pool size' });
    engine.reflect({ agentId: 'a', taskId: 't2', trial: 1, observation: 'button styling issue', diagnosis: 'd', prescription: 'fix css margin' });

    const results = engine.getRelevantReflections('a', 'database connection pool');
    assert.ok(results.length > 0);
    assert.ok(results[0].observation.includes('database'));
  });

  it('validate() marks reflection as validated', () => {
    const r = engine.reflect({ agentId: 'a', taskId: 't1', trial: 1, observation: 'o', diagnosis: 'd', prescription: 'p' });
    engine.validate(r.id);

    const validated = engine.getValidatedReflections('a');
    assert.ok(validated.some(v => v.id === r.id));
  });

  it('getValidatedReflections() returns only validated reflections', () => {
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 1, observation: 'o', diagnosis: 'd', prescription: 'p1' });
    const r2 = engine.reflect({ agentId: 'a', taskId: 't2', trial: 1, observation: 'o', diagnosis: 'd', prescription: 'p2' });
    engine.validate(r2.id);

    const validated = engine.getValidatedReflections('a');
    assert.equal(validated.length, 1);
    assert.equal(validated[0].prescription, 'p2');
  });

  it('buildAugmentedContext() prepends past learnings to task description', () => {
    engine.reflect({ agentId: 'a', taskId: 't1', trial: 1, observation: 'timeout issue', diagnosis: 'd', prescription: 'use retry logic' });

    const context = engine.buildAugmentedContext('a', 'fix the timeout issue');
    assert.ok(context.includes('Past learnings:'));
    assert.ok(context.includes('use retry logic'));
    assert.ok(context.includes('fix the timeout issue'));
  });

  it('buildAugmentedContext() returns original task when no reflections exist', () => {
    const context = engine.buildAugmentedContext('agent-new', 'implement feature X');
    assert.equal(context, 'implement feature X');
  });
});

describe('SkillLibrary', () => {
  let db: ReturnType<typeof createTestDb>;
  let library: SkillLibrary;

  beforeEach(() => {
    db = createTestDb();
    library = new SkillLibrary(db);
  });

  it('store() creates a new skill', () => {
    const skill = library.store({ name: 'deploy', description: 'deploy to production', code: 'run deploy.sh', createdBy: 'agent-1' });
    assert.equal(skill.name, 'deploy');
    assert.equal(skill.version, 1);
    assert.equal(skill.successCount, 0);
  });

  it('store() updates existing skill and increments version', () => {
    library.store({ name: 'deploy', description: 'v1', code: 'code-v1', createdBy: 'agent-1' });
    const updated = library.store({ name: 'deploy', description: 'v2', code: 'code-v2', createdBy: 'agent-1' });
    assert.equal(updated.version, 2);
    assert.equal(updated.description, 'v2');
  });

  it('search() returns skills ranked by text overlap + success rate', () => {
    library.store({ name: 'deploy-prod', description: 'deploy to production server', code: 'c', createdBy: 'a' });
    library.store({ name: 'test-unit', description: 'run unit tests locally', code: 'c', createdBy: 'a' });

    const results = library.search('deploy production');
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, 'deploy-prod');
  });

  it('getByName() returns skill or null', () => {
    library.store({ name: 'lint', description: 'run linter', code: 'eslint .', createdBy: 'a' });
    const found = library.getByName('lint');
    assert.ok(found);
    assert.equal(found!.name, 'lint');

    const notFound = library.getByName('nonexistent');
    assert.equal(notFound, null);
  });

  it('recordExecution() increments success count on success', () => {
    const skill = library.store({ name: 'build', description: 'build project', code: 'npm run build', createdBy: 'a' });
    library.recordExecution({ skillId: skill.id, success: true, output: 'ok', durationMs: 100 });

    const updated = library.getByName('build');
    assert.equal(updated!.successCount, 1);
  });

  it('recordExecution() increments failure count on failure', () => {
    const skill = library.store({ name: 'build', description: 'build project', code: 'npm run build', createdBy: 'a' });
    library.recordExecution({ skillId: skill.id, success: false, output: '', error: 'failed', durationMs: 50 });

    const updated = library.getByName('build');
    assert.equal(updated!.failureCount, 1);
  });

  it('getPrerequisites() returns transitive prerequisites', () => {
    library.store({ name: 'install', description: 'install deps', code: 'c', createdBy: 'a' });
    library.store({ name: 'build', description: 'build', code: 'c', prerequisites: ['install'], createdBy: 'a' });
    library.store({ name: 'deploy', description: 'deploy', code: 'c', prerequisites: ['build'], createdBy: 'a' });

    const prereqs = library.getPrerequisites('deploy');
    assert.ok(prereqs.includes('install'));
    assert.ok(prereqs.includes('build'));
  });

  it('getPrerequisites() handles circular dependencies', () => {
    library.store({ name: 'a', description: 'a', code: 'c', prerequisites: ['b'], createdBy: 'x' });
    library.store({ name: 'b', description: 'b', code: 'c', prerequisites: ['a'], createdBy: 'x' });

    const prereqs = library.getPrerequisites('a');
    assert.ok(Array.isArray(prereqs));
    assert.ok(prereqs.includes('b'));
  });

  it('compose() creates composite skill with prerequisites', () => {
    library.store({ name: 'install', description: 'install', code: 'c', createdBy: 'a' });
    library.store({ name: 'build', description: 'build', code: 'c', createdBy: 'a' });

    const composite = library.compose('full-pipeline', 'install and build', ['install', 'build'], 'a');
    assert.equal(composite.name, 'full-pipeline');
    assert.deepEqual(composite.prerequisites, ['install', 'build']);
    assert.ok(composite.code.includes('composite'));
  });

  it('prune() removes unreliable skills', () => {
    const skill = library.store({ name: 'flaky', description: 'flaky skill', code: 'c', createdBy: 'a' });
    for (let i = 0; i < 6; i++) {
      library.recordExecution({ skillId: skill.id, success: false, output: '', error: 'fail', durationMs: 10 });
    }

    const pruned = library.prune(0.8, 5);
    assert.ok(pruned >= 1);
    assert.equal(library.getByName('flaky'), null);
  });
});

describe('LanguageAgentTreeSearch', () => {
  let lats: LanguageAgentTreeSearch;

  beforeEach(() => {
    lats = new LanguageAgentTreeSearch({ maxDepth: 5, explorationConstant: 1.414 });
  });

  it('initialize() creates root node', () => {
    const rootId = lats.initialize('initial state');
    const root = lats.getNode(rootId);
    assert.ok(root);
    assert.equal(root!.state, 'initial state');
    assert.equal(root!.depth, 0);
    assert.equal(root!.parentId, null);
  });

  it('expand() adds children to a node', () => {
    const rootId = lats.initialize('root');
    const childIds = lats.expand(rootId, ['action-a', 'action-b'], ['state-a', 'state-b']);

    assert.equal(childIds.length, 2);
    const childA = lats.getNode(childIds[0]);
    assert.equal(childA!.action, 'action-a');
    assert.equal(childA!.state, 'state-a');
    assert.equal(childA!.depth, 1);
  });

  it('select() uses UCT to pick most promising leaf', () => {
    const rootId = lats.initialize('root');
    lats.expand(rootId, ['a1', 'a2'], ['s1', 's2']);

    const selected = lats.select();
    assert.ok(selected);
    const node = lats.getNode(selected!);
    assert.ok(node);
    assert.ok(node!.children.length === 0);
  });

  it('backpropagate() updates values up to root', () => {
    const rootId = lats.initialize('root');
    const children = lats.expand(rootId, ['a1'], ['s1']);
    lats.backpropagate(children[0], 1.0);

    const root = lats.getNode(rootId);
    const child = lats.getNode(children[0]);
    assert.equal(root!.visits, 1);
    assert.equal(root!.value, 1.0);
    assert.equal(child!.visits, 1);
    assert.equal(child!.value, 1.0);
  });

  it('getBestAction() returns most-visited child action', () => {
    const rootId = lats.initialize('root');
    const children = lats.expand(rootId, ['a1', 'a2'], ['s1', 's2']);
    lats.backpropagate(children[0], 1.0);
    lats.backpropagate(children[0], 1.0);
    lats.backpropagate(children[1], 0.5);

    const best = lats.getBestAction();
    assert.ok(best);
    assert.equal(best!.action, 'a1');
    assert.ok(best!.confidence > 0.5);
  });

  it('getBestTrajectory() follows highest-value path', () => {
    const rootId = lats.initialize('root');
    const children = lats.expand(rootId, ['a1', 'a2'], ['s1', 's2']);
    lats.backpropagate(children[0], 5.0);
    lats.backpropagate(children[1], 1.0);

    const trajectory = lats.getBestTrajectory();
    assert.ok(trajectory.length >= 2);
    assert.equal(trajectory[0].state, 'root');
    assert.equal(trajectory[1].action, 'a1');
  });

  it('reset() clears all state', () => {
    lats.initialize('root');
    lats.reset();

    const stats = lats.getStats();
    assert.equal(stats.totalNodes, 0);
    assert.equal(stats.rootVisits, 0);
  });

  it('getStats() returns correct statistics', () => {
    const rootId = lats.initialize('root');
    const children = lats.expand(rootId, ['a1', 'a2', 'a3'], ['s1', 's2', 's3']);
    lats.backpropagate(children[0], 1.0);

    const stats = lats.getStats();
    assert.equal(stats.totalNodes, 4);
    assert.equal(stats.maxDepth, 1);
    assert.equal(stats.rootVisits, 1);
  });
});
