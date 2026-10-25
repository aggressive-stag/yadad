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
    expect(result).toEqual({ ok: true, value: entity, warnings: [] });
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
    expect(problems({ ...entity, specVersion: 8 })).toEqual([["/specVersion", "unsupported-spec-version"]]);
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

  // RFC 0001 slice 2: series shape (cross-document field checks live in the set checks).
  const series = (over: Record<string, unknown> = {}, drop: string[] = []) => {
    const base = {
      id: "per_day", x: 0, y: 0, w: 8, h: 5,
      widget: "series", label: "Volume per day", view: "sets",
      groupBy: { field: "date" },
      measure: { op: "sum", product: ["weight", "reps"] },
      display: "bar",
    } as Record<string, unknown>;
    for (const key of drop) delete base[key];
    return withItems([{ ...base, ...over }]);
  };

  test("a valid series widget", () => {
    expect(problems(series())).toEqual([]);
    expect(problems(series({ display: "line", sort: { by: "value", dir: "desc" }, limit: 200, filter: { op: "eq", field: "warmup", value: false } }))).toEqual([]);
    expect(problems(series({ groupBy: { field: "exercise", bucket: "day" } }))).toEqual([]); // bucket-on-select is a cross-document check (43c), shape is fine
  });

  test("series requires its keys and refuses unknown ones", () => {
    expect(problems(series({}, ["label", "view", "groupBy", "measure", "display"]))).toEqual([
      ["/tabs/0/items/0/label", "required"],
      ["/tabs/0/items/0/view", "required"],
      ["/tabs/0/items/0/groupBy", "required"],
      ["/tabs/0/items/0/measure", "required"],
      ["/tabs/0/items/0/display", "required"],
    ]);
    expect(problems(series({ extra: 1 }))).toEqual([["/tabs/0/items/0/extra", "unknown-property"]]);
  });

  test("series display enum", () => {
    expect(problems(series({ display: "pie" }))).toEqual([["/tabs/0/items/0/display", "invalid-value"]]);
  });

  test("series groupBy shape", () => {
    expect(problems(series({ groupBy: "date" }))).toEqual([["/tabs/0/items/0/groupBy", "type"]]);
    expect(problems(series({ groupBy: {} }))).toEqual([["/tabs/0/items/0/groupBy/field", "required"]]);
    expect(problems(series({ groupBy: { field: "date", bucket: "quarter" } }))).toEqual([["/tabs/0/items/0/groupBy/bucket", "invalid-value"]]);
    expect(problems(series({ groupBy: { field: "not an id" } }))).toEqual([["/tabs/0/items/0/groupBy/field", "invalid-value"]]);
    expect(problems(series({ groupBy: { field: "date", extra: 1 } }))).toEqual([["/tabs/0/items/0/groupBy/extra", "unknown-property"]]);
  });

  test("series sort enums", () => {
    expect(problems(series({ sort: { by: "date", dir: "asc" } }))).toEqual([["/tabs/0/items/0/sort/by", "invalid-value"]]);
    expect(problems(series({ sort: { by: "group", dir: "sideways" } }))).toEqual([["/tabs/0/items/0/sort/dir", "invalid-value"]]);
    expect(problems(series({ sort: { by: "group" } }))).toEqual([["/tabs/0/items/0/sort/dir", "required"]]);
    expect(problems(series({ sort: "group" }))).toEqual([["/tabs/0/items/0/sort", "type"]]);
  });

  test("series limit bound", () => {
    expect(problems(series({ limit: 0 }))).toEqual([["/tabs/0/items/0/limit", "invalid-value"]]);
    expect(problems(series({ limit: 201 }))).toEqual([["/tabs/0/items/0/limit", "invalid-value"]]);
    expect(problems(series({ limit: 1.5 }))).toEqual([["/tabs/0/items/0/limit", "invalid-value"]]);
    expect(problems(series({ limit: 1 }))).toEqual([]);
    expect(problems(series({ limit: 200 }))).toEqual([]);
  });

  test("series reuses the measure shape check", () => {
    expect(problems(series({ measure: { op: "median", field: "weight" } }))).toEqual([["/tabs/0/items/0/measure/op", "invalid-value"]]);
    expect(problems(series({ measure: { op: "sum", field: "weight", product: ["a", "b"] } }))).toEqual([["/tabs/0/items/0/measure/product", "invalid-value"]]);
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

describe("warnings", () => {
  const warnings = (doc: unknown) => validateDocument(doc).warnings.map((w) => [w.path, w.code]);

  test("empty content is valid but warned about", () => {
    expect(validateDocument({ ...entity, fields: [] }).ok).toBe(true);
    expect(warnings({ ...entity, fields: [] })).toEqual([["/fields", "empty"]]);
    expect(warnings({ ...form, sections: [] })).toEqual([["/sections", "empty"]]);
    expect(warnings({ ...form, sections: [{ id: "main", items: [] }] })).toEqual([["/sections", "empty"]]);
    expect(warnings({ ...form, sections: [...form.sections, { id: "more", items: [] }] })).toEqual([["/sections/1/items", "empty"]]);
    expect(warnings({ kind: "dashboard", specVersion: 0, id: "d", revision: 1, tabs: [{ id: "t", title: "T", items: [] }] })).toEqual([["/tabs/0/items", "empty"]]);
  });

  test("documents with content have none", () => {
    expect(warnings(entity)).toEqual([]);
    expect(warnings(form)).toEqual([]);
  });
});

describe("condition hints", () => {
  const conditionErrors = (condition: unknown) => {
    const result = validateDocument({ ...form, sections: [{ id: "main", items: [{ field: "name", visibleWhen: condition }] }] });
    return result.ok ? [] : result.errors.map((e) => ({ path: e.path, message: e.message, hint: e.hint }));
  };
  const at = "/sections/0/items/0/visibleWhen";

  test("a one-letter slip names the key the op takes and shows its shape", () => {
    const [unknown, missing] = conditionErrors({ op: "in", field: "name", value: ["a"] });
    expect(unknown).toMatchObject({ path: `${at}/value`, message: '"in" takes "values", not "value".' });
    expect(unknown?.hint).toContain('"values": ["Squat", "Bench"]');
    expect(missing).toMatchObject({ path: `${at}/values`, message: 'Missing required property "values" for "in".' });

    expect(conditionErrors({ op: "not", conditions: [] })[0]?.message).toBe('"not" takes "condition", not "conditions".');
    expect(conditionErrors({ op: "and", condition: { op: "empty", field: "name" } })[0]?.message).toBe('"and" takes "conditions", not "condition".');
  });

  test("other unknown keys still list what the op allows", () => {
    const errors = validateDocument({ ...form, sections: [{ id: "main", items: [{ field: "name", visibleWhen: { op: "empty", field: "name", value: 1 } }] }] });
    expect(errors.ok ? [] : errors.errors.map((e) => [e.message, e.allowed])).toEqual([['Unknown property "value" for "empty".', ["op", "field"]]]);
  });
});

describe("reference fields", () => {
  const entity = (field: object) => ({ kind: "entity", specVersion: 2, id: "entry", revision: 1, fields: [field] });
  const problemsOf = (doc: unknown): [string, string][] => {
    const result = validateDocument(doc);
    return result.ok ? [] : result.errors.map((e) => [e.path, e.code]);
  };

  test("accepts entity and an optional display", () => {
    expect(problemsOf(entity({ id: "ex", type: "reference", label: "Exercise", entity: "exercise" }))).toEqual([]);
    expect(problemsOf(entity({ id: "ex", type: "reference", label: "Exercise", entity: "exercise", display: "name", required: true }))).toEqual([]);
  });
  test("requires entity, rejects unknown properties and bad ids", () => {
    expect(problemsOf(entity({ id: "ex", type: "reference", label: "Exercise" }))).toEqual([["/fields/0/entity", "required"]]);
    expect(problemsOf(entity({ id: "ex", type: "reference", label: "Exercise", entity: "exercise", options: [] }))).toEqual([["/fields/0/options", "unknown-property"]]);
    expect(problemsOf(entity({ id: "ex", type: "reference", label: "Exercise", entity: "Bad Id" }))).toEqual([["/fields/0/entity", "invalid-value"]]);
  });
});

describe("calendar view", () => {
  const calendar = { kind: "calendar", specVersion: 3, id: "cal", entity: "e", revision: 1, dataSource: "default", dateField: "day" };

  test("the required keys are enough, and every optional key is accepted", () => {
    expect(problems(calendar)).toEqual([]);
    const full = {
      ...calendar,
      title: "Cal",
      titleField: "name",
      detailFields: ["a", "b", "c"],
      colorField: "mood",
      filter: { op: "notEmpty", field: "name" },
      sort: [{ field: "name", dir: "desc" }],
      modes: ["week"],
      weekStartsOn: 0,
      editable: false,
      rowAction: { open: "t", bind: [{ field: "a", to: "a" }] },
    };
    expect(problems(full)).toEqual([]);
  });

  test("required keys and unknown properties", () => {
    expect(problems({ kind: "calendar", specVersion: 3 })).toEqual([
      ["/id", "required"],
      ["/entity", "required"],
      ["/revision", "required"],
      ["/dataSource", "required"],
      ["/dateField", "required"],
    ]);
    expect(problems({ ...calendar, columns: [] })).toEqual([["/columns", "unknown-property"]]);
  });

  test("ids", () => {
    expect(problems({ ...calendar, dateField: 3, titleField: "Bad Id", colorField: [] })).toEqual([
      ["/dateField", "type"],
      ["/titleField", "invalid-value"],
      ["/colorField", "type"],
    ]);
  });

  test("detailFields: shape, at most three, no duplicates", () => {
    expect(problems({ ...calendar, detailFields: "a" })).toEqual([["/detailFields", "type"]]);
    expect(problems({ ...calendar, detailFields: ["a", 1] })).toEqual([["/detailFields/1", "type"]]);
    expect(problems({ ...calendar, detailFields: ["a", "b", "c", "d"] })).toEqual([["/detailFields", "invalid-value"]]);
    expect(problems({ ...calendar, detailFields: ["a", "b", "a"] })).toEqual([["/detailFields/2", "invalid-value"]]);
  });

  test("modes: an array, non-empty, month or week, no duplicates", () => {
    expect(problems({ ...calendar, modes: "month" })).toEqual([["/modes", "type"]]);
    expect(problems({ ...calendar, modes: [] })).toEqual([["/modes", "invalid-value"]]);
    expect(problems({ ...calendar, modes: ["month", "day"] })).toEqual([["/modes/1", "invalid-value"]]);
    expect(problems({ ...calendar, modes: ["month", "month"] })).toEqual([["/modes/1", "invalid-value"]]);
  });

  test("weekStartsOn: a whole number from 0 to 6", () => {
    expect(problems({ ...calendar, weekStartsOn: "1" })).toEqual([["/weekStartsOn", "type"]]);
    for (const bad of [7, -1, 1.5]) expect(problems({ ...calendar, weekStartsOn: bad })).toEqual([["/weekStartsOn", "invalid-value"]]);
    for (const good of [0, 1, 6]) expect(problems({ ...calendar, weekStartsOn: good })).toEqual([]);
  });

  test("editable, filter, sort and rowAction are checked as on tables", () => {
    expect(problems({ ...calendar, editable: "yes" })).toEqual([["/editable", "type"]]);
    expect(problems({ ...calendar, filter: { op: "eq", field: "x" } })).toEqual([["/filter/value", "required"]]);
    expect(problems({ ...calendar, sort: [{ field: "x", dir: "up" }] })).toEqual([["/sort/0/dir", "invalid-value"]]);
    expect(problems({ ...calendar, sort: [{ field: "x", dir: "asc" }, { field: "x", dir: "asc" }] })).toEqual([["/sort/1/field", "duplicate-id"]]);
    expect(problems({ ...calendar, rowAction: { open: "t", bind: [] } })).toEqual([["/rowAction/bind", "invalid-value"]]);
  });
});

describe("RFC 0008 item 5 — labelled, coloured static options", () => {
  const selectEntity = (values: unknown[]) => ({
    kind: "entity", specVersion: 0, id: "list", revision: 1,
    fields: [{ id: "color", type: "select", label: "Color", options: { source: "static", values } }],
  });

  test("plain strings and option objects both validate, mixed included", () => {
    expect(problems(selectEntity(["red", "blue"]))).toEqual([]);
    expect(problems(selectEntity([{ value: "#D13438", label: "Red", color: "#D13438" }, { value: "plain" }]))).toEqual([]);
  });

  test("duplicate values across the two forms collide", () => {
    expect(problems(selectEntity(["red", { value: "red", label: "Reddish" }]))).toEqual([["/fields/0/options/values/1", "duplicate-id"]]);
  });

  test("color must be #RRGGBB; label must be non-empty bounded text; unknown keys refused", () => {
    expect(problems(selectEntity([{ value: "a", color: "red" }]))).toEqual([["/fields/0/options/values/0/color", "invalid-value"]]);
    expect(problems(selectEntity([{ value: "a", color: "#D1343" }]))).toEqual([["/fields/0/options/values/0/color", "invalid-value"]]);
    expect(problems(selectEntity([{ value: "a", label: "  " }]))).toEqual([["/fields/0/options/values/0/label", "type"]]);
    expect(problems(selectEntity([{ value: "a", label: "x".repeat(121) }]))).toEqual([["/fields/0/options/values/0/label", "invalid-value"]]);
    expect(problems(selectEntity([{ value: "a", hex: "#D13438" }]))).toEqual([["/fields/0/options/values/0/hex", "unknown-property"]]);
    expect(problems(selectEntity([{ label: "no value" }]))).toEqual([["/fields/0/options/values/0/value", "required"]]);
  });
});

describe("RFC 0008 item 6 — a form item may relabel its field", () => {
  const itemForm = (item: object) => ({
    kind: "form", specVersion: 0, id: "f", entity: "hello", revision: 1, dataSource: "default",
    sections: [{ id: "main", items: [item] }],
  });

  test("label is optional, string when present", () => {
    expect(problems(itemForm({ field: "name", label: "Important" }))).toEqual([]);
    expect(problems(itemForm({ field: "name", label: "" }))).toEqual([["/sections/0/items/0/label", "type"]]);
    expect(problems(itemForm({ field: "name", label: 7 }))).toEqual([["/sections/0/items/0/label", "type"]]);
    expect(problems(itemForm({ field: "name", label: "x".repeat(121) }))).toEqual([["/sections/0/items/0/label", "invalid-value"]]);
  });
});

describe("RFC 0008 item 7 — the busy-day cap", () => {
  const cal = (extra: object) => ({
    kind: "calendar", specVersion: 0, id: "cal", entity: "hello", revision: 1, dataSource: "default",
    dateField: "name", ...extra,
  });

  test("an integer 1..31 validates; anything else is refused", () => {
    expect(problems(cal({ maxEntriesPerDay: 1 }))).toEqual([]);
    expect(problems(cal({ maxEntriesPerDay: 31 }))).toEqual([]);
    expect(problems(cal({ maxEntriesPerDay: 0 }))).toEqual([["/maxEntriesPerDay", "invalid-value"]]);
    expect(problems(cal({ maxEntriesPerDay: 32 }))).toEqual([["/maxEntriesPerDay", "invalid-value"]]);
    expect(problems(cal({ maxEntriesPerDay: 2.5 }))).toEqual([["/maxEntriesPerDay", "invalid-value"]]);
    expect(problems(cal({ maxEntriesPerDay: "3" }))).toEqual([["/maxEntriesPerDay", "invalid-value"]]);
  });
});

describe("RFC 0008 item 8 — a reference may borrow the target's colour", () => {
  const withRef = (extra: object) => ({
    kind: "entity", specVersion: 0, id: "item", revision: 1,
    fields: [{ id: "list", type: "reference", label: "List", entity: "hello", ...extra }],
  });

  test("colorFrom is an optional id; display stays optional", () => {
    expect(problems(withRef({}))).toEqual([]);
    expect(problems(withRef({ colorFrom: "name" }))).toEqual([]);
    expect(problems(withRef({ colorFrom: "Bad Id" }))).toEqual([["/fields/0/colorFrom", "invalid-value"]]);
  });
});
