import { ACTIONS_MAX, validateDocument } from "@yadad/core";
import type { ActionInputField, EntityDocument, RecordAction, TableView } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { addAction, actionReferences, addActionInput, moveAction, removeAction, removeActionInput, setActionInput, setActionVisibleWhen, updateAction, updateActionInput } from "./actions.js";
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

describe("action input fields and visibility", () => {
  const withOne = withActions(base, [ship]);
  const reason: ActionInputField = { id: "reason", type: "text", label: "Reason", required: true };

  test("the first input creates the key; further inputs append; the last removal drops it", () => {
    let s = apply(startSession(withOne), addActionInput(withOne, "ship", reason));
    expect(finish(s).actions?.[0]?.input).toEqual([reason]);
    s = apply(s, addActionInput(s.current, "ship", { id: "when", type: "date", label: "When" }));
    expect(finish(s).actions?.[0]?.input?.map((f) => f.id)).toEqual(["reason", "when"]);
    s = apply(s, removeActionInput(s.current, "ship", "reason"));
    s = apply(s, removeActionInput(s.current, "ship", "when"));
    expect(finish(s).actions?.[0]?.input).toBeUndefined();
  });

  test("a sixth input is refused", () => {
    const five = withActions(base, [{ ...ship, input: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, type: "text" as const, label: `F${i}` })) }]);
    const result = addActionInput(five, "ship", { id: "sixth", type: "text", label: "Sixth" });
    expect(result.ok ? "accepted" : result.error.message).toContain("at most 5");
  });

  test("a reference input is refused with the reason; duplicate ids and empty labels are refused", () => {
    const fake = { id: "who", type: "reference", label: "Who" } as unknown as ActionInputField;
    const refused = addActionInput(withOne, "ship", fake);
    expect(refused.ok ? "" : refused.error.message).toContain("cannot ask for a reference field");
    const dupe = addActionInput(withActions(base, [{ ...ship, input: [reason] }]), "ship", { id: "reason", type: "text", label: "Other" });
    expect(dupe.ok ? "" : dupe.error.message).toContain('already asks for "reason"');
    expect(addActionInput(withOne, "ship", { id: "noisy", type: "text", label: "  " }).ok).toBe(false);
  });

  test("setActionInput replaces the list, and an empty list removes the key", () => {
    const withInput = withActions(base, [{ ...ship, input: [reason] }]);
    let s = apply(startSession(withInput), setActionInput(withInput, "ship", [{ id: "note", type: "text", label: "Note" }, { id: "ok", type: "boolean", label: "Ok" }]));
    expect(finish(s).actions?.[0]?.input?.map((f) => f.id)).toEqual(["note", "ok"]);
    s = apply(s, setActionInput(s.current, "ship", []));
    expect(finish(s).actions?.[0]?.input).toBeUndefined();
  });

  test("a reference type is refused through setActionInput and updateActionInput", () => {
    const fake = { id: "who", type: "reference", label: "Who" } as unknown as ActionInputField;
    expect(setActionInput(withOne, "ship", [fake]).ok).toBe(false);
    const withInput = withActions(base, [{ ...ship, input: [reason] }]);
    expect(updateActionInput(withInput, "ship", "reason", fake).ok).toBe(false);
  });

  test("updating an input keeps its id fixed and applies the new properties", () => {
    const withInput = withActions(base, [{ ...ship, input: [reason] }]);
    const next = apply(startSession(withInput), updateActionInput(withInput, "ship", "reason", { id: "reason", type: "text", label: "Why it failed" }));
    expect(finish(next).actions?.[0]?.input).toEqual([{ id: "reason", type: "text", label: "Why it failed" }]);
  });

  test("visibleWhen is added, replaced and cleared, and the entity still validates", () => {
    let s = apply(startSession(withOne), setActionVisibleWhen(withOne, "ship", { op: "eq", field: "status", value: "open" }));
    expect(finish(s).actions?.[0]?.visibleWhen).toEqual({ op: "eq", field: "status", value: "open" });
    s = apply(s, setActionVisibleWhen(s.current, "ship", { op: "viewerIn", fact: "role", values: ["admin"] }));
    expect(finish(s).actions?.[0]?.visibleWhen).toEqual({ op: "viewerIn", fact: "role", values: ["admin"] });
    s = apply(s, setActionVisibleWhen(s.current, "ship", undefined));
    expect(finish(s).actions?.[0]?.visibleWhen).toBeUndefined();
  });

  test("input helpers refuse an action that does not exist", () => {
    expect(addActionInput(base, "ghost", reason).ok).toBe(false);
    expect(setActionVisibleWhen(base, "ghost", { op: "empty", field: "status" }).ok).toBe(false);
  });
});
