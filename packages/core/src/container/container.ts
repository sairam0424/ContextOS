type Factory<T> = (container: ServiceContainer) => T;

export class ServiceContainer {
  private factories = new Map<symbol, Factory<unknown>>();
  private instances = new Map<symbol, unknown>();
  private parent: ServiceContainer | null;

  constructor(parent: ServiceContainer | null = null) {
    this.parent = parent;
  }

  register<T>(token: symbol, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
    this.instances.delete(token);
  }

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

  private getFactory(token: symbol): Factory<unknown> | undefined {
    return this.factories.get(token) ?? this.parent?.getFactory(token);
  }
}
