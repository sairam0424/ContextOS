import assert from 'node:assert';
import { ServiceContainer } from '../container/container.js';
import type { Disposable, Warmable } from '../container/container.js';

describe('ServiceContainer lifecycle', function () {
  describe('start()', function () {
    it('calls warmup() on services that implement Warmable', async () => {
      const container = new ServiceContainer();
      const calls: string[] = [];

      const tokenA = Symbol.for('test:WarmableA');
      const tokenB = Symbol.for('test:Plain');

      container.register(tokenA, () => ({
        warmup() { calls.push('A'); },
      } satisfies Warmable));

      container.register(tokenB, () => ({ value: 42 }));

      // Resolve both so instances are cached
      container.resolve(tokenA);
      container.resolve(tokenB);

      await container.start();

      assert.deepStrictEqual(calls, ['A']);
    });

    it('handles async warmup()', async () => {
      const container = new ServiceContainer();
      let warmed = false;

      const token = Symbol.for('test:AsyncWarmable');
      container.register(token, () => ({
        async warmup() { warmed = true; },
      } satisfies Warmable));

      container.resolve(token);
      await container.start();

      assert.strictEqual(warmed, true);
    });
  });

  describe('stop()', function () {
    it('calls dispose() on services that implement Disposable', async () => {
      const container = new ServiceContainer();
      const calls: string[] = [];

      const token = Symbol.for('test:Disposable');
      container.register(token, () => ({
        dispose() { calls.push('disposed'); },
      } satisfies Disposable));

      container.resolve(token);
      await container.stop();

      assert.deepStrictEqual(calls, ['disposed']);
    });

    it('calls dispose() in reverse resolution order', async () => {
      const container = new ServiceContainer();
      const calls: string[] = [];

      const tokenA = Symbol.for('test:DisposableA');
      const tokenB = Symbol.for('test:DisposableB');
      const tokenC = Symbol.for('test:DisposableC');

      container.register(tokenA, () => ({
        dispose() { calls.push('A'); },
      } satisfies Disposable));

      container.register(tokenB, () => ({
        dispose() { calls.push('B'); },
      } satisfies Disposable));

      container.register(tokenC, () => ({
        dispose() { calls.push('C'); },
      } satisfies Disposable));

      // Resolve in order A, B, C
      container.resolve(tokenA);
      container.resolve(tokenB);
      container.resolve(tokenC);

      await container.stop();

      // Should dispose in reverse: C, B, A
      assert.deepStrictEqual(calls, ['C', 'B', 'A']);
    });

    it('clears instances after stop()', async () => {
      const container = new ServiceContainer();
      let count = 0;

      const token = Symbol.for('test:Clearable');
      container.register(token, () => ({
        id: ++count,
        dispose() {},
      }));

      container.resolve(token);
      await container.stop();

      // Re-resolve should create a new instance
      const fresh = container.resolve<{ id: number }>(token);
      assert.strictEqual(fresh.id, 2);
    });

    it('handles async dispose()', async () => {
      const container = new ServiceContainer();
      let disposed = false;

      const token = Symbol.for('test:AsyncDisposable');
      container.register(token, () => ({
        async dispose() { disposed = true; },
      } satisfies Disposable));

      container.resolve(token);
      await container.stop();

      assert.strictEqual(disposed, true);
    });
  });

  describe('detection', function () {
    it('ignores services without warmup or dispose', async () => {
      const container = new ServiceContainer();
      const token = Symbol.for('test:PlainService');

      container.register(token, () => ({ hello: 'world' }));
      container.resolve(token);

      // Should not throw
      await container.start();
      await container.stop();
    });

    it('handles a service that is both Warmable and Disposable', async () => {
      const container = new ServiceContainer();
      const calls: string[] = [];

      const token = Symbol.for('test:FullLifecycle');
      container.register(token, () => ({
        warmup() { calls.push('warmup'); },
        dispose() { calls.push('dispose'); },
      } satisfies Warmable & Disposable));

      container.resolve(token);

      await container.start();
      await container.stop();

      assert.deepStrictEqual(calls, ['warmup', 'dispose']);
    });
  });
});
