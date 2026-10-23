import type { DataAdapter, Measure, RecordValues } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { aggregate, aggregateSeries, computeMeasure } from "./aggregate.js";
import { createMemoryAdapter } from "./memory-adapter.js";

const sets: RecordValues[] = [
  { day: "2026-10-01", weight: 100, reps: 5, warmup: false },
  { day: "2026-10-01", weight: 60, reps: 10, warmup: true },
  { day: "2026-10-03", weight: 102.5, reps: 5, warmup: false },
  { day: "2026-10-03", weight: null, reps: 8, warmup: false },
];

async function seeded(rows: readonly RecordValues[] = sets): Promise<DataAdapter> {
  const db = createMemoryAdapter();
  for (const values of rows) await db.create("set", values, { entityRevision: 1 });
  return db;
}

/** A store of `count` numbered rows served by a counting-free server (RFC 0007 `paging: "cursor"`). */
async function seededCursor(count: number): Promise<DataAdapter> {
  const db = createMemoryAdapter({ paging: "cursor" });
  for (const values of numbered(count)) await db.create("set", values, { entityRevision: 1 });
  return db;
}

const numbered = (count: number): RecordValues[] => Array.from({ length: count }, (_, i) => ({ n: i }));

describe("computeMeasure", () => {
  const run = (measure: Measure, rows: readonly RecordValues[] = sets) => computeMeasure(rows, measure);
  test("count counts every record, even with empty values", () => expect(run({ op: "count" })).toBe(4));
  test("sum skips empty values", () => expect(run({ op: "sum", field: "weight" })).toBe(262.5));
  test("sum of a product skips records missing either operand", () => {
    expect(run({ op: "sum", product: ["weight", "reps"] })).toBe(100 * 5 + 60 * 10 + 102.5 * 5);
  });
  test("avg is over the records that have a value", () => {
    expect(run({ op: "avg", field: "weight" })).toBeCloseTo(262.5 / 3);
    expect(run({ op: "avg", product: ["weight", "reps"] })).toBeCloseTo((500 + 600 + 512.5) / 3);
  });
  test("min and max work on numbers and on dates", () => {
    expect(run({ op: "min", field: "weight" })).toBe(60);
    expect(run({ op: "max", field: "weight" })).toBe(102.5);
    expect(run({ op: "min", field: "day" })).toBe("2026-10-01");
    expect(run({ op: "max", field: "day" })).toBe("2026-10-03");
  });
  test("countDistinct ignores empty values and keeps types apart", () => {
    expect(run({ op: "countDistinct", field: "day" })).toBe(2);
    expect(run({ op: "countDistinct", field: "weight" })).toBe(3);
    expect(run({ op: "countDistinct", field: "x" }, [{ x: 1 }, { x: "1" }, { x: "" }, { x: null }])).toBe(2);
  });
  test("no records: 0 for count, sum, countDistinct; undefined for min, max, avg", () => {
    expect(run({ op: "count" }, [])).toBe(0);
    expect(run({ op: "sum", field: "weight" }, [])).toBe(0);
    expect(run({ op: "sum", product: ["weight", "reps"] }, [])).toBe(0);
    expect(run({ op: "countDistinct", field: "day" }, [])).toBe(0);
    expect(run({ op: "min", field: "weight" }, [])).toBeUndefined();
    expect(run({ op: "max", field: "day" }, [])).toBeUndefined();
    expect(run({ op: "avg", field: "weight" }, [])).toBeUndefined();
  });
  test("records with only empty values count like no records for min, max and avg", () => {
    expect(run({ op: "avg", field: "weight" }, [{ weight: null }, {}])).toBeUndefined();
    expect(run({ op: "sum", field: "weight" }, [{ weight: null }, {}])).toBe(0);
  });
});

