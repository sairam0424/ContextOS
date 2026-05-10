import { createHash, randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('audit-log');

export interface AuditEntry {
  id: string;
  agentId: string;
  action: string;
  detail: Record<string, unknown>;
  timestamp: number;
  prevHash: string;
  hash: string;
}

export class AuditLog {
  private lastHash: string = '0000000000000000';

  constructor(private db: RawDB) {
    this.ensureTable();
    this.lastHash = this.getLastHash();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, timestamp)`);
  }

  append(agentId: string, action: string, detail: Record<string, unknown> = {}): AuditEntry {
    const id = randomUUID();
    const timestamp = Date.now();
    const prevHash = this.lastHash;

    const content = `${id}:${agentId}:${action}:${JSON.stringify(detail)}:${timestamp}:${prevHash}`;
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

    this.db.prepare(`
      INSERT INTO audit_log (id, agent_id, action, detail, timestamp, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, action, JSON.stringify(detail), timestamp, prevHash, hash);

    this.lastHash = hash;

    return { id, agentId, action, detail, timestamp, prevHash, hash };
  }

  getForAgent(agentId: string, limit: number = 50): AuditEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_log WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(agentId, limit) as any[];
    return rows.map(r => this.toEntry(r));
  }

  verifyIntegrity(): { valid: boolean; brokenAt?: string } {
    const rows = this.db.prepare(`SELECT * FROM audit_log ORDER BY timestamp ASC`).all() as any[];
    let expectedPrevHash = '0000000000000000';

    for (const row of rows) {
      if (row.prev_hash !== expectedPrevHash) {
        return { valid: false, brokenAt: row.id };
      }

      const content = `${row.id}:${row.agent_id}:${row.action}:${row.detail}:${row.timestamp}:${row.prev_hash}`;
      const computedHash = createHash('sha256').update(content).digest('hex').slice(0, 16);

      if (computedHash !== row.hash) {
        return { valid: false, brokenAt: row.id };
      }

      expectedPrevHash = row.hash;
    }

    return { valid: true };
  }

  private getLastHash(): string {
    const row = this.db.prepare(`SELECT hash FROM audit_log ORDER BY timestamp DESC LIMIT 1`).get() as any;
    return row?.hash ?? '0000000000000000';
  }

  private toEntry(row: any): AuditEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      action: row.action,
      detail: JSON.parse(row.detail),
      timestamp: row.timestamp,
      prevHash: row.prev_hash,
      hash: row.hash,
    };
  }
}
