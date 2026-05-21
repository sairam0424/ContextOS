import assert from 'node:assert';
import { WorkspaceEventBus } from '../events/event-bus.js';

describe('WorkspaceEventBus (Enhanced)', function () {
  let bus: WorkspaceEventBus;

  beforeEach(function () {
    bus = new WorkspaceEventBus();
  });

  afterEach(function () {
    bus.dispose();
  });

  it('dispose() clears all handlers', () => {
    bus.on('task.completed', () => {});
    bus.on('task.failed', () => {});
    assert.strictEqual(bus.listenerCount('task.completed'), 1);
    bus.dispose();
    assert.strictEqual(bus.listenerCount('task.completed'), 0);
    assert.strictEqual(bus.listenerCount('task.failed'), 0);
  });

  it('listenerCount returns correct count', () => {
    assert.strictEqual(bus.listenerCount('task.completed'), 0);
    const unsub1 = bus.on('task.completed', () => {});
    const unsub2 = bus.on('task.completed', () => {});
    assert.strictEqual(bus.listenerCount('task.completed'), 2);
    unsub1();
    assert.strictEqual(bus.listenerCount('task.completed'), 1);
  });

  it('once() with timeout rejects on expiry', async () => {
    await assert.rejects(
      () => bus.once('task.completed', 50),
      (err: Error) => err.message.includes('timed out')
    );
  });

  it('once() with timeout resolves before expiry', async () => {
    const promise = bus.once('task.completed', 1000);
    setTimeout(() => bus.emit({ type: 'task.completed', taskId: 'test' }), 10);
    const event = await promise;
    assert.strictEqual((event as any).taskId, 'test');
  });

  it('emitAsync calls handlers asynchronously', async () => {
    let called = false;
    bus.on('task.completed', () => { called = true; });
    await bus.emitAsync({ type: 'task.completed', taskId: 'test' });
    assert.strictEqual(called, true);
  });
});
