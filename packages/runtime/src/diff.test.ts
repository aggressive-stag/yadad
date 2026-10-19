// diffWords (RFC 0007): tokens are non-space runs and whitespace runs, an LCS
// over tokens, neighbours merged, bounded cost past 2,000 tokens.

import { describe, expect, test } from "vitest";

import { diffWords } from "./diff.js";

/** Joining `same` + `added` text must rebuild `after`; `same` + `removed` must rebuild `before`. */
function reconstruct(segments: ReturnType<typeof diffWords>, keep: Array<"same" | "added" | "removed">): string {
  return segments.filter((s) => keep.includes(s.kind)).map((s) => s.text).join("");
}

function kinds(segments: ReturnType<typeof diffWords>): string[] {
  return segments.map((s) => s.kind);
}

describe("diffWords", () => {
  test("both empty gives no segments", () => {
    expect(diffWords("", "")).toEqual([]);
  });

  test("one empty is all added or all removed", () => {
    expect(diffWords("hello world", "")).toEqual([{ kind: "removed", text: "hello world" }]);
    expect(diffWords("", "hello world")).toEqual([{ kind: "added", text: "hello world" }]);
  });

  test("identical text is a single same segment", () => {
    expect(diffWords("one two three", "one two three")).toEqual([{ kind: "same", text: "one two three" }]);
  });

  test("a whitespace-only change is a whitespace added/removed pair, words stay same", () => {
    expect(diffWords("a b", "a  b")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "  " },
      { kind: "removed", text: " " },
      { kind: "same", text: "b" },
    ]);
  });

  test("a word added", () => {
    expect(diffWords("one two", "one new two")).toEqual([
      { kind: "same", text: "one" },
      { kind: "added", text: " new" },
      { kind: "same", text: " two" },
    ]);
  });

  test("a word removed", () => {
    expect(diffWords("one two three", "one three")).toEqual([
      { kind: "same", text: "one" },
      { kind: "removed", text: " two" },
      { kind: "same", text: " three" },
    ]);
  });

  test("a word replaced is an added and a removed run", () => {
    expect(diffWords("the quick brown fox", "the slow brown fox")).toEqual([
      { kind: "same", text: "the " },
      { kind: "added", text: "slow" },
      { kind: "removed", text: "quick" },
      { kind: "same", text: " brown fox" },
    ]);
  });

  test("adjacent runs of one kind merge into one segment", () => {
    // A deleted run of three tokens is one removed segment (six unmerged:
    // ws+word pairs), and likewise for an added run.
    expect(diffWords("a b c", "a")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: " b c" },
    ]);
    expect(diffWords("a", "a b c")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: " b c" },
    ]);
  });

  test("equal-length alternatives are deterministic (same result every call)", () => {
    // "a b" -> "b a" has two LCS choices of length 1; the tie-break must be fixed.
    const first = diffWords("a b", "b a");
    expect(first).toEqual([
      { kind: "added", text: "b " },
      { kind: "same", text: "a" },
      { kind: "removed", text: " b" },
    ]);
    expect(diffWords("a b", "b a")).toEqual(first);
  });

  test("joining same+added gives after and same+removed gives before", () => {
    const pairs: Array<[string, string]> = [
      ["", ""],
      ["hello", ""],
      ["", "hello"],
      ["one two", "one new two"],
      ["the quick brown fox", "the slow brown fox"],
      ["a b c d", "a x y z d"],
      ["a b", "b a"],
      ["keep\tthis  spacing", "keep\tthat  spacing"],
    ];
    for (const [before, after] of pairs) {
      const segments = diffWords(before, after);
      expect(reconstruct(segments, ["same", "added"])).toBe(after);
      expect(reconstruct(segments, ["same", "removed"])).toBe(before);
    }
  });

  test("over 2,000 tokens on either side falls back to one removed and one added", () => {
    const many = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
    const over = diffWords(many("x", 2001), many("y", 10));
    expect(over).toEqual([
      { kind: "removed", text: many("x", 2001) },
      { kind: "added", text: many("y", 10) },
    ]);
    // Exactly 2,000 tokens is still diffed for real, not fallen back: 1,000
    // words and 1,000 whitespace runs is 2,000 tokens, and identical text
    // must come back as one merged `same` segment.
    const atLimit = ` ${many("x", 1000)}`;
    expect(diffWords(atLimit, atLimit)).toEqual([{ kind: "same", text: atLimit }]);
    // One word more (2,001 tokens) is past the bound.
    expect(kinds(diffWords(many("x", 1001), "z"))).toEqual(["removed", "added"]);
  });

  test("a 2,000 by 2,000 token diff finishes in well under a second", () => {
    const words = (tag: string) => Array.from({ length: 2000 }, (_, i) => `${tag}${i}`).join(" ");
    const started = Date.now();
    const segments = diffWords(words("a"), words("b"));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(segments).toHaveLength(2);
  });
});
