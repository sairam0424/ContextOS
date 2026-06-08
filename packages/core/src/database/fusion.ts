/**
 * Reciprocal Rank Fusion (RRF) — the one canonical fusion primitive.
 *
 * RRF combines multiple ranked lists by summing each item's reciprocal rank
 * across the lists: `score(item) = sum over lists of 1 / (k + rank)`, where
 * `rank` is 0-based position within a list. It is scale-invariant (it ignores
 * raw scores and only uses ordering), so it needs zero per-signal weight tuning
 * and is robust to lists with wildly different score magnitudes (e.g. cosine
 * distance vs. BM25 rank). `k` (default 60, the value from the original RRF
 * paper) damps the influence of top ranks so a single list cannot dominate.
 *
 * This replaces ad-hoc magic-weight fusion in both vectors.ts and
 * fusion-scoring.ts (DRY: one helper, two call sites).
 */

/** A single ranked list: items in best-first order, keyed by a stable id. */
export interface RankedList<T> {
  /** Items already sorted best-first (index 0 = top result). */
  readonly items: ReadonlyArray<T>;
  /** Extracts the stable fusion key (e.g. document path) from an item. */
  readonly key: (item: T) => string;
}

/** Fused output: the representative record plus its accumulated RRF score. */
export interface RrfEntry<T> {
  readonly key: string;
  readonly record: T;
  readonly rrfScore: number;
}

export const DEFAULT_RRF_K = 60;

/**
 * Fuses any number of ranked lists into one RRF-ordered list (best first).
 *
 * For each key, the first record encountered (scanning lists left-to-right,
 * top-to-bottom) is kept as the representative `record`; its `rrfScore` is the
 * sum of `1 / (k + rank)` contributions from every list it appears in.
 *
 * @param lists ranked lists to fuse (any length, including 0 or 1).
 * @param k RRF damping constant (default {@link DEFAULT_RRF_K} = 60).
 */
export function rrf<T>(lists: ReadonlyArray<RankedList<T>>, k: number = DEFAULT_RRF_K): RrfEntry<T>[] {
  const accumulated = new Map<string, { record: T; score: number }>();

  for (const list of lists) {
    list.items.forEach((item, rank) => {
      const key = list.key(item);
      const contribution = 1 / (k + rank);
      const existing = accumulated.get(key);
      if (existing) {
        // Immutability: replace the entry with a new object, never mutate in place.
        accumulated.set(key, { record: existing.record, score: existing.score + contribution });
      } else {
        accumulated.set(key, { record: item, score: contribution });
      }
    });
  }

  return Array.from(accumulated.entries())
    .map(([key, v]) => ({ key, record: v.record, rrfScore: v.score }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}
