import { randomUUID } from 'node:crypto';
import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';

export interface CapabilityGrant {
  readonly resource: string;
  readonly actions: readonly ('read' | 'write' | 'execute' | 'delegate')[];
}

export interface CapabilityToken {
  readonly id: string;
  readonly agentId: string;
  readonly capabilities: readonly CapabilityGrant[];
  readonly issuedBy: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
  readonly parentTokenId: string | null;
  readonly maxDelegationDepth: number;
}

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly reason?: string;
  readonly tokenId?: string;
}

interface IssueOptions {
  readonly agentId: string;
  readonly capabilities: CapabilityGrant[];
  readonly issuedBy: string;
  readonly ttlMs?: number;
  readonly parentTokenId?: string;
  readonly maxDelegationDepth?: number;
}

interface TokenRow {
  id: string;
  agent_id: string;
  capabilities: string;
  issued_by: string;
  issued_at: number;
  expires_at: number;
  revoked: number;
  parent_token_id: string | null;
  max_delegation_depth: number;
}

export class CapabilityTokenService {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  issue(opts: IssueOptions): CapabilityToken {
    const {
      agentId,
      capabilities,
      issuedBy,
      ttlMs = 3_600_000,
      parentTokenId = null,
      maxDelegationDepth = 0,
    } = opts;

    if (parentTokenId !== null) {
      const parentRow = this.db.prepare(
        'SELECT id, revoked, expires_at, max_delegation_depth, parent_token_id FROM capability_tokens WHERE id = ?'
      ).get(parentTokenId) as TokenRow | undefined;

      if (!parentRow) {
        throw new Error(`Parent token ${parentTokenId} does not exist`);
      }
      if (parentRow.revoked === 1) {
        throw new Error(`Parent token ${parentTokenId} is revoked`);
      }
      if (parentRow.expires_at <= Date.now()) {
        throw new Error(`Parent token ${parentTokenId} is expired`);
      }

      const currentDepth = this.computeDelegationDepth(parentTokenId);
      if (currentDepth >= parentRow.max_delegation_depth) {
        throw new Error(`Parent token ${parentTokenId} has reached maximum delegation depth`);
      }
    }

    const id = randomUUID();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttlMs;

    this.db.prepare(
      `INSERT INTO capability_tokens (id, agent_id, capabilities, issued_by, issued_at, expires_at, revoked, parent_token_id, max_delegation_depth)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(id, agentId, JSON.stringify(capabilities), issuedBy, issuedAt, expiresAt, parentTokenId, maxDelegationDepth);

    return {
      id,
      agentId,
      capabilities,
      issuedBy,
      issuedAt,
      expiresAt,
      revoked: false,
      parentTokenId,
      maxDelegationDepth,
    };
  }

  revoke(tokenId: string): void {
    this.db.prepare('UPDATE capability_tokens SET revoked = 1 WHERE id = ?').run(tokenId);
  }

  revokeAll(agentId: string): void {
    this.db.prepare('UPDATE capability_tokens SET revoked = 1 WHERE agent_id = ?').run(agentId);
  }

  authorize(agentId: string, resource: string, action: CapabilityGrant['actions'][number]): AuthorizationResult {
    const now = Date.now();
    const rows = this.db.prepare(
      'SELECT id, capabilities FROM capability_tokens WHERE agent_id = ? AND revoked = 0 AND expires_at > ?'
    ).all(agentId, now) as Pick<TokenRow, 'id' | 'capabilities'>[];

    for (const row of rows) {
      const capabilities: CapabilityGrant[] = JSON.parse(row.capabilities);
      for (const grant of capabilities) {
        if (this.matchResource(grant.resource, resource) && grant.actions.includes(action)) {
          return { authorized: true, tokenId: row.id };
        }
      }
    }

    return { authorized: false, reason: `No active token grants '${action}' on '${resource}' for agent '${agentId}'` };
  }

  getActiveTokens(agentId: string): CapabilityToken[] {
    const now = Date.now();
    const rows = this.db.prepare(
      'SELECT * FROM capability_tokens WHERE agent_id = ? AND revoked = 0 AND expires_at > ?'
    ).all(agentId, now) as TokenRow[];

    return rows.map(row => this.rowToToken(row));
  }

  getToken(tokenId: string): CapabilityToken | null {
    const row = this.db.prepare('SELECT * FROM capability_tokens WHERE id = ?').get(tokenId) as TokenRow | undefined;
    if (!row) return null;
    return this.rowToToken(row);
  }

  private matchResource(pattern: string, resource: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1);
      return resource.startsWith(prefix);
    }
    return pattern === resource;
  }

  private computeDelegationDepth(tokenId: string): number {
    let depth = 0;
    let currentId: string | null = tokenId;
    while (currentId !== null) {
      const row = this.db.prepare(
        'SELECT parent_token_id FROM capability_tokens WHERE id = ?'
      ).get(currentId) as Pick<TokenRow, 'parent_token_id'> | undefined;
      if (!row || row.parent_token_id === null) break;
      depth++;
      currentId = row.parent_token_id;
    }
    return depth;
  }

  private rowToToken(row: TokenRow): CapabilityToken {
    return {
      id: row.id,
      agentId: row.agent_id,
      capabilities: JSON.parse(row.capabilities),
      issuedBy: row.issued_by,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      parentTokenId: row.parent_token_id,
      maxDelegationDepth: row.max_delegation_depth,
    };
  }
}
