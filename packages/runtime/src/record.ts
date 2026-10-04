import { jsonPointer } from "@yadad/core";
import type { DocumentError, EntityDocument, RecordValues } from "@yadad/core";

/**
 * Checks record values against their entity. Pre-contract: hand-written for
 * text fields; contract-v0 compiles the entity to JSON Schema instead.
 * Paths are JSON Pointers into the values object ("/name").
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
    const value = values[field.id];
    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push({
        path: jsonPointer([field.id]),
        code: "type",
        message: `"${field.label}" must be text.`,
        hint: "Use a string value.",
      });
    } else if (field.required === true && (value === undefined || value === null || value.trim() === "")) {
      errors.push({
        path: jsonPointer([field.id]),
        code: "required",
        message: `"${field.label}" is required.`,
        hint: `Enter a value for "${field.label}".`,
      });
    }
  }

  return errors;
}
