import { defaultTitleField, optionColor, optionLabel, optionValue } from "@yadad/core";
import type { BoardView, DataAdapter, DataRecord, EntityDocument, Field, FieldValue, Query, ReferenceField, ReferenceOption } from "@yadad/core";
import { resolveRelativeDates } from "./condition.js";
import { walkWithNext } from "./memory-adapter.js";
import type { MovePlan } from "./move-plan.js";
import { loadReferenceOptions } from "./reference.js";
import type { ReferenceOptionsResult } from "./reference.js";

/** Records fetched per `find` call; the protocol's per-request cap. */
export const BOARD_PAGE_SIZE = 500;
/** Most cards one board load reads. Past this the load is `truncated`. */
export const BOARD_MAX_CARDS = 1000;
/** Most columns a reference grouping builds; past this cards go to "Other". */
export const BOARD_MAX_COLUMNS = 50;

/** The label of the extra column that holds cards fitting no value column. */
export const BOARD_OTHER_LABEL = "Other";

/**
 * One column of a board. `id` is stable and used by `groupByColumn` and
 * `moveCard`: "v:<value>" for a value column, "empty" or "other". `value` is
 * what a move writes: the option string, true/false, a target record id, or
 * null for "empty"; unused for "other".
 */
export interface BoardColumnDef {
  readonly id: string;
  readonly kind: "value" | "empty" | "other";
  readonly label: string;
  readonly value: FieldValue;
  /** The option's `#RRGGBB` swatch hint (RFC 0008 item 5), when the select option carries one. */
  readonly color?: string;
}

const OTHER_COLUMN: BoardColumnDef = { id: "other", kind: "other", label: BOARD_OTHER_LABEL, value: null };

function emptyColumn(field: Field): BoardColumnDef {
  return { id: "empty", kind: "empty", label: `No ${field.label}`, value: null };
}

/**
 * Normalizes a stored value the way a column compares it: a boolean field's
 * missing or null value is `false`; any other field's missing, null or
 * empty-string value is `null` (select options and reference ids are never
 * empty strings, so `null` cannot collide with a real value).
 */
function normalizedValue(field: Field, raw: FieldValue | undefined): FieldValue {
  if (field.type === "boolean") return raw === true;
  if (raw === undefined || raw === null || raw === "") return null;
  return raw;
}

/**
 * The field named by `requested` if it is one of the view's `groupBy`
 * fields, else the first (the default). An unknown or stale request never
 * throws. Throws only if the view or entity is malformed (no such field on
 * the entity for the resolved id), which validation should have caught.
 */
export function boardGroupField(view: BoardView, entity: EntityDocument, requested?: string): Field {
  const ids = view.groupBy.map((g) => g.field);
  const id = requested !== undefined && ids.includes(requested) ? requested : ids[0];
  const field = entity.fields.find((f) => f.id === id);
  if (!field) throw new RangeError(`"${String(id)}" is not a field of entity "${entity.id}"`);
  return field;
}

/** The fields the viewer may group by, with their labels, in `groupBy` order (the first is the default). */
export function boardGroupChoices(view: BoardView, entity: EntityDocument): { readonly field: string; readonly label: string }[] {
  return view.groupBy.map((g) => {
    const field = entity.fields.find((f) => f.id === g.field);
    return { field: g.field, label: field?.label ?? g.field };
  });
}

/**
 * Builds the value columns for a grouping field, plus the "empty" column
 * when the field is not required. "other" is never built here: it is added
 * by `groupByColumn` only when a loaded record needs it.
 *
 * - `select`: one column per option, in option order.
 * - `boolean`: exactly "Yes" and "No" (never an empty column: every value is one or the other).
 * - `reference`: one column per loaded target record (`targets`), in the given order, labelled by `label`.
 *   Without `targets` (not loaded yet) a reference field returns no columns.
 */
export function boardColumns(field: Field, targets?: readonly ReferenceOption[]): BoardColumnDef[] {
  if (field.type === "select") {
    // RFC 0008 item 5: columns carry the option's label (defaulting to its value) and its swatch colour.
    const columns = field.options.values.map((o): BoardColumnDef => { const value = optionValue(o); const color = optionColor(o); return { id: `v:${value}`, kind: "value", label: optionLabel(o), value, ...(color === undefined ? {} : { color }) }; });
    return field.required === true ? columns : [emptyColumn(field), ...columns];
  }
  if (field.type === "boolean") {
    return [
      { id: "v:true", kind: "value", label: "Yes", value: true },
      { id: "v:false", kind: "value", label: "No", value: false },
    ];
  }
  if (field.type === "reference") {
    if (!targets) return [];
    const columns = targets.map((option): BoardColumnDef => ({ id: `v:${option.id}`, kind: "value", label: option.label, value: option.id }));
    return field.required === true ? columns : [emptyColumn(field), ...columns];
  }
  return [];
}

