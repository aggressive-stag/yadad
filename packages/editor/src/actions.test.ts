import { ACTIONS_MAX, validateDocument } from "@yadad/core";
import type { EntityDocument, RecordAction, TableView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { addAction, actionReferences, moveAction, removeAction, updateAction } from "./actions.js";
import { edit, finish, startSession } from "./session.js";
import type { EditSession } from "./session.js";
import type { PatchOperation } from "@yadad/runtime";

type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: { message: string } };

const base: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
  ],
};

const ship: RecordAction = { id: "ship", label: "Ship", confirm: { title: "Ship it?", message: "This marks the task shipped.", tone: "neutral" } };
const reassign: RecordAction = { id: "reassign", label: "Reassign", confirm: { message: "Who should it go to?", confirmLabel: "Reassign" } };
const drop: RecordAction = { id: "drop", label: "Drop", confirm: { message: "This cannot be undone.", tone: "danger" } };

const withActions = (entity: EntityDocument, actions: RecordAction[]): EntityDocument => ({ ...entity, actions });

/** Applies a helper's result through a session and requires core to still validate the entity. */
function apply(s: EditSession<EntityDocument>, result: Result): EditSession<EntityDocument> {
  if (!result.ok) throw new Error(`helper refused the edit: ${result.error.message}`);
  const next = edit(s, result.patch);
  expect(next.rejected).toEqual([]);
  const validation = validateDocument(next.current as EntityDocument);
  if (!validation.ok) throw new Error(`core rejected the patched entity: ${validation.errors.map((e) => e.message).join("; ")}`);
  return next;
}

describe("entity actions", () => {
  test("adding an action applies and the entity still validates", () => {
    const s = apply(startSession(base), addAction(base, ship));
    expect(finish(s).actions).toEqual([ship]);
  });

  test("adding the last action creates the key; removing it takes the key with it", () => {
    const s = apply(startSession(base), addAction(base, ship));
    expect(Object.hasOwn(s.current, "actions")).toBe(true);
    const back = apply(s, removeAction(s.current, "ship", []));
    expect(finish(back).actions).toBeUndefined();
    expect(Object.hasOwn(finish(back), "actions")).toBe(false);
  });

  test("a duplicate id is refused", () => {
    const entity = withActions(base, [ship]);
    expect(addAction(entity, { id: "ship", label: "Ship again" }).ok).toBe(false);
  });

  test("an empty label is refused", () => {
    expect(addAction(base, { id: "ship", label: "   " }).ok).toBe(false);
    const entity = withActions(base, [ship]);
    expect(updateAction(entity, "ship", { label: "" }).ok).toBe(false);
  });

  test(`a thirteenth action is refused at ACTIONS_MAX=${ACTIONS_MAX}`, () => {
    const full = withActions(base, Array.from({ length: ACTIONS_MAX }, (_, i) => ({ id: `a${i}`, label: `A${i}` })));
    const result = addAction(full, { id: "one-too-many", label: "Nope" });
    expect(result.ok ? "accepted" : result.error.message).toContain(`at most ${ACTIONS_MAX}`);
  });

  test("updating label and confirm preserves the id and the parts the next card owns", () => {
    const input = [{ id: "reason", type: "text" as const, label: "Reason", required: true }];
    const current = withActions(base, [{ id: "ship", label: "Ship", confirm: { message: "Ship it?" }, input, visibleWhen: { op: "eq", field: "status", value: "open" } }]);
    const result = updateAction(current, "ship", { label: "Publish", confirm: { message: "Publish it?", tone: "danger" } });
    const next = apply(startSession(current), result);
    expect(finish(next).actions).toEqual([
      { id: "ship", label: "Publish", confirm: { message: "Publish it?", tone: "danger" }, input, visibleWhen: { op: "eq", field: "status", value: "open" } },
    ]);
  });

  test("clearing the confirm message removes the confirm block", () => {
    const current = withActions(base, [ship]);
    const next = apply(startSession(current), updateAction(current, "ship", { label: "Ship" }));
    expect(finish(next).actions).toEqual([{ id: "ship", label: "Ship" }]);
  });

  test("an action id stays stable across a reorder", () => {
    const current = withActions(base, [ship, reassign, drop]);
    const next = apply(startSession(current), moveAction(current, "drop", -2));
    expect(finish(next).actions?.map((a) => a.id)).toEqual(["drop", "ship", "reassign"]);
  });

  test("moving past an end is refused", () => {
    const current = withActions(base, [ship, reassign]);
    expect(moveAction(current, "ship", -1).ok).toBe(false);
    expect(moveAction(current, "reassign", 1).ok).toBe(false);
  });

  test("removal is refused while a view still offers the action", () => {
    const current = withActions(base, [ship, reassign]);
    const table: TableView = { kind: "table", specVersion: 0, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }], recordActions: ["ship"] };
    expect(actionReferences([table], "task", "ship")).toEqual(["tasks/recordActions/0"]);
    expect(removeAction(current, "ship", [table]).ok).toBe(false);
    expect(removeAction(current, "reassign", [table]).ok).toBe(true);
  });

  test("the guard test refuses a patch prepared against a stale document", () => {
    const stale = withActions(base, [ship, reassign]);
    const patch = moveAction(stale, "reassign", -1);
    if (!patch.ok) throw new Error("stale patch should be buildable");
    // Meanwhile the live entity lost the action, so /actions/1/id no longer matches.
    const live = withActions(base, [ship]);
    const s = edit(startSession(live), patch.patch);
    expect(s.applied.length).toBe(0);
    expect(s.rejected.length).toBe(1);
  });
});
