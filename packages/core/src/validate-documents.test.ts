import { describe, expect, test } from "vitest";
import { validateDocuments } from "./validate.js";

type ExpectedError = { path: string; code: string; document?: string | undefined; allowed?: readonly string[] | undefined };

function entity(id: string, fields: { id: string; type: string }[]): unknown {
  return {
    kind: "entity",
    specVersion: 0,
    id,
    revision: 1,
    fields: fields.map((f) => ({ id: f.id, type: f.type, label: f.id })),
  };
}

function form(id: string, ent: string, items: { field: string; visibleWhen?: unknown }[]): unknown {
  return {
    kind: "form",
    specVersion: 0,
    id,
    entity: ent,
    revision: 1,
    dataSource: "default",
    sections: [{ id: "main", items }],
  };
}

function table(id: string, ent: string, extra: Record<string, unknown> = {}): unknown {
  return {
    kind: "table",
    specVersion: 0,
    id,
    entity: ent,
    revision: 1,
    dataSource: "default",
    columns: [{ field: "name" }],
    ...extra,
  };
}

function dashboard(id: string, items: unknown[]): unknown {
  return { kind: "dashboard", specVersion: 0, id, revision: 1, tabs: [{ id: "t", title: "T", items }] };
}

/** Normalizes a set's errors to the fields we assert on. Throws if the set is valid. */
function problems(set: readonly unknown[]): ExpectedError[] {
  const result = validateDocuments(set);
  if (result.ok) throw new Error("expected the set to be invalid");
  return result.errors.map((e) => ({ path: e.path, code: e.code, document: e.document, allowed: e.allowed }));
}

describe("validateDocuments", () => {
  test("a structurally and referentially valid set is ok", () => {
    const set = [
      entity("thing", [{ id: "name", type: "text" }]),
      form("thing_form", "thing", [{ field: "name" }]),
      table("thing_table", "thing"),
      dashboard("board", [
        { id: "a", x: 0, y: 0, w: 6, h: 2, widget: "view", view: "thing_form" },
        { id: "c", x: 0, y: 2, w: 6, h: 2, widget: "count", label: "C", view: "thing_table", filter: { op: "eq", field: "name", value: 1 } },
      ]),
    ];
    const result = validateDocuments(set);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(4);
  });

  test("a form that names a missing entity", () => {
    const set = [entity("thing", [{ id: "name", type: "text" }]), form("thing_form", "ghost", [{ field: "name" }])];
    expect(problems(set)).toEqual([{ path: "/entity", code: "unknown-reference", document: "thing_form", allowed: ["thing"] }]);
  });

  test("a form item that names a missing field", () => {
    const set = [entity("thing", [{ id: "name", type: "text" }]), form("thing_form", "thing", [{ field: "name" }, { field: "nope" }])];
    expect(problems(set)).toEqual([{ path: "/sections/0/items/1/field", code: "unknown-reference", document: "thing_form", allowed: ["name"] }]);
  });

  test("a form condition that names a missing field", () => {
    const set = [
      entity("thing", [
        { id: "name", type: "text" },
        { id: "mood", type: "text" },
      ]),
      form("thing_form", "thing", [{ field: "mood", visibleWhen: { op: "eq", field: "ghost", value: "sad" } }]),
    ];
    expect(problems(set)).toEqual([
      { path: "/sections/0/items/0/visibleWhen/field", code: "unknown-reference", document: "thing_form", allowed: ["name", "mood"] },
    ]);
  });

  test("a table whose columns, sort, filters and filter name missing fields", () => {
    const set = [
      entity("thing", [{ id: "name", type: "text" }]),
      table("thing_table", "thing", {
        columns: [{ field: "name" }, { field: "ghost" }],
        sort: [{ field: "no_sort", dir: "asc" }],
        quickFilters: [{ field: "no_filter" }],
        filter: { op: "eq", field: "no_filter", value: 1 },
      }),
    ];
    expect(problems(set)).toEqual([
      { path: "/columns/1/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
      { path: "/sort/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
      { path: "/quickFilters/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
      { path: "/filter/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    ]);
  });

  test("a dashboard view widget that names a missing view", () => {
    const set = [
      entity("e", [{ id: "name", type: "text" }]),
      form("the_form", "e", [{ field: "name" }]),
      dashboard("board", [{ id: "a", x: 0, y: 0, w: 6, h: 2, widget: "view", view: "ghost" }]),
    ];
    expect(problems(set)).toEqual([{ path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_form"] }]);
  });

  test("a dashboard count widget that points at a form instead of a table", () => {
    const set = [
      entity("e", [{ id: "name", type: "text" }]),
      form("the_form", "e", [{ field: "name" }]),
      table("the_table", "e"),
      dashboard("board", [{ id: "c", x: 0, y: 0, w: 6, h: 2, widget: "count", label: "C", view: "the_form" }]),
    ];
    expect(problems(set)).toEqual([{ path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] }]);
  });

  test("a dashboard count widget whose filter names a missing field", () => {
    const set = [
      entity("e", [{ id: "name", type: "text" }]),
      table("the_table", "e"),
      dashboard("board", [{ id: "c", x: 0, y: 0, w: 6, h: 2, widget: "count", label: "C", view: "the_table", filter: { op: "eq", field: "ghost", value: 1 } }]),
    ];
    expect(problems(set)).toEqual([{ path: "/tabs/0/items/0/filter/field", code: "unknown-reference", document: "board", allowed: ["name"] }]);
  });

  test("two documents of the same kind with the same id", () => {
    const set = [
      entity("thing", [{ id: "name", type: "text" }]),
      { kind: "entity", specVersion: 0, id: "thing", revision: 2, fields: [{ id: "name", type: "text", label: "name" }] },
    ];
    expect(problems(set)).toEqual([{ path: "/id", code: "duplicate-id", document: "thing" }]);
  });

  test("a structural error is tagged with the document's id and keeps its allowed list", () => {
    const set = [entity("e", [{ id: "name", type: "text" }]), { kind: "widget", specVersion: 0, id: "w", revision: 1 }];
    expect(problems(set)).toEqual([{ path: "/kind", code: "unknown-kind", document: "w", allowed: ["entity", "form", "table", "dashboard"] }]);
  });
});
