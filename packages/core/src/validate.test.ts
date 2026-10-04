import { describe, expect, test } from "vitest";
import { jsonPointer } from "./errors.js";
import { validateDocument } from "./validate.js";

const entity = {
  kind: "entity",
  specVersion: 0,
  id: "hello",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name", required: true }],
};

const form = {
  kind: "form",
  specVersion: 0,
  id: "hello_form",
  entity: "hello",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", title: "Hello", items: [{ field: "name" }] }],
};

/** Validates and returns [path, code] pairs, or [] when valid. */
function problems(doc: unknown): [string, string][] {
  const result = validateDocument(doc);
  return result.ok ? [] : result.errors.map((e) => [e.path, e.code]);
}

describe("valid documents", () => {
  test("entity", () => {
    const result = validateDocument(entity);
    expect(result).toEqual({ ok: true, value: entity });
  });

  test("form view", () => {
    expect(problems(form)).toEqual([]);
  });

  test("optional properties may be left out", () => {
    expect(problems({ ...entity, fields: [{ id: "name", type: "text", label: "Name" }] })).toEqual([]);
    expect(problems({ ...form, sections: [{ id: "main", items: [] }] })).toEqual([]);
  });
});

describe("document level", () => {
  test.each([null, [], "entity", 3])("rejects non-object %j", (doc) => {
    expect(problems(doc)).toEqual([["", "type"]]);
  });

  test("missing and unknown kind", () => {
    expect(problems({})).toEqual([["/kind", "required"]]);
    expect(problems({ ...entity, kind: "chart" })).toEqual([["/kind", "unknown-kind"]]);
  });

  test("unsupported spec version", () => {
    expect(problems({ ...entity, specVersion: 1 })).toEqual([["/specVersion", "unsupported-spec-version"]]);
    expect(problems({ ...entity, specVersion: "0" })).toEqual([["/specVersion", "type"]]);
  });

  test("missing required and unknown properties", () => {
    const noRevision: Record<string, unknown> = { ...entity };
    delete noRevision["revision"];
    expect(problems(noRevision)).toEqual([["/revision", "required"]]);
    expect(problems({ ...entity, title: "x" })).toEqual([["/title", "unknown-property"]]);
  });

  test("ids and revisions", () => {
    expect(problems({ ...entity, id: "Hello World" })).toEqual([["/id", "invalid-value"]]);
    expect(problems({ ...entity, revision: 0 })).toEqual([["/revision", "invalid-value"]]);
    expect(problems({ ...entity, revision: 1.5 })).toEqual([["/revision", "invalid-value"]]);
  });

  test("collects every error, not just the first", () => {
    expect(problems({ ...form, id: "X", revision: -1, dataSource: "" })).toEqual([
      ["/id", "invalid-value"],
      ["/revision", "invalid-value"],
      ["/dataSource", "invalid-value"],
    ]);
  });
});

describe("entity fields", () => {
  const withFields = (...fields: unknown[]) => ({ ...entity, fields });

  test("unknown field type stops checking that field", () => {
    expect(problems(withFields({ id: "mood", type: "rating", label: "Mood", stars: 5 }))).toEqual([
      ["/fields/0/type", "unknown-field-type"],
    ]);
  });

  test("field properties", () => {
    expect(problems(withFields({ id: "name", type: "text", label: "", required: "yes", placeholder: "x" }))).toEqual([
      ["/fields/0/placeholder", "unknown-property"],
      ["/fields/0/label", "invalid-value"],
      ["/fields/0/required", "type"],
    ]);
  });

  test("duplicate field ids", () => {
    const field = { id: "name", type: "text", label: "Name" };
    expect(problems(withFields(field, field))).toEqual([["/fields/1/id", "duplicate-id"]]);
  });
});

