import type { RawDB } from '../database/types.js';
import type { WorkspaceEvent } from './types.js';

export class EventStore {
  private appendCount = 0;
  private static readonly AUTO_PRUNE_INTERVAL = 1000;
  private static readonly AUTO_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private db: RawDB) {
    this.ensureConsumerOffsets();
  }

  /**
   * Self-managed companion table tracking, per durable consumer, the highest
   * event id that consumer has acknowledged. prune() never deletes past the
   * SLOWEST consumer's acknowledged position, so a consumer lagging behind the
   * 7-day age window does not silently lose events.
   *
   * Created here (not in schema.ts) on purpose: event-store owns its own
   * companion state, matching how other self-managed tables declare themselves
   * idempotently with CREATE TABLE IF NOT EXISTS.
   */
  private ensureConsumerOffsets(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consumer_offsets (
        consumer_id TEXT PRIMARY KEY,
        offset INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /**
   * Records that `consumerId` has durably processed every event up to and
   * including `eventId`. Monotonic: an out-of-order or replayed-backwards ack
   * never moves a consumer's committed position backwards.
   */
  commitOffset(consumerId: string, eventId: number): void {
    this.db.prepare(`
      INSERT INTO consumer_offsets (consumer_id, offset) VALUES (?, ?)
      ON CONFLICT(consumer_id) DO UPDATE SET
        offset = MAX(offset, excluded.offset)
    `).run(consumerId, eventId);
  }

  /**
   * The slowest registered consumer's acknowledged position. `undefined` when no
   * consumer has committed an offset yet — in that case prune falls back to its
   * original age+replayed gate (no consumer-lag protection to enforce).
   */
  private minCommittedOffset(): number | undefined {
    const row = this.db.prepare(
      'SELECT MIN(offset) as minOffset FROM consumer_offsets'
    ).get() as { minOffset: number | null } | undefined;
    return row?.minOffset ?? undefined;
  }

  append(event: WorkspaceEvent): number {
    const { type, ...rest } = event;
    const result = this.db.prepare(
      'INSERT INTO event_log (type, payload, timestamp) VALUES (?, ?, ?)'
    ).run(type, JSON.stringify(rest), Date.now());

    this.appendCount++;
    if (this.appendCount % EventStore.AUTO_PRUNE_INTERVAL === 0) {
      this.prune(EventStore.AUTO_PRUNE_AGE_MS);
    }

    return Number(result.lastInsertRowid);
  }

  getUnreplayed(limit = 100): Array<{ id: number; event: WorkspaceEvent }> {
    const rows = this.db.prepare(
      'SELECT id, type, payload, timestamp FROM event_log WHERE replayed = 0 ORDER BY id ASC LIMIT ?'
    ).all(limit) as Array<{ id: number; type: string; payload: string; timestamp: number }>;

    return rows.map(row => ({
      id: row.id,
      event: { type: row.type, ...JSON.parse(row.payload) } as WorkspaceEvent,
    }));
  }

  markReplayed(id: number): void {
    this.db.prepare('UPDATE event_log SET replayed = 1 WHERE id = ?').run(id);
  }

  getSince(afterId: number, type?: string, limit = 100): WorkspaceEvent[] {
    let rows: Array<{ type: string; payload: string }>;
    if (type) {
      rows = this.db.prepare(
        'SELECT type, payload FROM event_log WHERE id > ? AND type = ? ORDER BY id ASC LIMIT ?'
      ).all(afterId, type, limit) as Array<{ type: string; payload: string }>;
    } else {
      rows = this.db.prepare(
        'SELECT type, payload FROM event_log WHERE id > ? ORDER BY id ASC LIMIT ?'
      ).all(afterId, limit) as Array<{ type: string; payload: string }>;
    }

    return rows.map(row => ({ type: row.type, ...JSON.parse(row.payload) } as WorkspaceEvent));
  }

  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const minOffset = this.minCommittedOffset();

    // Age is the upper bound; consumer lag is the floor. An event is only
    // deletable when it is BOTH older than the cutoff AND already past the
    // slowest registered consumer (id <= minOffset). When no consumer has
    // committed an offset, there is no lag to protect against, so prune keeps
    // its original age+replayed semantics.
    if (minOffset === undefined) {
      return this.db.prepare(
        'DELETE FROM event_log WHERE replayed = 1 AND timestamp < ?'
      ).run(cutoff).changes;
    }

    return this.db.prepare(
      'DELETE FROM event_log WHERE replayed = 1 AND timestamp < ? AND id <= ?'
    ).run(cutoff, minOffset).changes;
  }
}
