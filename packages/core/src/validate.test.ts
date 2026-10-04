import { describe, expect, test } from "vitest";
import { jsonPointer } from "./errors";
import { validateDocument } from "./validate";

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
    expect(problems({ ...entity, kind: "table" })).toEqual([["/kind", "unknown-kind"]]);
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
    expect(problems(withFields({ id: "age", type: "number", label: "Age", min: 0 }))).toEqual([
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
