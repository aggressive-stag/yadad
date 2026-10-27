import { isHhMm, isIsoDate, isIsoDatetime, jsonPointer, optionValue } from "@yadad/core";
import type { DocumentError, EntityDocument, Field, FieldValue, RecordValues } from "@yadad/core";

/**
 * `"write"` (the default) validates values a client sends: a `readOnly` field
 * is refused. `"stored"` validates a record as the server holds it: a
 * `readOnly` value is accepted and a `required` one must be present, as in
 * `recordJsonSchema(entity, { mode: "stored" })`.
 */
export interface ValidateRecordOptions {
  readonly mode?: "write" | "stored";
}

/**
 * Checks record values against their entity, for forms and adapters. A backend
 * validates the same records with `recordJsonSchema(entity)` from @yadad/core,
 * a standard JSON Schema. record-schema.test.ts proves the two agree, apart
 * from the differences listed in docs/records-protocol.md: change a rule here
 * and there together.
 * Paths are JSON Pointers into the values object ("/weight").
 */
export function validateRecord(entity: EntityDocument, values: RecordValues, options: ValidateRecordOptions = {}): readonly DocumentError[] {
  const errors: DocumentError[] = [];
  const stored = options.mode === "stored";
  const known = new Set(entity.fields.map((f) => f.id));
  // A stored record carries the server-set values; only a write must leave them out.
  const serverSet = new Set(stored ? [] : entity.fields.filter((f) => f.readOnly === true).map((f) => f.id));

  for (const key of Object.keys(values)) {
    // RFC 0010 item 8: the write schema leaves a readOnly field out, so sending one (even null) is refused.
    if (serverSet.has(key)) {
      if (values[key] === undefined) continue;
      const label = entity.fields.find((f) => f.id === key)?.label ?? key;
      errors.push({
        path: jsonPointer([key]),
        code: "invalid-value",
        message: `"${label}" is set by the server.`,
        hint: `Remove "${key}" from the values you send; the server sets it.`,
      });
      continue;
    }
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
    if (field.readOnly === true && !stored) continue; // never a form requirement, even with `required`
    const problem = checkValue(field, values[field.id] ?? null);
    if (problem) errors.push({ path: jsonPointer([field.id]), ...problem });
  }

  return errors;
}

type Problem = Omit<DocumentError, "path">;

function isEmpty(value: FieldValue): boolean {
  // An empty tags list is empty (RFC 0008 item 15).
  return value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
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
      if (typeof value !== "string") return wrongType(name, "text");
      // RFC 0008 item 13c: characters are code points, as in JSON Schema's maxLength.
      if (field.maxLength !== undefined && [...value].length > field.maxLength) {
        return outOfRange(name, `at most ${field.maxLength} characters`);
      }
      return undefined;

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

    case "select": {
      if (typeof value !== "string") return wrongType(name, "one of its choices");
      const choices = field.options.values.map(optionValue);
      return choices.includes(value)
        ? undefined
        : { code: "invalid-value", message: `${JSON.stringify(value)} is not a choice for ${name}.`, hint: `Use one of: ${choices.join(", ")}.` };
    }

    case "reference":
      return typeof value === "string" ? undefined : wrongType(name, "the id of a record");

    case "date":
      if (typeof value !== "string" || !isIsoDate(value)) return wrongType(name, "a date (YYYY-MM-DD)");
      if (field.min !== undefined && value < field.min) return outOfRange(name, `on or after ${field.min}`);
      if (field.max !== undefined && value > field.max) return outOfRange(name, `on or before ${field.max}`);
      return undefined;

    case "datetime":
      // RFC 0007: card 34b (the full datetime helpers; this is the canonical-form check)
      if (typeof value !== "string" || !isIsoDatetime(value)) return wrongType(name, "an instant (YYYY-MM-DDTHH:MM:SS.sssZ, UTC)");
      if (field.min !== undefined && value < field.min) return outOfRange(name, `at or after ${field.min}`);
      if (field.max !== undefined && value > field.max) return outOfRange(name, `at or before ${field.max}`);
      return undefined;

    case "time": {
      // RFC 0008: card 47k — "HH:MM", compared as ordered text (lexicographic = chronological at fixed width).
      if (typeof value !== "string" || !isHhMm(value)) return wrongType(name, 'a time (HH:MM, 24-hour)');
      if (field.min !== undefined && value < field.min) return outOfRange(name, `at or after ${field.min}`);
      if (field.max !== undefined && value > field.max) return outOfRange(name, `at or before ${field.max}`);
      if (field.step !== undefined) {
        const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
        if (minutes % field.step !== 0) return outOfRange(name, `a whole multiple of ${field.step} minutes from midnight`);
      }
      return undefined;
    }

    case "tags": {
      // RFC 0008: card 47k — an array of non-empty strings; an empty array is empty.
      if (!Array.isArray(value)) return wrongType(name, "a list of tags");
      if (value.some((t) => typeof t !== "string" || t.trim() === "")) return wrongType(name, "a list of non-empty tags");
      return undefined;
    }
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
