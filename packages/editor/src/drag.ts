/**
 * Shared pointer math for the view editors, hand-written like the dashboard
 * editor. One geometry for form fields, sections and table columns: where a
 * pointer's `y` maps to. Fields are dropped between rows of a section (the
 * section is hit-tested from coarse spans); sections and columns are flat
 * lists, so they only need the position among their neighbours.
 */

/** Rows the pointer can drop between, in the order they are laid out. */
export interface ReorderableRow {
  readonly id: string;
  /** The section the row belongs to; "" for flat lists. */
  readonly sectionId: string;
  /** Element whose vertical midpoint the pointer is compared against. */
  readonly el: HTMLElement;
}

/** Coarse vertical spans, for hit-testing which section the pointer is in. */
export interface RangeSpan {
  readonly id: string;
  readonly el: HTMLElement;
}

/** The drop a drag has previewed: the section and 0-based position within it. */
export interface DropTarget {
  readonly sectionId: string;
  readonly index: number;
}

/**
 * The span whose range the point `y` falls in; otherwise the span whose top
 * is nearest.
 */
export function nearestSpan(spans: readonly RangeSpan[], y: number): RangeSpan | undefined {
  if (spans.length === 0) return undefined;
  for (const span of spans) {
    const rect = span.el.getBoundingClientRect();
    if (y >= rect.top && y < rect.bottom) return span;
  }
  return spans.reduce((nearest, span) => (Math.abs(span.el.getBoundingClientRect().top - y) < Math.abs(nearest.el.getBoundingClientRect().top - y) ? span : nearest));
}

/** Rows of one section, in layout order, excluding the drag's own row. */
function rowsInSection(rows: readonly ReorderableRow[], sectionId: string, excludeId: string): readonly ReorderableRow[] {
  return rows.filter((r) => r.sectionId === sectionId && r.id !== excludeId);
}

/**
 * Where a pointer at `y` would land when dragging row `excludeId`. The
 * section is the one the pointer is in (the nearest span's top when between
 * spans); the index is how many of that section's *other* rows the pointer
 * is below the midpoint of. That index is also the position the row takes
 * after the move, so it goes straight into the move patch. Dropping a row
 * where it already is resolves to its current position, which the editors
 * treat as a no-op (a zero-patch move, not an undo step).
 */
export function insertIndex(rows: readonly ReorderableRow[], spans: readonly RangeSpan[], y: number, excludeId: string): DropTarget {
  const sectionId = nearestSpan(spans, y)?.id ?? spans[0]?.id;
  if (sectionId === undefined) return { sectionId: "", index: 0 };
  const inSection = rowsInSection(rows, sectionId, excludeId);
  let index = 0;
  for (const row of inSection) {
    const rect = row.el.getBoundingClientRect();
    if (y >= rect.top + rect.height / 2) index++;
  }
  return { sectionId, index };
}

/**
 * The position a pointer at `y` takes in a flat list of rows, excluding the
 * drag's own row: how many of the other rows the pointer is below the
 * midpoint of. Same convention as `insertIndex` — it is the post-move
 * index, and a drop where the row already is resolves to its current
 * position (a no-op). For sections and columns, which are flat lists with
 * no sections to hit-test.
 */
export function flatIndex(rows: readonly ReorderableRow[], y: number, excludeId: string): number {
  let index = 0;
  for (const row of rows) {
    if (row.id === excludeId) continue;
    const rect = row.el.getBoundingClientRect();
    if (y >= rect.top + rect.height / 2) index++;
  }
  return index;
}
