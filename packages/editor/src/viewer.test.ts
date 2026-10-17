import { SPEC_VERSION } from "@yadad/core";
import type { Document, TableView, ViewerDocument } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { edit, redo, startSession, undo } from "./session.js";
import { addViewerFact, addViewerFactValue, moveViewerFact, newViewerFact, removeViewerFact, removeViewerFactValue, setViewerFactDefault, setViewerFactLabel, viewerEditConflicts } from "./viewer.js";

const viewer: ViewerDocument = {
  kind: "viewer",
  specVersion: SPEC_VERSION,
  id: "viewer",
  revision: 1,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor", "owner"] }, default: "viewer" },
    { id: "beta", label: "Beta", type: "boolean", default: false },
  ],
};

const table: TableView = {
  kind: "table",
  specVersion: SPEC_VERSION,
  id: "t",
  entity: "task",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "title", visibleWhen: { op: "viewerIn", fact: "role", values: ["owner"] } }],
};
const entity: Document = { kind: "entity", specVersion: SPEC_VERSION, id: "task", revision: 1, fields: [{ id: "title", type: "text", label: "Title" }] };

function apply(result: { ok: true; patch: PatchOperation[] } | { ok: false; error: unknown }) {
  if (!result.ok) throw new Error("expected a patch");
  return edit(startSession(viewer), result.patch);
}

describe("viewer fact patches", () => {
  test("add, label, default, move and remove are patches with undo and redo", () => {
    let s = startSession(viewer);
    const add = addViewerFact(s.current, newViewerFact("plan", "Plan", "select"));
    if (!add.ok) throw new Error("add");
    s = edit(s, add.patch);
    expect(s.rejected).toEqual([]);
    expect(s.current.facts.map((f) => f.id)).toEqual(["role", "beta", "plan"]);
    const label = setViewerFactLabel(s.current, "plan", "Plan tier");
    if (!label.ok) throw new Error("label");
    s = edit(s, label.patch);
    expect(s.current.facts[2]?.label).toBe("Plan tier");
    const move = moveViewerFact(s.current, "plan", -1);
    if (!move.ok) throw new Error("move");
    s = edit(s, move.patch);
    expect(s.current.facts.map((f) => f.id)).toEqual(["role", "plan", "beta"]);
    s = undo(s);
    expect(s.current.facts.map((f) => f.id)).toEqual(["role", "beta", "plan"]);
    s = redo(s);
    expect(s.current.facts.map((f) => f.id)).toEqual(["role", "plan", "beta"]);
    const remove = removeViewerFact(s.current, "plan");
    if (!remove.ok) throw new Error("remove");
    expect(edit(s, remove.patch).current.facts.map((f) => f.id)).toEqual(["role", "beta"]);
  });

  test("a duplicate id, the ninth fact and removing the last fact are refused with a hint", () => {
    expect(addViewerFact(viewer, newViewerFact("role", "Again", "boolean"))).toMatchObject({ ok: false, error: { hint: "Pick another id." } });
    const full: ViewerDocument = { ...viewer, facts: Array.from({ length: 8 }, (_, i) => newViewerFact(`f${i}`, `F${i}`, "boolean")) };
    expect(addViewerFact(full, newViewerFact("more", "More", "boolean")).ok).toBe(false);
    expect(removeViewerFact({ ...viewer, facts: [viewer.facts[1]!] }, "beta").ok).toBe(false);
  });

  test("values: add, remove, and the default cannot be removed", () => {
    expect(apply(addViewerFactValue(viewer, "role", "guest")).current.facts[0]).toMatchObject({ options: { values: ["viewer", "editor", "owner", "guest"] } });
    expect(apply(removeViewerFactValue(viewer, "role", "editor")).current.facts[0]).toMatchObject({ options: { values: ["viewer", "owner"] } });
    expect(removeViewerFactValue(viewer, "role", "viewer")).toMatchObject({ ok: false, error: { hint: expect.stringContaining("default") } });
    expect(addViewerFactValue(viewer, "role", "owner").ok).toBe(false);
    expect(addViewerFactValue(viewer, "beta", "x").ok).toBe(false);
  });

  test("the default must be one of the values", () => {
    expect(apply(setViewerFactDefault(viewer, "role", "owner")).current.facts[0]).toMatchObject({ default: "owner" });
    expect(apply(setViewerFactDefault(viewer, "beta", true)).current.facts[1]).toMatchObject({ default: true });
    expect(setViewerFactDefault(viewer, "role", "nobody").ok).toBe(false);
    expect(setViewerFactDefault(viewer, "beta", "yes").ok).toBe(false);
  });

  test("an edit that a condition still reads is reported with where", () => {
    const set = [entity, table, viewer];
    const candidate = apply(removeViewerFactValue(viewer, "role", "owner")).current;
    const conflicts = viewerEditConflicts(viewer, candidate, set);
    expect(conflicts.map((c) => `${c.document}${c.path}`)).toEqual(["t/columns/0/visibleWhen/values/0"]);
    const gone = { ...viewer, facts: [viewer.facts[1]!] };
    expect(viewerEditConflicts(viewer, gone, set).map((c) => c.path)).toEqual(["/columns/0/visibleWhen/fact"]);
    expect(viewerEditConflicts(viewer, apply(removeViewerFact(viewer, "beta")).current, set)).toEqual([]);
  });
});
