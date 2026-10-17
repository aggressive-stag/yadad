import type { BoardView, EntityDocument, TableView } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { describe, expect, test } from "vitest";
import { blankBoard } from "./blank.js";
import { edit, startSession } from "./session.js";
import type { EditSession } from "./session.js";
import {
  addBoardCardField,
  addBoardGroupBy,
  boardRowActionTargets,
  boardTitleFieldsOf,
  fieldsNotInBoardCards,
  fieldsNotInBoardGroupBy,
  groupableFieldsOf,
  moveBoardCardField,
  moveBoardGroupBy,
  removeBoardCardField,
  removeBoardGroupBy,
  setBoardEditable,
  setBoardFilter,
  setBoardRowAction,
  setBoardSort,
  setBoardTitle,
  setBoardTitleField,
} from "./views.js";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "flag", type: "boolean", label: "Flagged" },
    { id: "agreed", type: "boolean", label: "Agreed", required: true },
    { id: "list", type: "reference", label: "List", entity: "list" },
    { id: "notes", type: "text", label: "Notes" },
    { id: "due", type: "date", label: "Due" },
  ],
};

const view: BoardView = { kind: "board", specVersion: 0, id: "tasks_board", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "status" }] };

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: { message: string } };

/** Applies a helper's result through a session, failing the test if the helper or validation refused it. */
function apply(s: EditSession<BoardView>, result: Result): EditSession<BoardView> {
  if (!Array.isArray(result) && !result.ok) throw new Error(`helper refused the edit: ${result.error.message}`);
  const next = edit(s, Array.isArray(result) ? result : result.patch);
  expect(next.rejected).toEqual([]);
  return next;
}

describe("blankBoard", () => {
  test("groups by the entity's first groupable field", () => {
    expect(blankBoard(entity, "tasks_board", "default")).toMatchObject({ kind: "board", entity: "task", groupBy: [{ field: "status" }] });
  });

  test("skips a required boolean and is null when nothing can group", () => {
    const onlyRequired: EntityDocument = { ...entity, fields: [entity.fields[0]!, entity.fields[3]!] };
    expect(blankBoard(onlyRequired, "x", "default")).toBeNull();
  });
});

describe("groupable and title fields", () => {
  test("offers select, optional boolean and reference fields only", () => {
    expect(groupableFieldsOf(entity)).toEqual(["status", "flag", "list"]);
    expect(boardTitleFieldsOf(entity)).toEqual(["title", "status", "notes"]);
  });
});

describe("board groupBy", () => {
  test("adds, reorders and removes groupings; the first is the default and one stays", () => {
    let s = startSession(view);
    expect(fieldsNotInBoardGroupBy(entity, s.current)).toEqual(["flag", "list"]);
    s = apply(s, addBoardGroupBy(s.current, entity, "flag"));
    s = apply(s, addBoardGroupBy(s.current, entity, "list"));
    expect(s.current.groupBy.map((g) => g.field)).toEqual(["status", "flag", "list"]);
    s = apply(s, moveBoardGroupBy(s.current, "list", -2));
    expect(s.current.groupBy.map((g) => g.field)).toEqual(["list", "status", "flag"]);
    s = apply(s, removeBoardGroupBy(s.current, "list"));
    s = apply(s, removeBoardGroupBy(s.current, "flag"));
    expect(removeBoardGroupBy(s.current, "status").ok).toBe(false);
  });

  test("refuses fields that cannot group, duplicates and a sixth grouping", () => {
    expect(addBoardGroupBy(view, entity, "agreed").ok).toBe(false);
    expect(addBoardGroupBy(view, entity, "notes").ok).toBe(false);
    expect(addBoardGroupBy(view, entity, "status").ok).toBe(false);
    const many: EntityDocument = { ...entity, fields: [...entity.fields, ...[1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, type: "select" as const, label: `S${n}`, options: { source: "static" as const, values: ["a"] } }))] };
    let s = startSession(view);
    for (const n of [1, 2, 3, 4]) s = apply(s, addBoardGroupBy(s.current, many, `s${n}`));
    expect(s.current.groupBy).toHaveLength(5);
    expect(addBoardGroupBy(s.current, many, "s5").ok).toBe(false);
  });

  test("moving a field past the ends or that is not listed is refused", () => {
    expect(moveBoardGroupBy(view, "status", -1).ok).toBe(false);
    expect(moveBoardGroupBy(view, "flag", 1).ok).toBe(false);
    expect(removeBoardGroupBy(view, "flag").ok).toBe(false);
  });
});