/**
 * Groups `records` into the given columns, keyed by column id, keeping each
 * record's input order within its column. A record whose value matches none
 * of `columns` goes under the key "other", added only when at least one
 * record needs it (a select value no longer an option, a required field's
 * legacy empty value, or a reference past the column cap or to a deleted
 * record).
 */
export function groupByColumn(field: Field, columns: readonly BoardColumnDef[], records: readonly DataRecord[]): Map<string, DataRecord[]> {
  const map = new Map<string, DataRecord[]>();
  for (const column of columns) map.set(column.id, []);
  const other: DataRecord[] = [];
  for (const record of records) {
    const value = normalizedValue(field, record.values[field.id]);
    const column = columns.find((c) => c.value === value);
    if (column) map.get(column.id)?.push(record);
    else other.push(record);
  }
  if (other.length > 0) map.set(OTHER_COLUMN.id, other);
  return map;
}

/** The number of loaded cards in each column: every given column, then "other" last when present. */
export function boardColumnCounts(columns: readonly BoardColumnDef[], grouped: ReadonlyMap<string, readonly DataRecord[]>): readonly { readonly id: string; readonly count: number }[] {
  const counts = columns.map((column) => ({ id: column.id, count: grouped.get(column.id)?.length ?? 0 }));
  const other = grouped.get(OTHER_COLUMN.id);
  return other && other.length > 0 ? [...counts, { id: OTHER_COLUMN.id, count: other.length }] : counts;
}

// --- queries ---

export interface BoardQueryOptions {
  /** Supplies the default title field (the entity's first text field) for the card sort. */
  readonly entity?: EntityDocument;
  /** The clock for relative dates in the view's filter. */
  readonly now?: Date;
  readonly offset?: number;
  readonly limit?: number;
}

function titleFieldOf(view: BoardView, entity: EntityDocument | undefined): string | undefined {
  return view.titleField ?? (entity !== undefined ? defaultTitleField(entity) : undefined);
}

/**
 * The one query for a board's cards, independent of the grouping: the
 * view's `filter` (relative dates resolved), sorted by the view's `sort`
 * (default: the title field, ascending), 500 per page. No grouping
 * condition, so switching the grouping never refetches.
 */
export function boardQuery(view: BoardView, options: BoardQueryOptions = {}): Query {
  const title = titleFieldOf(view, options.entity);
  const sort = view.sort ?? (title ? [{ field: title, dir: "asc" as const }] : []);
  return {
    ...(view.filter ? { filter: resolveRelativeDates(view.filter, options.now) } : {}),
    sort,
    page: { offset: options.offset ?? 0, limit: options.limit ?? BOARD_PAGE_SIZE },
  };
}

export interface BoardLoad {
  readonly records: readonly DataRecord[];
  /** Records the query matched. */
  readonly total: number;
  /** True when `total` exceeds the records read (the cap, or data that shifted between pages). */
  readonly truncated: boolean;
}

export interface LoadBoardOptions extends Omit<BoardQueryOptions, "offset" | "limit"> {
  /** Overrides the 1000-card cap. */
  readonly maxCards?: number;
  /** Overrides the 500-record page size. */
  readonly pageSize?: number;
}

/**
 * Loads a board's cards through `adapter.find`: the first page, then (when
 * `total` is larger) the remaining pages in parallel, up to the cap (1000
 * cards, at most 2 requests). Records are de-duplicated by id and keep the
 * query's sort order. Cards past the cap are reported through `truncated`,
 * never dropped silently.
 */
