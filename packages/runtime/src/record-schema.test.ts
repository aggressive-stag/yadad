import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { recordJsonSchema } from "@yadad/core";
import type { EntityDocument, Field, RecordValues } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { validateRecord } from "./record.js";

/**
 * Parity between validateRecord (hand-written) and recordJsonSchema (what a
 * backend validates with). Both must accept or reject the same records,
 * except for the cases in KNOWN_DIFFERENCES, which are asserted explicitly
 * and listed in docs/records-protocol.md.
 */

/** A fresh instance each time: schemas of different cases share an $id. */
function newAjv(): Ajv2020 {
  return addFormats(new Ajv2020({ strict: true }));
}

function entityOf(...fields: Field[]): EntityDocument {
  return { kind: "entity", specVersion: 2, id: "thing", revision: 3, fields };
}

interface Case {
  readonly name: string;
  readonly fields: Field[];
  readonly values: Record<string, unknown>;
  readonly ok: boolean;
}

function c(name: string, fields: Field[], values: Record<string, unknown>, ok: boolean): Case {
  return { name, fields, values, ok };
}

const text = (required?: boolean): Field => ({ id: "f", type: "text", label: "F", ...(required ? { required } : {}) });
const num = (extra: object = {}): Field => ({ id: "f", type: "number", label: "F", ...extra }) as Field;
const bool = (required?: boolean): Field => ({ id: "f", type: "boolean", label: "F", ...(required ? { required } : {}) });
const sel = (required?: boolean): Field => ({ id: "f", type: "select", label: "F", options: { source: "static", values: ["a", "b"] }, ...(required ? { required } : {}) }) as Field;
const ref = (required?: boolean): Field => ({ id: "f", type: "reference", label: "F", entity: "other", ...(required ? { required } : {}) }) as Field;
const date = (extra: object = {}): Field => ({ id: "f", type: "date", label: "F", ...extra }) as Field;
const dt = (extra: object = {}): Field => ({ id: "f", type: "datetime", label: "F", ...extra }) as Field;

