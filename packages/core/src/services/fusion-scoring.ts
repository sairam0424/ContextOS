import type { RawDB } from '../database/types.js';

export interface FusionWeights {
  readonly semantic: number;
  readonly bm25: number;
  readonly graphProximity: number;
  readonly recency: number;
  readonly heat: number;
}

export interface FusionResult {
  readonly path: string;
  readonly scores: {
    readonly semantic: number;
    readonly bm25: number;
    readonly graphProximity: number;
    readonly recency: number;
    readonly heat: number;
  };
  readonly fusedScore: number;
}

export interface FusionCandidate {
  readonly path: string;
  readonly semanticScore?: number;
  readonly bm25Score?: number;
  readonly graphProximityScore?: number;
  readonly lastModified?: number;
  readonly accessCount?: number;
}

interface FusionContext {
  readonly anchorPath?: string;
  readonly now?: number;
}

export class MultiModalFusionService {
  private readonly db: RawDB;
  private readonly defaultWeights: FusionWeights;

  constructor(db: RawDB) {
    this.db = db;
    this.defaultWeights = Object.freeze({
      semantic: 0.4,
      bm25: 0.2,
      graphProximity: 0.2,
      recency: 0.1,
      heat: 0.1,
    });
  }

  score(
    candidates: FusionCandidate[],
    weights?: Partial<FusionWeights>,
    context?: FusionContext
  ): FusionResult[] {
    if (candidates.length === 0) return [];

    const activeWeights: FusionWeights = Object.freeze({
      ...this.defaultWeights,
      ...weights,
    });

    const now = context?.now ?? Date.now();

    const maxAccessCount = candidates.reduce(
      (max, c) => Math.max(max, c.accessCount ?? 0),
      1
    );

    const results: FusionResult[] = candidates.map((candidate) => {
      const semantic = candidate.semanticScore ?? 0;
      const bm25 = candidate.bm25Score ?? 0;
      const graphProximity = candidate.graphProximityScore ?? 0;
      const recency = this.recencyScore(candidate.lastModified, now);
      const heat =
        maxAccessCount > 0 ? (candidate.accessCount ?? 0) / maxAccessCount : 0;

      const fusedScore =
        activeWeights.semantic * semantic +
        activeWeights.bm25 * bm25 +
        activeWeights.graphProximity * graphProximity +
        activeWeights.recency * recency +
        activeWeights.heat * heat;

      return Object.freeze({
        path: candidate.path,
        scores: Object.freeze({ semantic, bm25, graphProximity, recency, heat }),
        fusedScore,
      });
    });

    const sorted = [...results].sort((a, b) => b.fusedScore - a.fusedScore);
    return sorted;
  }

  getDefaultWeights(): FusionWeights {
    return this.defaultWeights;
  }

  normalizeScores(results: FusionResult[]): FusionResult[] {
    if (results.length === 0) return [];

    const maxScore = results.reduce(
      (max, r) => Math.max(max, r.fusedScore),
      0
    );

    if (maxScore === 0) return results;

    return results.map((result) =>
      Object.freeze({
        path: result.path,
        scores: result.scores,
        fusedScore: result.fusedScore / maxScore,
      })
    );
  }

  private recencyScore(lastModified: number | undefined, now: number): number {
    if (!lastModified) return 0;
    const daysSince = (now - lastModified) / 86400000;
    const halfLifeDays = 14;
    return Math.exp((-0.693 * daysSince) / halfLifeDays);
  }
}
