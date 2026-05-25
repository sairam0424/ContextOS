import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { AgentMessage, SendMessageOpts } from './types.js';
import type { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';
import { validateAgentId, validateIntent, validatePayload } from '../validation.js';

const log = createChildLogger('message-bus');

export class MessageBus {
  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  send(opts: SendMessageOpts): string {
    const validatedFrom = validateAgentId(opts.from);
    const validatedTo = validateAgentId(opts.to);
    const validatedIntent = validateIntent(opts.intent);
    const validatedPayload = validatePayload(opts.payload ?? {});

    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO agent_messages (id, correlation_id, from_agent, to_agent, intent, payload, timestamp, ttl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, opts.correlationId ?? null, validatedFrom, validatedTo, validatedIntent, validatedPayload, now, opts.ttl ?? null);

    this.eventBus.emit({ type: 'message.sent', from: opts.from, to: opts.to, intent: opts.intent });
    log.debug({ messageId: id, from: opts.from, to: opts.to, intent: opts.intent }, 'Message sent');
    return id;
  }

  getUndelivered(agentId: string): AgentMessage[] {
    const now = Date.now();

    // First, find and move expired messages to dead_letters
    const expiredRows = this.db.prepare(`
      SELECT * FROM agent_messages
      WHERE to_agent = ? AND delivered_at IS NULL
      AND ttl IS NOT NULL AND (timestamp + ttl * 1000) <= ?
      ORDER BY timestamp ASC
    `).all(agentId, now) as any[];

    for (const row of expiredRows) {
      const deadId = randomUUID();
      this.db.prepare(`
        INSERT INTO dead_letters (id, original_id, sender_id, target_id, topic, content, expired_at, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ttl_expired')
      `).run(deadId, row.id, row.from_agent, row.to_agent, row.intent, row.payload, now);

      this.db.prepare(`DELETE FROM agent_messages WHERE id = ?`).run(row.id);

      this.eventBus.emit({ type: 'message.expired', messageId: row.id, topic: row.intent });
      log.debug({ messageId: row.id, intent: row.intent }, 'Message expired, moved to dead-letter queue');
    }

    // Then return only valid (non-expired) undelivered messages
    const rows = this.db.prepare(`
      SELECT * FROM agent_messages
      WHERE to_agent = ? AND delivered_at IS NULL
      AND (ttl IS NULL OR (timestamp + ttl * 1000) > ?)
      ORDER BY timestamp ASC
    `).all(agentId, now) as any[];
    return rows.map(r => this.toMessage(r));
  }

  getBroadcasts(agentId: string): AgentMessage[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM agent_messages
      WHERE to_agent = '*' AND from_agent != ? AND delivered_at IS NULL
      AND (ttl IS NULL OR (timestamp + ttl * 1000) > ?)
      ORDER BY timestamp ASC
    `).all(agentId, now) as any[];
    return rows.map(r => this.toMessage(r));
  }

  acknowledge(messageId: string): void {
    const now = Date.now();
    this.db.prepare(`UPDATE agent_messages SET delivered_at = ? WHERE id = ?`).run(now, messageId);
  }

  getByCorrelation(correlationId: string): AgentMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_messages WHERE correlation_id = ? ORDER BY timestamp ASC
    `).all(correlationId) as any[];
    return rows.map(r => this.toMessage(r));
  }

  private toMessage(row: any): AgentMessage {
    return {
      id: row.id,
      correlationId: row.correlation_id ?? undefined,
      from: row.from_agent,
      to: row.to_agent,
      intent: row.intent,
      payload: JSON.parse(row.payload),
      timestamp: row.timestamp,
      deliveredAt: row.delivered_at ?? undefined,
      ttl: row.ttl ?? undefined,
    };
  }
}
