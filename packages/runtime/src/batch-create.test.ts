import type { DataAdapter, EntityDocument } from "@yadad/core";
import { RecordValidationError } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { submitBatchCreate } from "./batch-create.js";
import { createMemoryAdapter } from "./memory-adapter.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "step",
  revision: 7,
  fields: [
    { id: "title", type: "text", label: "Step", required: true },
    { id: "ord", type: "number", label: "Order", min: 1 },
  ],
};

describe("submitBatchCreate (RFC 0009 item 4)", () => {
  test("writes every row through one batch call under the entity revision", async () => {
    const db = createMemoryAdapter();
    let calls = 0;
    let seenMeta: unknown;
    const spy: DataAdapter = {
      ...db,
      async batch(e, ops, meta) {
        calls += 1;
        seenMeta = meta;
        return db.batch(e, ops, meta);
      },
    };
    const result = await submitBatchCreate(entity, [{ title: "A" }, { title: "B", ord: 2 }], spy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(2);
    expect(calls).toBe(1);
    expect(seenMeta).toEqual({ entityRevision: 7 });
    const stored = await db.find("step", {});
    expect(stored.items.map((r) => r.values["title"])).toEqual(["A", "B"]);
  });

  test("an invalid row is reported at /rows/<i>/<field> and nothing is written", async () => {
    const db = createMemoryAdapter();
    let calls = 0;
    const spy: DataAdapter = {
      ...db,
      async batch(e, ops, meta) {
        calls += 1;
        return db.batch(e, ops, meta);
      },
    };
    const result = await submitBatchCreate(entity, [{ title: "Fine" }, { title: "" }, { title: "Bad", ord: 0 }], spy);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.path, e.code])).toEqual([
      ["/rows/1/title", "required"],
      ["/rows/2/ord", "invalid-value"],
    ]);
    expect(calls).toBe(0); // validation first: a bad row never reaches the adapter
    expect((await db.find("step", {})).items).toHaveLength(0);
  });

  test("an adapter that refuses the batch yields one form-level error, not partial rows", async () => {
    const db = createMemoryAdapter();
    const flaky: DataAdapter = {
      ...db,
      async batch() {
        throw new RecordValidationError("Some values were rejected.", [{ path: "/create/1/values/title", code: "required", message: "Step is required.", hint: "Fill in the step." }]);
      },
    };
    const result = await submitBatchCreate(entity, [{ title: "A" }, { title: "B" }], flaky);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect((await db.find("step", {})).items).toHaveLength(0); // all or nothing
  });
});
