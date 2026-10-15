import type { EntityDocument, Field } from "./document.js";

/**
 * A standard JSON Schema (draft 2020-12) for the `values` of a record under
 * an entity, so a backend can validate records with any off-the-shelf
 * validator instead of re-implementing the rules by hand.
 *
 * Only the keywords this module emits are typed here.
 */
export interface RecordFieldSchema {
  readonly type: "string" | "number" | "boolean" | readonly ["string" | "number" | "boolean", "null"];
  readonly description?: string;
  readonly enum?: readonly (string | null)[];
  readonly const?: true;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly format?: "date";
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

function nullable(type: "string" | "number" | "boolean", field: Field): Base {
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

    case "select":
      return {
        type: nullable("string", field),
        enum: field.required === true ? [...field.options.values] : [...field.options.values, null],
      };

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

function isoDateBound(bound: string, beyond: (digit: number) => string | undefined): string {
  const alternatives = [bound];
  for (let i = 0; i < bound.length; i++) {
    if (bound[i] === "-") continue;
    const cls = beyond(Number(bound[i]));
    if (cls !== undefined) alternatives.push(`${bound.slice(0, i)}${cls}.*`);
  }
  return `^(?:${alternatives.join("|")})$`;
}
