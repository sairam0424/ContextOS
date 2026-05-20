import type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('event-bus');

type Unsubscribe = () => void;

const MAX_CONSECUTIVE_FAILURES = 5;

export class WorkspaceEventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private handlerFailures = new WeakMap<EventHandler<any>, number>();

  on<T extends EventType>(type: T, handler: EventHandler<T>): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  once<T extends EventType>(type: T, timeoutMs?: number): Promise<EventPayload<T>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const unsub = this.on(type, (event) => {
        if (timer !== undefined) clearTimeout(timer);
        unsub();
        resolve(event);
      });

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          unsub();
          reject(new Error(`once('${type}') timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
    });
  }

  emit(event: WorkspaceEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event as any);
        this.handlerFailures.set(handler, 0);
      } catch (err) {
        this.trackHandlerFailure(event.type, handler, err);
      }
    }
  }

  async emitAsync(event: WorkspaceEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    const promises = [...handlers].map(handler =>
      Promise.resolve()
        .then(() => handler(event as any))
        .then(() => {
          this.handlerFailures.set(handler, 0);
          return { handler, status: 'fulfilled' as const };
        })
        .catch((err) => {
          this.trackHandlerFailure(event.type, handler, err);
          return { handler, status: 'rejected' as const, reason: err };
        })
    );

    await Promise.all(promises);
  }

  listenerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  dispose(): void {
    this.handlers.clear();
    log.info('Event bus disposed — all handlers cleared');
  }

  private trackHandlerFailure(type: string, handler: EventHandler<any>, err: unknown): void {
    const failures = (this.handlerFailures.get(handler) ?? 0) + 1;
    this.handlerFailures.set(handler, failures);
    log.error({ err, type, consecutiveFailures: failures }, 'Event handler threw');

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      // Auto-unsubscribe the faulty handler from all event types
      for (const [, handlerSet] of this.handlers) {
        handlerSet.delete(handler);
      }
      log.warn({ type, failures }, 'Handler auto-unsubscribed after repeated failures');
    }
  }
}
