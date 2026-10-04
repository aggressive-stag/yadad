import { isIsoDate, jsonPointer } from "@yadad/core";
import type { DocumentError, EntityDocument, Field, FieldValue, RecordValues } from "@yadad/core";

/**
 * Checks record values against their entity. Hand-written per field type for
 * now; the contract will compile the entity to JSON Schema instead.
 * Paths are JSON Pointers into the values object ("/weight").
 */
export function validateRecord(entity: EntityDocument, values: RecordValues): readonly DocumentError[] {
  const errors: DocumentError[] = [];
  const known = new Set(entity.fields.map((f) => f.id));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      errors.push({
        path: jsonPointer([key]),
        code: "unknown-property",
        message: `"${key}" is not a field of "${entity.id}".`,
        hint: `Remove it, or add the field to the entity (revision ${entity.revision}).`,
      });
    }
  }

  for (const field of entity.fields) {
    const problem = checkValue(field, values[field.id] ?? null);
    if (problem) errors.push({ path: jsonPointer([field.id]), ...problem });
  }

  return errors;
}

type Problem = Omit<DocumentError, "path">;

function isEmpty(value: FieldValue): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function checkValue(field: Field, value: FieldValue): Problem | undefined {
  const name = `"${field.label}"`;

  if (isEmpty(value)) {
    return field.required === true
      ? { code: "required", message: `${name} is required.`, hint: `Enter a value for ${name}.` }
      : undefined;
  }

  switch (field.type) {
    case "text":
      return typeof value === "string" ? undefined : wrongType(name, "text");

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return wrongType(name, "a number");
      if (field.min !== undefined && value < field.min) return outOfRange(name, `at least ${field.min}`);
      if (field.max !== undefined && value > field.max) return outOfRange(name, `at most ${field.max}`);
      if (field.step !== undefined && !isOnStep(value, field.min ?? 0, field.step)) {
        return outOfRange(name, `a multiple of ${field.step}${field.min ? ` from ${field.min}` : ""}`);
      }
      return undefined;
    }

    case "boolean":
      if (typeof value !== "boolean") return wrongType(name, "true or false");
      return field.required === true && !value
        ? { code: "required", message: `${name} must be checked.`, hint: `Check ${name} to continue.` }
        : undefined;

    case "select":
      if (typeof value !== "string") return wrongType(name, "one of its choices");
      return field.options.values.includes(value)
        ? undefined
        : { code: "invalid-value", message: `${JSON.stringify(value)} is not a choice for ${name}.`, hint: `Use one of: ${field.options.values.join(", ")}.` };

    case "date":
      if (typeof value !== "string" || !isIsoDate(value)) return wrongType(name, "a date (YYYY-MM-DD)");
      if (field.min !== undefined && value < field.min) return outOfRange(name, `on or after ${field.min}`);
      if (field.max !== undefined && value > field.max) return outOfRange(name, `on or before ${field.max}`);
      return undefined;
  }
}

/** Steps are counted from `base`; a small tolerance absorbs float error (0.1 + 0.2). */
function isOnStep(value: number, base: number, step: number): boolean {
  const steps = (value - base) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function wrongType(name: string, expected: string): Problem {
  return { code: "type", message: `${name} must be ${expected}.`, hint: `Enter ${expected}.` };
}

function outOfRange(name: string, rule: string): Problem {
  return { code: "invalid-value", message: `${name} must be ${rule}.`, hint: `Change ${name} to be ${rule}.` };
}
