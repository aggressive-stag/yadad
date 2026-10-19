// Word diff for compare columns (RFC 0007, "Meaning" and "The engine computes").
// Tokens are runs of non-space characters and runs of whitespace; a
// longest-common-subsequence over the tokens yields same/added/removed runs.
// Pure, deterministic, and bounded: past MAX_TOKENS on either side it returns
// one removed plus one added segment instead of computing the LCS.

import type { DiffSegment } from "@yadad/core";

/** Past this many tokens on either side, `diffWords` falls back to whole-text removed + added. */
const MAX_TOKENS = 2000;

/** Runs of non-space characters and runs of whitespace, in order, nothing lost. */
function tokenize(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.split(/(\s+)/).filter((part) => part !== "");
}

/** Merge neighbours of the same kind so each run of changed text is one segment. */
function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.kind === segment.kind) {
      merged[merged.length - 1] = { kind: last.kind, text: last.text + segment.text };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

/**
 * The LCS table as direction bits per cell (0 = match came from the diagonal,
 * 1 = came from skipping a `before` token, 2 = came from skipping an `after`
 * token). Ties (equal-length alternatives) always take the same branch — up
 * before left — so the diff is deterministic.
 */
function buildTable(before: string[], after: string[]): Uint8Array {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const lengths = new Uint32Array(rows * cols);
  const directions = new Uint8Array(rows * cols);
  for (let i = 1; i <= before.length; i++) {
    for (let j = 1; j <= after.length; j++) {
      const cell = i * cols + j;
      if (before[i - 1] === after[j - 1]) {
        lengths[cell] = (lengths[(i - 1) * cols + (j - 1)] ?? 0) + 1;
        directions[cell] = 0;
      } else {
        const up = lengths[(i - 1) * cols + j] ?? 0;
        const left = lengths[i * cols + (j - 1)] ?? 0;
        if (up >= left) {
          lengths[cell] = up;
          directions[cell] = 1;
        } else {
          lengths[cell] = left;
          directions[cell] = 2;
        }
      }
    }
  }
  return directions;
}

/** Walk the table backwards to emit segments in document order. */
function emitSegments(directions: Uint8Array, before: string[], after: string[]): DiffSegment[] {
  const cols = after.length + 1;
  const reversed: DiffSegment[] = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && directions[i * cols + j] === 0) {
      reversed.push({ kind: "same", text: before[i - 1] ?? "" });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || directions[i * cols + j] === 1)) {
      reversed.push({ kind: "removed", text: before[i - 1] ?? "" });
      i -= 1;
    } else {
      reversed.push({ kind: "added", text: after[j - 1] ?? "" });
      j -= 1;
    }
  }
  return reversed.reverse();
}

/**
 * Diff two texts by words. Joining the `same` and `added` texts gives `after`;
 * joining the `same` and `removed` texts gives `before`. Both empty texts give
 * no segments. Over 2,000 tokens on either side the diff is not computed — one
 * `removed` and one `added` segment are returned so the cost stays bounded.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  if (beforeTokens.length === 0 && afterTokens.length === 0) {
    return [];
  }
  if (beforeTokens.length > MAX_TOKENS || afterTokens.length > MAX_TOKENS) {
    const fallback: DiffSegment[] = [];
    if (before !== "") {
      fallback.push({ kind: "removed", text: before });
    }
    if (after !== "") {
      fallback.push({ kind: "added", text: after });
    }
    return fallback;
  }
  const directions = buildTable(beforeTokens, afterTokens);
  return mergeAdjacent(emitSegments(directions, beforeTokens, afterTokens));
}