const CASES: Case[] = [
  // text
  c("text: string", [text()], { f: "hi" }, true),
  c("text: empty string, optional", [text()], { f: "" }, true),
  c("text: blank string, optional", [text()], { f: "  " }, true),
  c("text: null, optional", [text()], { f: null }, true),
  c("text: absent, optional", [text()], {}, true),
  c("text: number", [text()], { f: 1 }, false),
  c("text: boolean", [text()], { f: false }, false),
  c("text: string, required", [text(true)], { f: "x" }, true),
  c("text: padded string, required", [text(true)], { f: " x " }, true),
  c("text: empty string, required", [text(true)], { f: "" }, false),
  c("text: blank string, required", [text(true)], { f: " \t\n" }, false),
  c("text: null, required", [text(true)], { f: null }, false),
  c("text: absent, required", [text(true)], {}, false),

  // number
  c("number: integer", [num()], { f: 3 }, true),
  c("number: negative decimal", [num()], { f: -2.25 }, true),
  c("number: null", [num()], { f: null }, true),
  c("number: absent", [num()], {}, true),
  c("number: string", [num()], { f: "3" }, false),
  c("number: boolean", [num()], { f: true }, false),
  c("number: required, null", [num({ required: true })], { f: null }, false),
  c("number: required, absent", [num({ required: true })], {}, false),
  c("number: required, zero", [num({ required: true })], { f: 0 }, true),
  c("number: at min", [num({ min: 1 })], { f: 1 }, true),
  c("number: below min", [num({ min: 1 })], { f: 0.99 }, false),
  c("number: at max", [num({ max: 10 })], { f: 10 }, true),
  c("number: above max", [num({ max: 10 })], { f: 10.01 }, false),
  c("number: negative min", [num({ min: -5, max: -1 })], { f: -3 }, true),
  c("number: step 1 on step", [num({ step: 1 })], { f: 7 }, true),
  c("number: step 1 off step", [num({ step: 1 })], { f: 7.5 }, false),
  c("number: step 2.5 on step", [num({ step: 2.5, min: 0 })], { f: 12.5 }, true),
  c("number: step 2.5 off step", [num({ step: 2.5, min: 0 })], { f: 11 }, false),
  c("number: step 0.5 negative", [num({ step: 0.5 })], { f: -1.5 }, true),
  c("number: step from min, aligned", [num({ step: 5, min: 10 })], { f: 15 }, true),
  c("number: step from min, aligned at min", [num({ step: 5, min: 10 })], { f: 10 }, true),
  c("number: step from min, misaligned", [num({ step: 5, min: 10 })], { f: 12 }, false),
  c("number: step with min multiple of step", [num({ step: 0.25, min: 1 })], { f: 1.75 }, true),
  c("number: min, max and step", [num({ min: 0, max: 100, step: 5 })], { f: 105 }, false),
  c("number: null with bounds", [num({ min: 1, max: 2, step: 1 })], { f: null }, true),

  // boolean
  c("boolean: true", [bool()], { f: true }, true),
  c("boolean: false", [bool()], { f: false }, true),
  c("boolean: null", [bool()], { f: null }, true),
  c("boolean: absent", [bool()], {}, true),
  c("boolean: string", [bool()], { f: "true" }, false),
  c("boolean: number", [bool()], { f: 1 }, false),
  c("boolean: required, true", [bool(true)], { f: true }, true),
  c("boolean: required, false", [bool(true)], { f: false }, false),
  c("boolean: required, null", [bool(true)], { f: null }, false),
  c("boolean: required, absent", [bool(true)], {}, false),

  // select
  c("select: a choice", [sel()], { f: "a" }, true),
  c("select: not a choice", [sel()], { f: "c" }, false),
  c("select: case differs", [sel()], { f: "A" }, false),
  c("select: null", [sel()], { f: null }, true),
  c("select: absent", [sel()], {}, true),
  c("select: number", [sel()], { f: 1 }, false),
  c("select: required, a choice", [sel(true)], { f: "b" }, true),
  c("select: required, null", [sel(true)], { f: null }, false),
  c("select: required, absent", [sel(true)], {}, false),

  // reference
  c("reference: id", [ref()], { f: "r1" }, true),
  c("reference: empty string, optional", [ref()], { f: "" }, true),
  c("reference: null", [ref()], { f: null }, true),
  c("reference: absent", [ref()], {}, true),
  c("reference: number", [ref()], { f: 1 }, false),
  c("reference: required, id", [ref(true)], { f: "r1" }, true),
  c("reference: required, null", [ref(true)], { f: null }, false),
  c("reference: required, blank", [ref(true)], { f: " " }, false),
  c("reference: required, absent", [ref(true)], {}, false),

  // date
  c("date: valid", [date()], { f: "2026-10-05" }, true),
  c("date: leap day", [date()], { f: "2028-02-29" }, true),
  c("date: not a leap day", [date()], { f: "2026-02-29" }, false),
  c("date: month 13", [date()], { f: "2026-13-01" }, false),
  c("date: day 32", [date()], { f: "2026-01-32" }, false),
  c("date: no zero padding", [date()], { f: "2026-1-5" }, false),
  c("date: slashes", [date()], { f: "2026/10/05" }, false),
  c("date: with time", [date()], { f: "2026-10-05T00:00:00Z" }, false),
  c("date: trailing newline", [date()], { f: "2026-10-05\n" }, false),
  c("date: number", [date()], { f: 20261005 }, false),
  c("date: null", [date()], { f: null }, true),
  c("date: absent", [date()], {}, true),
  c("date: required, null", [date({ required: true })], { f: null }, false),
  c("date: required, valid", [date({ required: true })], { f: "2026-10-05" }, true),
  c("date: at min", [date({ min: "2026-03-15" })], { f: "2026-03-15" }, true),
  c("date: day after min", [date({ min: "2026-03-15" })], { f: "2026-03-16" }, true),
  c("date: day before min", [date({ min: "2026-03-15" })], { f: "2026-03-14" }, false),
  c("date: next month after min", [date({ min: "2026-03-15" })], { f: "2026-04-01" }, true),
  c("date: previous month before min", [date({ min: "2026-03-15" })], { f: "2026-02-28" }, false),
  c("date: next year after min", [date({ min: "2026-12-31" })], { f: "2027-01-01" }, true),
  c("date: earlier year than min", [date({ min: "2026-01-01" })], { f: "2025-12-31" }, false),
  c("date: min with nines", [date({ min: "2026-09-09" })], { f: "2026-10-01" }, true),
  c("date: at max", [date({ max: "2026-03-15" })], { f: "2026-03-15" }, true),
  c("date: day before max", [date({ max: "2026-03-15" })], { f: "2026-03-14" }, true),
  c("date: day after max", [date({ max: "2026-03-15" })], { f: "2026-03-16" }, false),
  c("date: previous year before max", [date({ max: "2026-01-01" })], { f: "2025-12-31" }, true),
  c("date: next year after max", [date({ max: "2026-12-31" })], { f: "2027-01-01" }, false),
  c("date: max with zeros", [date({ max: "2026-10-10" })], { f: "2026-09-30" }, true),
  c("date: max with zeros, above", [date({ max: "2026-10-10" })], { f: "2026-10-11" }, false),
  c("date: inside min and max", [date({ min: "2026-01-01", max: "2026-12-31" })], { f: "2026-06-15" }, true),
  c("date: outside min and max, below", [date({ min: "2026-01-01", max: "2026-12-31" })], { f: "2025-06-15" }, false),
  c("date: outside min and max, above", [date({ min: "2026-01-01", max: "2026-12-31" })], { f: "2027-06-15" }, false),
  c("date: min equals max", [date({ min: "2026-05-05", max: "2026-05-05" })], { f: "2026-05-05" }, true),
  c("date: null with bounds", [date({ min: "2026-01-01", max: "2026-12-31" })], { f: null }, true),

  // datetime
  c("datetime: valid", [dt({})], { f: "2026-10-17T09:30:00.000Z" }, true),
  c("datetime: leap day", [dt({})], { f: "2028-02-29T23:59:59.999Z" }, true),
  c("datetime: not a leap day", [dt({})], { f: "2026-02-29T00:00:00.000Z" }, false),
  c("datetime: hour 24", [dt({})], { f: "2026-10-17T24:00:00.000Z" }, false),
  c("datetime: no milliseconds", [dt({})], { f: "2026-10-17T09:30:00Z" }, false),
  c("datetime: two fractional digits", [dt({})], { f: "2026-10-17T09:30:00.00Z" }, false),
  c("datetime: offset instead of Z", [dt({})], { f: "2026-10-17T11:30:00.000+02:00" }, false),
  c("datetime: no zone", [dt({})], { f: "2026-10-17T09:30:00.000" }, false),
  c("datetime: lower case t and z", [dt({})], { f: "2026-10-17t09:30:00.000z" }, false),
  c("datetime: a date only", [dt({})], { f: "2026-10-17" }, false),
  c("datetime: trailing newline", [dt({})], { f: "2026-10-17T09:30:00.000Z\n" }, false),
  c("datetime: number", [dt({})], { f: 1760693400000 }, false),
  c("datetime: null", [dt({})], { f: null }, true),
  c("datetime: required, null", [dt({ required: true })], { f: null }, false),
  c("datetime: at min", [dt({ min: "2026-03-15T10:00:00.000Z" })], { f: "2026-03-15T10:00:00.000Z" }, true),
  c("datetime: a millisecond before min", [dt({ min: "2026-03-15T10:00:00.000Z" })], { f: "2026-03-15T09:59:59.999Z" }, false),
  c("datetime: a millisecond after min", [dt({ min: "2026-03-15T10:00:00.000Z" })], { f: "2026-03-15T10:00:00.001Z" }, true),
  c("datetime: next day after min", [dt({ min: "2026-03-15T23:59:59.999Z" })], { f: "2026-03-16T00:00:00.000Z" }, true),
  c("datetime: at max", [dt({ max: "2026-03-15T10:00:00.000Z" })], { f: "2026-03-15T10:00:00.000Z" }, true),
  c("datetime: a millisecond after max", [dt({ max: "2026-03-15T10:00:00.000Z" })], { f: "2026-03-15T10:00:00.001Z" }, false),
  c("datetime: earlier year than max", [dt({ max: "2026-01-01T00:00:00.000Z" })], { f: "2025-12-31T23:59:59.999Z" }, true),
  c("datetime: inside min and max", [dt({ min: "2026-01-01T00:00:00.000Z", max: "2026-12-31T23:59:59.999Z" })], { f: "2026-06-15T12:00:00.000Z" }, true),
  c("datetime: outside min and max, above", [dt({ min: "2026-01-01T00:00:00.000Z", max: "2026-12-31T23:59:59.999Z" })], { f: "2027-01-01T00:00:00.000Z" }, false),

  // the record as a whole
  c("record: unknown field", [text()], { f: "x", g: "y" }, false),
  c("record: unknown field, null", [text()], { g: null }, false),
  c("record: empty entity, empty record", [], {}, true),
  c("record: two fields, both valid", [text(true), { id: "g", type: "number", label: "G" }], { f: "x", g: 1 }, true),
  c("record: two fields, one invalid", [text(true), { id: "g", type: "number", label: "G" }], { f: "x", g: "1" }, false),
];

