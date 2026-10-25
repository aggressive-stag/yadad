import type { EntityDocument, Field } from "./document.js";
import { optionValue } from "./document.js";

/**
 * A standard JSON Schema (draft 2020-12) for the `values` of a record under
 * an entity, so a backend can validate records with any off-the-shelf
 * validator instead of re-implementing the rules by hand.
 *
 * Only the keywords this module emits are typed here.
 */
export interface RecordFieldSchema {
  readonly type: "string" | "number" | "boolean" | "array" | readonly ["string" | "number" | "boolean" | "array", "null"];
  /** Element schema, only for an "array" (a tags field, RFC 0008 item 15). `pattern: "\\S"` rejects an element that is blank after trimming. */
  readonly items?: { readonly type: "string"; readonly pattern?: string };
  readonly minItems?: number;
  readonly uniqueItems?: boolean;
  readonly description?: string;
  readonly enum?: readonly (string | null)[];
  readonly const?: true;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly format?: "date" | "date-time";
  readonly pattern?: string;
  /** Conjunction of `{ pattern }` subschemas; used for date ranges. */
  readonly allOf?: readonly { readonly pattern: string }[];
}

export interface RecordSchema {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly $id: string;
  readonly title: string;
  readonly type: "object";
  /** One entry per field, keyed by field id (ids are user-defined). */
  readonly properties: Readonly<Record<string, RecordFieldSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

/**
 * Builds the JSON Schema for a record's `values` under `entity`.
 *
 * Empty is `null` (or an absent key): optional fields accept `null`, required
 * fields reject it. Text and reference fields that are required also reject a
 * blank string, as `validateRecord` does.
 *
 * Where JSON Schema cannot say exactly what `validateRecord` says, the schema
 * is the stricter or the plainer of the two and the field's `description`
 * says so. The known differences are listed in docs/records-protocol.md.
 */
export function recordJsonSchema(entity: EntityDocument): RecordSchema {
  const properties: Record<string, RecordFieldSchema> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    properties[field.id] = fieldSchema(field);
    if (field.required === true) required.push(field.id);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:yadad:record:${entity.id}:${entity.revision}`,
    title: `Record values of entity "${entity.id}" (revision ${entity.revision})`,
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

type Base = RecordFieldSchema["type"];

function nullable(type: "string" | "number" | "boolean" | "array", field: Field): Base {
  return field.required === true ? type : [type, "null"];
}

function fieldSchema(field: Field): RecordFieldSchema {
  switch (field.type) {
    case "text":
    case "reference":
      // A blank string counts as empty, so a required one must hold a non-space character.
      return { type: nullable("string", field), ...(field.required === true ? { pattern: "\\S" } : {}) };

    case "number": {
      const notes: string[] = [];
      let multipleOf: number | undefined;
      if (field.step !== undefined) {
        if (isExactStep(field.step, field.min)) multipleOf = field.step;
        else notes.push(`Not enforced by this schema: the value must be a multiple of ${field.step}${field.min ? ` counted from ${field.min}` : ""}.`);
      }
      return {
        type: nullable("number", field),
        ...(field.min !== undefined ? { minimum: field.min } : {}),
        ...(field.max !== undefined ? { maximum: field.max } : {}),
        ...(multipleOf !== undefined ? { multipleOf } : {}),
        ...(notes.length > 0 ? { description: notes.join(" ") } : {}),
      };
    }

    case "boolean":
      // A required boolean means "must be checked".
      return field.required === true ? { type: "boolean", const: true } : { type: ["boolean", "null"] };

    case "select": {
      const values = field.options.values.map(optionValue);
      return {
        type: nullable("string", field),
        enum: field.required === true ? [...values] : [...values, null],
      };
    }

    case "date": {
      const bounds: { pattern: string }[] = [];
      if (field.min !== undefined) bounds.push({ pattern: isoDateAtLeast(field.min) });
      if (field.max !== undefined) bounds.push({ pattern: isoDateAtMost(field.max) });
      return {
        type: nullable("string", field),
        format: "date",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        ...(bounds.length > 0 ? { allOf: bounds } : {}),
        description:
          "A calendar date, YYYY-MM-DD. Whether 2026-02-30 is rejected depends on the validator asserting the \"date\" format.",
      };
    }

    case "time":
      // RFC 0008 item 14: HH:MM only (a zone-less time has no JSON Schema "time" format that fits),
      // min/max as ordered-text alternatives like the date bounds above.
      return {
        type: nullable("string", field),
        pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        ...hhMmBounds(field),
      };

    case "tags": {
      // RFC 0008 item 15: an array of non-empty strings in the order entered, unique. An element
      // must hold a non-space character (validateRecord trims before the emptiness test), and a
      // required field rejects the empty array the same way a required text rejects "".
      return { type: nullable("array", field), items: { type: "string", pattern: "\\S" }, minItems: field.required === true ? 1 : 0, uniqueItems: true };
    }

    case "datetime": {
      const bounds: { pattern: string }[] = [];
      if (field.min !== undefined) bounds.push({ pattern: isoDateAtLeast(field.min) });
      if (field.max !== undefined) bounds.push({ pattern: isoDateAtMost(field.max) });
      return {
        type: nullable("string", field),
        format: "date-time",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
        ...(bounds.length > 0 ? { allOf: bounds } : {}),
        description:
          "An instant in the one stored form, YYYY-MM-DDTHH:MM:SS.sssZ (UTC, milliseconds, Z). The min and max patterns compare the text; whether the moment exists (2026-02-30T00:00:00.000Z is rejected) depends on the validator asserting the \"date-time\" format.",
      };
    }
  }
}

/**
 * JSON Schema's `multipleOf` counts steps from zero, and validators divide in
 * floating point. It is exact only when the steps start at zero and the step
 * is a binary fraction (1, 0.5, 0.25, ...); `validateRecord` instead counts
 * from `min` and tolerates float error (0.1 + 0.2).
 */
function isExactStep(step: number, min: number | undefined): boolean {
  if (!(step > 0) || !Number.isInteger(step * 1024)) return false;
  return min === undefined || Number.isInteger(min / step);
}

/*
 * ISO dates are fixed-width, so "on or after X" is a regular language: the
 * string equals X, or shares a prefix with X and then has a larger digit.
 * Hyphens sit at the same positions in every candidate, so only digits vary.
 */
function isoDateAtLeast(min: string): string {
  return isoDateBound(min, (d) => (d < 9 ? `[${d + 1}-9]` : undefined));
}

function isoDateAtMost(max: string): string {
  return isoDateBound(max, (d) => (d > 0 ? `[0-${d - 1}]` : undefined));
}

/** min/max for a "HH:MM" field, as ordered-text alternatives like the date bounds. */
function hhMmBounds(field: { readonly min?: string; readonly max?: string }): { readonly allOf?: readonly { readonly pattern: string }[] } {
  const bounds: { pattern: string }[] = [];
  if (field.min !== undefined) bounds.push({ pattern: isoDateBound(field.min, (d) => (d < 9 ? `[${d + 1}-9]` : undefined)) });
  if (field.max !== undefined) bounds.push({ pattern: isoDateBound(field.max, (d) => (d > 0 ? `[0-${d - 1}]` : undefined)) });
  return bounds.length > 0 ? { allOf: bounds } : {};
}

function isoDateBound(bound: string, beyond: (digit: number) => string | undefined): string {
  const escape = (text: string): string => text.replace(/\./g, "\\.");
  const alternatives = [escape(bound)];
  for (let i = 0; i < bound.length; i++) {
    if (!/\d/.test(bound[i] ?? "")) continue;
    const cls = beyond(Number(bound[i]));
    if (cls !== undefined) alternatives.push(`${escape(bound.slice(0, i))}${cls}.*`);
  }
  return `^(?:${alternatives.join("|")})$`;
}