describe("aggregate through the adapter", () => {
  test("applies the filter and reports the value", async () => {
    const db = await seeded();
    const result = await aggregate(db, "set", { op: "sum", product: ["weight", "reps"] }, { filter: { op: "eq", field: "warmup", value: false } });
    expect(result).toEqual({ value: 1012.5, partial: false, read: 3, total: 3 });
  });

  test("count reads only the total", async () => {
    const calls: unknown[] = [];
    const db = await seeded();
    const spy: DataAdapter = { ...db, find: (e, q) => (calls.push(q), db.find(e, q)) };
    expect(await aggregate(spy, "set", { op: "count" })).toMatchObject({ value: 4, partial: false });
    expect(calls).toEqual([{ page: { offset: 0, limit: 0 } }]);
  });

  test("resolves relative dates before the adapter sees them", async () => {
    const db = await seeded();
    const seen: unknown[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (seen.push(q.filter), db.find(e, q)) };
    const now = new Date(2026, 9, 3, 12);
    const result = await aggregate(spy, "set", { op: "countDistinct", field: "day" }, { filter: { op: "gte", field: "day", value: { daysFromToday: 0 } }, now });
    expect(seen).toEqual([{ op: "gte", field: "day", value: "2026-10-03" }]);
    expect(result.value).toBe(1);
  });

  test("empty data", async () => {
    const db = await seeded([]);
    expect((await aggregate(db, "set", { op: "count" })).value).toBe(0);
    expect((await aggregate(db, "set", { op: "sum", field: "weight" }))).toEqual({ value: 0, partial: false, read: 0, total: 0 });
    expect((await aggregate(db, "set", { op: "avg", field: "weight" })).value).toBeUndefined();
    expect((await aggregate(db, "set", { op: "min", field: "day" })).value).toBeUndefined();
  });

  test("pages 500 at a time and stops at the 5000 ceiling with partial", async () => {
    const rows = Array.from({ length: 5200 }, (_, i) => ({ n: 1, i }));
    const db = await seeded(rows);
    const limits: number[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (limits.push(q.page?.limit ?? -1), db.find(e, q)) };
    const result = await aggregate(spy, "set", { op: "sum", field: "n" });
    expect(result).toEqual({ value: 5000, partial: true, read: 5000, total: 5200 });
    expect(limits).toHaveLength(10);
    expect(new Set(limits)).toEqual(new Set([500]));
  });

  test("exactly the ceiling is not partial; a smaller page size works", async () => {
    const db = await seeded(Array.from({ length: 12 }, () => ({ n: 2 })));
    expect(await aggregate(db, "set", { op: "sum", field: "n" }, { maxRecords: 12, pageSize: 5 })).toEqual({ value: 24, partial: false, read: 12, total: 12 });
    expect(await aggregate(db, "set", { op: "sum", field: "n" }, { maxRecords: 10, pageSize: 5 })).toEqual({ value: 20, partial: true, read: 10, total: 12 });
  });

  test("an adapter failure rejects", async () => {
    const db = await seeded();
    const broken: DataAdapter = { ...db, find: () => Promise.reject(new Error("down")) };
    await expect(aggregate(broken, "set", { op: "sum", field: "weight" })).rejects.toThrow("down");
  });

  // RFC 0007: a server that never counts answers `limit=0` with no `total`,
  // so `count` walks the pages instead and reports what it read.
  test("count without a total walks the pages and reports what it read", async () => {
    const db = await seededCursor(1200);
    const result = await aggregate(db, "set", { op: "count" });
    expect(result).toEqual({ value: 1200, partial: false, read: 1200, total: 1200 });
  });

  test("count without a total is partial at the 5000 ceiling", async () => {
    const db = await seededCursor(5200);
    const limits: number[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (limits.push(q.page?.limit ?? -1), db.find(e, q)) };
    const result = await aggregate(spy, "set", { op: "count" });
    expect(result).toEqual({ value: 5000, partial: true, read: 5000, total: 5000 });
    expect(limits).toEqual([0, ...Array.from({ length: 10 }, () => 500)]); // the count request, then the walk
  });

  test("count without a total keeps the filter across the walk", async () => {
    const db = await seededCursor(30);
    const seen: unknown[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (seen.push(q.filter), db.find(e, q)) };
    const result = await aggregate(spy, "set", { op: "count" }, { filter: { op: "lte", field: "n", value: 1 }, pageSize: 4 });
    expect(result).toEqual({ value: 2, partial: false, read: 2, total: 2 });
    expect(seen.every((f) => JSON.stringify(f) === JSON.stringify({ op: "lte", field: "n", value: 1 }))).toBe(true);
  });
});

