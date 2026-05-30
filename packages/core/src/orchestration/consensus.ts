import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export interface VoteRequest {
  readonly id: string;
  readonly proposerId: string;
  readonly topic: string;
  readonly options: readonly string[];
  readonly quorum: number;
  readonly deadline: number;
  readonly result: string | null;
  readonly createdAt: number;
}

export interface Vote {
  readonly requestId: string;
  readonly voterId: string;
  readonly choice: string;
  readonly weight: number;
  readonly timestamp: number;
}

export interface ConsensusResult {
  readonly requestId: string;
  readonly winner: string | null;
  readonly totalVotes: number;
  readonly quorumReached: boolean;
  readonly breakdown: Record<string, number>;
}

interface ProposeOpts {
  proposerId: string;
  topic: string;
  options: string[];
  quorum: number;
  deadlineMs?: number;
}

interface VoteRequestRow {
  id: string;
  proposer_id: string;
  topic: string;
  options: string;
  quorum: number;
  deadline: number;
  result: string | null;
  created_at: number;
}

interface VoteRow {
  request_id: string;
  voter_id: string;
  choice: string;
  weight: number;
  timestamp: number;
}

function rowToVoteRequest(row: VoteRequestRow): VoteRequest {
  return {
    id: row.id,
    proposerId: row.proposer_id,
    topic: row.topic,
    options: JSON.parse(row.options) as string[],
    quorum: row.quorum,
    deadline: row.deadline,
    result: row.result,
    createdAt: row.created_at,
  };
}

function rowToVote(row: VoteRow): Vote {
  return {
    requestId: row.request_id,
    voterId: row.voter_id,
    choice: row.choice,
    weight: row.weight,
    timestamp: row.timestamp,
  };
}

export class ConsensusService {
  constructor(private db: RawDB, private eventBus: WorkspaceEventBus) {}

  propose(opts: ProposeOpts): VoteRequest {
    const id = randomUUID();
    const now = Date.now();
    const deadlineMs = opts.deadlineMs ?? 60_000;
    const deadline = now + deadlineMs;

    this.db.prepare(`
      INSERT INTO vote_requests (id, proposer_id, topic, options, quorum, deadline, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(id, opts.proposerId, opts.topic, JSON.stringify(opts.options), opts.quorum, deadline, now);

    this.eventBus.emit({
      type: 'consensus.proposed' as any,
      requestId: id,
      topic: opts.topic,
    } as any);

    return {
      id,
      proposerId: opts.proposerId,
      topic: opts.topic,
      options: Object.freeze([...opts.options]),
      quorum: opts.quorum,
      deadline,
      result: null,
      createdAt: now,
    };
  }

  vote(requestId: string, voterId: string, choice: string, weight = 1.0): Vote {
    const request = this.getRequest(requestId);
    if (!request) throw new Error(`Vote request not found: ${requestId}`);
    if (Date.now() > request.deadline) throw new Error(`Vote request ${requestId} has passed its deadline`);
    if (!request.options.includes(choice)) {
      throw new Error(`Invalid choice "${choice}". Valid options: ${request.options.join(', ')}`);
    }

    const now = Date.now();

    this.db.prepare(`
      INSERT OR REPLACE INTO votes (request_id, voter_id, choice, weight, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(requestId, voterId, choice, weight, now);

    const totalVoteCount = (
      this.db.prepare(`SELECT COUNT(*) as count FROM votes WHERE request_id = ?`).get(requestId) as { count: number }
    ).count;

    if (totalVoteCount >= request.quorum && request.result === null) {
      this.tally(requestId);
    }

    return {
      requestId,
      voterId,
      choice,
      weight,
      timestamp: now,
    };
  }

  tally(requestId: string): ConsensusResult {
    const votes = this.getVotes(requestId);
    const request = this.getRequest(requestId);
    if (!request) throw new Error(`Vote request not found: ${requestId}`);

    const breakdown: Record<string, number> = {};
    for (const v of votes) {
      breakdown[v.choice] = (breakdown[v.choice] ?? 0) + v.weight;
    }

    const totalVotes = votes.length;
    const quorumReached = totalVotes >= request.quorum;

    let winner: string | null = null;
    if (quorumReached) {
      let maxWeight = 0;
      for (const [choice, weightSum] of Object.entries(breakdown)) {
        if (weightSum > maxWeight) {
          maxWeight = weightSum;
          winner = choice;
        }
      }

      this.db.prepare(`UPDATE vote_requests SET result = ? WHERE id = ?`).run(winner, requestId);

      this.eventBus.emit({
        type: 'consensus.decided' as any,
        requestId,
        winner,
      } as any);
    }

    return {
      requestId,
      winner,
      totalVotes,
      quorumReached,
      breakdown,
    };
  }

  getRequest(requestId: string): VoteRequest | null {
    const row = this.db.prepare(`SELECT * FROM vote_requests WHERE id = ?`).get(requestId) as VoteRequestRow | undefined;
    if (!row) return null;
    return rowToVoteRequest(row);
  }

  getVotes(requestId: string): Vote[] {
    const rows = this.db.prepare(`SELECT * FROM votes WHERE request_id = ?`).all(requestId) as VoteRow[];
    return rows.map(rowToVote);
  }

  getResult(requestId: string): ConsensusResult {
    const request = this.getRequest(requestId);
    if (!request) throw new Error(`Vote request not found: ${requestId}`);

    if (Date.now() > request.deadline && request.result === null) {
      return this.tally(requestId);
    }

    const votes = this.getVotes(requestId);
    const breakdown: Record<string, number> = {};
    for (const v of votes) {
      breakdown[v.choice] = (breakdown[v.choice] ?? 0) + v.weight;
    }

    return {
      requestId,
      winner: request.result,
      totalVotes: votes.length,
      quorumReached: votes.length >= request.quorum,
      breakdown,
    };
  }
}
