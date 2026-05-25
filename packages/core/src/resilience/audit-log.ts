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
  sequence: number;
  prevHash: string;
  hash: string;
}

export class AuditLog {
  private lastHash: string = '0'.repeat(64);

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
        sequence INTEGER NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, sequence)`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_sequence ON audit_log(sequence)`);
  }

  append(agentId: string, action: string, detail: Record<string, unknown> = {}): AuditEntry {
    const txn = this.db.transaction(() => {
      const id = randomUUID();
      const timestamp = Date.now();
      const sequence = this.nextSequence();
      const prevHash = this.lastHash;

      const hash = this.computeHash({ id, agent_id: agentId, action, detail: JSON.stringify(detail), timestamp, sequence, prev_hash: prevHash }, prevHash);

      this.db.prepare(`
        INSERT INTO audit_log (id, agent_id, action, detail, timestamp, sequence, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, agentId, action, JSON.stringify(detail), timestamp, sequence, prevHash, hash);

      this.lastHash = hash;

      return { id, agentId, action, detail, timestamp, sequence, prevHash, hash };
    });

    return txn();
  }

  getForAgent(agentId: string, limit: number = 50): AuditEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_log WHERE agent_id = ? ORDER BY sequence DESC LIMIT ?
    `).all(agentId, limit) as any[];
    return rows.map(r => this.toEntry(r));
  }

  verifyIntegrity(options?: { batchSize?: number; fromSequence?: number }): { valid: boolean; brokenAt?: string; lastVerifiedSequence: number } {
    const batchSize = options?.batchSize ?? 1000;
    let offset = options?.fromSequence ?? 0;
    let prevHash = '';

    if (offset > 0) {
      const prev = this.db.prepare('SELECT hash FROM audit_log WHERE sequence = ?').get(offset) as any;
      if (prev) prevHash = prev.hash;
    } else {
      prevHash = '0'.repeat(64);
    }

    while (true) {
      const batch = this.db.prepare(
        'SELECT * FROM audit_log WHERE sequence > ? ORDER BY sequence ASC LIMIT ?'
      ).all(offset, batchSize) as any[];
      if (batch.length === 0) break;

      for (const entry of batch) {
        if (entry.prev_hash !== prevHash) {
          return { valid: false, brokenAt: entry.id, lastVerifiedSequence: offset };
        }

        const computed = this.computeHash(entry, prevHash);
        if (entry.hash !== computed) {
          return { valid: false, brokenAt: entry.id, lastVerifiedSequence: offset };
        }

        prevHash = entry.hash;
        offset = entry.sequence;
      }
    }

    return { valid: true, lastVerifiedSequence: offset };
  }

  private computeHash(entry: any, prevHash: string): string {
    const content = `${entry.id}:${entry.agent_id}:${entry.action}:${entry.detail}:${entry.timestamp}:${entry.sequence}:${prevHash}`;
    return createHash('sha256').update(content).digest('hex');
  }

  private getLastHash(): string {
    const row = this.db.prepare(`SELECT hash FROM audit_log ORDER BY sequence DESC LIMIT 1`).get() as any;
    return row?.hash ?? '0'.repeat(64);
  }

  private nextSequence(): number {
    const row = this.db.prepare(`SELECT MAX(sequence) as max_seq FROM audit_log`).get() as any;
    return (row?.max_seq ?? 0) + 1;
  }

  private toEntry(row: any): AuditEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      action: row.action,
      detail: JSON.parse(row.detail),
      timestamp: row.timestamp,
      sequence: row.sequence,
      prevHash: row.prev_hash,
      hash: row.hash,
    };
  }
}
