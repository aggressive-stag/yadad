import type { Condition, DataAdapter, FieldValue, Measure, RecordValues } from "@yadad/core";
import { resolveRelativeDates } from "./condition.js";

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
    const { total } = await adapter.find(entityId, { ...base, page: { offset: 0, limit: 0 } });
    return { value: total, partial: false, read: total, total };
  }
  const maxRecords = options.maxRecords ?? AGGREGATE_MAX_RECORDS;
  const pageSize = options.pageSize ?? AGGREGATE_PAGE_SIZE;
  const acc = accumulator(measure);
  let read = 0;
  let total = 0;
  while (read < maxRecords) {
    const page = await adapter.find(entityId, { ...base, page: { offset: read, limit: Math.min(pageSize, maxRecords - read) } });
    total = page.total;
    for (const record of page.items) acc.add(record.values);
    read += page.items.length;
    if (page.items.length === 0 || read >= total) break;
  }
  return { value: acc.result(), partial: total > read, read, total };
}
