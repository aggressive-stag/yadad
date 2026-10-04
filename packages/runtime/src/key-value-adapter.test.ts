import { describe, expect, test } from "vitest";
import { createKeyValueAdapter } from "./key-value-adapter";
import type { KeyValueStore } from "./key-value-adapter";

const mapStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("key-value adapter", () => {
  test("records survive a new adapter on the same store (a page reload)", async () => {
    const store = mapStore();
    const first = createKeyValueAdapter(store, "app");
    const a = await first.create("set", { exercise: "Squat", weight: 100 }, { entityRevision: 2 });
    await first.create("set", { exercise: "Bench", weight: 80 }, { entityRevision: 2 });
    await first.update("set", a.id, { weight: 102.5 }, { entityRevision: 3 });

    const reloaded = createKeyValueAdapter(store, "app");
    const page = await reloaded.find("set", { sort: [{ field: "weight", dir: "desc" }], filter: { op: "neq", field: "exercise", value: "Deadlift" } });
    expect(page.items.map((r) => [r.values["exercise"], r.values["weight"], r.entityRevision])).toEqual([
      ["Squat", 102.5, 3],
      ["Bench", 80, 2],
    ]);
    await reloaded.delete("set", a.id);
    expect((await createKeyValueAdapter(store, "app").find("set", {})).total).toBe(1);
    expect([...store.data.keys()]).toEqual(["app:records:set"]);
  });

  test("ids stay unique across adapters and prefixes keep apps apart", async () => {
    const store = mapStore();
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const adapter = createKeyValueAdapter(store, "app");
      for (let j = 0; j < 3; j++) ids.add((await adapter.create("set", {}, { entityRevision: 1 })).id);
    }
    expect(ids.size).toBe(9);
    expect((await createKeyValueAdapter(store, "other").find("set", {})).total).toBe(0);
  });

  test("unreadable stored data is reported and left alone", async () => {
    const store = mapStore();
    store.setItem("app:records:set", "{ broken");
    const adapter = createKeyValueAdapter(store, "app");
    await expect(adapter.find("set", {})).rejects.toThrow('are not valid JSON (key "app:records:set"); they were left untouched');
    await expect(adapter.create("set", {}, { entityRevision: 1 })).rejects.toThrow("not valid JSON");
    expect(store.getItem("app:records:set")).toBe("{ broken");
  });

  test("a full store surfaces as a failed save", async () => {
    const adapter = createKeyValueAdapter(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      "app",
    );
    await expect(adapter.create("set", {}, { entityRevision: 1 })).rejects.toThrow("QuotaExceededError");
  });
});
