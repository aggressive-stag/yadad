import type { EntityDocument } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { createDraftStore, restoreDraft } from "./drafts.js";
import type { DraftStorage } from "./drafts.js";

function memoryStorage(): DraftStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "contact",
  revision: 2,
  fields: [
    { id: "name", type: "text", label: "Name" },
    { id: "age", type: "number", label: "Age" },
  ],
};

describe("draft store", () => {
  test("saves, loads and clears a draft per form and record", () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage, "app");
    store.save("contact_form", undefined, { values: { name: "Ada" }, entityRevision: 2, savedAt: 1000 });
    store.save("contact_form", "r1", { values: { name: "Grace" }, entityRevision: 2, savedAt: 2000, recordVersion: "v1" });
    expect([...storage.data.keys()].sort()).toEqual(["app:draft:contact_form:new", "app:draft:contact_form:r1"]);
    expect(store.load("contact_form")).toEqual({ values: { name: "Ada" }, entityRevision: 2, savedAt: 1000 });
    expect(store.load("contact_form", "r1")?.recordVersion).toBe("v1");
    store.clear("contact_form");
    expect(store.load("contact_form")).toBeNull();
    expect(store.load("contact_form", "r1")).not.toBeNull();
  });

  test("corrupt or wrongly shaped entries read as no draft", () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage, "app");
    const bad = ["not json", "[]", '{"values":{"a":[1]},"entityRevision":1,"savedAt":1}', '{"values":{},"entityRevision":"1","savedAt":1}'];
    for (const raw of bad) {
      storage.data.set("app:draft:f:new", raw);
      expect(store.load("f")).toBeNull();
    }
  });

  test("storage that throws never breaks the form", () => {
    const fail = () => {
      throw new Error("storage disabled");
    };
    const store = createDraftStore({ getItem: fail, setItem: fail, removeItem: fail });
    expect(store.load("f")).toBeNull();
    expect(() => store.save("f", undefined, { values: { a: 1 }, entityRevision: 1, savedAt: 1 })).not.toThrow();
    expect(() => store.clear("f")).not.toThrow();
  });
});

describe("restoreDraft", () => {
  test("drops values of fields the entity no longer has and flags a new revision", () => {
    const restored = restoreDraft(entity, { values: { name: "Ada", nickname: "A" }, entityRevision: 1, savedAt: 5 });
    expect(restored).toEqual({ values: { name: "Ada" }, savedAt: 5, revisionChanged: true, droppedFields: ["nickname"], recordChanged: false });
  });

  test("returns null when nothing fits any more", () => {
    expect(restoreDraft(entity, { values: { gone: 1 }, entityRevision: 2, savedAt: 5 })).toBeNull();
  });

  test("flags a record saved elsewhere since the draft was taken", () => {
    const draft = { values: { name: "Ada" }, entityRevision: 2, savedAt: 5, recordVersion: "v1" };
    expect(restoreDraft(entity, draft, "v1")?.recordChanged).toBe(false);
    expect(restoreDraft(entity, draft, "v2")?.recordChanged).toBe(true);
  });
});
