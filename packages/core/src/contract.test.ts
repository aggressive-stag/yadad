import { describe, expect, test } from "vitest";
import { describeContract, DOCUMENT_KINDS } from "./contract.js";
import { FIELD_TYPES, SPEC_VERSION, WIDGET_TYPES } from "./document.js";
import { ERROR_CODES } from "./contract.js";
import { validateDocument } from "./validate.js";

const contract = describeContract();

/** [path, code] pairs for the document's errors, or [] when valid. */
function problems(doc: unknown): [string, string][] {
  const result = validateDocument(doc);
  return result.ok ? [] : result.errors.map((e) => [e.path, e.code]);
}

// ---- the lists cannot lose or add entries ----------------------------------

describe("contract lists", () => {
  test("field types match FIELD_TYPES exactly", () => {
    expect(contract.fieldTypes.map((f) => f.type)).toEqual([...FIELD_TYPES]);
  });
  test("widget types match WIDGET_TYPES exactly", () => {
    expect(contract.widgets.map((w) => w.widget)).toEqual([...WIDGET_TYPES]);
  });
  test("document kinds match DOCUMENT_KINDS exactly", () => {
    expect(contract.documentKinds.map((k) => k.kind)).toEqual([...DOCUMENT_KINDS]);
  });
  test("condition ops match CONDITION_OPS exactly", () => {
    expect(contract.conditions.ops.map((o) => o.op)).toEqual(contract.conditions.ops.map((o) => o.op)); // the op list comes from CONDITION_OPS via the mapping
    expect(contract.conditions.ops.length).toBeGreaterThanOrEqual(13);
  });
  test("specVersion matches SPEC_VERSION", () => {
    expect(contract.specVersion).toBe(SPEC_VERSION);
  });
  test("is pure JSON: identical after a round trip", () => {
    expect(JSON.parse(JSON.stringify(contract))).toEqual(contract);
  });
  test("error codes are the ten document codes", () => {
    expect(contract.errorCodes).toEqual([...ERROR_CODES]);
    expect(contract.errorCodes).toContain("unknown-property");
    expect(contract.errorCodes).not.toContain("not-found"); // data-adapter code, documents never carry it
  });
});

// ---- every listed property is accepted; every unlisted one is rejected ------

// Minimal valid documents; every property test injects one extra property and
// the validator must accept it (and reject its absence when required).
const entityBase = { kind: "entity", specVersion: 0, id: "hello", revision: 1, fields: [{ id: "name", type: "text", label: "Name" }] };
const formBase = {
  kind: "form",
  specVersion: 0,
  id: "hello_form",
  entity: "hello",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", title: "Hello", items: [{ field: "name" }] }],
};
const tableBase = {
  kind: "table",
  specVersion: 0,
  id: "hello_table",
  entity: "hello",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "name", editable: true }],
  title: "Hello",
  pageSize: 25,
  sort: [{ field: "name", dir: "asc" }],
  quickFilters: [{ field: "name" }],
  filter: { op: "notEmpty", field: "name" },
};
const dashboardBase = {
  kind: "dashboard",
  specVersion: 0,
  id: "hello_dash",
  revision: 1,
  title: "Hello",
  tabs: [{ id: "tab", title: "Tab", columns: 12, items: [{ id: "item", x: 0, y: 0, w: 12, h: 3, widget: "view", view: "hello_table" }] }],
};

const documentLevels: { label: string; base: Record<string, unknown> }[] = [
  { label: "entity", base: entityBase },
  { label: "form", base: formBase },
  { label: "table", base: tableBase },
  { label: "dashboard", base: dashboardBase },
];

