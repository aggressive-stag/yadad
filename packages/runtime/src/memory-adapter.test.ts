import { describe, expect, test } from "vitest";
import { createMemoryAdapter } from "./memory-adapter";

describe("memory adapter", () => {
  test("create stores the record with its entity revision", async () => {
    const db = createMemoryAdapter();
    const record = await db.create("hello", { name: "Ada" }, { entityRevision: 3 });
    expect(record).toEqual({ id: "1", entityId: "hello", entityRevision: 3, values: { name: "Ada" } });
    expect(await db.findOne("hello", "1")).toEqual(record);
  });

  test("find pages and counts per entity", async () => {
    const db = createMemoryAdapter();
    for (const name of ["a", "b", "c"]) await db.create("hello", { name }, { entityRevision: 1 });
    await db.create("other", { name: "x" }, { entityRevision: 1 });
    const page = await db.find("hello", { page: { offset: 1, limit: 1 } });
    expect(page.total).toBe(3);
    expect(page.items.map((r) => r.values["name"])).toEqual(["b"]);
    expect((await db.find("hello", {})).items).toHaveLength(3);
  });

  test("update merges values and records the new revision", async () => {
    const db = createMemoryAdapter();
    const { id } = await db.create("hello", { name: "Ada", note: "x" }, { entityRevision: 1 });
    const updated = await db.update("hello", id, { name: "Grace" }, { entityRevision: 2 });
    expect(updated.values).toEqual({ name: "Grace", note: "x" });
    expect(updated.entityRevision).toBe(2);
    await expect(db.update("hello", "nope", {}, { entityRevision: 2 })).rejects.toThrow('No "hello" record');
  });

  test("delete removes the record", async () => {
    const db = createMemoryAdapter();
    const { id } = await db.create("hello", { name: "Ada" }, { entityRevision: 1 });
    await db.delete("hello", id);
    expect(await db.findOne("hello", id)).toBeNull();
  });
});
