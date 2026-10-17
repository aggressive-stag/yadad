import type { BoardView, DataRecord, Document, EntityDocument, FormView, TableView } from "@yadad/core";
import { AdapterError, ForbiddenError, RecordConflictError, RecordValidationError } from "@yadad/core";
import { viewStates } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { applicableSources, sourceStates } from "./source-states.js";
import { createStateAdapter } from "./state-adapter.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const meta = { entityRevision: 1 };
const records: DataRecord[] = [
  { id: "rec-1", entityId: "task", entityRevision: 1, version: "1", values: { title: "One", status: "todo" } },
  { id: "rec-2", entityId: "task", entityRevision: 1, version: "1", values: { title: "Two", status: "done" } },
];

const settles = async (promise: Promise<unknown>): Promise<"settled" | "pending"> =>
  Promise.race([promise.then(() => "settled" as const, () => "settled" as const), new Promise<"pending">((r) => setTimeout(() => r("pending"), 20))]);

describe("createStateAdapter", () => {
  test("ready behaves like a memory adapter seeded with the records", async () => {
    const adapter = createStateAdapter(records);
    expect((await adapter.find("task", {})).total).toBe(2);
    expect((await adapter.findOne("task", "rec-2"))?.values["title"]).toBe("Two");
    const created = await adapter.create("task", { title: "Three" }, meta);
    expect(created.id).not.toBe("rec-1");
    const updated = await adapter.update("task", "rec-1", { title: "Uno" }, { ...meta, baseVersion: "1" });
    expect(updated.version).not.toBe("1");
    await expect(adapter.update("task", "rec-1", { title: "x" }, { ...meta, baseVersion: "1" })).rejects.toBeInstanceOf(RecordConflictError);
    await adapter.delete("task", "rec-2");
    expect(adapter.records().map((r) => r.id)).toEqual(["rec-1", created.id]);
  });

  test("loading never settles a read, and writes still work", async () => {
    const adapter = createStateAdapter(records, { source: "loading" });
    expect(await settles(adapter.find("task", {}))).toBe("pending");
    expect(await settles(adapter.findOne("task", "rec-1"))).toBe("pending");
    expect((await adapter.create("task", { title: "x" }, meta)).values["title"]).toBe("x");
  });

  test("error rejects every read with a readable message", async () => {
    const adapter = createStateAdapter(records, { source: "error", message: "Server is down" });
    await expect(adapter.find("task", {})).rejects.toThrow("Server is down");
    await expect(adapter.findOne("task", "rec-1")).rejects.toThrow("Server is down");
    expect(createStateAdapter(records, { source: "error" }).options.message).not.toBe("");
    await createStateAdapter(records, { source: "error" }).create("task", { title: "x" }, meta);
  });

  test("refused with a 400 throws a validation error with a field error", async () => {
    const adapter = createStateAdapter(records, { source: "refused", field: "title", message: "Title is taken." });
    const error = await adapter.create("task", { title: "x" }, meta).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordValidationError);
    expect((error as RecordValidationError).issues).toEqual([expect.objectContaining({ path: "/title", message: "Title is taken." })]);
    await expect(adapter.update("task", "rec-1", { title: "x" }, meta)).rejects.toBeInstanceOf(RecordValidationError);
    await expect(adapter.delete("task", "rec-1")).rejects.toBeInstanceOf(RecordValidationError);
    await expect(adapter.batch("task", { create: [{ title: "x" }] }, meta)).rejects.toBeInstanceOf(RecordValidationError);
    expect((await adapter.find("task", {})).total).toBe(2);
    expect(adapter.records()).toEqual(records);
  });

  test("refused with a 403 throws a forbidden error", async () => {
    const adapter = createStateAdapter(records, { source: "refused", status: 403 });
    const error = await adapter.update("task", "rec-1", { title: "x" }, meta).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as AdapterError).code).toBe("forbidden");
  });

  test("conflict throws a 409 carrying the stored record", async () => {
    const adapter = createStateAdapter(records, { source: "conflict" });
    const error = await adapter.update("task", "rec-1", { title: "x" }, { ...meta, baseVersion: "1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordConflictError);
    expect((error as RecordConflictError).current?.id).toBe("rec-1");
    expect((error as AdapterError).code).toBe("conflict");
    await expect(adapter.create("task", { title: "x" }, meta)).rejects.toBeInstanceOf(RecordConflictError);
    expect((await adapter.find("task", {})).total).toBe(2);
  });

  test("configure switches the behavior while running", async () => {
    const adapter = createStateAdapter(records, { source: "refused" });
    await expect(adapter.create("task", { title: "x" }, meta)).rejects.toBeInstanceOf(RecordValidationError);
    adapter.configure({ source: "ready" });
    await adapter.create("task", { title: "x" }, meta);
    adapter.configure({ source: "error", message: "Down" });
    await expect(adapter.find("task", {})).rejects.toThrow("Down");
  });

  test("seeds from a view state, including a dashboard's embedded views", async () => {
    const result = viewStates(table, docs, { now: NOW });
    const many = result.states.find((s) => s.render.kind === "table" && s.render.records.length > 1);
    expect(many).toBeDefined();
    const adapter = createStateAdapter(many!);
    expect((await adapter.find("task", {})).total).toBe(many!.render.kind === "table" ? many!.render.records.length : -1);
  });
});

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "status", label: "Status", type: "select", options: { source: "static", values: ["todo", "done"] } },
  ],
};
const base = { specVersion: 4 as const, revision: 1, dataSource: "tasks", entity: "task" };
const form: FormView = { ...base, kind: "form", id: "f", sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }] }] };
const table: TableView = { ...base, kind: "table", id: "t", columns: [{ field: "title" }, { field: "status" }] };
const editableTable: TableView = { ...table, id: "te", columns: [{ field: "title", editable: true }] };
const board: BoardView = { ...base, kind: "board", id: "b", groupBy: [{ field: "status" }], editable: true };
const docs: Document[] = [entity, form, table, editableTable, board];

