import type { RawDB } from '../database/types.js';
import { rrf, type RankedList } from '../database/fusion.js';

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

  /**
   * Fuses multi-signal candidates into a ranked, normalized result list.
   *
   * Default fusion is canonical Reciprocal Rank Fusion (RRF) over each signal's
   * ranking — scale-invariant and tuning-free, so incomparable raw magnitudes
   * (cosine similarity vs. BM25 vs. graph proximity) no longer skew the blend
   * the way the old un-normalized weighted sum did. The `weights` argument now
   * tilts each signal's RRF contribution multiplicatively (a weight of 0 mutes
   * a signal) while preserving the public `(candidates, weights, context)`
   * signature. graphProximity + recency + heat remain first-class signals — a
   * legitimate, SOTA-aligned affinity boost — but enter ranked, not raw.
   * Output `fusedScore` is normalized to [0, 1] via {@link normalizeScores}.
   */
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

    // Pre-compute the per-signal value for every candidate; keep the breakdown
    // for transparency in `scores`. recency/heat are derived as before.
    const signalValues = candidates.map((candidate) => ({
      path: candidate.path,
      semantic: candidate.semanticScore ?? 0,
      bm25: candidate.bm25Score ?? 0,
      graphProximity: candidate.graphProximityScore ?? 0,
      recency: this.recencyScore(candidate.lastModified, now),
      heat: maxAccessCount > 0 ? (candidate.accessCount ?? 0) / maxAccessCount : 0,
    }));

    // One ranked list per signal: candidates sorted best-first by that signal.
    // Candidates with a zero value for a signal are dropped from that list so a
    // missing signal contributes nothing (rather than a misleading mid-rank).
    const SIGNALS = ['semantic', 'bm25', 'graphProximity', 'recency', 'heat'] as const;
    const lists: RankedList<{ path: string }>[] = SIGNALS.map((signal) => ({
      items: signalValues
        .filter((v) => v[signal] > 0)
        .sort((a, b) => b[signal] - a[signal])
        .map((v) => ({ path: v.path })),
      key: (item) => item.path,
    }));

    // RRF fuse, then apply the per-signal weight as a multiplicative tilt by
    // running weighted RRF: each list's contribution is scaled by its weight.
    const weightForList: Record<(typeof SIGNALS)[number], number> = {
      semantic: activeWeights.semantic,
      bm25: activeWeights.bm25,
      graphProximity: activeWeights.graphProximity,
      recency: activeWeights.recency,
      heat: activeWeights.heat,
    };
    const weightedScore = new Map<string, number>();
    SIGNALS.forEach((signal, idx) => {
      const weight = weightForList[signal];
      if (weight === 0) return;
      for (const entry of rrf([lists[idx]])) {
        weightedScore.set(entry.key, (weightedScore.get(entry.key) ?? 0) + weight * entry.rrfScore);
      }
    });

    const byPath = new Map(signalValues.map((v) => [v.path, v]));
    const results: FusionResult[] = signalValues.map((v) => {
      const sv = byPath.get(v.path)!;
      return Object.freeze({
        path: v.path,
        scores: Object.freeze({
          semantic: sv.semantic,
          bm25: sv.bm25,
          graphProximity: sv.graphProximity,
          recency: sv.recency,
          heat: sv.heat,
        }),
        fusedScore: weightedScore.get(v.path) ?? 0,
      });
    });

    const sorted = [...results].sort((a, b) => b.fusedScore - a.fusedScore);
    // Normalize to [0, 1] so downstream consumers get a stable, bounded score
    // (this path previously defined normalizeScores but never invoked it).
    return this.normalizeScores(sorted);
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
