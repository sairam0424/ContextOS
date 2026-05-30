import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'countered';

export interface Proposal {
  readonly id: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly resource: string;
  readonly type: 'task_handoff' | 'resource_request' | 'capability_offer';
  readonly bid: number;
  readonly status: ProposalStatus;
  readonly counterPayload: string | null;
  readonly expiresAt: number;
  readonly createdAt: number;
}

interface ProposeOpts {
  fromAgent: string;
  toAgent: string;
  resource: string;
  type: Proposal['type'];
  bid?: number;
  ttlMs?: number;
}

interface ProposalRow {
  id: string;
  from_agent: string;
  to_agent: string;
  resource: string;
  type: string;
  bid: number;
  status: string;
  counter_payload: string | null;
  expires_at: number;
  created_at: number;
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    resource: row.resource,
    type: row.type as Proposal['type'],
    bid: row.bid,
    status: row.status as ProposalStatus,
    counterPayload: row.counter_payload,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class NegotiationService {
  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  propose(opts: ProposeOpts): Proposal {
    const id = randomUUID();
    const now = Date.now();
    const bid = opts.bid ?? 0;
    const ttlMs = opts.ttlMs ?? 30_000;
    const expiresAt = now + ttlMs;

    this.db.prepare(`
      INSERT INTO proposals (id, from_agent, to_agent, resource, type, bid, status, counter_payload, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
    `).run(id, opts.fromAgent, opts.toAgent, opts.resource, opts.type, bid, expiresAt, now);

    this.eventBus.emit({
      type: 'negotiate.proposed' as any,
      proposalId: id,
      resource: opts.resource,
    } as any);

    return {
      id,
      fromAgent: opts.fromAgent,
      toAgent: opts.toAgent,
      resource: opts.resource,
      type: opts.type,
      bid,
      status: 'pending',
      counterPayload: null,
      expiresAt,
      createdAt: now,
    };
  }

  accept(proposalId: string, agentId: string): void {
    const proposal = this.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.toAgent !== agentId) throw new Error(`Agent ${agentId} is not the recipient of proposal ${proposalId}`);

    this.db.prepare(`UPDATE proposals SET status = 'accepted' WHERE id = ?`).run(proposalId);

    this.eventBus.emit({
      type: 'negotiate.resolved' as any,
      proposalId,
      status: 'accepted',
    } as any);
  }

  reject(proposalId: string, agentId: string): void {
    const proposal = this.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.toAgent !== agentId) throw new Error(`Agent ${agentId} is not the recipient of proposal ${proposalId}`);

    this.db.prepare(`UPDATE proposals SET status = 'rejected' WHERE id = ?`).run(proposalId);

    this.eventBus.emit({
      type: 'negotiate.resolved' as any,
      proposalId,
      status: 'rejected',
    } as any);
  }

  counter(proposalId: string, agentId: string, counterBid: number): void {
    const proposal = this.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.toAgent !== agentId) throw new Error(`Agent ${agentId} is not the recipient of proposal ${proposalId}`);

    this.db.prepare(`UPDATE proposals SET status = 'countered', counter_payload = ? WHERE id = ?`).run(
      String(counterBid),
      proposalId
    );

    this.eventBus.emit({
      type: 'negotiate.resolved' as any,
      proposalId,
      status: 'countered',
    } as any);
  }

  getProposal(proposalId: string): Proposal | null {
    const row = this.db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId) as ProposalRow | undefined;
    if (!row) return null;

    if (row.status === 'pending' && row.expires_at < Date.now()) {
      this.db.prepare(`UPDATE proposals SET status = 'expired' WHERE id = ?`).run(proposalId);
      return rowToProposal({ ...row, status: 'expired' });
    }

    return rowToProposal(row);
  }

  getPendingForAgent(agentId: string): Proposal[] {
    this.expireStale();

    const rows = this.db.prepare(
      `SELECT * FROM proposals WHERE to_agent = ? AND status = 'pending'`
    ).all(agentId) as ProposalRow[];

    return rows.map(rowToProposal);
  }

  expireStale(): number {
    const now = Date.now();
    const result = this.db.prepare(
      `UPDATE proposals SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`
    ).run(now);

    return result.changes;
  }
}
