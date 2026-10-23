import type { Condition, DataAdapter, FieldValue, Measure, RecordValues, SeriesBucket, SeriesSortBy, SeriesSortDir } from "@yadad/core";
import { isIsoDate, SERIES_LIMIT_DEFAULT, SERIES_LIMIT_MAX } from "@yadad/core";
import { resolveRelativeDates } from "./condition.js";
import { walkWithNext } from "./memory-adapter.js";

/** Records fetched per `find` call; the protocol's per-request cap. */
export const AGGREGATE_PAGE_SIZE = 500;
/** Most records one aggregate reads. Past this the result is `partial`. */
export const AGGREGATE_MAX_RECORDS = 5000;

/** A measure's value: a number, a date string (min/max of a date field), or undefined when there is nothing to show. */
export type MeasureValue = number | string | undefined;

export interface AggregateResult {
  /** undefined for min, max and avg over no values. count, sum and countDistinct over nothing are 0. */
  readonly value: MeasureValue;
  /** True when the table holds more records than were read, so the value covers only the first `read`. */
  readonly partial: boolean;
  /** Records the value was computed from. */
  readonly read: number;
  /** Records that matched the filter. */
  readonly total: number;
}

const isNumber = (v: FieldValue | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Folds records into a measure one at a time, so nothing but the running state is kept. */
interface Accumulator {
  add(values: RecordValues): void;
  result(): MeasureValue;
}

function accumulator(measure: Measure): Accumulator {
  if (measure.op === "count") {
    let n = 0;
    return { add: () => void n++, result: () => n };
  }
  if (measure.op === "countDistinct") {
    const seen = new Set<string>();
    const field = measure.field;
    return {
      add(values) {
        const v = values[field];
        if (v === null || v === undefined || v === "") return;
        seen.add(`${typeof v}:${String(v)}`); // 1 and "1" are different values
      },
      result: () => seen.size,
    };
  }
  if (measure.op === "min" || measure.op === "max") {
    const field = measure.field;
    const pick = measure.op === "min" ? (a: number | string, b: number | string) => (b < a ? b : a) : (a: number | string, b: number | string) => (b > a ? b : a);
    let best: number | string | undefined;
    return {
      add(values) {
        const v = values[field];
        const usable = isNumber(v) ? v : typeof v === "string" && v !== "" ? v : undefined;
        if (usable === undefined || (best !== undefined && typeof best !== typeof usable)) return;
        best = best === undefined ? usable : pick(best, usable);
      },
      result: () => best,
    };
  }
  // sum and avg, over one field or the product of two
  const term = "product" in measure ? productOf(measure.product) : fieldOf(measure.field);
  let total = 0;
  let n = 0;
  return {
    add(values) {
      const x = term(values);
      if (x === undefined) return;
      total += x;
      n++;
    },
    result: () => (measure.op === "sum" ? total : n === 0 ? undefined : total / n),
  };
}

const fieldOf = (field: string) => (values: RecordValues): number | undefined => {
  const v = values[field];
  return isNumber(v) ? v : undefined;
};

/** A record counts only when both operands have a value. */
const productOf = ([a, b]: readonly [string, string]) => (values: RecordValues): number | undefined => {
  const x = values[a];
  const y = values[b];
  return isNumber(x) && isNumber(y) ? x * y : undefined;
};

/** The one definition of measure semantics: skips empty values, 0 for count/sum/countDistinct over nothing, undefined for min/max/avg. Pure. */
export function computeMeasure(records: readonly RecordValues[], measure: Measure): MeasureValue {
  const acc = accumulator(measure);
  for (const values of records) acc.add(values);
  return acc.result();
}

export interface AggregateOptions {
  /** The filter to apply: usually the table view's fixed filter and the widget's, joined with `and`. Relative dates are resolved here. */
  readonly filter?: Condition;
  /** Overrides the 5000-record ceiling. */
  readonly maxRecords?: number;
  /** Overrides the 500-record page size. */
  readonly pageSize?: number;
  /** The clock for relative dates. */
  readonly now?: Date;
}

/**
 * Computes a measure over an entity's records through `adapter.find`: `count`
 * is one request that reads only `total`; every other op pages through the
 * matching records (500 per request) and stops at 5000, reporting `partial`
 * when the table holds more. Relative dates in the filter become fixed ones
 * before the adapter sees them.
 */
export async function aggregate(adapter: DataAdapter, entityId: string, measure: Measure, options: AggregateOptions = {}): Promise<AggregateResult> {
  const filter = options.filter ? resolveRelativeDates(options.filter, options.now) : undefined;
  const base = filter ? { filter } : {};
  if (measure.op === "count") {
    // `limit: 0` is the count request: one read, the total is the answer.
    const first = await adapter.find(entityId, { ...base, page: { offset: 0, limit: 0 } });
    if (first.total !== undefined) return { value: first.total, partial: false, read: first.total, total: first.total };
    // A server that does not count has no total to ask (RFC 0007): walk the
    // pages up to the same cap the other measures use and report what was read.
    const maxRecords = options.maxRecords ?? AGGREGATE_MAX_RECORDS;
    const pageSize = options.pageSize ?? AGGREGATE_PAGE_SIZE;
    const walked = await walkWithNext(adapter, entityId, base, { maxRecords, pageSize });
    return { value: walked.items.length, partial: walked.hasMore, read: walked.items.length, total: walked.items.length };
  }
  const maxRecords = options.maxRecords ?? AGGREGATE_MAX_RECORDS;
  const pageSize = options.pageSize ?? AGGREGATE_PAGE_SIZE;
  const acc = accumulator(measure);
  let read = 0;
  let total = 0;
  while (read < maxRecords) {
    const page = await adapter.find(entityId, { ...base, page: { offset: read, limit: Math.min(pageSize, maxRecords - read) } });
    for (const record of page.items) acc.add(record.values);
    read += page.items.length;
    total = page.total ?? read; // RFC 0007: card 34h (no total: the pages are not followed by `next` yet)
    if (page.items.length === 0 || read >= total) break;
  }
  return { value: acc.result(), partial: total > read, read, total };
}

/** How a series groups records: one field, its type read from the entity, dates optionally bucketed. */
export interface SeriesSpec {
  readonly groupBy: { readonly field: string; readonly type: "select" | "boolean" | "reference" | "text" | "date"; readonly bucket?: SeriesBucket };
  readonly measure: Measure;
  readonly sort?: { readonly by: SeriesSortBy; readonly dir: SeriesSortDir };
  /** Groups kept; defaults to SERIES_LIMIT_DEFAULT (50). Values above SERIES_LIMIT_MAX (200) are clamped. */
  readonly limit?: number;
}

/** One group of a series: its key and the measure's value over the records that carry it. */
export interface SeriesGroup {
  /** The group's exact field value, or the bucket's date/period (RFC 0001 slice 2, decision 3). */
  readonly key: string;
  /** undefined for a gap bucket of min, max or avg; a number otherwise (gap count/sum/countDistinct are 0). */
  readonly value: number | undefined;
}

export interface SeriesResult {
  readonly groups: readonly SeriesGroup[];
  /** Records with no group value: in no group, and counted by no measure (decision 4). */
  readonly skipped: number;
  /** Set when the table holds more records than were read; the groups then cover only `read` of `total`. */
  readonly partial?: { readonly read: number; readonly total: number };
}

export type AggregateSeriesOptions = AggregateOptions;

/** A group value is empty when it is missing, null or blank — the same emptiness every measure uses. */
const groupKey = (values: RecordValues, field: string): string | undefined => {
  const v = values[field];
  if (v === null || v === undefined) return undefined;
  const s = typeof v === "string" ? v : v === true ? "true" : v === false ? "false" : String(v);
  return s === "" ? undefined : s;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Monday of the ISO week containing `date` (calendar arithmetic; dates are calendar dates, so no time zones). */
export function isoWeekMonday(date: Date): string {
  const dow = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - dow);
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

/** The bucket key a date value falls into: day = itself, week = its ISO Monday, month = `YYYY-MM`. A malformed date joins no group. */
function bucketKey(value: string, bucket: SeriesBucket): string | undefined {
  if (!isIsoDate(value)) return undefined;
  if (bucket === "month") return value.slice(0, 7);
  if (bucket === "week") return isoWeekMonday(new Date(`${value}T00:00:00Z`));
  return value;
}

const monthAdd = (ym: string, n: number): string => {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${pad2((total % 12) + 1)}`;
};

const dayAdd = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/** Every bucket key from the first to the last, stepping the calendar (RFC 0001 slice 2, decision 5). */
function bucketRange(from: string, to: string, bucket: SeriesBucket): string[] {
  if (bucket === "month") {
    const keys: string[] = [];
    for (let cur = from; cur <= to && keys.length < SERIES_LIMIT_MAX; cur = monthAdd(cur, 1)) keys.push(cur);
    return keys;
  }
  const step = bucket === "week" ? 7 : 1;
  const keys: string[] = [];
  for (let cur = from; cur <= to && keys.length < SERIES_LIMIT_MAX; cur = dayAdd(cur, step)) keys.push(cur);
  return keys;
}

const compareGroup = (dir: SeriesSortDir) => (a: SeriesGroup, b: SeriesGroup): number => {
  const by = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  return dir === "asc" ? by : -by;
};

/**
 * Groups an entity's records and folds `measure` per group. Paging, the 500/5000
 * ceiling and `partial` are the same as `aggregate`'s; each record feeds exactly
 * one group's accumulator, so memory stays groups-plus-ceiling no matter the data.
 * Records with no group value join no group and increment `skipped` (decision 4).
 * A date series sorted by group gets every bucket between the first and last
 * filled in: 0 for count/sum/countDistinct, undefined for min/max/avg (decision 5);
 * `limit` then keeps the newest N. The result holds no formatting, no labels and
 * no chart — the renderer and `widgets.series` own those.
 */
export async function aggregateSeries(adapter: DataAdapter, entityId: string, spec: SeriesSpec, options: AggregateSeriesOptions = {}): Promise<SeriesResult> {
  const filter = options.filter ? resolveRelativeDates(options.filter, options.now) : undefined;
  const base = filter ? { filter } : {};
  const maxRecords = options.maxRecords ?? AGGREGATE_MAX_RECORDS;
  const pageSize = options.pageSize ?? AGGREGATE_PAGE_SIZE;
  const accumulators = new Map<string, Accumulator>();
  const accFor = (key: string): Accumulator => {
    let acc = accumulators.get(key);
    if (!acc) {
      acc = accumulator(spec.measure);
      accumulators.set(key, acc);
    }
    return acc;
  };

  let read = 0;
  let total = 0;
  let skipped = 0;
  const addAll = (records: readonly RecordValues[]): void => {
    for (const values of records) {
      const raw = groupKey(values, spec.groupBy.field);
      if (raw === undefined) {
        skipped += 1;
        continue;
      }
      const key = spec.groupBy.type === "date" ? bucketKey(raw, spec.groupBy.bucket ?? "day") : raw;
      if (key === undefined) {
        skipped += 1; // a malformed date buckets into nothing
        continue;
      }
      accFor(key).add(values);
    }
  };

  if (spec.measure.op === "count") {
    // The count request first: a server that counts answers without sending rows.
    const first = await adapter.find(entityId, { ...base, page: { offset: 0, limit: 0 } });
    if (first.total !== undefined) {
      total = first.total;
      if (total > 0) {
        // The total says how many records exist, but grouping needs every row.
        while (read < maxRecords) {
          const page = await adapter.find(entityId, { ...base, page: { offset: read, limit: Math.min(pageSize, maxRecords - read) } });
          addAll(page.items.map((r) => r.values));
          read += page.items.length;
          if (page.items.length === 0 || read >= total) break;
        }
      }
    } else {
      const walked = await walkWithNext(adapter, entityId, base, { maxRecords, pageSize });
      addAll(walked.items.map((r) => r.values));
      read = walked.items.length;
      total = read; // no total to know; same reporting as `aggregate`
      if (walked.hasMore) total = read + 1; // partial: more rows exist past the ceiling
    }
  } else {
    while (read < maxRecords) {
      const page = await adapter.find(entityId, { ...base, page: { offset: read, limit: Math.min(pageSize, maxRecords - read) } });
      addAll(page.items.map((r) => r.values));
      read += page.items.length;
      total = page.total ?? read;
      if (page.items.length === 0 || read >= total) break;
    }
  }
  const partial = total > read ? { read, total } : undefined;

  const by = spec.sort?.by ?? "group";
  const dir = spec.sort?.dir ?? "asc";
  const groups: SeriesGroup[] = [...accumulators.entries()].map(([key, acc]) => ({ key, value: acc.result() as number | undefined }));

  const bucket = spec.groupBy.bucket ?? "day";
  const gapFill = spec.groupBy.type === "date" && by === "group"; // decision 5: a date series sorted by group; `day` counts as a bucket
  if (gapFill) {
    const sorted = [...groups].sort(compareGroup("asc"));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first && last) {
      // A gap carries 0 for count/sum/countDistinct and no value for min/max/avg (decision 5).
      const gapValue: number | undefined = spec.measure.op === "min" || spec.measure.op === "max" || spec.measure.op === "avg" ? undefined : 0;
      const filled: SeriesGroup[] = [];
      for (const key of bucketRange(first.key, last.key, bucket)) {
        const existing = accumulators.get(key);
        filled.push(existing ? { key, value: existing.result() as number | undefined } : { key, value: gapValue });
      }
      groups.length = 0;
      groups.push(...filled);
    }
  }

  if (by === "value") {
    groups.sort((a, b) => {
      const av = a.value ?? -Infinity;
      const bv = b.value ?? -Infinity;
      return dir === "asc" ? av - bv || (a.key < b.key ? -1 : 1) : bv - av || (a.key < b.key ? -1 : 1);
    });
  } else {
    groups.sort(compareGroup(dir));
  }

  const limit = Math.min(spec.limit ?? SERIES_LIMIT_DEFAULT, SERIES_LIMIT_MAX);
  // A date series is chronological, so a cap keeps the *newest* buckets (decision 5);
  // every other cap keeps the first N of the sort the reader asked for.
  const kept = spec.groupBy.type === "date" && by === "group" ? groups.slice(-limit) : groups.slice(0, limit);
  return { groups: kept, skipped, ...(partial ? { partial } : {}) };
}
