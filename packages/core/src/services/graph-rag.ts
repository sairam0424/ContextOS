import type { RawDB } from '../database/types.js';

export interface Community {
  readonly id: number;
  readonly level: number;
  readonly nodeIds: readonly string[];
  readonly summary: string;
  readonly parentCommunityId: number | null;
  readonly modularity: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommunitySearchResult {
  readonly community: Community;
  readonly relevanceScore: number;
}

export interface GraphRAGResult {
  readonly globalAnswer: string;
  readonly communities: readonly CommunitySearchResult[];
  readonly localDetails: readonly { nodeId: string; relevance: number }[];
}

interface CommunityRow {
  id: number;
  level: number;
  node_ids: string;
  summary: string;
  parent_community_id: number | null;
  modularity: number;
  created_at: number;
  updated_at: number;
}

function rowToCommunity(row: CommunityRow): Community {
  return {
    id: row.id,
    level: row.level,
    nodeIds: JSON.parse(row.node_ids) as string[],
    summary: row.summary,
    parentCommunityId: row.parent_community_id,
    modularity: row.modularity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeTextOverlap(query: string, text: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTokens.length === 0) return 0;
  const textLower = text.toLowerCase();
  const matchCount = queryTokens.filter(token => textLower.includes(token)).length;
  return matchCount / queryTokens.length;
}

export class GraphRAGService {
  private readonly db: RawDB;

  constructor(db: RawDB) {
    this.db = db;
  }

  storeCommunity(opts: {
    level: number;
    nodeIds: string[];
    summary: string;
    parentCommunityId?: number;
    modularity?: number;
  }): Community {
    const now = Date.now();
    const nodeIdsJson = JSON.stringify(opts.nodeIds);
    const modularity = opts.modularity ?? 0;
    const parentCommunityId = opts.parentCommunityId ?? null;

    const result = this.db.prepare(`
      INSERT INTO community_summaries (level, node_ids, summary, parent_community_id, modularity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(opts.level, nodeIdsJson, opts.summary, parentCommunityId, modularity, now, now);

    return {
      id: Number(result.lastInsertRowid),
      level: opts.level,
      nodeIds: opts.nodeIds,
      summary: opts.summary,
      parentCommunityId,
      modularity,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateSummary(communityId: number, summary: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE community_summaries SET summary = ?, updated_at = ? WHERE id = ?
    `).run(summary, now, communityId);
  }

  getCommunities(level?: number): Community[] {
    if (level !== undefined) {
      const rows = this.db.prepare(`
        SELECT * FROM community_summaries WHERE level = ?
      `).all(level) as CommunityRow[];
      return rows.map(rowToCommunity);
    }

    const rows = this.db.prepare(`
      SELECT * FROM community_summaries
    `).all() as CommunityRow[];
    return rows.map(rowToCommunity);
  }

  getCommunityForNode(nodeId: string): Community | null {
    const row = this.db.prepare(`
      SELECT * FROM community_summaries WHERE node_ids LIKE ?
    `).get(`%"${nodeId}"%`) as CommunityRow | undefined;

    if (!row) return null;
    return rowToCommunity(row);
  }

  searchCommunities(query: string, limit?: number): CommunitySearchResult[] {
    const effectiveLimit = limit ?? 5;
    const rows = this.db.prepare(`
      SELECT * FROM community_summaries
    `).all() as CommunityRow[];

    const scored = rows
      .map(row => ({
        community: rowToCommunity(row),
        relevanceScore: computeTextOverlap(query, row.summary),
      }))
      .filter(entry => entry.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, effectiveLimit);

    return scored;
  }

  globalSearch(query: string): GraphRAGResult {
    const levelOneCommunities = this.db.prepare(`
      SELECT * FROM community_summaries WHERE level = 1
    `).all() as CommunityRow[];

    const scored = levelOneCommunities
      .map(row => ({
        community: rowToCommunity(row),
        relevanceScore: computeTextOverlap(query, row.summary),
      }))
      .filter(entry => entry.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const topCommunities = scored.slice(0, 5);

    const localDetails = topCommunities.flatMap(entry =>
      entry.community.nodeIds.map(nodeId => ({
        nodeId,
        relevance: entry.relevanceScore,
      }))
    );

    const globalAnswer = topCommunities.length > 0
      ? topCommunities.map(c => c.community.summary).join(' ')
      : '';

    return {
      globalAnswer,
      communities: topCommunities,
      localDetails,
    };
  }

  getHierarchy(communityId: number): Community[] {
    const chain: Community[] = [];
    let currentId: number | null = communityId;

    while (currentId !== null) {
      const row = this.db.prepare(`
        SELECT * FROM community_summaries WHERE id = ?
      `).get(currentId) as CommunityRow | undefined;

      if (!row) break;

      const community = rowToCommunity(row);
      chain.push(community);
      currentId = community.parentCommunityId;
    }

    return chain;
  }

  pruneStale(olderThanMs?: number): number {
    const threshold = olderThanMs ?? 2592000000;
    const cutoff = Date.now() - threshold;

    const result = this.db.prepare(`
      DELETE FROM community_summaries WHERE updated_at < ?
    `).run(cutoff);

    return result.changes;
  }
}
