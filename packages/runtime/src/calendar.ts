import type { CalendarMode, CalendarView, Condition, DataAdapter, DataRecord, EntityDocument, FieldValue, Query, RecordValues, SortSpec } from "@yadad/core";
import { localIsoDate, resolveRelativeDates } from "./condition.js";

/** Records fetched per `find` call; the protocol's per-request cap. */
export const CALENDAR_PAGE_SIZE = 500;
/** Most records one visible range reads. Past this the load is `truncated`. */
export const CALENDAR_MAX_RECORDS = 2000;
/** Colour slots an entry can have (0 to 7). */
export const CALENDAR_COLOR_SLOTS = 8;

/** One day of the grid. `date` is "YYYY-MM-DD"; `weekday` is 0 (Sunday) to 6. */
export interface CalendarDay {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly weekday: number;
  /** False for the leading and trailing days of a month grid; always true in week mode. */
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

/** An inclusive range of calendar dates. */
export interface DateRange {
  readonly first: string;
  readonly last: string;
}

// --- calendar-date arithmetic (year, month, day via Date.UTC: never local midnights) ---

interface Ymd {
  readonly y: number;
  readonly m: number; // 1 to 12
  readonly d: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a real calendar date; throws RangeError for anything else (including 2026-02-30). */
function parseDate(date: string): Ymd {
  const match = DATE_PATTERN.exec(date);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const back = fromMs(utcMs({ y, m, d }));
    if (back.y === y && back.m === m && back.d === d) return { y, m, d };
  }
  throw new RangeError(`"${date}" is not a calendar date (expected a real YYYY-MM-DD)`);
}

function utcMs({ y, m, d }: Ymd): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}

function fromMs(ms: number): Ymd {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function format({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

function addDays(date: Ymd, days: number): Ymd {
  return fromMs(utcMs(date) + days * DAY_MS);
}

const weekdayOf = (date: Ymd): number => new Date(utcMs(date)).getUTCDay();

function checkWeekStart(weekStartsOn: number): void {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new RangeError(`weekStartsOn must be an integer from 0 to 6, got ${weekStartsOn}`);
  }
}

/** The first day of the week containing `date`. */
function weekStart(date: Ymd, weekStartsOn: number): Ymd {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

function periodFirst(anchor: Ymd, mode: CalendarMode, weekStartsOn: number): Ymd {
  return mode === "month" ? weekStart({ y: anchor.y, m: anchor.m, d: 1 }, weekStartsOn) : weekStart(anchor, weekStartsOn);
}

/**
 * The days a grid shows. Month: always 42 days (six whole weeks) from the
 * `weekStartsOn` day on or before the 1st of the anchor's month, so the grid
 * keeps its height; days outside the month have `inMonth: false`. Week: the 7
 * days from the `weekStartsOn` day on or before the anchor. `today` is a
 * "YYYY-MM-DD" (see `calendarToday`).
 */
export function visibleDays(anchor: string, mode: CalendarMode, weekStartsOn: number, today: string): CalendarDay[] {
  checkWeekStart(weekStartsOn);
  const a = parseDate(anchor);
  parseDate(today);
  const count = mode === "month" ? 42 : 7;
  const first = periodFirst(a, mode, weekStartsOn);
  const days: CalendarDay[] = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(first, i);
    const date = format(day);
    days.push({ date, dayOfMonth: day.d, weekday: weekdayOf(day), inMonth: mode === "week" || (day.y === a.y && day.m === a.m), isToday: date === today });
  }
  return days;
}

/** The first and last of the visible days. A month range includes the leading and trailing days. */
export function visibleRange(anchor: string, mode: CalendarMode, weekStartsOn: number): DateRange {
  checkWeekStart(weekStartsOn);
  const first = periodFirst(parseDate(anchor), mode, weekStartsOn);
  return { first: format(first), last: format(addDays(first, (mode === "month" ? 42 : 7) - 1)) };
}

/** Month: the 1st of the previous or next month. Week: 7 days earlier or later. */
export function shiftAnchor(anchor: string, mode: CalendarMode, direction: -1 | 1): string {
  const a = parseDate(anchor);
  if (mode === "week") return format(addDays(a, direction * 7));
  const index = a.y * 12 + (a.m - 1) + direction;
  return format({ y: Math.floor(index / 12), m: (index % 12) + 1, d: 1 });
}

/** The viewer's local date as "YYYY-MM-DD". `now` is injectable so tests are deterministic. */
export function calendarToday(now: Date = new Date()): string {
  return localIsoDate(now);
}

// --- labels (Intl in UTC on the date parts) ---

const part = (date: Ymd, locale: string | undefined, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(utcMs(date)));

/**
 * The heading for a period: "October 2026" for a month; for a week
 * "5 to 11 October 2026", naming both months (and both years) when it spans them.
 */
export function periodTitle(anchor: string, mode: CalendarMode, weekStartsOn: number, locale?: string): string {
  checkWeekStart(weekStartsOn);
  const a = parseDate(anchor);
  if (mode === "month") return `${part(a, locale, { month: "long" })} ${part(a, locale, { year: "numeric" })}`;
  const first = periodFirst(a, "week", weekStartsOn);
  const last = addDays(first, 6);
  const day = (d: Ymd): string => part(d, locale, { day: "numeric" });
  const month = (d: Ymd): string => part(d, locale, { month: "long" });
  const year = (d: Ymd): string => part(d, locale, { year: "numeric" });
  if (first.y !== last.y) return `${day(first)} ${month(first)} ${year(first)} to ${day(last)} ${month(last)} ${year(last)}`;
  if (first.m !== last.m) return `${day(first)} ${month(first)} to ${day(last)} ${month(last)} ${year(last)}`;
  return `${day(first)} to ${day(last)} ${month(last)} ${year(last)}`;
}

/** Column headings starting at `weekStartsOn`: a short ("Mon") and a long ("Monday") form. */
export function weekdayLabels(weekStartsOn: number, locale?: string): { short: string; long: string }[] {
  checkWeekStart(weekStartsOn);
  const sunday = { y: 2023, m: 1, d: 1 }; // a Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(sunday, (weekStartsOn + i) % 7);
    return { short: part(day, locale, { weekday: "short" }), long: part(day, locale, { weekday: "long" }) };
  });
}

