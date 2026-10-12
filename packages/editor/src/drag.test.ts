/**
 * Geometry tests for the shared drag math. The math is pure over elements,
 * so fake rectangles stand in for laid-out rows: the same function the
 * editors call with real <tr>s and section spans.
 */
import { describe, expect, test } from "vitest";
import type { ReorderableRow, RangeSpan } from "./drag.js";
import { flatIndex, insertIndex, nearestSpan } from "./drag.js";

/** A fake element with one rectangle, the way the math sees it. */
const fakeEl = (top: number, height: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height }) }) as unknown as HTMLElement;

const row = (id: string, sectionId: string, top: number, height = 40): ReorderableRow => ({ id, sectionId, el: fakeEl(top, height) });
const span = (id: string, top: number, height: number): RangeSpan => ({ id, el: fakeEl(top, height) });

describe("nearestSpan", () => {
  const spans = [span("main", 0, 100), span("more", 120, 100)];
  test("is the span whose range contains the point", () => {
    expect(nearestSpan(spans, 50)?.id).toBe("main");
    expect(nearestSpan(spans, 99)?.id).toBe("main");
    expect(nearestSpan(spans, 120)?.id).toBe("more");
  });
  test("between spans is the one whose top is nearer, so a gap resolves to the next span", () => {
    // The gap is (100, 120); every point in it is closer to more's top (120)
    // than main's (0).
    expect(nearestSpan(spans, 101)?.id).toBe("more");
    expect(nearestSpan(spans, 119)?.id).toBe("more");
    expect(nearestSpan(spans, 130)?.id).toBe("more");
    expect(nearestSpan(spans, -5)?.id).toBe("main");
    expect(nearestSpan(spans, 500)?.id).toBe("more");
  });
  test("an empty list has no span", () => {
    expect(nearestSpan([], 0)).toBeUndefined();
  });
});

describe("insertIndex", () => {
  // main: a (0-40), b (40-80); more: c (120-160).
  const rows = [row("a", "main", 0), row("b", "main", 40), row("c", "more", 120)];
  const spans = [span("main", 0, 80), span("more", 120, 40)];

  test("counts the other rows the pointer is below the midpoint of", () => {
    // Above a's midpoint (20): before everything in main.
    expect(insertIndex(rows, spans, 10, "c")).toEqual({ sectionId: "main", index: 0 });
    // Below a's midpoint but above b's (60): between the two.
    expect(insertIndex(rows, spans, 55, "c")).toEqual({ sectionId: "main", index: 1 });
    // Below both: at the end of main.
    expect(insertIndex(rows, spans, 75, "c")).toEqual({ sectionId: "main", index: 2 });
    // In the other section, above its only row's midpoint (140).
    expect(insertIndex(rows, spans, 130, "a")).toEqual({ sectionId: "more", index: 0 });
    expect(insertIndex(rows, spans, 150, "a")).toEqual({ sectionId: "more", index: 1 });
  });

  test("excludes the dragged row from the count", () => {
    // Dragging b in main: a is the only row counted.
    expect(insertIndex(rows, spans, 10, "b")).toEqual({ sectionId: "main", index: 0 });
    expect(insertIndex(rows, spans, 55, "b")).toEqual({ sectionId: "main", index: 1 });
  });

  test("a drop where the row already is resolves to its own position (a no-op)", () => {
    // b is at position 1; pointing at its own zone (past a's midpoint,
    // before b's own row is counted) gives 1.
    expect(insertIndex(rows, spans, 55, "b")).toEqual({ sectionId: "main", index: 1 });
    expect(insertIndex(rows, spans, 10, "a")).toEqual({ sectionId: "main", index: 0 });
    // c is the only row in more: excluding itself leaves nothing, so any
    // drop in that section is index 0 — its own position, a no-op.
    expect(insertIndex(rows, spans, 150, "c")).toEqual({ sectionId: "more", index: 0 });
  });
});

describe("flatIndex", () => {
  const rows = [row("a", "", 0), row("b", "", 40), row("c", "", 80)];
  test("counts the other rows the pointer is below the midpoint of", () => {
    // Midpoints: b at 60, c at 100. In the upper half of a row, the drop
    // lands at that row's own position; in the lower half, after it.
    expect(flatIndex(rows, 10, "a")).toBe(0);
    expect(flatIndex(rows, 55, "a")).toBe(0); // upper half of b: no-op for a
    expect(flatIndex(rows, 65, "a")).toBe(1); // lower half of b
    expect(flatIndex(rows, 105, "a")).toBe(2); // lower half of c
  });
  test("excludes the dragged row, so a drop on itself is its own index (a no-op)", () => {
    expect(flatIndex(rows, 55, "b")).toBe(1);
    expect(flatIndex(rows, 10, "a")).toBe(0);
  });
  test("an empty list is position 0", () => {
    expect(flatIndex([], 10, "a")).toBe(0);
  });
});
