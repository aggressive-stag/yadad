import type { EntityDocument } from "@yadad/core";
import { ForbiddenError, RecordConflictError, RecordNotFoundError, RecordValidationError, UnauthorizedError } from "@yadad/core";
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
    if (!result.ok) throw new Error("setup");
    expect(result.record).toMatchObject({ id: "1", entityId: "hello", entityRevision: 4, values: { name: "Ada" } });
    expect(result.record.version).not.toBe("");
  });

  test("submitEdit validates the merged record and saves the patch", async () => {
    const db = createMemoryAdapter();
    const created = await submitForm(entity, { name: "Ada", note: "x" }, db);
    if (!created.ok) throw new Error("setup");
    expect((await submitEdit(entity, created.record, { name: " " }, db)).ok).toBe(false);
    const edited = await submitEdit({ ...entity, revision: 5 }, created.record, { name: "Grace" }, db);
    if (!edited.ok) throw new Error("edit failed");
    expect(edited.record).toMatchObject({ id: created.record.id, entityId: "hello", entityRevision: 5, values: { name: "Grace", note: "x" } });
    expect(edited.record.version).not.toBe(created.record.version);
  });

  test("submitEdit sends only changed values and skips the save when nothing changed", async () => {
    const db = createMemoryAdapter();
    const created = await submitForm(entity, { name: "Ada" }, db);
    if (!created.ok) throw new Error("setup");
    const patches: object[] = [];
    const spy = { ...db, update: (...args: Parameters<typeof db.update>) => (patches.push(args[2]), db.update(...args)) };
    const unchanged = await submitEdit(entity, created.record, { name: "Ada", note: null }, spy);
    expect(unchanged).toEqual({ ok: true, record: created.record });
    expect(patches).toEqual([]);
    const edited = await submitEdit(entity, created.record, { name: "Ada", note: "hi" }, spy);
    expect(edited.ok).toBe(true);
    expect(patches).toEqual([{ note: "hi" }]);
  });

  test("submitEdit ignores values the server sent for undeclared fields", async () => {
    // A records host may serve computed / server-managed values the entity
    // document never declared. They must not refuse the edit, and none of them
    // may ride along in the patch.
    const db = createMemoryAdapter();
    const served = await db.create("hello", { name: "Ada", note: "x", is_home: true, open_tasks: 3 }, { entityRevision: 4 });
    const patches: object[] = [];
    const spy = { ...db, update: (...args: Parameters<typeof db.update>) => (patches.push(args[2]), db.update(...args)) };
    const edited = await submitEdit(entity, served, { name: "Grace" }, spy);
    if (!edited.ok) throw new Error(`edit refused: ${JSON.stringify(edited.errors)}`);
    expect(patches).toEqual([{ name: "Grace" }]);
    expect(edited.record.values).toMatchObject({ name: "Grace", is_home: true, open_tasks: 3 });
  });

  test("submitEdit still refuses an undeclared key the client puts in the patch", async () => {
    const db = createMemoryAdapter();
    const created = await submitForm(entity, { name: "Ada" }, db);
    if (!created.ok) throw new Error("setup");
    const result = await submitEdit(entity, created.record, { name: "Grace", is_home: true }, db);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.map((e) => [e.path, e.code])).toEqual([["/is_home", "unknown-property"]]);
  });

  test("invalid submit returns errors and writes nothing", async () => {
    const db = createMemoryAdapter();
    const result = await submitForm(entity, {}, db);
    expect(result.ok).toBe(false);
    expect((await db.find("hello", {})).total).toBe(0);
  });
});

describe("a refused save keeps the server's own hint and field", () => {
  const throwing = (error: unknown): ReturnType<typeof createMemoryAdapter> => {
    const db = createMemoryAdapter();
    return { ...db, create: () => Promise.reject(error), update: () => Promise.reject(error) };
  };

  test("a 400 at /values/<field> marks that field with the server's message and hint", async () => {
    // The protocol locates a bad record value in the request body; the form
    // must find it under the field, and must not append its own reload advice.
    const server400 = new RecordValidationError("The server rejected the request.", [
      { path: "/values/name", code: "invalid-value", message: "name must not be taken", hint: "pick another name" },
    ]);
    const result = await submitForm(entity, { name: "Ada" }, throwing(server400));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toEqual([{ path: "/name", code: "invalid-value", message: "name must not be taken", hint: "pick another name" }]);
  });

  test("every entry of a multi-error 400 keeps its own message, hint and path", async () => {
    const server400 = new RecordValidationError("The server rejected the request.", [
      { path: "/values/name", code: "invalid-value", message: "name is taken", hint: "pick another" },
      { path: "", code: "invalid-value", message: "the form is incomplete", hint: "fill both fields" },
    ]);
    const result = await submitForm(entity, { name: "Ada" }, throwing(server400));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toEqual([
      { path: "/name", code: "invalid-value", message: "name is taken", hint: "pick another" },
      { path: "", code: "invalid-value", message: "the form is incomplete", hint: "fill both fields" },
    ]);
  });

  test("a 400 at path \"\" keeps the server's hint at form level, with no reload advice", async () => {
    const server400 = new RecordValidationError("The server rejected the request.", [
      { path: "", code: "invalid-value", message: "due_time must be a 'HH:MM' time (got '25:99')", hint: "fix the value and retry" },
    ]);
    const result = await submitForm(entity, { name: "Ada" }, throwing(server400));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toEqual([{ path: "", code: "invalid-value", message: "due_time must be a 'HH:MM' time (got '25:99')", hint: "fix the value and retry" }]);
    expect(JSON.stringify(result.errors)).not.toContain("Reload");
  });

  test("an edit refused by the server marks its field too", async () => {
    const db = createMemoryAdapter();
    const created = await submitForm(entity, { name: "Ada", note: "x" }, db);
    if (!created.ok) throw new Error("setup");
    const server400 = new RecordValidationError("The server rejected the request.", [
      { path: "/values/note", code: "invalid-value", message: "note is too long", hint: "shorten it" },
    ]);
    const result = await submitEdit(entity, created.record, { note: "y" }, throwing(server400));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toEqual([{ path: "/note", code: "invalid-value", message: "note is too long", hint: "shorten it" }]);
  });

  test("a failure with no protocol body keeps the generic hint", async () => {
    for (const [label, error] of [
      ["a network failure", new TypeError("Failed to fetch")],
      ["a 5xx", new Error("The server responded with status 500.")],
      ["a 400 with an empty body", new RecordValidationError("The server rejected the request.", [])],
    ] as const) {
      const result = await submitForm(entity, { name: "Ada" }, throwing(error));
      expect(result.ok, label).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.errors.length, label).toBe(1);
      expect(result.errors[0], label).toMatchObject({ path: "", code: "invalid-value", hint: "Reload and try again." });
    }
  });

  test("conflict, not-found, unauthorized and forbidden keep their own mappings", async () => {
    const cases: readonly (readonly [unknown, string, string])[] = [
      [new RecordConflictError("changed", null), "conflict", "Reload to load the latest version, then re-apply your change."],
      [new RecordNotFoundError("gone"), "not-found", "Reload to refresh the list."],
      [new UnauthorizedError("sign in"), "unauthorized", "Sign in and try again."],
      [new ForbiddenError("nope"), "forbidden", "You are not allowed to save this."],
    ];
    for (const [error, code, hint] of cases) {
      const result = await submitForm(entity, { name: "Ada" }, throwing(error));
      expect(result.ok, code).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.errors.map((e) => [e.path, e.code, e.hint]), code).toEqual([["", code, hint]]);
    }
  });
});
