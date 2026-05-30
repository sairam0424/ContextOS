import type { RawDB } from '../database/types.js';

export interface DistilledKnowledge {
  readonly id: number;
  readonly corridor: string;
  readonly summary: string;
  readonly queryCluster: readonly string[];
  readonly accessCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DistillationResult {
  readonly corridorsFound: number;
  readonly newDistillations: number;
  readonly updatedDistillations: number;
}

interface DistilledKnowledgeRow {
  id: number;
  corridor: string;
  summary: string;
  query_cluster: string;
  access_count: number;
  created_at: number;
  updated_at: number;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function computeOverlap(tokens: string[], centroid: string[]): number {
  if (centroid.length === 0) return 0;
  const centroidSet = new Set(centroid);
  const shared = tokens.filter((t) => centroidSet.has(t)).length;
  return shared / centroidSet.size;
}

function getTopWords(queries: string[], count: number): string[] {
  const frequency = new Map<string, number>();
  for (const query of queries) {
    const tokens = tokenize(query);
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

function rowToDistilledKnowledge(row: DistilledKnowledgeRow): DistilledKnowledge {
  return {
    id: row.id,
    corridor: row.corridor,
    summary: row.summary,
    queryCluster: JSON.parse(row.query_cluster) as string[],
    accessCount: row.access_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgeDistiller {
  private readonly db: RawDB;
  private queryBuffer: string[];
  private readonly MAX_BUFFER_SIZE = 200;

  constructor(db: RawDB) {
    this.db = db;
    this.queryBuffer = [];
  }

  recordQuery(query: string): void {
    this.queryBuffer = [...this.queryBuffer, query];
    if (this.queryBuffer.length > this.MAX_BUFFER_SIZE) {
      this.distill();
    }
  }

  distill(): DistillationResult {
    if (this.queryBuffer.length === 0) {
      return { corridorsFound: 0, newDistillations: 0, updatedDistillations: 0 };
    }

    const clusters = this.clusterQueries(this.queryBuffer);
    let newDistillations = 0;
    let updatedDistillations = 0;

    for (const cluster of clusters) {
      if (cluster.queries.length < 3) continue;

      const topWords = getTopWords(cluster.queries, 3);
      const corridor = topWords.join('-');
      const summary = 'Knowledge corridor accessed via: ' + cluster.queries.slice(0, 5).join(', ');
      const queryClusterJson = JSON.stringify(cluster.queries);
      const now = Date.now();

      const existing = this.db
        .prepare('SELECT * FROM distilled_knowledge WHERE corridor = ?')
        .get(corridor) as DistilledKnowledgeRow | undefined;

      if (existing) {
        this.db
          .prepare(
            'UPDATE distilled_knowledge SET access_count = access_count + 1, query_cluster = ?, updated_at = ? WHERE corridor = ?'
          )
          .run(queryClusterJson, now, corridor);
        updatedDistillations++;
      } else {
        this.db
          .prepare(
            'INSERT INTO distilled_knowledge (corridor, summary, query_cluster, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(corridor, summary, queryClusterJson, 1, now, now);
        newDistillations++;
      }
    }

    this.queryBuffer = [];

    return {
      corridorsFound: clusters.filter((c) => c.queries.length >= 3).length,
      newDistillations,
      updatedDistillations,
    };
  }

  getCorridor(corridor: string): DistilledKnowledge | null {
    const row = this.db
      .prepare('SELECT * FROM distilled_knowledge WHERE corridor = ?')
      .get(corridor) as DistilledKnowledgeRow | undefined;

    if (!row) return null;
    return rowToDistilledKnowledge(row);
  }

  getTopCorridors(limit = 10): DistilledKnowledge[] {
    const rows = this.db
      .prepare('SELECT * FROM distilled_knowledge ORDER BY access_count DESC LIMIT ?')
      .all(limit) as DistilledKnowledgeRow[];

    return rows.map(rowToDistilledKnowledge);
  }

  getAllCorridors(): DistilledKnowledge[] {
    const rows = this.db
      .prepare('SELECT * FROM distilled_knowledge ORDER BY access_count DESC')
      .all() as DistilledKnowledgeRow[];

    return rows.map(rowToDistilledKnowledge);
  }

  getBufferSize(): number {
    return this.queryBuffer.length;
  }

  private clusterQueries(queries: string[]): Array<{ centroid: string[]; queries: string[] }> {
    const clusters: Array<{ centroid: string[]; queries: string[] }> = [];

    for (const query of queries) {
      const tokens = tokenize(query);
      let assigned = false;

      for (const cluster of clusters) {
        if (computeOverlap(tokens, cluster.centroid) > 0.5) {
          cluster.queries = [...cluster.queries, query];
          cluster.centroid = getTopWords(cluster.queries, 5);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        clusters.push({ centroid: tokens, queries: [query] });
      }
    }

    return clusters;
  }
}