describe("field types", () => {
  const withFields = (...fields: unknown[]) => ({ ...entity, fields });

  test("every field type validates in its full form", () => {
    expect(
      problems(
        withFields(
          { id: "notes", type: "text", label: "Notes" },
          { id: "weight", type: "number", label: "Weight", min: 0, max: 500, step: 2.5, unit: "kg", required: true },
          { id: "warmup", type: "boolean", label: "Warm-up set" },
          { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
          { id: "day", type: "date", label: "Day", min: "2020-01-01", max: "2030-12-31" },
        ),
      ),
    ).toEqual([]);
  });

  test("number bounds and step", () => {
    expect(problems(withFields({ id: "w", type: "number", label: "W", min: 10, max: 5, step: 0, unit: "" }))).toEqual([
      ["/fields/0/step", "invalid-value"],
      ["/fields/0/unit", "invalid-value"],
      ["/fields/0/min", "invalid-value"],
    ]);
    expect(problems(withFields({ id: "w", type: "number", label: "W", min: "0" }))).toEqual([["/fields/0/min", "type"]]);
  });

  test("properties are per type", () => {
    expect(problems(withFields({ id: "t", type: "text", label: "T", min: 1 }))).toEqual([["/fields/0/min", "unknown-property"]]);
  });

  test("select options", () => {
    const select = (options: unknown) => withFields({ id: "s", type: "select", label: "S", options });
    expect(problems(withFields({ id: "s", type: "select", label: "S" }))).toEqual([["/fields/0/options", "required"]]);
    expect(problems(select({ source: "entity", values: [] }))).toEqual([
      ["/fields/0/options/source", "invalid-value"],
      ["/fields/0/options/values", "invalid-value"],
    ]);
    expect(problems(select({ source: "static", values: ["A", "", "A", 3] }))).toEqual([
      ["/fields/0/options/values/1", "invalid-value"],
      ["/fields/0/options/values/2", "duplicate-id"],
      ["/fields/0/options/values/3", "invalid-value"],
    ]);
  });

  test("date bounds must be real YYYY-MM-DD days, min before max", () => {
    expect(problems(withFields({ id: "d", type: "date", label: "D", min: "2026-02-30", max: "10/04/2026" }))).toEqual([
      ["/fields/0/min", "invalid-value"],
      ["/fields/0/max", "invalid-value"],
    ]);
    expect(problems(withFields({ id: "d", type: "date", label: "D", min: "2027-01-01", max: "2026-01-01" }))).toEqual([
      ["/fields/0/min", "invalid-value"],
    ]);
  });
});

describe("table views", () => {
  const table = {
    kind: "table",
    specVersion: 0,
    id: "sets",
    title: "Sets",
    entity: "workout_set",
    revision: 1,
    dataSource: "default",
    columns: [{ field: "day" }, { field: "weight", editable: true }],
    sort: [{ field: "day", dir: "desc" }],
    pageSize: 25,
  };

  test("a full table view validates", () => {
    expect(problems(table)).toEqual([]);
    const { sort: _sort, pageSize: _pageSize, ...minimal } = table;
    expect(problems(minimal)).toEqual([]);
  });

  test("columns, sort and page size", () => {
    expect(problems({ ...table, columns: [] })).toEqual([["/columns", "invalid-value"]]);
    expect(problems({ ...table, columns: [{ field: "day" }, { field: "day", editable: "yes" }] })).toEqual([
      ["/columns/1/editable", "type"],
      ["/columns/1/field", "duplicate-id"],
    ]);
    expect(problems({ ...table, sort: [{ field: "day", dir: "up" }] })).toEqual([["/sort/0/dir", "invalid-value"]]);
    expect(problems({ ...table, pageSize: 0 })).toEqual([["/pageSize", "invalid-value"]]);
  });
});

describe("dashboards", () => {
  const dashboard = {
    kind: "dashboard",
    specVersion: 0,
    id: "fitnotes",
    title: "Training",
    revision: 1,
    tabs: [
      {
        id: "log",
        title: "Log",
        items: [
          { id: "form", x: 0, y: 0, w: 8, h: 2, widget: "view", view: "log_set" },
          { id: "total", x: 8, y: 0, w: 4, h: 1, widget: "count", label: "Sets", view: "sets", filter: { op: "eq", field: "warmup", value: false } },
        ],
      },
      { id: "history", title: "History", columns: 6, items: [{ id: "table", x: 0, y: 0, w: 6, h: 3, widget: "view", view: "sets" }] },
    ],
  };
  const withItems = (items: unknown[]) => ({ ...dashboard, tabs: [{ id: "t", title: "T", items }] });

  test("a full dashboard validates", () => {
    expect(problems(dashboard)).toEqual([]);
  });

  test("grid bounds and overlaps", () => {
    expect(
      problems(
        withItems([
          { id: "a", x: 0, y: 0, w: 6, h: 2, widget: "view", view: "v" },
          { id: "b", x: 4, y: 1, w: 4, h: 1, widget: "view", view: "v" },
          { id: "c", x: 10, y: 0, w: 4, h: 1, widget: "view", view: "v" },
          { id: "d", x: -1, y: 0, w: 0, h: 1, widget: "view", view: "v" },
        ]),
      ),
    ).toEqual([
      ["/tabs/0/items/2/w", "invalid-value"],
      ["/tabs/0/items/3/x", "invalid-value"],
      ["/tabs/0/items/3/w", "invalid-value"],
      ["/tabs/0/items/1", "invalid-value"],
    ]);
  });

  test("widgets are discriminated on widget", () => {
    expect(problems(withItems([{ id: "a", x: 0, y: 0, w: 1, h: 1, widget: "chart", view: "v" }]))).toEqual([["/tabs/0/items/0/widget", "invalid-value"]]);
    expect(problems(withItems([{ id: "a", x: 0, y: 0, w: 1, h: 1, widget: "count", view: "v" }]))).toEqual([["/tabs/0/items/0/label", "required"]]);
    expect(problems(withItems([{ id: "a", x: 0, y: 0, w: 1, h: 1, widget: "view", view: "v", label: "x" }]))).toEqual([["/tabs/0/items/0/label", "unknown-property"]]);
  });

  test("tabs", () => {
    expect(problems({ ...dashboard, tabs: [] })).toEqual([["/tabs", "invalid-value"]]);
    expect(problems({ ...dashboard, tabs: [dashboard.tabs[1], dashboard.tabs[1]] })).toEqual([["/tabs/1/id", "duplicate-id"]]);
  });
});

describe("form sections and items", () => {
  test("duplicate sections and fields placed twice", () => {
    const section = { id: "main", items: [{ field: "name" }] };
    expect(problems({ ...form, sections: [section, section] })).toEqual([
      ["/sections/1/id", "duplicate-id"],
      ["/sections/1/items/0/field", "duplicate-id"],
    ]);
  });

  test("item shape", () => {
    expect(problems({ ...form, sections: [{ id: "main", items: ["name", { field: "Name" }] }] })).toEqual([
      ["/sections/0/items/0", "type"],
      ["/sections/0/items/1/field", "invalid-value"],
    ]);
  });
});

test("every error has a message and a hint", () => {
  const result = validateDocument({ ...form, id: 1, sections: [{ items: [{}] }], extra: true });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  for (const e of result.errors) {
    expect(e.message.length, e.path).toBeGreaterThan(0);
    expect(e.hint.length, e.path).toBeGreaterThan(0);
  }
});

test("jsonPointer escapes ~ and /", () => {
  expect(jsonPointer([])).toBe("");
  expect(jsonPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
});
