import type { EntityDocument, TableView } from "@yadad/core";
import { applyPatch } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { rowActionTargets, setRowAction } from "./views.js";

const ent = (id: string, fields: EntityDocument["fields"]): EntityDocument => ({ kind: "entity", specVersion: 2, id, revision: 1, fields });
const sets = ent("set", [{ id: "exercise", type: "text", label: "Exercise" }, { id: "weight", type: "number", label: "Weight" }]);
const table = (id: string, extra: Partial<TableView> = {}): TableView => ({ kind: "table", specVersion: 2, id, entity: "set", revision: 1, dataSource: "default", columns: [{ field: "exercise" }], ...extra });
const view = table("sets");
const history = table("history");
const context = { tables: [view, history], entities: [sets] };

describe("setRowAction", () => {
  test("lists every other table as a target", () => {
    expect(rowActionTargets(view, context).map((t) => t.id)).toEqual(["history"]);
  });

  test("sets a valid action as one patch that applies cleanly", () => {
    const action = { open: "history", bind: [{ field: "exercise", to: "exercise" }], mode: "replace" as const };
    const result = setRowAction(view, sets, context, action);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch).toEqual([{ op: "add", path: "/rowAction", value: action }]);
    expect(applyPatch(view, result.patch)).toMatchObject({ ok: true });
  });

  test("clears an action, and clearing nothing is a no-op", () => {
    const withAction = table("sets", { rowAction: { open: "history", bind: [{ field: "exercise", to: "exercise" }] } });
    const cleared = setRowAction(withAction, sets, context, undefined);
    expect(cleared).toEqual({ ok: true, patch: [{ op: "remove", path: "/rowAction" }] });
    expect(setRowAction(view, sets, context, undefined)).toEqual({ ok: true, patch: [] });
  });

  test("refuses mismatched types, unknown fields and unknown targets with the validator's message", () => {
    const bad = (bind: { field: string; to: string }[], open = "history") => setRowAction(view, sets, context, { open, bind });
    const types = bad([{ field: "exercise", to: "weight" }]);
    expect(types.ok).toBe(false);
    expect(!types.ok && types.error.path).toBe("/rowAction/bind/0");
    expect(!types.ok && types.error.hint).toContain("same type");
    const field = bad([{ field: "nope", to: "exercise" }]);
    expect(!field.ok && field.error.code).toBe("unknown-reference");
    const target = bad([{ field: "exercise", to: "exercise" }], "ghost");
    expect(!target.ok && target.error.path).toBe("/rowAction/open");
  });

  test("refuses an action that would close a cycle", () => {
    const back = table("history", { rowAction: { open: "sets", bind: [{ field: "exercise", to: "exercise" }] } });
    const result = setRowAction(view, sets, { tables: [view, back], entities: [sets] }, { open: "history", bind: [{ field: "exercise", to: "exercise" }] });
    expect(!result.ok && result.error.message).toContain("cycle");
  });
});
