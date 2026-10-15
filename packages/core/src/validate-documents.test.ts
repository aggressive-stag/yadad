import { describe, expect, test } from "vitest";
import { validateDocument, validateDocuments } from "./validate.js";

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

describe("relative dates across a set", () => {
  const ent = {
    kind: "entity",
    specVersion: 1,
    id: "thing",
    revision: 1,
    fields: [
      { id: "day", type: "date", label: "Day" },
      { id: "weight", type: "number", label: "Weight" },
    ],
  };
  const rel = { daysFromToday: -7 };

  test("is accepted on a date field in a form, a table and a count widget", () => {
    const set = [
      ent,
      form("f", "thing", [{ field: "day", visibleWhen: { op: "gte", field: "day", value: rel } }]),
      table("t", "thing", { columns: [{ field: "day" }], filter: { op: "lte", field: "day", value: rel } }),
      dashboard("b", [{ id: "c", x: 0, y: 0, w: 2, h: 2, widget: "count", label: "C", view: "t", filter: { op: "eq", field: "day", value: { daysFromToday: 0 } } }]),
    ];
    expect(validateDocuments(set).ok).toBe(true);
  });

  test("is rejected on a non-date field, naming the op in the hint", () => {
    const set = [ent, table("t", "thing", { columns: [{ field: "day" }], filter: { op: "not", condition: { op: "gte", field: "weight", value: rel } } })];
    const result = validateDocuments(set);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.path, e.code])).toEqual([["/filter/condition/value", "invalid-value"]]);
    expect(result.errors[0]?.hint).toContain('"op": "gte"');
  });

  test("is rejected on a non-date field in a count widget filter", () => {
    const set = [
      ent,
      table("t", "thing", { columns: [{ field: "day" }] }),
      dashboard("b", [{ id: "c", x: 0, y: 0, w: 2, h: 2, widget: "count", label: "C", view: "t", filter: { op: "eq", field: "weight", value: rel } }]),
    ];
    const result = validateDocuments(set);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(["/tabs/0/items/0/filter/value"]);
  });
});

describe("table rowAction", () => {
  const ent = entity("thing", [{ id: "name", type: "text" }, { id: "qty", type: "number" }]);
  const go = (open: string, extra: Record<string, unknown> = {}) => ({ open, bind: [{ field: "name", to: "name" }], ...extra });

  test("a chain of three hops is valid; the mode may be stated", () => {
    const set = [ent, table("a", "thing", { rowAction: go("b", { mode: "replace" }) }), table("b", "thing", { rowAction: go("c") }), table("c", "thing", { rowAction: go("d") }), table("d", "thing")];
    expect(validateDocuments(set).ok).toBe(true);
  });

  test("structural problems: dialog mode, no bindings, a repeated target field, unknown keys", () => {
    const set = [
      table("a", "thing", { rowAction: { open: "a", bind: [], mode: "dialog" } }),
      table("b", "thing", { rowAction: { open: "a", bind: [{ field: "name", to: "name" }, { field: "qty", to: "name" }], edit: true } }),
    ];
    const results = set.map((d) => validateDocument(d));
    expect(results[0]?.ok ? [] : results[0]?.errors.map((e) => [e.path, e.code])).toEqual([["/rowAction/mode", "invalid-value"], ["/rowAction/bind", "invalid-value"]]);
    expect(results[1]?.ok ? [] : results[1]?.errors.map((e) => [e.path, e.code])).toEqual([["/rowAction/edit", "unknown-property"], ["/rowAction/bind/1/to", "duplicate-id"]]);
    const dialog = results[0];
    expect(dialog?.ok ? "" : dialog?.errors[0]?.hint).toContain("replace");
  });

  test("a row action that opens its own table is a cycle", () => {
    expect(problems([ent, table("a", "thing", { rowAction: go("a") })])).toEqual([{ path: "/rowAction/open", code: "invalid-value", document: "a", allowed: undefined }]);
  });

  test("a table that leads into a cycle is not itself reported as one", () => {
    const set = [ent, table("c", "thing", { rowAction: go("a") }), table("a", "thing", { rowAction: go("b") }), table("b", "thing", { rowAction: go("a") })];
    expect(problems(set)).toEqual([{ path: "/rowAction/open", code: "invalid-value", document: "b", allowed: undefined }]);
  });

  test("a four-hop chain is reported once, with a readable hint", () => {
    const set = [ent, table("a", "thing", { rowAction: go("b") }), table("b", "thing", { rowAction: go("c") }), table("c", "thing", { rowAction: go("d") }), table("d", "thing", { rowAction: go("e") }), table("e", "thing")];
    expect(problems(set)).toEqual([{ path: "/rowAction/open", code: "invalid-value", document: "a", allowed: undefined }]);
  });

  test("reference fields bind only when they point at the same entity", () => {
    const withRef = (to: string): unknown => ({
      kind: "entity", specVersion: 2, id: "entry", revision: 1,
      fields: [{ id: "name", type: "text", label: "Name" }, { id: "who", type: "reference", label: "Who", entity: to }],
    });
    const bind = { open: "b", bind: [{ field: "who", to: "who" }] };
    const people = entity("person", [{ id: "name", type: "text" }]);
    const pets = entity("pet", [{ id: "name", type: "text" }]);
    expect(validateDocuments([people, pets, withRef("person"), table("a", "entry", { rowAction: bind }), table("b", "entry")]).ok).toBe(true);
    // A second entity whose "who" points at another entity.
    const other = { ...(withRef("pet") as object), id: "note" };
    const mismatch = [people, pets, withRef("person"), other, table("a", "entry", { rowAction: bind }), table("b", "note")];
    expect(problems(mismatch)).toEqual([{ path: "/rowAction/bind/0", code: "invalid-value", document: "a", allowed: undefined }]);
  });

  test("the target may be a different entity", () => {
    const other = entity("order", [{ id: "name", type: "text" }]);
    expect(validateDocuments([ent, other, table("a", "thing", { rowAction: go("b") }), table("b", "order")]).ok).toBe(true);
  });
});