/**
 * Records where the two deliberately differ. `validateRecord` accepts a blank
 * string as "empty" for any field type; the protocol says empty is null, so
 * the schema rejects it. Step checks differ in float tolerance or origin.
 */
const KNOWN_DIFFERENCES: { readonly name: string; readonly fields: Field[]; readonly values: Record<string, unknown>; readonly validateRecord: boolean; readonly schema: boolean }[] = [
  { name: "number: empty string counts as empty", fields: [num()], values: { f: "" }, validateRecord: true, schema: false },
  { name: "number: blank string counts as empty", fields: [num()], values: { f: "  " }, validateRecord: true, schema: false },
  { name: "boolean: empty string counts as empty", fields: [bool()], values: { f: "" }, validateRecord: true, schema: false },
  { name: "select: empty string counts as empty", fields: [sel()], values: { f: "" }, validateRecord: true, schema: false },
  { name: "date: empty string counts as empty", fields: [date()], values: { f: "" }, validateRecord: true, schema: false },
  { name: "datetime: empty string counts as empty", fields: [dt()], values: { f: "" }, validateRecord: true, schema: false },
  // 0.1 is not a binary fraction, so the schema leaves the step to the description.
  { name: "number: step 0.1 is not enforced by the schema", fields: [num({ step: 0.1 })], values: { f: 0.25 }, validateRecord: false, schema: true },
  { name: "number: step counted from a min that is not a multiple", fields: [num({ step: 5, min: 2 })], values: { f: 3 }, validateRecord: false, schema: true },
  { name: "number: step 0.1 float error", fields: [num({ step: 0.1 })], values: { f: 0.1 + 0.2 }, validateRecord: true, schema: true },
  // validateRecord forgives 1e-9 of float error on a step; multipleOf does not.
  { name: "number: step tolerance of 1e-9", fields: [num({ step: 0.5 })], values: { f: 1.0000000001 }, validateRecord: true, schema: false },
];

