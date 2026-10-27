import type { EntityDocument, Field, ReferenceField } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";
import { loadReferenceFilterChoices, loadReferenceOptions, referenceDisplayField, resolveReferenceColors, resolveReferenceLabels } from "./reference.js";
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
    expect(result.total).toBe(result.options.length);
  });
  test("caps the list and signals more", async () => {
    const result = await loadReferenceOptions(await seeded(), exercise, ref, 2);
    expect(result.options.map((o) => o.label)).toEqual(["Bench", "Deadlift"]);
    expect(result.more).toBe(true);
    expect(result.total).toBeGreaterThan(result.options.length);
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

describe("resolveReferenceColors (RFC 0008 item 8)", () => {
  const colours: EntityDocument = {
    kind: "entity",
    specVersion: 3,
    id: "colour",
    revision: 1,
    fields: [
      { id: "name", type: "text", label: "Name" },
      { id: "hex", type: "text", label: "Hex" },
      { id: "tone", type: "select", label: "Tone", options: { source: "static", values: [{ value: "warm", color: "#D13438" }, "cool"] } },
    ],
  };

  test("keeps only colour-shaped values, from text and from a select option", async () => {
    const db = createMemoryAdapter();
    const red = await db.create("colour", { name: "Red", hex: "#D13438", tone: "warm" }, { entityRevision: 1 });
    const free = await db.create("colour", { name: "Free", hex: "firebrick", tone: "cool" }, { entityRevision: 1 });
    const bare = await db.create("colour", { name: "Bare" }, { entityRevision: 1 });
    const hexField = (colours.fields as Field[])[1]!;
    const toneField = (colours.fields as Field[])[2]!;
    const byHex = await resolveReferenceColors(db, colours, hexField, [red.id, free.id, bare.id, "missing"]);
    expect([...byHex]).toEqual([[red.id, "#D13438"]]); // free text, no value, and a missing record are all absent
    const byTone = await resolveReferenceColors(db, colours, toneField, [red.id, free.id]);
    expect([...byTone]).toEqual([[red.id, "#D13438"]]); // the chosen option's colour; an option without one paints none
  });
});

describe("loadReferenceFilterChoices", () => {
  test("loads { value: id, label } choices sorted by the display value", async () => {
    const db = await seeded();
    const { choices, more } = await loadReferenceFilterChoices(db, exercise, ref);
    expect(choices.map((c) => c.label)).toEqual(["Bench", "Deadlift", "Squat"]);
    const all = await db.find("exercise", {});
    for (const c of choices) expect(all.items.some((r) => r.id === c.value)).toBe(true);
    expect(more).toBe(false);
  });

  test("labels a record with no display value by its id, and caps the list", async () => {
    const db = createMemoryAdapter();
    const bare = await db.create("exercise", { rank: 1 }, { entityRevision: 1 });
    for (const name of ["A", "B", "C"]) await db.create("exercise", { name }, { entityRevision: 1 });
    const all = await loadReferenceFilterChoices(db, exercise, ref);
    expect(all.choices.find((c) => c.value === bare.id)?.label).toBe(bare.id);
    const cut = await loadReferenceFilterChoices(db, exercise, ref, 2);
    expect(cut.choices).toHaveLength(2);
    expect(cut.more).toBe(true);
  });
});
