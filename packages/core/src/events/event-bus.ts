import type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './types.js';

type Unsubscribe = () => void;

export class WorkspaceEventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();

  on<T extends EventType>(type: T, handler: EventHandler<T>): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  once<T extends EventType>(type: T): Promise<EventPayload<T>> {
    return new Promise((resolve) => {
      const unsub = this.on(type, (event) => {
        unsub();
        resolve(event);
      });
    });
  }

  emit(event: WorkspaceEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(event as any);
    }
  }
}
