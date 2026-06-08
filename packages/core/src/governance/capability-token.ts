import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
  /** Initiating human/root authority (the principal), carried through the delegation chain. */
  readonly principal: string;
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
  /**
   * The initiating human/root authority. For a root grant this is typically the
   * same as issuedBy; for a delegated child it is inherited from the parent so
   * the original principal is preserved (confused-deputy defense). When omitted
   * on a root grant it defaults to issuedBy.
   */
  readonly principal?: string;
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
  signature: string | null;
  principal: string | null;
}

/** Canonical, order-stable fields covered by the HMAC. */
interface SignedFields {
  readonly id: string;
  readonly agentId: string;
  readonly capabilities: readonly CapabilityGrant[];
  readonly issuedBy: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly parentTokenId: string | null;
  readonly maxDelegationDepth: number;
  readonly principal: string;
}

/**
 * Resolves the HMAC signing key from the environment.
 *
 * Production REQUIRES `CONTEXTOS_TOKEN_HMAC_KEY`; a missing key is a fatal
 * startup error (no insecure fallback, no key baked into source). Under the
 * test runner (mocha injects the `describe` global, or NODE_ENV==='test') a
 * fixed, clearly-labeled NON-SECRET key is used so the suite stays hermetic —
 * this is never used to protect real grants.
 */
function resolveHmacKey(): Buffer {
  const fromEnv = process.env.CONTEXTOS_TOKEN_HMAC_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return Buffer.from(fromEnv, 'utf8');
  }

  const isTest =
    process.env.NODE_ENV === 'test' ||
    typeof (globalThis as { describe?: unknown }).describe === 'function';
  if (isTest) {
    return Buffer.from('contextos-test-token-hmac-key-not-a-secret', 'utf8');
  }

  throw new Error(
    'CONTEXTOS_TOKEN_HMAC_KEY is required to sign capability tokens but is unset. ' +
      'Provide it via the environment (it must never be hardcoded).',
  );
}

export class CapabilityTokenService {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly hmacKey: Buffer;

  constructor(db: RawDB, eventBus: WorkspaceEventBus) {
    this.db = db;
    this.eventBus = eventBus;
    this.hmacKey = resolveHmacKey();
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

    let principal = opts.principal ?? issuedBy;

    if (parentTokenId !== null) {
      const parentRow = this.db.prepare(
        'SELECT id, revoked, expires_at, max_delegation_depth, parent_token_id, principal FROM capability_tokens WHERE id = ?'
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

      // Inherit the original principal across the delegation chain so a child
      // cannot silently re-root authority to itself (confused-deputy defense).
      if (opts.principal === undefined) {
        principal = parentRow.principal ?? issuedBy;
      }
    }

    const id = randomUUID();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttlMs;

    const signature = this.sign({
      id,
      agentId,
      capabilities,
      issuedBy,
      issuedAt,
      expiresAt,
      parentTokenId,
      maxDelegationDepth,
      principal,
    });

    this.db.prepare(
      `INSERT INTO capability_tokens (id, agent_id, capabilities, issued_by, issued_at, expires_at, revoked, parent_token_id, max_delegation_depth, signature, principal)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(id, agentId, JSON.stringify(capabilities), issuedBy, issuedAt, expiresAt, parentTokenId, maxDelegationDepth, signature, principal);

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
      principal,
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
      'SELECT id, agent_id, capabilities, issued_by, issued_at, expires_at, parent_token_id, max_delegation_depth, signature, principal FROM capability_tokens WHERE agent_id = ? AND revoked = 0 AND expires_at > ?'
    ).all(agentId, now) as TokenRow[];

    for (const row of rows) {
      const capabilities: CapabilityGrant[] = JSON.parse(row.capabilities);

      // Fail closed on any row whose HMAC is missing or does not match its
      // contents: a forged/unsigned/tampered row never grants authority.
      if (!this.verify(row, capabilities)) {
        continue;
      }

      // Re-enforce the delegation-depth bound at authorize() — not only at
      // issue() — so a row whose ancestry was tampered with cannot exceed it.
      if (this.computeDelegationDepth(row.id) > row.max_delegation_depth) {
        continue;
      }

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

  /** Computes the canonical HMAC-SHA256 over a token's signed fields. */
  private sign(fields: SignedFields): string {
    const canonical = JSON.stringify([
      fields.id,
      fields.agentId,
      fields.capabilities,
      fields.issuedBy,
      fields.issuedAt,
      fields.expiresAt,
      fields.parentTokenId,
      fields.maxDelegationDepth,
      fields.principal,
    ]);
    return createHmac('sha256', this.hmacKey).update(canonical).digest('hex');
  }

  /**
   * Verifies a DB row's stored signature against a freshly computed HMAC using
   * timing-safe comparison. A null/empty signature, a length mismatch, or any
   * byte difference all return false (fail closed).
   */
  private verify(row: TokenRow, capabilities: readonly CapabilityGrant[]): boolean {
    if (!row.signature) return false;
    if (row.principal === null) return false;

    const expected = this.sign({
      id: row.id,
      agentId: row.agent_id,
      capabilities,
      issuedBy: row.issued_by,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      parentTokenId: row.parent_token_id,
      maxDelegationDepth: row.max_delegation_depth,
      principal: row.principal,
    });

    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(row.signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
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
      principal: row.principal ?? row.issued_by,
    };
  }
}