function schemaAccepts(fields: Field[], values: unknown): boolean {
  const validate = newAjv().compile(recordJsonSchema(entityOf(...fields)));
  return validate(values) === true;
}

function runtimeAccepts(fields: Field[], values: Record<string, unknown>): boolean {
  return validateRecord(entityOf(...fields), values as RecordValues).length === 0;
}

describe("recordJsonSchema parity with validateRecord", () => {
  test.each(CASES)("$name", ({ fields, values, ok }) => {
    expect(runtimeAccepts(fields, values), "validateRecord").toBe(ok);
    expect(schemaAccepts(fields, values), "recordJsonSchema").toBe(ok);
  });

  test.each(KNOWN_DIFFERENCES)("known difference: $name", ({ fields, values, validateRecord: rt, schema }) => {
    expect(runtimeAccepts(fields, values), "validateRecord").toBe(rt);
    expect(schemaAccepts(fields, values), "recordJsonSchema").toBe(schema);
  });

  test("step 0.1 is described, not enforced", () => {
    const schema = recordJsonSchema(entityOf(num({ step: 0.1 })));
    expect(schema.properties["f"]).not.toHaveProperty("multipleOf");
    expect(schema.properties["f"]?.description).toContain("multiple of 0.1");
  });

  test("the schema is a valid draft 2020-12 schema for every field type", () => {
    const all = [text(true), num({ min: 0, step: 1 }), bool(), sel(), ref(), date({ min: "2026-01-01" })].map((f, i) => ({ ...f, id: `f${i}` }) as Field);
    expect(newAjv().validateSchema(recordJsonSchema(entityOf(...all)))).toBe(true);
  });

  test("identifies the entity and revision", () => {
    const schema = recordJsonSchema(entityOf(text()));
    expect(schema.$id).toBe("urn:yadad:record:thing:3");
    expect(schema.title).toContain("thing");
    expect(schema.additionalProperties).toBe(false);
  });

  test("required lists exactly the required fields", () => {
    const fields = [{ ...text(true), id: "a" }, { ...text(), id: "b" }, { ...bool(true), id: "c" }] as Field[];
    expect(recordJsonSchema(entityOf(...fields)).required).toEqual(["a", "c"]);
  });
});
