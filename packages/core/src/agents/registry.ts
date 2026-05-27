import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { AgentRecord, RegisterOpts, AgentStatus } from './types.js';
import type { WorkspaceEventBus } from '../events/index.js';
import { createChildLogger } from '../logger.js';
import { validateName, validateCapabilities } from '../validation.js';

const log = createChildLogger('agent-registry');

export class AgentRegistry {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  startStaleCleanup(intervalMs: number = 30000): void {
    this.stopStaleCleanup();
    this.cleanupTimer = setInterval(() => {
      const staleAgents = this.getStale(90000);
      for (const agent of staleAgents) {
        this.quarantine(agent.id, 'heartbeat_timeout');
        log.info({ agentId: agent.id, name: agent.name }, 'Auto-quarantined stale agent');
      }
    }, intervalMs);
  }

  stopStaleCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  dispose(): void {
    this.stopStaleCleanup();
  }

  register(opts: RegisterOpts): AgentRecord {
    const validatedName = validateName(opts.name);
    const validatedCaps = validateCapabilities(opts.capabilities);

    const id = randomUUID();
    const now = Date.now();
    const record: AgentRecord = {
      id,
      name: validatedName,
      capabilities: validatedCaps,
      status: 'active',
      transport: opts.transport ?? 'stdio',
      lastHeartbeat: now,
      registeredAt: now,
      metadata: opts.metadata ?? {},
    };

    this.db.prepare(`
      INSERT INTO agents (id, name, capabilities, status, transport, last_heartbeat, registered_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, record.name, JSON.stringify(record.capabilities), record.status, record.transport, now, now, JSON.stringify(record.metadata));

    this.eventBus.emit({ type: 'agent.registered', agentId: id, name: opts.name });
    log.info({ agentId: id, name: opts.name }, 'Agent registered');
    return record;
  }

  heartbeat(agentId: string): void {
    const now = Date.now();
    this.db.prepare(`UPDATE agents SET last_heartbeat = ? WHERE id = ?`).run(now, agentId);
  }

  deregister(agentId: string, reason: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);
    this.eventBus.emit({ type: 'agent.deregistered', agentId, reason });
    log.info({ agentId, reason }, 'Agent deregistered');
  }

  quarantine(agentId: string, reason: string): void {
    this.db.prepare(`UPDATE agents SET status = 'quarantined' WHERE id = ?`).run(agentId);
    this.eventBus.emit({ type: 'agent.quarantined', agentId, reason });
    log.warn({ agentId, reason }, 'Agent quarantined');
  }

  reactivate(agentId: string, reason: string): void {
    this.db.prepare(`UPDATE agents SET status = 'active' WHERE id = ?`).run(agentId);
    this.eventBus.emit({ type: 'agent.reactivated', agentId, reason });
    log.info({ agentId, reason }, 'Agent reactivated');
  }

  getById(id: string): AgentRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as any;
    return row ? this.toRecord(row) : undefined;
  }

  getActive(): AgentRecord[] {
    const rows = this.db.prepare(`SELECT * FROM agents WHERE status = 'active'`).all() as any[];
    return rows.map(r => this.toRecord(r));
  }

  findByCapability(intent: string): AgentRecord[] {
    const active = this.getActive();
    const term = intent.toLowerCase();
    return active.filter(a =>
      a.capabilities.some(c => c.toLowerCase().includes(term))
    ).sort((a, b) => {
      const aScore = a.capabilities.filter(c => c.toLowerCase().includes(term)).length;
      const bScore = b.capabilities.filter(c => c.toLowerCase().includes(term)).length;
      return bScore - aScore;
    });
  }

  getStale(timeoutMs: number = 90000): AgentRecord[] {
    const cutoff = Date.now() - timeoutMs;
    const rows = this.db.prepare(`SELECT * FROM agents WHERE status = 'active' AND last_heartbeat < ?`).all(cutoff) as any[];
    return rows.map(r => this.toRecord(r));
  }

  private toRecord(row: any): AgentRecord {
    return {
      id: row.id,
      name: row.name,
      capabilities: JSON.parse(row.capabilities),
      status: row.status as AgentStatus,
      transport: row.transport,
      lastHeartbeat: row.last_heartbeat,
      registeredAt: row.registered_at,
      metadata: JSON.parse(row.metadata),
    };
  }
}