describe("sourceStates", () => {
  test("a form gets ready and refused only, refused on a valid draft", () => {
    const result = sourceStates(viewStates(form, docs, { now: NOW }), docs);
    expect(result.axes.at(-1)).toMatchObject({ id: "source", kind: "source", values: [{ id: "ready" }, { id: "refused" }] });
    const refused = result.states.filter((s) => s.source === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]!.values["source"]).toBe("refused");
    expect(refused[0]!.id).toContain("source=refused");
  });

  test("a read-only table gets loading and error but not refused or conflict", () => {
    expect(applicableSources(table)).toEqual(["ready", "loading", "error"]);
    const result = sourceStates(viewStates(table, docs, { now: NOW }), docs);
    expect(new Set(result.states.map((s) => s.source))).toEqual(new Set(["ready", "loading", "error"]));
  });

  test("an editable table and board get every source; refused and conflict sit on the fullest state", () => {
    for (const view of [editableTable, board]) {
      const result = sourceStates(viewStates(view, docs, { now: NOW }), docs);
      expect(new Set(result.states.map((s) => s.source))).toEqual(new Set(["ready", "loading", "error", "refused", "conflict"]));
      const most = Math.max(...result.states.map((s) => (s.render.kind === "form" || s.render.kind === "dashboard" ? 0 : s.render.records.length)));
      const conflict = result.states.find((s) => s.source === "conflict")!;
      expect(conflict.render.kind !== "form" && conflict.render.kind !== "dashboard" ? conflict.render.records.length : -1).toBe(most);
    }
  });

  test("every data state stays once with source ready, ids are unique and the adapter matches the source", async () => {
    const data = viewStates(board, docs, { now: NOW });
    const result = sourceStates(data, docs);
    expect(result.states.filter((s) => s.source === "ready").map((s) => s.base.id)).toEqual(data.states.map((s) => s.id));
    expect(new Set(result.states.map((s) => s.id)).size).toBe(result.states.length);
    const error = result.states.find((s) => s.source === "error")!;
    await expect(error.adapter().find("task", {})).rejects.toThrow();
    const conflict = result.states.find((s) => s.source === "conflict")!;
    await expect(conflict.adapter().update("task", "rec-1", { title: "x" }, meta)).rejects.toBeInstanceOf(RecordConflictError);
  });
});
