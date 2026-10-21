import { RecordConflictError, validateDocuments } from "@yadad/core";
import type { Query } from "@yadad/core";
import { expect, test } from "vitest";
import { ForbiddenError } from "@yadad/core";
import { reviewDocuments, reviewStore } from "./review";

const store = (role: "editor" | "owner") => reviewStore(() => role);

const rows = async (adapter: ReturnType<typeof store>["adapter"], entity: string, query: Query) => (await adapter.find(entity, query)).items;

const findVersion = async (adapter: ReturnType<typeof store>["adapter"], key: string, version: number) => {
  const items = await rows(adapter, "record_version", { filter: { op: "and", conditions: [{ op: "eq", field: "key", value: key }, { op: "eq", field: "version", value: version }] } });
  const record = items[0];
  if (record === undefined) throw new Error(`no seeded version ${key} v${version}`);
  return record;
};

const findDecision = async (adapter: ReturnType<typeof store>["adapter"], code: string) => {
  const items = await rows(adapter, "decision", { filter: { op: "eq", field: "code", value: code } });
  const record = items[0];
  if (record === undefined) throw new Error(`no seeded decision ${code}`);
  return record;
};

test("the review documents validate as a set", async () => {
  const result = validateDocuments(reviewDocuments);
  expect(result.ok === true ? [] : result.errors.map((e) => `${e.document ?? e.path}: ${e.message} ${e.hint}`)).toEqual([]);
});

test("changes are paged by cursor, like a server that never counts", async () => {
  const { adapter } = store("owner");
  const first = await adapter.find("record_version", {
    filter: { op: "in", field: "state", values: ["superseded", "deleted"] },
    page: { offset: 0, limit: 8 },
  });
  expect(first.items).toHaveLength(8);
  expect(first.total).toBeUndefined(); // cursor paging: no count
  expect(first.next).toBeTruthy();
  const second = await adapter.find("record_version", {
    filter: { op: "in", field: "state", values: ["superseded", "deleted"] },
    page: { cursor: first.next ?? "", limit: 8 },
  });
  expect(second.items.length).toBeGreaterThan(0);
  expect(second.items.some((r) => first.items.some((f) => f.id === r.id))).toBe(false);
  // 15 notes x 2 superseded + 1 deleted: enough rows that the pager has work.
  let pages = 2; // first and second are already fetched
  let cursor = second.next;
  while (cursor) {
    const page = await adapter.find("record_version", { filter: { op: "in", field: "state", values: ["superseded", "deleted"] }, page: { cursor, limit: 8 } });
    cursor = page.next;
    pages += 1;
  }
  expect(pages).toBeGreaterThanOrEqual(4);
});

test("the change rows carry kind, author and a body to compare with its previous body", async () => {
  const { adapter } = store("owner");
  const items = await rows(adapter, "record_version", { filter: { op: "eq", field: "state", value: "superseded" }, page: { offset: 0, limit: 8 } });
  const row = items.find((r) => r.values["previous_body"] !== undefined && r.values["previous_body"] !== r.values["body"]);
  expect(row?.values["kind"]).toMatch(/edit|retire/);
  expect(typeof row?.values["author"]).toBe("string");
});

test("restore_version makes a version current and demotes the one it replaced", async () => {
  const { adapter } = store("owner");
  const old = await findVersion(adapter, "note_9", 2);
  const current = await findVersion(adapter, "note_9", 3);
  expect(current.values["is_current"]).toBe(true);

  const after = await adapter.act?.("record_version", old.id, "restore_version", { meta: { entityRevision: 1, baseVersion: old.version } });
  expect(after?.values["state"]).toBe("current");
  expect(after?.values["is_current"]).toBe(true);

  const demoted = await findVersion(adapter, "note_9", 3);
  expect(demoted.values["state"]).toBe("superseded");
  expect(demoted.values["is_current"]).toBe(false);
});

test("apply belongs to the owner; an editor pressing it gets a 403", async () => {
  const editor = store("editor");
  const record = await findDecision(editor.adapter, "DEC-101");
  await expect(editor.adapter.act?.("decision", record.id, "apply", { meta: { entityRevision: 1, baseVersion: record.version } })).rejects.toBeInstanceOf(ForbiddenError);

  const owner = store("owner");
  const target = await findDecision(owner.adapter, "DEC-101");
  const applied = await owner.adapter.act?.("decision", target.id, "apply", { meta: { entityRevision: 1, baseVersion: target.version } });
  expect(applied?.values["state"]).toBe("applied");
  expect(typeof applied?.values["decided_at"]).toBe("string");
  expect(applied?.values["decided_by"]).toBe("role:owner");
});

test("reject keeps an optional reason; without input the reason stays empty", async () => {
  const owner = store("owner");
  const first = await findDecision(owner.adapter, "DEC-102");
  const rejected = await owner.adapter.act?.("decision", first.id, "reject", { input: { reason: "The club still needs it" }, meta: { entityRevision: 1, baseVersion: first.version } });
  expect(rejected?.values["state"]).toBe("rejected");
  expect(rejected?.values["reject_reason"]).toBe("The club still needs it");

  const second = await findDecision(owner.adapter, "DEC-103");
  const bare = await owner.adapter.act?.("decision", second.id, "reject", { meta: { entityRevision: 1, baseVersion: second.version } });
  expect(bare?.values["state"]).toBe("rejected");
  expect(bare?.values["reject_reason"]).toBeNull();
});

test("restore moves a decided decision back to pending and clears the decision fields", async () => {
  const owner = store("owner");
  const applied = await findDecision(owner.adapter, "DEC-104");
  expect(applied.values["state"]).toBe("applied");
  const back = await owner.adapter.act?.("decision", applied.id, "restore", { meta: { entityRevision: 1, baseVersion: applied.version } });
  expect(back?.values["state"]).toBe("pending");
  expect(back?.values["decided_at"]).toBeNull();
  expect(back?.values["decided_by"]).toBeNull();
  expect(back?.values["reject_reason"]).toBeNull();
});

test("simulateAnotherEditor makes the next press a 409, as a concurrent write would", async () => {
  const owner = store("owner");
  const decision = await findDecision(owner.adapter, "DEC-101");
  await owner.simulateAnotherEditor("decision", decision.id);
  await expect(owner.adapter.act?.("decision", decision.id, "apply", { meta: { entityRevision: 1, baseVersion: decision.version } })).rejects.toBeInstanceOf(RecordConflictError);

  // The same record, freshly read, acts fine again: the conflict is the stale guard, not a broken handler.
  const fresh = await findDecision(owner.adapter, "DEC-101");
  const applied = await owner.adapter.act?.("decision", fresh.id, "apply", { meta: { entityRevision: 1, baseVersion: fresh.version } });
  expect(applied?.values["state"]).toBe("applied");
});
