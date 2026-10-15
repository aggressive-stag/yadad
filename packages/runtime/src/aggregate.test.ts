import type { DataAdapter, Measure, RecordValues } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { aggregate, computeMeasure } from "./aggregate.js";
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
});