// RFC 0001 slice 2: the series widget's computation (card 43e). One test per card-43a decision.
describe("aggregateSeries", () => {
  const spec = (over: Partial<{ groupBy: { field: string; type: "select" | "boolean" | "reference" | "text" | "date"; bucket?: "day" | "week" | "month" }; measure: Measure; sort: { by: "group" | "value"; dir: "asc" | "desc" }; limit: number }>) => ({
    groupBy: over.groupBy ?? { field: "warmup", type: "boolean" as const },
    measure: over.measure ?? { op: "count" as const },
    ...(over.sort ? { sort: over.sort } : {}),
    ...(over.limit !== undefined ? { limit: over.limit } : {}),
  });
  const seed = async (rows: readonly RecordValues[]): Promise<DataAdapter> => seeded(rows);

  test("each measure op computes per group", async () => {
    const db = await seed(sets); // two warmup=false 10-01/10-03 pairs, one warmup=true, one null-weight
    const bool = { field: "warmup", type: "boolean" as const };
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "count" } }))).toEqual({ groups: [{ key: "false", value: 3 }, { key: "true", value: 1 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "sum", field: "weight" } }))).toEqual({ groups: [{ key: "false", value: 202.5 }, { key: "true", value: 60 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "sum", product: ["weight", "reps"] } }))).toEqual({ groups: [{ key: "false", value: 1012.5 }, { key: "true", value: 600 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "avg", field: "weight" } }))).toEqual({ groups: [{ key: "false", value: 101.25 }, { key: "true", value: 60 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "min", field: "weight" } }))).toEqual({ groups: [{ key: "false", value: 100 }, { key: "true", value: 60 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "max", field: "weight" } }))).toEqual({ groups: [{ key: "false", value: 102.5 }, { key: "true", value: 60 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: bool, measure: { op: "countDistinct", field: "day" } }))).toEqual({ groups: [{ key: "false", value: 2 }, { key: "true", value: 1 }], skipped: 0 });
  });

  test("a select or text groupBy keys groups by the exact value", async () => {
    const db = await seed([{ s: "heavy", n: 1 }, { s: "light", n: 2 }, { s: "heavy", n: 3 }]);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "s", type: "text" }, measure: { op: "sum", field: "n" } }))).toEqual({ groups: [{ key: "heavy", value: 4 }, { key: "light", value: 2 }], skipped: 0 });
  });

  test("a reference group key is the id, raw (decision 6: labels are the component's)", async () => {
    const db = await seed([{ ex: "push", n: 1 }, { ex: "pull", n: 2 }, { ex: "push", n: 3 }]);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "ex", type: "reference" }, measure: { op: "sum", field: "n" } }))).toEqual({ groups: [{ key: "pull", value: 2 }, { key: "push", value: 4 }], skipped: 0 });
  });

  test("records with no group value are skipped and counted, never in a measure (decision 4)", async () => {
    const db = await seed([{ g: "a", n: 1 }, { n: 5 }, { g: "", n: 2 }, { g: null, n: 3 }]);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "sum", field: "n" } }))).toEqual({ groups: [{ key: "a", value: 1 }], skipped: 3 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "count" } }))).toEqual({ groups: [{ key: "a", value: 1 }], skipped: 3 });
  });

  test("empty measure values inside a group follow slice 1's rules", async () => {
    const db = await seed([{ g: "a", n: 1 }, { g: "a", n: null }, { g: "a", n: 4 }]);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "avg", field: "n" } }))).toEqual({ groups: [{ key: "a", value: 2.5 }], skipped: 0 });
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "min", field: "n" } }))).toEqual({ groups: [{ key: "a", value: 1 }], skipped: 0 });
  });

  test("week buckets are ISO Mondays and cross the year boundary (decision 3)", async () => {
    const db = await seed([{ day: "2026-01-01" }, { day: "2025-12-29" }, { day: "2026-01-05" }, { day: "2026-01-04" }]); // Thu, Mon, Mon, Sun — three share the week of 2025-12-29
    const r = await aggregateSeries(db, "set", spec({ groupBy: { field: "day", type: "date", bucket: "week" }, measure: { op: "count" } }));
    expect(r).toEqual({ groups: [{ key: "2025-12-29", value: 3 }, { key: "2026-01-05", value: 1 }], skipped: 0 });
  });

  test("month buckets cross the year boundary and fill gaps", async () => {
    const db = await seed([{ day: "2025-12-15" }, { day: "2026-02-02" }]);
    const r = await aggregateSeries(db, "set", spec({ groupBy: { field: "day", type: "date", bucket: "month" }, measure: { op: "count" } }));
    expect(r).toEqual({ groups: [{ key: "2025-12", value: 1 }, { key: "2026-01", value: 0 }, { key: "2026-02", value: 1 }], skipped: 0 });
  });

  test("a malformed date joins no group and is skipped", async () => {
    const db = await seed([{ day: "2026-13-45" }, { day: "2026-01-02" }]);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "day", type: "date", bucket: "week" }, measure: { op: "count" } }))).toEqual({ groups: [{ key: "2025-12-29", value: 1 }], skipped: 1 });
  });

  test("gap filling: 0 for count/sum/countDistinct, undefined for min/max/avg (decision 5)", async () => {
    const db = await seed([{ day: "2026-03-02", n: 4 }, { day: "2026-03-06", n: 6 }]); // Mon and Fri of the same week
    const week = { field: "day", type: "date" as const, bucket: "day" as const };
    const zero = (measure: Measure) => aggregateSeries(db, "set", spec({ groupBy: { ...week, bucket: "day" }, measure, sort: { by: "group", dir: "asc" } }));
    expect((await zero({ op: "count" })).groups).toEqual([{ key: "2026-03-02", value: 1 }, { key: "2026-03-03", value: 0 }, { key: "2026-03-04", value: 0 }, { key: "2026-03-05", value: 0 }, { key: "2026-03-06", value: 1 }]);
    expect((await zero({ op: "sum", field: "n" })).groups).toEqual([{ key: "2026-03-02", value: 4 }, { key: "2026-03-03", value: 0 }, { key: "2026-03-04", value: 0 }, { key: "2026-03-05", value: 0 }, { key: "2026-03-06", value: 6 }]);
    expect((await zero({ op: "countDistinct", field: "n" })).groups).toEqual([{ key: "2026-03-02", value: 1 }, { key: "2026-03-03", value: 0 }, { key: "2026-03-04", value: 0 }, { key: "2026-03-05", value: 0 }, { key: "2026-03-06", value: 1 }]);
    expect((await zero({ op: "avg", field: "n" })).groups).toEqual([{ key: "2026-03-02", value: 4 }, { key: "2026-03-03", value: undefined }, { key: "2026-03-04", value: undefined }, { key: "2026-03-05", value: undefined }, { key: "2026-03-06", value: 6 }]);
    expect((await zero({ op: "min", field: "n" })).groups).toEqual([{ key: "2026-03-02", value: 4 }, { key: "2026-03-03", value: undefined }, { key: "2026-03-04", value: undefined }, { key: "2026-03-05", value: undefined }, { key: "2026-03-06", value: 6 }]);
    // no gap fill: sort by value, non-date groupBy, or a bucketless day series
    const noFill = await aggregateSeries(db, "set", spec({ groupBy: week, measure: { op: "count" }, sort: { by: "value", dir: "desc" } }));
    expect(noFill.groups).toEqual([{ key: "2026-03-02", value: 1 }, { key: "2026-03-06", value: 1 }]);
    expect(noFill.groups.some((g) => g.key === "2026-03-03")).toBe(false);
  });

  test("sort by value desc puts the biggest group first; ties break by key", async () => {
    const db = await seed([{ g: "a", n: 1 }, { g: "b", n: 1 }, { g: "b", n: 1 }, { g: "c", n: 9 }]);
    const r = await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "sum", field: "n" }, sort: { by: "value", dir: "desc" } }));
    expect(r.groups).toEqual([{ key: "c", value: 9 }, { key: "b", value: 2 }, { key: "a", value: 1 }]);
  });

  test("limit keeps the first N of a sorted non-date series (decision 5)", async () => {
    const db = await seed([{ g: "a", n: 1 }, { g: "b", n: 2 }, { g: "c", n: 3 }]);
    const r = await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "sum", field: "n" }, sort: { by: "value", dir: "desc" }, limit: 2 }));
    expect(r.groups).toEqual([{ key: "c", value: 3 }, { key: "b", value: 2 }]);
  });

  test("a capped date series keeps the newest buckets, and the limit clamps at 200", async () => {
    const days = Array.from({ length: 8 }, (_, i) => ({ day: `2026-01-0${i + 1}` }));
    const db = await seed(days);
    const r = await aggregateSeries(db, "set", spec({ groupBy: { field: "day", type: "date" }, measure: { op: "count" }, limit: 3 }));
    expect(r.groups.map((g) => g.key)).toEqual(["2026-01-06", "2026-01-07", "2026-01-08"]);
    const many = Array.from({ length: 250 }, () => ({ day: "2025-01-01" }));
    const db2 = await seed(many);
    const clamped = await aggregateSeries(db2, "set", spec({ groupBy: { field: "day", type: "date" }, measure: { op: "count" }, limit: 9999 }));
    expect(clamped.groups).toHaveLength(1); // one bucket; the clamp only matters above 200 buckets
  });

  test("past the 5000-record ceiling the result is partial, like aggregate (decision 8)", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ g: `g${i % 7}`, n: 1 }));
    const db = await seed(rows);
    const limits: number[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (limits.push(q.page?.limit ?? -1), db.find(e, q)) };
    const r = await aggregateSeries(spy, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "sum", field: "n" } }));
    expect(r.partial).toEqual({ read: 5000, total: 5001 });
    expect(r.groups.reduce((s, g) => s + (g.value ?? 0), 0)).toBe(5000);
    expect(limits).toEqual(Array.from({ length: 10 }, () => 500));
  });

  test("count pages the counting server and walks the counting-free one", async () => {
    const rows = [{ g: "a" }, { g: "a" }, { g: "b" }];
    const db = await seed(rows);
    expect(await aggregateSeries(db, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "count" } }))).toEqual({ groups: [{ key: "a", value: 2 }, { key: "b", value: 1 }], skipped: 0 });
    const cursorDb = createMemoryAdapter({ paging: "cursor" });
    for (const values of Array.from({ length: 5200 }, (_, i) => ({ g: `g${i % 3}` }))) await cursorDb.create("set", values, { entityRevision: 1 });
    const r = await aggregateSeries(cursorDb, "set", spec({ groupBy: { field: "g", type: "text" }, measure: { op: "count" } }));
    expect(r.partial).toEqual({ read: 5000, total: 5001 });
    expect(r.groups.reduce((s, g) => s + (g.value ?? 0), 0)).toBe(5000);
  });

  test("the filter reaches the adapter with relative dates resolved", async () => {
    const db = await seeded();
    const seen: unknown[] = [];
    const spy: DataAdapter = { ...db, find: (e, q) => (seen.push(q.filter), db.find(e, q)) };
    const now = new Date(2026, 9, 3, 12);
    const r = await aggregateSeries(spy, "set", spec({ groupBy: { field: "warmup", type: "boolean" }, measure: { op: "count" } }), {
      filter: { op: "gte", field: "day", value: { daysFromToday: 0 } },
      now,
    });
    expect(seen.every((f) => JSON.stringify(f) === JSON.stringify({ op: "gte", field: "day", value: "2026-10-03" }))).toBe(true);
    expect(r.groups).toEqual([{ key: "false", value: 2 }]); // both 10-03 rows are warmup=false; the warmup row is on 10-01
  });

  test("an adapter failure rejects", async () => {
    const db = await seeded();
    const broken: DataAdapter = { ...db, find: () => Promise.reject(new Error("down")) };
    await expect(aggregateSeries(broken, "set", spec({ groupBy: { field: "warmup", type: "boolean" }, measure: { op: "count" } }))).rejects.toThrow("down");
  });
});
