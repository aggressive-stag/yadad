import type { DashboardView, EntityDocument, FormView, TableView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { addField, fieldReferences, removeField, updateField } from "./fields.js";
import { moveItem, resizeItem } from "./layout.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";

const dashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 0,
  id: "d",
  revision: 4,
  tabs: [
    {
      id: "log",
      title: "Log",
      items: [
        { id: "form", x: 0, y: 0, w: 8, h: 4, widget: "view", view: "f" },
        { id: "count", x: 8, y: 0, w: 4, h: 2, widget: "count", label: "Sets", view: "t", filter: { op: "eq", field: "felt", value: "Hard" } },
      ],
    },
  ],
};

describe("edit sessions", () => {
  test("valid edits apply; undo and redo replay the log; finish bumps the revision", () => {
    let s = startSession(dashboard);
    s = edit(s, moveItem(s.current, "log", "count", 8, 4));
    s = edit(s, resizeItem(s.current, "log", "count", 4, 3));
    expect(s.current.tabs[0]?.items[1]).toMatchObject({ x: 8, y: 4, w: 4, h: 3 });
    s = undo(s);
    expect(s.current.tabs[0]?.items[1]).toMatchObject({ y: 4, h: 2 });
    s = redo(s);
    expect(s.current.tabs[0]?.items[1]).toMatchObject({ h: 3 });
    expect(finish(s).revision).toBe(5);
    expect(dashboard.tabs[0]?.items[1]).toMatchObject({ y: 0, h: 2 }); // the original is untouched
  });

  test("an edit that breaks the document is rejected with the reason", () => {
    const s = edit(startSession(dashboard), moveItem(dashboard, "log", "count", 4, 0));
    expect(s.current).toBe(dashboard);
    expect(s.rejected.map((e) => e.message)).toEqual(['"count" would overlap "form".']);
    expect(isDirty(s)).toBe(false);
    expect(finish(s)).toBe(dashboard);
  });

  test("a new edit clears redo", () => {
    let s = edit(startSession(dashboard), moveItem(dashboard, "log", "count", 8, 5));
    s = undo(s);
    s = edit(s, resizeItem(s.current, "log", "count", 4, 1));
    expect(redo(s)).toBe(s);
  });
});

describe("field edits", () => {
  const entity: EntityDocument = {
    kind: "entity",
    specVersion: 0,
    id: "set",
    revision: 1,
    fields: [
      { id: "felt", type: "select", label: "Felt", options: { source: "static", values: ["Easy", "Hard"] } },
      { id: "notes", type: "text", label: "Notes" },
      { id: "spare", type: "text", label: "Spare" },
    ],
  };
  const form: FormView = {
    kind: "form",
    specVersion: 0,
    id: "f",
    entity: "set",
    revision: 1,
    dataSource: "default",
    sections: [{ id: "s", items: [{ field: "notes", visibleWhen: { op: "eq", field: "felt", value: "Hard" } }] }],
  };
  const table: TableView = { kind: "table", specVersion: 0, id: "t", entity: "set", revision: 1, dataSource: "default", columns: [{ field: "notes" }], sort: [{ field: "notes", dir: "asc" }] };
  const views = [form, table, dashboard];

  test("add a field, then update its label", () => {
    let s = edit(startSession(entity), addField(entity, { id: "rpe", type: "number", label: "RPE", min: 1, max: 10 }));
    const updated = updateField(s.current, { id: "rpe", type: "number", label: "Effort (RPE)", min: 1, max: 10 });
    if (!updated.ok) throw new Error(updated.error.message);
    s = edit(s, updated.patch);
    expect(finish(s).fields.at(-1)).toEqual({ id: "rpe", type: "number", label: "Effort (RPE)", min: 1, max: 10 });
  });

  test("invalid new fields and type changes are refused", () => {
    expect(edit(startSession(entity), addField(entity, { id: "notes", type: "text", label: "Again" })).rejected[0]?.code).toBe("duplicate-id");
    const retype = updateField(entity, { id: "notes", type: "number", label: "Notes" });
    expect(retype.ok ? "" : retype.error.message).toContain("would invalidate saved records");
  });

  test("a field in use cannot be removed; an unused one can", () => {
    expect(fieldReferences(views, "set", "notes")).toEqual(["f/sections/0/items/0", "t/columns/0", "t/sort/0"]);
    expect(fieldReferences(views, "set", "felt")).toEqual(["f/sections/0/items/0/visibleWhen", "d/tabs/0/items/1/filter"]);
    const blocked = removeField(entity, "notes", views);
    expect(blocked.ok ? "" : blocked.error.message).toContain("still used by: f/sections/0/items/0, t/columns/0, t/sort/0");
    const spare = removeField(entity, "spare", views);
    if (!spare.ok) throw new Error(spare.error.message);
    expect(edit(startSession(entity), spare.patch).current.fields.map((f) => f.id)).toEqual(["felt", "notes"]);
  });
});

describe("datetime property-panel values (RFC 0007)", () => {
  test("a native box value becomes the UTC instant; the stored form is kept; blanks drop", async () => {
    const { instantFromPanel, panelFromInstant } = await import("./field-options.js");
    expect(instantFromPanel("2026-10-17T09:30")).toBe("2026-10-17T09:30:00.000Z");
    expect(instantFromPanel(" 2026-10-17T09:30 ")).toBe("2026-10-17T09:30:00.000Z");
    expect(instantFromPanel("2026-10-17T09:30:00.000Z")).toBe("2026-10-17T09:30:00.000Z");
    expect(instantFromPanel("")).toBeUndefined();
    expect(instantFromPanel(undefined)).toBeUndefined();
    expect(instantFromPanel(7)).toBeUndefined();
    expect(panelFromInstant("2026-10-17T09:30:00.000Z")).toBe("2026-10-17T09:30");
    expect(panelFromInstant(undefined)).toBeNull();
  });

  test("a shape that is neither form is kept verbatim so the validator refuses it, naming the stored form", async () => {
    const { fieldFromProperties } = await import("./field-options.js");
    const { validateDocument } = await import("@yadad/core");
    const field = fieldFromProperties("datetime", { id: "when", label: "When", min: "17 October 2026, 9:30" });
    expect(field).toMatchObject({ min: "17 October 2026, 9:30" });
    const doc = { kind: "entity", specVersion: 0, id: "e", revision: 1, fields: [field] } as const;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    const error = result.ok ? undefined : result.errors[0];
    expect(error?.message).toContain('2026-10-17T09:30:00.000Z');
  });

  test("min above max is the validator's refusal, not the panel's", async () => {
    const { fieldFromProperties } = await import("./field-options.js");
    const { validateDocument } = await import("@yadad/core");
    const field = fieldFromProperties("datetime", { id: "when", label: "When", min: "2026-10-17T17:00", max: "2026-10-17T09:00" });
    const doc = { kind: "entity", specVersion: 0, id: "e", revision: 1, fields: [field] } as const;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.errors[0]?.message).toContain('is above "max"');
  });
});
