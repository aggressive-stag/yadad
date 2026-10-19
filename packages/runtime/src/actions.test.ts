// availableActions, actionNeedsDialog and validateActionInput (RFC 0007).

import type { DataRecord, EntityDocument, RecordAction, ResolvedViewer } from "@yadad/core";
import { describe, expect, test } from "vitest";

import { actionNeedsDialog, availableActions, validateActionInput } from "./actions.js";

const approve: RecordAction = { id: "approve", label: "Approve" };
const reject: RecordAction = { id: "reject", label: "Reject", confirm: { message: "Reject it?" } };
const retitle: RecordAction = {
  id: "retitle",
  label: "Retitle",
  input: [
    { id: "reason", type: "text", label: "Reason", required: true },
    { id: "score", type: "number", label: "Score", min: 1 },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["minor", "major"] } },
  ],
};
const close: RecordAction = { id: "close", label: "Close", visibleWhen: { op: "eq", field: "state", value: "open" } };
const adminsOnly: RecordAction = { id: "purge", label: "Purge", visibleWhen: { op: "viewerIn", fact: "role", values: ["admin"] } };

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 6,
  id: "task",
  revision: 1,
  fields: [{ id: "state", type: "text", label: "State" }],
  actions: [approve, reject, retitle, close, adminsOnly],
};

const viewer = (role: string): ResolvedViewer => ({ facts: [{ fact: "role", value: role }] });

function record(can?: DataRecord["can"], values: Record<string, string | null> = { state: "open" }): DataRecord {
  const base: DataRecord = { id: "r1", entityId: "task", entityRevision: 1, version: "v1", values };
  return can === undefined ? base : { ...base, can };
}

function offeredIds(can?: DataRecord["can"], values?: Record<string, string | null>, role = "editor"): string[] {
  const view = { recordActions: ["purge", "approve", "reject", "retitle", "close"] };
  return availableActions(entity, view, record(can, values), viewer(role)).map((a) => a.id);
}

describe("availableActions", () => {
  test("keeps the view's order, drops nothing when all are available", () => {
    // View order is purge, approve, reject, retitle, close; at the default
    // role retitle has no visibleWhen but purge does (viewerIn below), and
    // retitle stays because it is offered — order follows the view, not the entity.
    expect(offeredIds()).toEqual(["approve", "reject", "retitle", "close"]);
  });

  test("hides by visibleWhen on a record leaf", () => {
    expect(offeredIds(undefined, { state: "open" }, "admin")).toContain("close");
    expect(offeredIds(undefined, { state: "done" }, "admin")).not.toContain("close");
    expect(offeredIds(undefined, {}, "admin")).not.toContain("close"); // missing value is not "open"
  });

  test("hides by visibleWhen on a viewerIn leaf", () => {
    expect(offeredIds(undefined, undefined, "admin")).toEqual(["purge", "approve", "reject", "retitle", "close"]);
    expect(offeredIds(undefined, undefined, "editor")).not.toContain("purge");
  });

  test("hides only on an explicit can.actions false; missing can/actions/key is offered", () => {
    expect(offeredIds({ actions: { approve: false } })).toEqual(["reject", "retitle", "close"]);
    expect(offeredIds({ actions: { approve: true } })).toEqual(["approve", "reject", "retitle", "close"]);
    expect(offeredIds({})).toContain("approve"); // can present, actions absent
    expect(offeredIds({ actions: {} })).toContain("approve"); // key absent
  });

  test("ignores offered ids the entity does not define", () => {
    const view = { recordActions: ["ghost", "approve"] };
    expect(availableActions(entity, view, record(), viewer("editor")).map((a) => a.id)).toEqual(["approve"]);
  });

  test("an entity or view without actions offers none", () => {
    const bare: EntityDocument = { kind: "entity", specVersion: 6, id: "task", revision: 1, fields: [] };
    expect(availableActions(bare, { recordActions: ["approve"] }, record(), viewer("admin"))).toEqual([]);
    expect(availableActions(entity, {}, record(), viewer("admin"))).toEqual([]);
  });
});

describe("actionNeedsDialog", () => {
  test("confirm or input opens a dialog; neither runs on press", () => {
    expect(actionNeedsDialog(approve)).toBe(false);
    expect(actionNeedsDialog(reject)).toBe(true);
    expect(actionNeedsDialog(retitle)).toBe(true);
  });
});

describe("validateActionInput", () => {
  test("valid input has no issues", () => {
    expect(validateActionInput(retitle, { reason: "typo", score: 2, kind: "minor" })).toEqual([]);
  });

  test("required, min and select checks report under /input/<id>", () => {
    const issues = validateActionInput(retitle, { score: 0, kind: "huge" });
    expect(issues.map((e) => [e.path, e.code])).toEqual([
      ["/input/reason", "required"],
      ["/input/score", "invalid-value"],
      ["/input/kind", "invalid-value"],
    ]);
  });

  test("an unknown input id is reported under /input/", () => {
    expect(validateActionInput(retitle, { reason: "ok", extra: 1 }).map((e) => [e.path, e.code])).toEqual([
      ["/input/extra", "unknown-property"],
    ]);
  });

  test("an action without input accepts no values", () => {
    expect(validateActionInput(approve, {})).toEqual([]);
    expect(validateActionInput(approve, { reason: "x" }).map((e) => [e.path, e.code])).toEqual([
      ["/input/reason", "unknown-property"],
    ]);
  });
});