/** The long form used in accessible names: "Thursday 15 October 2026". */
export function dayLabel(date: string, locale?: string): string {
  const d = parseDate(date);
  return `${part(d, locale, { weekday: "long" })} ${part(d, locale, { day: "numeric" })} ${part(d, locale, { month: "long" })} ${part(d, locale, { year: "numeric" })}`;
}

// --- queries ---

/** The view's filter AND `dateField >= first` AND `dateField <= last`. An empty date matches neither bound. Relative dates in the filter are resolved with `now`. */
export function rangeCondition(dateField: string, range: DateRange, filter?: Condition, now?: Date): Condition {
  parseDate(range.first);
  parseDate(range.last);
  const bounds: Condition[] = [
    { op: "gte", field: dateField, value: range.first },
    { op: "lte", field: dateField, value: range.last },
  ];
  return { op: "and", conditions: filter ? [resolveRelativeDates(filter, now), ...bounds] : bounds };
}

export interface CalendarQueryOptions {
  /** Supplies the default title field (the entity's first text field) for the within-day sort. */
  readonly entity?: EntityDocument;
  /** The clock for relative dates in the view's filter. */
  readonly now?: Date;
  readonly offset?: number;
  readonly limit?: number;
}

function titleFieldOf(view: CalendarView, entity: EntityDocument | undefined): string | undefined {
  return view.titleField ?? entity?.fields.find((f) => f.type === "text")?.id;
}

/** One page of the range: filter from `rangeCondition`, sorted by date then the view's sort (default: the title field), 500 per page. */
export function calendarQuery(view: CalendarView, range: DateRange, options: CalendarQueryOptions = {}): Query {
  const title = titleFieldOf(view, options.entity);
  const within: readonly SortSpec[] = view.sort ?? (title ? [{ field: title, dir: "asc" }] : []);
  return {
    filter: rangeCondition(view.dateField, range, view.filter, options.now),
    sort: [{ field: view.dateField, dir: "asc" }, ...within],
    page: { offset: options.offset ?? 0, limit: options.limit ?? CALENDAR_PAGE_SIZE },
  };
}

export interface CalendarLoad {
  readonly records: readonly DataRecord[];
  /** Records the range matched. */
  readonly total: number;
  /** True when `total` exceeds the records read (the cap, or data that shifted between pages). */
  readonly truncated: boolean;
}

export interface LoadCalendarOptions extends Omit<CalendarQueryOptions, "offset" | "limit"> {
  /** Overrides the 2000-record cap. */
  readonly maxRecords?: number;
  /** Overrides the 500-record page size. */
  readonly pageSize?: number;
}

/**
 * Loads every entry of a range through `adapter.find`: the first page, then
 * (when `total` is larger) the remaining pages in parallel, up to the cap
 * (2000 records, at most 4 requests). Records are de-duplicated by id and
 * keep the query's sort order. Entries past the cap are reported through
 * `truncated`, never dropped silently.
 */