describe("board settings", () => {
  test("sets title, title field, editable, sort and filter, and clears them", () => {
    let s = startSession(view);
    s = apply(s, setBoardTitle(s.current, "Tasks"));
    expect(s.current.title).toBe("Tasks");
    s = apply(s, setBoardTitleField(s.current, entity, "notes"));
    expect(s.current.titleField).toBe("notes");
    s = apply(s, setBoardEditable(s.current, true));
    expect(s.current.editable).toBe(true);
    s = apply(s, setBoardEditable(s.current, false));
    expect(s.current.editable).toBeUndefined();
    s = apply(s, setBoardSort(s.current, { field: "title", dir: "desc" }));
    expect(s.current.sort).toEqual([{ field: "title", dir: "desc" }]);
    s = apply(s, setBoardSort(s.current, undefined));
    expect(s.current.sort).toBeUndefined();
    s = apply(s, setBoardFilter(s.current, { op: "neq", field: "status", value: "done" }));
    expect(s.current.filter).toEqual({ op: "neq", field: "status", value: "done" });
    s = apply(s, setBoardFilter(s.current, undefined));
    expect(s.current.filter).toBeUndefined();
    s = apply(s, setBoardTitleField(s.current, entity, undefined));
    expect(s.current.titleField).toBeUndefined();
  });

  test("the same title field is a no-op patch", () => {
    expect(setBoardTitleField(view, entity, undefined)).toEqual([]);
  });
});

describe("board card fields", () => {
  test("lists fields other than the title (default or chosen) and those already shown", () => {
    expect(fieldsNotInBoardCards(entity, view)).toEqual(["status", "flag", "agreed", "list", "notes", "due"]);
    expect(fieldsNotInBoardCards(entity, { ...view, titleField: "notes", cardFields: ["due"] })).toEqual(["title", "status", "flag", "agreed", "list"]);
  });

  test("adds, reorders and removes card fields, up to the limit", () => {
    let s = startSession(view);
    s = apply(s, addBoardCardField(s.current, entity, "due"));
    s = apply(s, addBoardCardField(s.current, entity, "list"));
    s = apply(s, addBoardCardField(s.current, entity, "notes"));
    expect(s.current.cardFields).toEqual(["due", "list", "notes"]);
    expect(addBoardCardField(s.current, entity, "flag").ok).toBe(false);
    s = apply(s, moveBoardCardField(s.current, "notes", -2));
    expect(s.current.cardFields).toEqual(["notes", "due", "list"]);
    for (const id of ["notes", "due", "list"]) s = apply(s, removeBoardCardField(s.current, id));
    expect(s.current.cardFields).toBeUndefined();
  });

  test("refuses the title field, duplicates and unknown fields", () => {
    expect(addBoardCardField(view, entity, "title").ok).toBe(false);
    expect(addBoardCardField({ ...view, cardFields: ["due"] }, entity, "due").ok).toBe(false);
    expect(addBoardCardField(view, entity, "ghost").ok).toBe(false);
    expect(removeBoardCardField(view, "due").ok).toBe(false);
    expect(moveBoardCardField(view, "due", 1).ok).toBe(false);
  });

  test("choosing a title field that is a card field drops it from the card fields in the same edit", () => {
    let s = startSession<BoardView>({ ...view, cardFields: ["notes", "due"] });
    s = apply(s, setBoardTitleField(s.current, entity, "notes"));
    expect(s.current).toMatchObject({ titleField: "notes", cardFields: ["due"] });
    let t = startSession<BoardView>({ ...view, cardFields: ["notes"] });
    t = apply(t, setBoardTitleField(t.current, entity, "notes"));
    expect(t.current.cardFields).toBeUndefined();
  });
});

describe("board row action", () => {
  const table: TableView = { kind: "table", specVersion: 0, id: "task_history", title: "Task history", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }] };
  const context = { tables: [table], entities: [entity] };

  test("lists the tables a board's row action may open", () => {
    expect(boardRowActionTargets(context)).toEqual([table]);
  });

  test("sets and clears a valid row action", () => {
    let s = startSession(view);
    s = apply(s, setBoardRowAction(s.current, entity, context, { open: "task_history", bind: [{ field: "title", to: "title" }], mode: "replace" }));
    expect(s.current.rowAction?.open).toBe("task_history");
    s = apply(s, setBoardRowAction(s.current, entity, context, undefined));
    expect(s.current.rowAction).toBeUndefined();
  });

  test("refuses an action naming an unknown table", () => {
    expect(setBoardRowAction(view, entity, context, { open: "nope", bind: [{ field: "title", to: "title" }], mode: "replace" }).ok).toBe(false);
  });
});
