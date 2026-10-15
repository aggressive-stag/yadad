import type { EntityDocument, ReferenceField } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";
import { loadReferenceOptions, referenceDisplayField, resolveReferenceLabels } from "./reference.js";
import { validateRecord } from "./record.js";

const exercise: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "exercise",
  revision: 1,
  fields: [
    { id: "rank", type: "number", label: "Rank" },
    { id: "name", type: "text", label: "Name" },
    { id: "alias", type: "text", label: "Alias" },
  ],
};
const entry: EntityDocument = {
  kind: "entity",
  specVersion: 2,
  id: "entry",
  revision: 1,
  fields: [{ id: "exercise", type: "reference", label: "Exercise", required: true, entity: "exercise" }],
};
const ref = entry.fields[0] as ReferenceField;

async function seeded() {
  const db = createMemoryAdapter();
  for (const name of ["Squat", "Bench", "Deadlift"]) await db.create("exercise", { name }, { entityRevision: 1 });
  return db;
}

describe("reference values", () => {
  test("a string id is valid, a number is not, and required applies", () => {
    expect(validateRecord(entry, { exercise: "1" })).toEqual([]);
    expect(validateRecord(entry, { exercise: 1 }).map((e) => [e.path, e.code])).toEqual([["/exercise", "type"]]);
    expect(validateRecord(entry, {}).map((e) => e.code)).toEqual(["required"]);
    expect(validateRecord({ ...entry, fields: [{ ...ref, required: false }] }, {})).toEqual([]);
  });
});

describe("referenceDisplayField", () => {
  test("defaults to the first text field; an explicit display wins", () => {
    expect(referenceDisplayField(exercise, ref)?.id).toBe("name");
    expect(referenceDisplayField(exercise, { ...ref, display: "alias" })?.id).toBe("alias");
  });
});

describe("loadReferenceOptions", () => {
  test("lists records sorted by the display field", async () => {
    const result = await loadReferenceOptions(await seeded(), exercise, ref);
    expect(result.options.map((o) => o.label)).toEqual(["Bench", "Deadlift", "Squat"]);
    expect(result.options.map((o) => o.id)).toEqual(["2", "3", "1"]);
    expect(result.more).toBe(false);
  });
  test("caps the list and signals more", async () => {
    const result = await loadReferenceOptions(await seeded(), exercise, ref, 2);
    expect(result.options.map((o) => o.label)).toEqual(["Bench", "Deadlift"]);
    expect(result.more).toBe(true);
  });
  test("labels a record with an empty display value by its id", async () => {
    const db = createMemoryAdapter();
    await db.create("exercise", { name: "" }, { entityRevision: 1 });
    expect((await loadReferenceOptions(db, exercise, ref)).options).toEqual([{ id: "1", label: "1" }]);
  });
});

describe("resolveReferenceLabels", () => {
  test("resolves existing ids and leaves missing ones out", async () => {
    const labels = await resolveReferenceLabels(await seeded(), exercise, ref, ["1", "3", "1", "99", ""]);
    expect([...labels]).toEqual([
      ["1", "Squat"],
      ["3", "Deadlift"],
    ]);
  });
});