export async function loadCalendarRange(adapter: DataAdapter, view: CalendarView, range: DateRange, options: LoadCalendarOptions = {}): Promise<CalendarLoad> {
  const maxRecords = options.maxRecords ?? CALENDAR_MAX_RECORDS;
  const pageSize = options.pageSize ?? CALENDAR_PAGE_SIZE;
  const { maxRecords: _m, pageSize: _p, ...queryOptions } = options;
  const query = (offset: number, limit: number): Query => calendarQuery(view, range, { ...queryOptions, offset, limit });
  const first = await adapter.find(view.entity, query(0, Math.min(pageSize, maxRecords)));
  const pages = [first.items];
  const stride = first.items.length; // an adapter may return fewer than asked; step by what it gave
  const firstTotal = first.total ?? first.items.length; // RFC 0007: card 34h (cursor paging)
  if (stride > 0 && firstTotal > stride && stride < maxRecords) {
    const requests: Promise<readonly DataRecord[]>[] = [];
    for (let offset = stride; offset < Math.min(firstTotal, maxRecords); offset += stride) {
      requests.push(adapter.find(view.entity, query(offset, Math.min(stride, maxRecords - offset))).then((p) => p.items));
    }
    pages.push(...(await Promise.all(requests)));
  }
  const seen = new Set<string>();
  const records: DataRecord[] = [];
  for (const record of pages.flat()) {
    if (seen.has(record.id) || records.length >= maxRecords) continue;
    seen.add(record.id);
    records.push(record);
  }
  return { records, total: firstTotal, truncated: firstTotal > records.length };
}

/** Records keyed by their `dateField` day, in input order. Records with no date are left out. */
export function groupByDay(records: readonly DataRecord[], dateField: string): Map<string, DataRecord[]> {
  const days = new Map<string, DataRecord[]>();
  for (const record of records) {
    const day = record.values[dateField];
    if (typeof day !== "string" || day === "") continue;
    const list = days.get(day);
    if (list) list.push(record);
    else days.set(day, [record]);
  }
  return days;
}

// --- moving an entry ---

/** What moving an entry to a day should do. Pure data: the renderer performs the update. */
export type MovePlan =
  /** Nothing to send: the entry is already on that day, or the view is not editable. */
  | { readonly kind: "none"; readonly reason: "same-day" | "not-editable" }
  /** The day is outside the date field's own min or max; nothing is sent. */
  | { readonly kind: "blocked"; readonly reason: "before-min" | "after-max"; readonly message: string }
  /** `adapter.update(entity, id, patch, meta)`. Only the date field is sent. */
  | {
      readonly kind: "update";
      readonly entity: string;
      readonly id: string;
      readonly patch: RecordValues;
      readonly meta: { readonly entityRevision: number; readonly baseVersion: string };
    };

/** Plans moving `record` to `day` ("YYYY-MM-DD", any real date, visible or not). Throws RangeError for a day that is not a real date. */
export function moveDay(view: CalendarView, entity: EntityDocument, record: DataRecord, day: string): MovePlan {
  parseDate(day);
  if (view.editable !== true) return { kind: "none", reason: "not-editable" };
  if (record.values[view.dateField] === day) return { kind: "none", reason: "same-day" };
  const field = entity.fields.find((f) => f.id === view.dateField);
  if (field?.type === "date") {
    if (field.min !== undefined && day < field.min) return { kind: "blocked", reason: "before-min", message: `${field.label} cannot be before ${field.min}` };
    if (field.max !== undefined && day > field.max) return { kind: "blocked", reason: "after-max", message: `${field.label} cannot be after ${field.max}` };
  }
  return {
    kind: "update",
    entity: view.entity,
    id: record.id,
    patch: { [view.dateField]: day },
    meta: { entityRevision: entity.revision, baseVersion: record.version },
  };
}

// --- colour ---

export interface ColorSlotOptions {
  /** A select field's option values, in order. */
  readonly options?: readonly string[];
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The colour slot (0 to 7) of a `colorField` value. Select: the index of the
 * value in its option list, modulo 8 (undefined if it is not an option).
 * Reference: FNV-1a 32-bit of the record id, modulo 8. An empty value has no colour.
 */
export function colorSlot(value: FieldValue | undefined, fieldKind: "select" | "reference", options: ColorSlotOptions = {}): number | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (fieldKind === "reference") return fnv1a32(value) % CALENDAR_COLOR_SLOTS;
  const index = (options.options ?? []).indexOf(value);
  return index === -1 ? undefined : index % CALENDAR_COLOR_SLOTS;
}
