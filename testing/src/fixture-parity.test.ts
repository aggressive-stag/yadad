import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { optionValue, recordJsonSchema } from "@yadad/core";
import type { Document, EntityDocument, Field, RecordValues } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { validateRecord, viewStates } from "@yadad/runtime";

/**
 * Every fixture entity and every fixture record must pass both validators
 * (validateRecord and the published recordJsonSchema), so a rule that one side
 * learns and the other does not fails here the day it lands.
 */

const root = new URL("../../fixtures/", import.meta.url);
const jsonIn = (dir: string): { name: string; json: unknown }[] =>
  readdirSync(new URL(dir, root))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, json: JSON.parse(readFileSync(new URL(`${dir}${name}`, root), "utf8")) }));

/** The sets: each valid-sets file, plus the loose valid/ files merged as one set. */
const sets: { name: string; documents: Document[] }[] = [
  ...jsonIn("valid-sets/").map(({ name, json }) => ({ name: `valid-sets/${name}`, documents: json as Document[] })),
  { name: "valid/", documents: jsonIn("valid/").map(({ json }) => json as Document) },
];

function newAjv(): Ajv2020 {
  return addFormats(new Ajv2020({ strict: true }));
}

/** A valid value for a field; `k` picks which option of a select is used. */
function sample(field: Field, k: number): unknown {
  switch (field.type) {
    case "text":
      return "x".repeat(Math.min(3, field.maxLength ?? 3));
    case "number":
      return field.min ?? (field.max !== undefined && field.max < 0 ? field.max : 0);
    case "boolean":
      return field.required === true ? true : k % 2 === 0;
    case "select":
      return optionValue(field.options.values[k % field.options.values.length] as string);
    case "date":
      return field.min ?? "2026-10-27";
    case "datetime":
      return field.min ?? "2026-10-27T10:00:00.000Z";
    case "time":
      return field.min ?? "00:00";
    case "reference":
      return "r1";
    case "tags":
      return ["a", "b"];
  }
}

function records(entity: EntityDocument): RecordValues[] {
  const rounds = Math.max(2, ...entity.fields.map((f) => (f.type === "select" ? f.options.values.length : 0)));
  return Array.from({ length: rounds }, (_, k) => Object.fromEntries(entity.fields.map((f) => [f.id, sample(f, k)])) as RecordValues);
}

function bothAccept(entity: EntityDocument, values: RecordValues, mode: "stored" | "write"): void {
  const runtime = validateRecord(entity, values, { mode });
  expect(runtime, `validateRecord ${mode}`).toEqual([]);
  const validate = newAjv().compile(recordJsonSchema(entity, { mode }));
  expect(validate(values), `recordJsonSchema ${mode}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

describe("generated records, per entity of every fixture set", () => {
  for (const set of sets) {
    const entities = set.documents.filter((d): d is EntityDocument => d.kind === "entity");
    test.each(entities.map((e) => [e.id, e] as const))(`${set.name}: entity %s`, (_id, entity) => {
      for (const values of records(entity)) {
        bothAccept(entity, values, "stored");
        const write = Object.fromEntries(Object.entries(values).filter(([id]) => entity.fields.find((f) => f.id === id)?.readOnly !== true)) as RecordValues;
        bothAccept(entity, write, "write");
      }
    });
  }
});

describe("fixtures/data records", () => {
  const entities = new Map<string, EntityDocument>();
  for (const set of sets) for (const d of set.documents) if (d.kind === "entity") entities.set(d.id, d);

  interface Rec { readonly id: string; readonly entityId: string; readonly values: RecordValues }
  const found: { file: string; record: Rec }[] = [];
  for (const { name, json } of jsonIn("data/")) {
    const j = json as { items?: Rec[]; current?: Rec; values?: RecordValues };
    const list = j.items ?? (j.current ? [j.current] : j.values ? [j as unknown as Rec] : []);
    for (const record of list) found.push({ file: name, record });
  }

  test("there are records to check", () => expect(found.length).toBeGreaterThan(0));

  test.each(found.map((f) => [`${f.file} ${f.record.id}`, f.record] as const))("%s", (_name, record) => {
    const entity = entities.get(record.entityId);
    expect(entity, `an entity "${record.entityId}" in the fixture sets`).toBeDefined();
    if (entity) bothAccept(entity, record.values, "stored");
  });
});

describe("the state grid's own samples", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  for (const set of sets) {
    test.each(set.documents.filter((d) => d.kind !== "entity").map((v) => [v.id, v] as const))(`${set.name}: view %s builds no fault skips`, (_id, view) => {
      const result = viewStates(view as Parameters<typeof viewStates>[0], set.documents, { now });
      expect(result.skipped.filter((s) => s.kind === "fault")).toEqual([]);
    });
  }
});
