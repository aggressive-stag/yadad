import type { EntityDocument } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { emptyFormState, setFieldValue, submitForm } from "./form";
import { createMemoryAdapter } from "./memory-adapter";
import { validateRecord } from "./record";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "hello",
  revision: 4,
  fields: [
    { id: "name", type: "text", label: "Name", required: true },
    { id: "note", type: "text", label: "Note" },
  ],
};

describe("validateRecord", () => {
  test("required text must be non-blank", () => {
    expect(validateRecord(entity, { name: "Ada" })).toEqual([]);
    for (const values of [{}, { name: null }, { name: "  " }]) {
      expect(validateRecord(entity, values).map((e) => [e.path, e.code])).toEqual([["/name", "required"]]);
    }
  });

  test("unknown keys are errors", () => {
    expect(validateRecord(entity, { name: "Ada", age: "3" }).map((e) => [e.path, e.code])).toEqual([
      ["/age", "unknown-property"],
    ]);
  });
});

describe("form state", () => {
  test("setFieldValue sets, clears and drops that field's errors", () => {
    const withError = { values: {}, errors: validateRecord(entity, {}) };
    const typed = setFieldValue(withError, "name", "Ada");
    expect(typed).toEqual({ values: { name: "Ada" }, errors: [] });
    expect(setFieldValue(typed, "name", undefined).values).toEqual({});
    expect(emptyFormState).toEqual({ values: {}, errors: [] });
  });

  test("submit creates a record under the entity's current revision", async () => {
    const db = createMemoryAdapter();
    const result = await submitForm(entity, { name: "Ada" }, db);
    expect(result).toEqual({
      ok: true,
      record: { id: "1", entityId: "hello", entityRevision: 4, values: { name: "Ada" } },
    });
  });

  test("invalid submit returns errors and writes nothing", async () => {
    const db = createMemoryAdapter();
    const result = await submitForm(entity, {}, db);
    expect(result.ok).toBe(false);
    expect((await db.find("hello", {})).total).toBe(0);
  });
});
