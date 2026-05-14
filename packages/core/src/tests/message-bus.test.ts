import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import path from 'path';
import fs from 'fs-extra';
import { createConnection } from '../database/connection.js';
import { initializeSchema, migrateSchema } from '../database/schema.js';
import { MessageBus } from '../agents/message-bus.js';
import { WorkspaceEventBus } from '../events/event-bus.js';

const TEST_DIR = path.join(process.cwd(), '.context-db-test-messages');

describe('MessageBus', function () {
  this.timeout(10000);
  let db: ReturnType<typeof createConnection>;
  let bus: MessageBus;
  let eventBus: WorkspaceEventBus;

  const agentA = randomUUID();
  const agentB = randomUUID();
  const agentX = randomUUID();
  const agentY = randomUUID();

  before(() => {
    fs.ensureDirSync(TEST_DIR);
    db = createConnection(path.join(TEST_DIR, 'messages.db'));
    initializeSchema(db);
    migrateSchema(db);
    eventBus = new WorkspaceEventBus();
    bus = new MessageBus(db, eventBus);
  });

  after(() => {
    db.close();
    fs.removeSync(TEST_DIR);
  });

  it('sends a direct message and retrieves it', () => {
    const msgId = bus.send({ from: agentA, to: agentB, intent: 'task.assign', payload: { taskId: '1' } });
    assert.ok(msgId);

    const messages = bus.getUndelivered(agentB);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].intent, 'task.assign');
    assert.strictEqual(messages[0].from, agentA);
  });

  it('acknowledges a message', () => {
    const messages = bus.getUndelivered(agentB);
    assert.ok(messages.length > 0);

    bus.acknowledge(messages[0].id);

    const remaining = bus.getUndelivered(agentB);
    assert.strictEqual(remaining.length, 0);
  });

  it('sends a broadcast message (to = *)', () => {
    bus.send({ from: 'scheduler', to: '*', intent: 'finding.share', payload: { data: 'test' } });

    const broadcasts = bus.getBroadcasts(agentA);
    assert.ok(broadcasts.length >= 1);
    assert.strictEqual(broadcasts[0].intent, 'finding.share');
  });

  it('supports correlation IDs for request-reply', () => {
    bus.send({ from: agentA, to: agentB, intent: 'question', correlationId: 'req-123' });
    bus.send({ from: agentB, to: agentA, intent: 'answer', correlationId: 'req-123', payload: { result: 42 } });

    const replies = bus.getByCorrelation('req-123');
    assert.strictEqual(replies.length, 2);
  });

  it('expired messages are not returned', () => {
    bus.send({ from: agentX, to: agentY, intent: 'ephemeral', ttl: 1 });

    // Simulate TTL expiry by backdating
    db.prepare(`UPDATE agent_messages SET timestamp = timestamp - 2000 WHERE intent = 'ephemeral'`).run();

    const messages = bus.getUndelivered(agentY);
    const ephemeral = messages.filter(m => m.intent === 'ephemeral');
    assert.strictEqual(ephemeral.length, 0);
  });
});
