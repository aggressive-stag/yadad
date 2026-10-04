import type { EntityDocument } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { emptyFormState, setFieldValue, submitEdit, submitForm } from "./form.js";
import { createMemoryAdapter } from "./memory-adapter.js";
import { validateRecord } from "./record.js";

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

describe("validateRecord by field type", () => {
  const log: EntityDocument = {
    kind: "entity",
    specVersion: 0,
    id: "workout_set",
    revision: 1,
    fields: [
      { id: "exercise", type: "select", label: "Exercise", required: true, options: { source: "static", values: ["Squat", "Bench"] } },
      { id: "weight", type: "number", label: "Weight", min: 0, max: 500, step: 2.5, unit: "kg" },
      { id: "day", type: "date", label: "Day", min: "2020-01-01" },
      { id: "warmup", type: "boolean", label: "Warm-up" },
      { id: "consent", type: "boolean", label: "Consent", required: true },
    ],
  };
  const check = (values: Record<string, string | number | boolean | null>) =>
    validateRecord(log, { exercise: "Squat", consent: true, ...values }).map((e) => [e.path, e.code]);

  test("a valid record has no errors", () => {
    expect(check({ weight: 102.5, day: "2026-10-04", warmup: false })).toEqual([]);
    expect(check({ weight: 0.1 + 0.2 - 0.3 })).toEqual([]);
  });

  test("numbers: type, bounds and step", () => {
    expect(check({ weight: "100" })).toEqual([["/weight", "type"]]);
    expect(check({ weight: -5 })).toEqual([["/weight", "invalid-value"]]);
    expect(check({ weight: 501 })).toEqual([["/weight", "invalid-value"]]);
    expect(check({ weight: 101 })).toEqual([["/weight", "invalid-value"]]);
  });

  test("select must be one of the choices", () => {
    expect(check({ exercise: "Deadlift" })).toEqual([["/exercise", "invalid-value"]]);
    expect(check({ exercise: null })).toEqual([["/exercise", "required"]]);
  });

  test("dates must be real days within bounds", () => {
    expect(check({ day: "2026-02-30" })).toEqual([["/day", "type"]]);
    expect(check({ day: "2019-12-31" })).toEqual([["/day", "invalid-value"]]);
  });

  test("a required boolean must be true", () => {
    expect(check({ consent: false })).toEqual([["/consent", "required"]]);
    expect(check({ warmup: "yes" })).toEqual([["/warmup", "type"]]);
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

  test("submitEdit validates the merged record and saves the patch", async () => {
    const db = createMemoryAdapter();
    const created = await submitForm(entity, { name: "Ada", note: "x" }, db);
    if (!created.ok) throw new Error("setup");
    expect((await submitEdit(entity, created.record, { name: " " }, db)).ok).toBe(false);
    const edited = await submitEdit({ ...entity, revision: 5 }, created.record, { name: "Grace" }, db);
    expect(edited).toEqual({ ok: true, record: { ...created.record, entityRevision: 5, values: { name: "Grace", note: "x" } } });
  });

  test("invalid submit returns errors and writes nothing", async () => {
    const db = createMemoryAdapter();
    const result = await submitForm(entity, {}, db);
    expect(result.ok).toBe(false);
    expect((await db.find("hello", {})).total).toBe(0);
  });
});
