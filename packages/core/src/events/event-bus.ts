import type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './types.js';
import type { EventStore } from './event-store.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('event-bus');

type Unsubscribe = () => void;

const MAX_CONSECUTIVE_FAILURES = 5;

interface PriorityHandler {
  readonly handler: EventHandler<any>;
  readonly priority: number;
}

/**
 * Returns true if `pattern` is a wildcard that matches `eventType`.
 * - '*' matches all event types
 * - 'agent.*' matches any type starting with 'agent.'
 */
function matchesWildcard(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // 'agent.*' → 'agent.'
    return eventType.startsWith(prefix);
  }
  return false;
}

/**
 * Returns true if the pattern string contains a wildcard character.
 */
function isWildcardPattern(pattern: string): boolean {
  return pattern.includes('*');
}

/**
 * Binary search to find the insertion index for a handler with `priority`
 * in a descending-sorted array. Handlers with equal priority are appended
 * after existing ones (stable insertion order within same priority).
 */
function findInsertionIndex(handlers: readonly PriorityHandler[], priority: number): number {
  let low = 0;
  let high = handlers.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (handlers[mid].priority >= priority) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Inserts a PriorityHandler into a sorted array (immutable — returns new array).
 */
function insertHandler(handlers: readonly PriorityHandler[], entry: PriorityHandler): PriorityHandler[] {
  const index = findInsertionIndex(handlers, entry.priority);
  const result = [...handlers.slice(0, index), entry, ...handlers.slice(index)];
  return result;
}

/**
 * Removes a handler from the array (immutable — returns new array).
 */
function removeHandler(handlers: readonly PriorityHandler[], handler: EventHandler<any>): PriorityHandler[] {
  return handlers.filter(entry => entry.handler !== handler);
}

/**
 * Merges two sorted PriorityHandler arrays into one sorted array (descending priority).
 */
function mergeSorted(a: readonly PriorityHandler[], b: readonly PriorityHandler[]): PriorityHandler[] {
  const result: PriorityHandler[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].priority >= b[j].priority) {
      result.push(a[i]);
      i++;
    } else {
      result.push(b[j]);
      j++;
    }
  }
  while (i < a.length) {
    result.push(a[i]);
    i++;
  }
  while (j < b.length) {
    result.push(b[j]);
    j++;
  }
  return result;
}

export class WorkspaceEventBus {
  private handlers = new Map<string, PriorityHandler[]>();
  private wildcardHandlers = new Map<string, PriorityHandler[]>();
  private handlerFailures = new WeakMap<EventHandler<any>, number>();
  private store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  on<T extends EventType>(type: T, handler: EventHandler<T>, priority?: number): Unsubscribe;
  on(type: string, handler: EventHandler<any>, priority?: number): Unsubscribe;
  on(type: string, handler: EventHandler<any>, priority = 0): Unsubscribe {
    const entry: PriorityHandler = { handler, priority };

    if (isWildcardPattern(type)) {
      const existing = this.wildcardHandlers.get(type) ?? [];
      this.wildcardHandlers.set(type, insertHandler(existing, entry));

      return () => {
        this.off(type, handler);
      };
    }

    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, insertHandler(existing, entry));

    return () => {
      this.off(type, handler);
    };
  }

  off(type: string, handler: EventHandler<any>): void {
    if (isWildcardPattern(type)) {
      const existing = this.wildcardHandlers.get(type);
      if (existing) {
        const updated = removeHandler(existing, handler);
        if (updated.length === 0) {
          this.wildcardHandlers.delete(type);
        } else {
          this.wildcardHandlers.set(type, updated);
        }
      }
      return;
    }

    const existing = this.handlers.get(type);
    if (existing) {
      const updated = removeHandler(existing, handler);
      if (updated.length === 0) {
        this.handlers.delete(type);
      } else {
        this.handlers.set(type, updated);
      }
    }
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
    this.store?.append(event);

    const resolvedHandlers = this.resolveHandlers(event.type);
    for (const { handler } of resolvedHandlers) {
      try {
        handler(event as any);
        this.handlerFailures.set(handler, 0);
      } catch (err) {
        this.trackHandlerFailure(event.type, handler, err);
      }
    }
  }

  async emitAsync(event: WorkspaceEvent): Promise<void> {
    this.store?.append(event);

    const resolvedHandlers = this.resolveHandlers(event.type);
    if (resolvedHandlers.length === 0) return;

    const promises = resolvedHandlers.map(({ handler }) =>
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

  replay(): number {
    if (!this.store) return 0;
    const unreplayed = this.store.getUnreplayed();
    let count = 0;
    for (const { id, event } of unreplayed) {
      const resolvedHandlers = this.resolveHandlers(event.type);
      for (const { handler } of resolvedHandlers) {
        try {
          handler(event as any);
          this.handlerFailures.set(handler, 0);
        } catch (err) {
          this.trackHandlerFailure(event.type, handler, err);
        }
      }
      this.store.markReplayed(id);
      count++;
    }
    return count;
  }

  listenerCount(type: EventType): number {
    return this.resolveHandlers(type).length;
  }

  dispose(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    log.info('Event bus disposed — all handlers cleared');
  }

  /**
   * Resolves all handlers that should fire for a given event type,
   * merging exact-match and matching wildcard handlers into a single
   * priority-sorted list.
   */
  private resolveHandlers(eventType: string): PriorityHandler[] {
    const exact = this.handlers.get(eventType) ?? [];

    // Collect all matching wildcard handler arrays
    const matchingWildcards: PriorityHandler[][] = [];
    for (const [pattern, handlers] of this.wildcardHandlers) {
      if (matchesWildcard(pattern, eventType)) {
        matchingWildcards.push(handlers);
      }
    }

    if (matchingWildcards.length === 0) {
      return exact;
    }

    // Merge all wildcard arrays into one sorted array
    let wildcardMerged: PriorityHandler[] = matchingWildcards[0];
    for (let i = 1; i < matchingWildcards.length; i++) {
      wildcardMerged = mergeSorted(wildcardMerged, matchingWildcards[i]);
    }

    if (exact.length === 0) {
      return wildcardMerged;
    }

    return mergeSorted(exact, wildcardMerged);
  }

  private trackHandlerFailure(type: string, handler: EventHandler<any>, err: unknown): void {
    const failures = (this.handlerFailures.get(handler) ?? 0) + 1;
    this.handlerFailures.set(handler, failures);
    log.error({ err, type, consecutiveFailures: failures }, 'Event handler threw');

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      // Auto-unsubscribe the faulty handler from all event types
      for (const [key, handlerList] of this.handlers) {
        const updated = removeHandler(handlerList, handler);
        if (updated.length === 0) {
          this.handlers.delete(key);
        } else if (updated.length !== handlerList.length) {
          this.handlers.set(key, updated);
        }
      }
      for (const [key, handlerList] of this.wildcardHandlers) {
        const updated = removeHandler(handlerList, handler);
        if (updated.length === 0) {
          this.wildcardHandlers.delete(key);
        } else if (updated.length !== handlerList.length) {
          this.wildcardHandlers.set(key, updated);
        }
      }
      log.warn({ type, failures }, 'Handler auto-unsubscribed after repeated failures');
    }
  }
}
