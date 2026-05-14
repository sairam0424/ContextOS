import assert from 'node:assert';
import { ServiceContainer } from '../container/container.js';

describe('ServiceContainer', function () {
  it('registers and resolves a service', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Greeter');

    container.register(token, () => ({ greet: () => 'hello' }));
    const service = container.resolve<{ greet: () => string }>(token);

    assert.strictEqual(service.greet(), 'hello');
  });

  it('returns same instance on subsequent resolves (singleton within container)', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Counter');
    let count = 0;

    container.register(token, () => ({ id: ++count }));

    const a = container.resolve<{ id: number }>(token);
    const b = container.resolve<{ id: number }>(token);

    assert.strictEqual(a.id, b.id);
    assert.strictEqual(count, 1);
  });

  it('throws on unregistered token', () => {
    const container = new ServiceContainer();
    const token = Symbol.for('test:Missing');

    assert.throws(() => container.resolve(token), /No factory registered/);
  });

  it('createScope inherits parent registrations', () => {
    const parent = new ServiceContainer();
    const token = Symbol.for('test:Shared');

    parent.register(token, () => ({ value: 42 }));

    const child = parent.createScope();
    const service = child.resolve<{ value: number }>(token);

    assert.strictEqual(service.value, 42);
  });

  it('createScope can override parent registrations', () => {
    const parent = new ServiceContainer();
    const token = Symbol.for('test:Override');

    parent.register(token, () => ({ value: 'parent' }));

    const child = parent.createScope();
    child.register(token, () => ({ value: 'child' }));

    assert.strictEqual(parent.resolve<{ value: string }>(token).value, 'parent');
    assert.strictEqual(child.resolve<{ value: string }>(token).value, 'child');
  });
});
