import type { EntityDocument } from "@yadad/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearDrafts, createDraftStore, resetDraftWarning, restoreDraft } from "./drafts.js";
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
    // invalidFields joined the shape (card 44c): values the schema now rejects
    // come back flagged; a clean draft restores with none.
    const restored = restoreDraft(entity, { values: { name: "Ada", nickname: "A" }, entityRevision: 1, savedAt: 5 });
    expect(restored).toEqual({ values: { name: "Ada" }, invalidFields: [], savedAt: 5, revisionChanged: true, droppedFields: ["nickname"], recordChanged: false });
  });

  test("returns null when nothing fits any more", () => {
    expect(restoreDraft(entity, { values: { gone: 1 }, entityRevision: 2, savedAt: 5 })).toBeNull();
  });

  test("keeps values the schema now rejects and flags them instead of dropping them", () => {
    // The fitnotes case: storage went stale, a draft's typed text no longer fits.
    // The text is the user's work — restore it AND flag it, never silently drop.
    const restored = restoreDraft(entity, { values: { name: "Ada", age: "thirty" }, entityRevision: 2, savedAt: 5 });
    expect(restored?.values).toEqual({ name: "Ada", age: "thirty" });
    expect(restored?.invalidFields).toEqual([
      { path: "/age", code: "type", message: '"Age" must be a number.', hint: "Enter a number." },
    ]);
  });

  test("an absent required value is NOT flagged at restore (the submit path reports it)", () => {
    const strict: EntityDocument = { ...entity, fields: [{ id: "name", type: "text", label: "Name", required: true }] };
    const restored = restoreDraft(strict, { values: { name: "Ada" }, entityRevision: 2, savedAt: 5 });
    expect(restored?.invalidFields).toEqual([]);
  });

  test("a draft where only a rejected value remains still restores (flagged, not lost)", () => {
    // The drop-everything path must NOT trigger for an invalid-but-typed value:
    // "nothing left to restore" means no keys, not no valid keys.
    const restored = restoreDraft(entity, { values: { age: "thirty" }, entityRevision: 2, savedAt: 5 });
    expect(restored?.values).toEqual({ age: "thirty" });
    expect(restored?.invalidFields.length).toBe(1);
  });

  test("flags a record saved elsewhere since the draft was taken", () => {
    const draft = { values: { name: "Ada" }, entityRevision: 2, savedAt: 5, recordVersion: "v1" };
    expect(restoreDraft(entity, draft, "v1")?.recordChanged).toBe(false);
    expect(restoreDraft(entity, draft, "v2")?.recordChanged).toBe(true);
  });
});

describe("drafts scoped to a user", () => {
  const draft = { values: { name: "x" }, entityRevision: 1, savedAt: 1 };
  const warnSpy = vi.fn();
  function listable() {
    const m = memoryStorage();
    return {
      ...m,
      get length() {
        return m.data.size;
      },
      key: (i: number) => [...m.data.keys()][i] ?? null,
    };
  }
  beforeEach(() => {
    resetDraftWarning();
    warnSpy.mockClear();
    vi.stubGlobal("console", { warn: warnSpy });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("scoped stores do not see each other", () => {
    const s = memoryStorage();
    const a = createDraftStore(s, { scope: "a" });
    const b = createDraftStore(s, { scope: "b" });
    a.save("f", undefined, draft);
    expect(a.load("f")).not.toBeNull();
    expect(b.load("f")).toBeNull();
    expect(createDraftStore(s, { scope: "a:b" }).load("f")).toBeNull();
  });

  test("clearDrafts with a scope removes only that scope; store.clear() clears its own", () => {
    const s = listable();
    const a = createDraftStore(s, { scope: "a" });
    const b = createDraftStore(s, { scope: "b" });
    a.save("f", undefined, draft);
    b.save("f", undefined, draft);
    clearDrafts(s, { scope: "a" });
    expect(a.load("f")).toBeNull();
    expect(b.load("f")).not.toBeNull();
    b.clear();
    expect(b.load("f")).toBeNull();
  });

  test("clearDrafts without a scope removes all drafts, legacy keys too, and leaves other keys", () => {
    const s = listable();
    s.setItem("yadad:draft:f:new", JSON.stringify(draft));
    createDraftStore(s, { scope: "a" }).save("f", "r1", draft);
    s.setItem("theme", "dark");
    clearDrafts(s);
    expect([...s.data.keys()]).toEqual(["theme"]);
  });

  test("a storage that cannot list keys clears what the stores wrote", () => {
    const s = memoryStorage();
    createDraftStore(s, { scope: "a" }).save("f", undefined, draft);
    clearDrafts(s);
    expect(s.data.size).toBe(0);
  });

  test("the old (storage, prefix) signature still works", () => {
    const s = memoryStorage();
    const store = createDraftStore(s, "app");
    store.save("f", undefined, draft);
    expect([...s.data.keys()]).toEqual(["app:draft:f:new"]);
    expect(store.load("f")).not.toBeNull();
    store.clear("f");
    expect(s.data.size).toBe(0);
  });

  test("an unscoped store warns once; a scoped one does not", () => {
    const s = memoryStorage();
    createDraftStore(s, { scope: "a" });
    expect(warnSpy).not.toHaveBeenCalled();
    createDraftStore(s);
    createDraftStore(s, "p");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
