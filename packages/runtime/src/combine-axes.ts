/** One axis of variation: an id and the ids of the values it can take. */
export interface CombinableAxis {
  readonly id: string;
  readonly values: readonly { readonly id: string }[];
}

/** One chosen value id per axis id. An axis with no values never appears. */
export type AxisSelection = Readonly<Record<string, string>>;

export interface CombineResult {
  readonly selections: readonly AxisSelection[];
  /** "full": every combination. "pairwise": a covering set that holds every pair of values. */
  readonly strategy: "full" | "pairwise";
  /** False only when `limit` was too small to hold the whole full product or the whole pairwise cover. */
  readonly complete: boolean;
}

/**
 * Combines axes into at most `limit` selections, deterministically (the same
 * axes and limit always give the same selections in the same order).
 *
 * When the full product fits in `limit`, it is returned (first axis varies
 * slowest). Otherwise a greedy pairwise cover is built: every pair of values
 * from two different axes appears in at least one selection. If even that
 * needs more than `limit` selections it is cut to the first `limit` (the
 * greedy order puts the most new pairs first) and `complete` is false.
 */
export function combineAxes(axes: readonly CombinableAxis[], limit: number): CombineResult {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer, got ${limit}`);
  const used = axes.filter((a) => a.values.length > 0);
  if (used.length === 0) return { selections: [{}], strategy: "full", complete: true };

  const sizes = used.map((a) => a.values.length);
  let product = 1;
  for (const size of sizes) {
    product *= size;
    if (product > limit) break;
  }

  const toSelection = (row: readonly number[]): AxisSelection =>
    Object.fromEntries(used.map((axis, i) => [axis.id, axis.values[row[i] ?? 0]?.id ?? ""]));

  if (product <= limit) {
    const rows: number[][] = [];
    const walk = (prefix: number[]): void => {
      if (prefix.length === sizes.length) {
        rows.push(prefix);
        return;
      }
      for (let v = 0; v < (sizes[prefix.length] ?? 0); v++) walk([...prefix, v]);
    };
    walk([]);
    return { selections: rows.map(toSelection), strategy: "full", complete: true };
  }

  const rows = pairwiseRows(sizes);
  return { selections: rows.slice(0, limit).map(toSelection), strategy: "pairwise", complete: rows.length <= limit };
}

const pairKey = (i: number, a: number, j: number, b: number): string => `${i}:${a}|${j}:${b}`;

/** Greedy pairwise cover over axes of the given sizes (at least two). */
function pairwiseRows(sizes: readonly number[]): number[][] {
  const n = sizes.length;
  // One axis has no pairs: its cover is each of its values.
  if (n === 1) return Array.from({ length: sizes[0] ?? 0 }, (_, v) => [v]);
  const uncovered = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let a = 0; a < (sizes[i] ?? 0); a++) {
        for (let b = 0; b < (sizes[j] ?? 0); b++) uncovered.add(pairKey(i, a, j, b));
      }
    }
  }
  const rows: number[][] = [];
  while (uncovered.size > 0) {
    // Seed: the first uncovered pair in axis order (Set keeps insertion order).
    const [seedKey] = uncovered;
    const seed = /^(\d+):(\d+)\|(\d+):(\d+)$/.exec(seedKey ?? "");
    const [si, sa, sj, sb] = [seed?.[1], seed?.[2], seed?.[3], seed?.[4]].map(Number) as [number, number, number, number];
    const row: (number | undefined)[] = new Array<number | undefined>(n).fill(undefined);
    row[si] = sa;
    row[sj] = sb;
    for (let k = 0; k < n; k++) {
      if (row[k] !== undefined) continue;
      let best = 0;
      let bestGain = -1;
      for (let v = 0; v < (sizes[k] ?? 0); v++) {
        let gain = 0;
        for (let m = 0; m < n; m++) {
          const other = row[m];
          if (m === k || other === undefined) continue;
          const key = m < k ? pairKey(m, other, k, v) : pairKey(k, v, m, other);
          if (uncovered.has(key)) gain++;
        }
        if (gain > bestGain) {
          best = v;
          bestGain = gain;
        }
      }
      row[k] = best;
    }
    const done = row.map((v) => v ?? 0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) uncovered.delete(pairKey(i, done[i] ?? 0, j, done[j] ?? 0));
    }
    rows.push(done);
  }
  return rows;
}