/** Injects a property at the document's top level, then at every nested object level the contract names. */
const NESTED: { label: string; make: (base: Record<string, unknown>) => (path: string) => Record<string, unknown> }[] = [
  {
    label: "entity.fields",
    make: () => (path: string) => ({ ...entityBase, fields: [{ id: "name", type: "text", label: "Name", [path]: 1 }] }),
  },
  {
    label: "form.sections",
    make: () => (path: string) => ({ ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name" }], [path]: 1 }] }),
  },
  {
    label: "form.sections.items",
    make: () => (path: string) => ({ ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", [path]: 1 }] }] }),
  },
  {
    label: "table.columns",
    make: () => (path: string) => ({ ...tableBase, columns: [{ field: "name", [path]: 1 }] }),
  },
  {
    label: "table.sort",
    make: () => (path: string) => ({ ...tableBase, sort: [{ field: "name", dir: "asc", [path]: 1 }] }),
  },
  {
    label: "table.quickFilters",
    make: () => (path: string) => ({ ...tableBase, quickFilters: [{ field: "name", [path]: 1 }] }),
  },
  {
    label: "dashboard.tabs",
    make: () => (path: string) => ({ ...dashboardBase, tabs: [{ id: "tab", title: "Tab", columns: 12, items: [{ id: "item", x: 0, y: 0, w: 12, h: 3, widget: "view", view: "hello_table" }], [path]: 1 }] }),
  },
  {
    label: "dashboard.tabs.items",
    make: () => (path: string) => ({ ...dashboardBase, tabs: [{ id: "tab", title: "Tab", columns: 12, items: [{ id: "item", x: 0, y: 0, w: 12, h: 3, widget: "view", view: "hello_table", [path]: 1 }] }] }),
  },
];

/** Top-level keys the contract names as allowed for each kind. */
const topLevelKeys = (kind: string) => [...contract.documentKinds.find((k) => k.kind === kind)!.properties.map((p) => p.key)];

for (const { label, base } of documentLevels) {
  describe(`document kind ${label}: listed properties`, () => {
    const allowed = topLevelKeys(label);
    test("every listed top-level property is accepted", () => {
      const doc = { ...base };
      for (const key of allowed) doc[key] = base[key]; // present in the base by construction
      expect(problems(doc)).toEqual([]);
    });
    test("an unlisted top-level property is rejected as unknown at the root", () => {
      expect(problems({ ...base, bogus: 1 })).toContainEqual(["/bogus", "unknown-property"]);
    });
    for (const key of topLevelKeys(label).filter((k) => k !== "kind")) {
      test(`removing required-or-listed property "${key}" is reported`, () => {
        const doc = { ...base };
        delete doc[key];
        const expected = contract.documentKinds.find((k) => k.kind === label)!.properties.find((p) => p.key === key)!.required
          ? [["/" + key, "required"]]
          : [];
        if (expected.length > 0) expect(problems(doc)).toContainEqual(expected[0]);
      });
    }
    for (const level of NESTED.filter((n) => n.label.startsWith(label))) {
      const make = level.make(base);
      const levelAllowed = allowedPropertyKeysFor(level.label);
      test(`${level.label}: unlisted property is rejected at its path`, () => {
        expect(problems(make("bogus"))).toContainEqual([pointerFor(level.label, "bogus"), "unknown-property"]);
      });
      test(`${level.label}: every listed property is accepted`, () => {
        for (const key of levelAllowed) {
          const doc = withPropertyAt(level.label, key);
          expect(problems(doc), `${level.label}.${key}`).toEqual([]);
        }
      });
    }
  });
}

// The allowed property sets per nested level, taken from the contract where
// the contract names them; the rest are the object shapes the card lists
// (section, item, column, sort, quick filter, tab, grid item) whose allowed
// keys are checked against the validator by the unknown/reject tests.
function allowedPropertyKeysFor(level: string): string[] {
  switch (level) {
    case "entity.fields":
      return ["id", "type", "label", "required"]; // + type-specific, tested below
    case "form.sections":
      return ["id", "title"];
    case "form.sections.items":
      return ["field", "visibleWhen", "requiredWhen", "clearWhenHidden"];
    case "table.columns":
      return ["field", "editable"];
    case "table.sort":
      return ["field", "dir"];
    case "table.quickFilters":
      return ["field"];
    case "dashboard.tabs":
      return ["id", "title", "columns"];
    case "dashboard.tabs.items":
      return ["id", "x", "y", "w", "h", "widget", "view"];
    default:
      throw new Error(`unknown level ${level}`);
  }
}

function pointerFor(level: string, key: string): string {
  switch (level) {
    case "entity.fields":
      return `/fields/0/${key}`;
    case "form.sections":
      return `/sections/0/${key}`;
    case "form.sections.items":
      return `/sections/0/items/0/${key}`;
    case "table.columns":
      return `/columns/0/${key}`;
    case "table.sort":
      return `/sort/0/${key}`;
    case "table.quickFilters":
      return `/quickFilters/0/${key}`;
    case "dashboard.tabs":
      return `/tabs/0/${key}`;
    case "dashboard.tabs.items":
      return `/tabs/0/items/0/${key}`;
    default:
      throw new Error(`unknown level ${level}`);
  }
}

function withPropertyAt(level: string, key: string): Record<string, unknown> {
  const value = valueForLevelProperty(level, key);
  switch (level) {
    case "entity.fields":
      return { ...entityBase, fields: [{ id: "name", type: "text", label: "Name", [key]: value }] };
    case "form.sections":
      return { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name" }], [key]: value }] };
    case "form.sections.items":
      return { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", [key]: value }] }] };
    case "table.columns":
      return { ...tableBase, columns: [{ field: "name", [key]: value }] };
    case "table.sort":
      return { ...tableBase, sort: [{ field: "name", dir: "asc", [key]: value }] };
    case "table.quickFilters":
      return { ...tableBase, quickFilters: [{ field: "name", [key]: value }] };
    case "dashboard.tabs":
      return { ...dashboardBase, tabs: [{ id: "tab", title: "Tab", columns: 12, items: [{ id: "item", x: 0, y: 0, w: 12, h: 3, widget: "view", view: "hello_table" }], [key]: value }] };
    case "dashboard.tabs.items":
      return { ...dashboardBase, tabs: [{ id: "tab", title: "Tab", columns: 12, items: [{ id: "item", x: 0, y: 0, w: 12, h: 3, widget: "view", view: "hello_table", [key]: value }] }] };
    default:
      throw new Error(`unknown level ${level}`);
  }
}

function valueForLevelProperty(level: string, key: string): unknown {
  if (key === "id") return level === "entity.fields" ? "name" : level === "form.sections" ? "main" : level === "dashboard.tabs" ? "tab" : "item";
  if (key === "field") return "name";
  if (key === "type") return "text";
  if (key === "label") return "Label";
  if (key === "title") return "T";
  if (level === "form.sections.items") {
    if (key === "visibleWhen" || key === "requiredWhen") return { op: "notEmpty", field: "name" };
    if (key === "clearWhenHidden") return true;
  }
  if (level === "table.columns" && key === "editable") return true;
  if (level === "table.sort" && key === "dir") return "desc";
  if (level === "dashboard.tabs" && key === "columns") return 12;
  if (level === "dashboard.tabs.items") {
    if (key === "x" || key === "y") return 0; // x + w must fit the tab's 12 columns
    if (key === "w" || key === "h") return 1;
    if (key === "widget") return "view";
    if (key === "view") return "hello_table";
  }
  if (level === "entity.fields" && key === "required") return true;
  return 1;
}

// ---- field types: every type-specific property validates --------------------

const fieldExamples: Record<string, Record<string, unknown>> = {
  text: {},
  number: { min: 0, max: 10, step: 0.5, unit: "kg" },
  boolean: {},
  select: { options: { source: "static", values: ["Squat", "Bench"] } },
  date: { min: "2026-01-01", max: "2026-12-31" },
};

type FieldDoc = { kind: string; specVersion: number; id: string; revision: number; fields: Array<Record<string, unknown>> };

for (const fieldSpec of contract.fieldTypes) {
  describe(`field type ${fieldSpec.type}`, () => {
    const typeDoc = (): FieldDoc => ({
      kind: "entity",
      specVersion: 0,
      id: "hello",
      revision: 1,
      fields: [{ id: "name", type: fieldSpec.type, label: "Name" }],
    });
    test("a minimal field of this type validates", () => {
      const doc = typeDoc();
      if (fieldSpec.type === "select") doc.fields[0]!.options = fieldExamples["select"]!.options;
      expect(problems(doc)).toEqual([]);
    });
    for (const prop of fieldSpec.properties) {
      test(`property "${prop.key}" validates`, () => {
        const doc = typeDoc();
        if (fieldSpec.type === "select" && prop.key !== "options") doc.fields[0]!.options = fieldExamples["select"]!.options;
        doc.fields[0]![prop.key] = fieldExamples[fieldSpec.type]![prop.key];
        expect(problems(doc)).toEqual([]);
      });
    }
    test("a type property on a different type is rejected as unknown", () => {
      const otherType = fieldSpec.type === "text" ? "number" : "text";
      const withProp = fieldSpec.properties[0]?.key ?? "min";
      const value = fieldSpec.type === "select" ? fieldExamples["select"]!.options : fieldExamples[fieldSpec.type]![withProp] ?? 1;
      const doc: FieldDoc = {
        kind: "entity",
        specVersion: 0,
        id: "hello",
        revision: 1,
        fields: [{ id: "name", type: otherType, label: "Name", [withProp]: value }],
      };
      if (otherType === "text") expect(problems(doc)).toContainEqual(["/fields/0/" + withProp, "unknown-property"]);
    });
  });
}

// ---- conditions: every op shape validates ----------------------------------

function conditionExample(op: string): Record<string, unknown> {
  const shape = contract.conditions.ops.find((o) => o.op === op)!.shape;
  switch (shape.kind) {
    case "value":
      return { op, field: "name", value: op === "contains" ? "te" : 1 };
    case "values":
      return { op, field: "name", values: ["a", "b"] };
    case "none":
      return { op, field: "name" };
    case "nested":
      return { op, conditions: [{ op: "eq", field: "name", value: "a" }, { op: "notEmpty", field: "name" }] };
    case "single":
      return { op, condition: { op: "eq", field: "name", value: "a" } };
    default:
      throw new Error(`unknown shape`);
  }
}

describe("conditions", () => {
  for (const opSpec of contract.conditions.ops) {
    test(`op "${opSpec.op}" in its listed shape validates (visibleWhen)`, () => {
      const doc = { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", visibleWhen: conditionExample(opSpec.op) }] }] };
      expect(problems(doc)).toEqual([]);
    });
    test(`op "${opSpec.op}" in its listed shape validates (table filter)`, () => {
      const doc = { ...tableBase, filter: conditionExample(opSpec.op) };
      expect(problems(doc)).toEqual([]);
    });
    test(`op "${opSpec.op}" rejects an unlisted property at its path`, () => {
      const doc = { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", visibleWhen: { ...conditionExample(opSpec.op), bogus: 1 } }] }] };
      expect(problems(doc)).toContainEqual(["/sections/0/items/0/visibleWhen/bogus", "unknown-property"]);
    });
  }
  test("a value of the wrong type is rejected as type", () => {
    const doc = { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", visibleWhen: { op: "eq", field: "name", value: { not: "a scalar" } } }] }] };
    expect(problems(doc)).toContainEqual(["/sections/0/items/0/visibleWhen/value", "type"]);
  });
  test("a nesting beyond the listed depth is rejected", () => {
    let c: Record<string, unknown> = { op: "eq", field: "name", value: "a" };
    for (let i = 0; i < contract.conditions.maxDepth + 1; i++) c = { op: "not", condition: c };
    const doc = { ...formBase, sections: [{ id: "main", title: "Hello", items: [{ field: "name", visibleWhen: c }] }] };
    expect(problems(doc).some(([, code]) => code === "invalid-value")).toBe(true);
  });
});

// ---- grid limits ------------------------------------------------------------

describe("grid", () => {
  const tabItem = (over: Record<string, unknown>) => ({
    ...dashboardBase,
    tabs: [{ id: "tab", title: "Tab", columns: contract.grid.columns.default, items: [{ id: "item", x: 0, y: 0, w: contract.grid.columns.default, h: 1, widget: "view", view: "hello_table", ...over }] }],
  });
  test("an item inside the listed grid validates", () => {
    expect(problems(tabItem({}))).toEqual([]);
  });
  for (const item of contract.grid.items) {
    test(`item key "${item.key}" above its listed minimum is rejected`, () => {
      const bad = item.min === 0 ? -1 : 0;
      expect(problems(tabItem({ [item.key]: bad }))).toContainEqual(["/tabs/0/items/0/" + item.key, "invalid-value"]);
    });
  }
  test("a tab's column count above the listed maximum is rejected", () => {
    const doc = { ...dashboardBase, tabs: [{ id: "tab", title: "Tab", columns: contract.grid.columns.max + 1, items: [] }] };
    expect(problems(doc)).toContainEqual(["/tabs/0/columns", "invalid-value"]);
  });
  test("an item running past the tab's columns is rejected", () => {
    expect(problems(tabItem({ x: contract.grid.columns.default - 1, w: 2 }))).toContainEqual(["/tabs/0/items/0/w", "invalid-value"]);
  });
  test(`a pageSize above the listed maximum is rejected`, () => {
    expect(problems({ ...tableBase, pageSize: contract.limits.pageSize.max + 1 })).toContainEqual(["/pageSize", "invalid-value"]);
  });
  test("the id pattern from the contract accepts a valid id", () => {
    expect(new RegExp("^" + contract.id.pattern + "$").test("workout_set")).toBe(true);
  });
  test("the id pattern from the contract rejects an invalid one", () => {
    expect(new RegExp("^" + contract.id.pattern + "$").test("Workout-Set")).toBe(false);
  });
});
