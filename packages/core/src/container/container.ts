/**
 * A service that can be gracefully torn down.
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}

/**
 * A service that supports eager initialization / warmup.
 */
export interface Warmable {
  warmup(): Promise<void> | void;
}

/**
 * Branded token type for type-safe dependency injection.
 * The phantom `__type` field carries the resolved service type at compile time.
 */
export type Token<T> = symbol & { readonly __type: T };

type Factory<T> = (container: ServiceContainer) => T;

export class ServiceContainer {
  private factories = new Map<symbol, Factory<unknown>>();
  private instances = new Map<symbol, unknown>();
  private parent: ServiceContainer | null;

  constructor(parent: ServiceContainer | null = null) {
    this.parent = parent;
  }

  register<T>(token: Token<T>, factory: Factory<T>): void;
  register<T>(token: symbol, factory: Factory<T>): void;
  register<T>(token: symbol, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
    this.instances.delete(token);
  }

  resolve<T>(token: Token<T>): T;
  resolve<T>(token: symbol): T;
  resolve<T>(token: symbol): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const factory = this.factories.get(token) ?? this.parent?.getFactory(token);
    if (!factory) {
      throw new Error(`No factory registered for token: ${String(token)}`);
    }

    const instance = factory(this);
    this.instances.set(token, instance);
    return instance as T;
  }

  has(token: symbol): boolean {
    return this.factories.has(token) || (this.parent?.has(token) ?? false);
  }

  createScope(): ServiceContainer {
    return new ServiceContainer(this);
  }

  /**
   * Start the container: calls warmup() on all resolved instances that implement Warmable.
   */
  async start(): Promise<void> {
    for (const instance of this.instances.values()) {
      if (this.isWarmable(instance)) {
        await instance.warmup();
      }
    }
  }

  /**
   * Stop the container: calls dispose() on all resolved instances that implement Disposable,
   * in reverse resolution order, then clears the instance cache.
   */
  async stop(): Promise<void> {
    const entries = [...this.instances.values()].reverse();
    for (const instance of entries) {
      if (this.isDisposable(instance)) {
        await instance.dispose();
      }
    }
    this.instances.clear();
  }

  private isWarmable(value: unknown): value is Warmable {
    return (
      value !== null &&
      typeof value === 'object' &&
      'warmup' in (value as object) &&
      typeof (value as Warmable).warmup === 'function'
    );
  }

  private isDisposable(value: unknown): value is Disposable {
    return (
      value !== null &&
      typeof value === 'object' &&
      'dispose' in (value as object) &&
      typeof (value as Disposable).dispose === 'function'
    );
  }

  private getFactory(token: symbol): Factory<unknown> | undefined {
    return this.factories.get(token) ?? this.parent?.getFactory(token);
  }
}
