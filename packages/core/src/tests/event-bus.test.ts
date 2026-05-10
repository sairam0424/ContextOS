import assert from 'node:assert';
import { WorkspaceEventBus } from '../events/event-bus.js';

describe('WorkspaceEventBus', function () {
  it('emits and receives typed events', () => {
    const bus = new WorkspaceEventBus();
    const received: any[] = [];

    bus.on('file.changed', (event) => {
      received.push(event);
    });

    bus.emit({ type: 'file.changed', path: 'test.md', kind: 'add' });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].path, 'test.md');
    assert.strictEqual(received[0].kind, 'add');
  });

  it('supports multiple handlers for same event type', () => {
    const bus = new WorkspaceEventBus();
    let count = 0;

    bus.on('file.deleted', () => { count++; });
    bus.on('file.deleted', () => { count++; });

    bus.emit({ type: 'file.deleted', path: 'gone.md' });

    assert.strictEqual(count, 2);
  });

  it('unsubscribe removes handler', () => {
    const bus = new WorkspaceEventBus();
    let count = 0;

    const unsub = bus.on('file.changed', () => { count++; });
    bus.emit({ type: 'file.changed', path: 'a.md', kind: 'change' });
    unsub();
    bus.emit({ type: 'file.changed', path: 'b.md', kind: 'change' });

    assert.strictEqual(count, 1);
  });

  it('once resolves on next matching event', async () => {
    const bus = new WorkspaceEventBus();

    const promise = bus.once('embedding.ready');
    bus.emit({ type: 'embedding.ready', path: 'doc.md', docId: 1 });

    const event = await promise;
    assert.strictEqual(event.docId, 1);
  });

  it('does not cross-fire between event types', () => {
    const bus = new WorkspaceEventBus();
    let received = false;

    bus.on('file.deleted', () => { received = true; });
    bus.emit({ type: 'file.changed', path: 'x.md', kind: 'add' });

    assert.strictEqual(received, false);
  });
});