export async function loadBoardCards(adapter: DataAdapter, view: BoardView, options: LoadBoardOptions = {}): Promise<BoardLoad> {
  const maxCards = options.maxCards ?? BOARD_MAX_CARDS;
  const pageSize = options.pageSize ?? BOARD_PAGE_SIZE;
  const { maxCards: _maxCards, pageSize: _pageSize, ...queryOptions } = options;
  const query = (offset: number, limit: number): Query => boardQuery(view, { ...queryOptions, offset, limit });
  const { page: _page, ...base } = query(0, 1);
  const first = await adapter.find(view.entity, query(0, Math.min(pageSize, maxCards)));
  if (first.total === undefined && first.next != null) {
    // A server that does not count (RFC 0007): follow `next` up to the cap.
    // `total` is then what was read (a lower bound when truncated).
    const walked = await walkWithNext(adapter, view.entity, base, { first, maxRecords: maxCards, pageSize });
    return { records: dedupeById(walked.items, maxCards), total: walked.items.length, truncated: walked.hasMore };
  }
  const pages = [first.items];
  const stride = first.items.length; // an adapter may return fewer than asked; step by what it gave
  const firstTotal = first.total ?? first.items.length;
  if (stride > 0 && firstTotal > stride && stride < maxCards) {
    const requests: Promise<readonly DataRecord[]>[] = [];
    for (let offset = stride; offset < Math.min(firstTotal, maxCards); offset += stride) {
      requests.push(adapter.find(view.entity, query(offset, Math.min(stride, maxCards - offset))).then((p) => p.items));
    }
    pages.push(...(await Promise.all(requests)));
  }
  const records = dedupeById(pages.flat(), maxCards);
  return { records, total: firstTotal, truncated: firstTotal > records.length };
}

/** De-duplicate by id, keep input order, stop at the cap. Shared by the calendar and board loaders. */
function dedupeById(records: readonly DataRecord[], maxRecords: number): DataRecord[] {
  const seen = new Set<string>();
  const kept: DataRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id) || kept.length >= maxRecords) continue;
    seen.add(record.id);
    kept.push(record);
  }
  return kept;
}

/**
 * The columns of a reference grouping in `columnsFrom: "options"` mode
 * (RFC 0008 item 10): the target entity's records sorted by its display field
 * (ascending), capped at `BOARD_MAX_COLUMNS`. A wrapper over
 * `loadReferenceOptions` with the board's own cap.
 */
export async function loadBoardTargets(adapter: DataAdapter, target: EntityDocument, field: ReferenceField): Promise<ReferenceOptionsResult> {
  return loadReferenceOptions(adapter, target, field, BOARD_MAX_COLUMNS);
}

/**
 * The columns of a reference grouping in the default `columnsFrom: "records"`
 * mode (RFC 0008 item 10): one column per value present in the loaded cards,
 * in first-appearance order (the card query's sort), capped at
 * `BOARD_MAX_COLUMNS` — a value past the cap is not dropped, its cards fall
 * to "other" through `groupByColumn`, the same honesty as a series gap fill.
 * `label` resolves each id the way the cards label it. A target with no
 * cards has no column and no drop target: that is what `columnsFrom:
 * "options"` buys.
 */
export function boardRecordColumns(field: ReferenceField, records: readonly DataRecord[], label: (id: string) => string): BoardColumnDef[] {
  const seen: string[] = [];
  for (const record of records) {
    const value = record.values[field.id];
    if (typeof value === "string" && value !== "" && !seen.includes(value)) seen.push(value);
    if (seen.length >= BOARD_MAX_COLUMNS) break;
  }
  const columns = seen.map((id): BoardColumnDef => ({ id: `v:${id}`, kind: "value", label: label(id), value: id }));
  return field.required === true ? columns : [emptyColumn(field), ...columns];
}

// --- moving a card ---

/** What moving a card to a column should do. One `MovePlan` for every move (card 45d); the name is this module's dialect. */
export type BoardMovePlan = MovePlan;

/**
 * Plans moving `record` to `column` of the grouping `field`. A no-op when
 * the view is not editable or the card is already in that column; refused
 * when `column` is "other" (the engine cannot write "other"); otherwise
 * writes `field.id` to `column.value` (null for the "empty" column).
 */
export function moveCard(view: BoardView, entity: EntityDocument, field: Field, record: DataRecord, column: BoardColumnDef): BoardMovePlan {
  if (view.editable !== true) return { kind: "none", reason: "not-editable" };
  if (column.kind === "other") return { kind: "blocked", reason: "other", message: `Cards cannot be moved to "${column.label}".` };
  const current = normalizedValue(field, record.values[field.id]);
  if (current === column.value) return { kind: "none", reason: "same-column" };
  return {
    kind: "update",
    entity: view.entity,
    id: record.id,
    patch: { [field.id]: column.value },
    meta: { entityRevision: entity.revision, baseVersion: record.version },
  };
}
