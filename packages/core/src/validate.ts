// PRE-CONTRACT (P0-04). Hand-written structural validation for the skeleton
// documents. The validator library and generated JSON Schemas are a Phase 1
// decision (P1-01); referential checks (view fields exist on the entity) are
// P1-05. Collects every error instead of stopping at the first.

import { FIELD_TYPES, SPEC_VERSION } from "./document";
import type { Document } from "./document";
import { jsonPointer } from "./errors";
import type { DocumentError, ErrorCode } from "./errors";

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DocumentError[] };

const KINDS = ["entity", "form"] as const;
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const ID_HINT = 'Use lowercase letters, digits and underscores, starting with a letter (e.g. "workout_set").';

type Path = readonly (string | number)[];
type JsonObject = { readonly [key: string]: unknown };

class Errors {
  readonly list: DocumentError[] = [];
  add(path: Path, code: ErrorCode, message: string, hint: string): void {
    this.list.push({ path: jsonPointer(path), code, message, hint });
  }
}

/** Validates the shape of a single entity or view document. */
export function validateDocument(input: unknown): ValidationResult<Document> {
  const errors = new Errors();

  if (!isObject(input)) {
    errors.add([], "type", "A document must be a JSON object.", 'Wrap the document in {} and give it a "kind".');
  } else if (input["kind"] === "entity") {
    validateEntity(errors, input);
  } else if (input["kind"] === "form") {
    validateForm(errors, input);
  } else if (input["kind"] === undefined) {
    errors.add(["kind"], "required", 'Missing required property "kind".', `Add "kind": one of ${KINDS.join(", ")}.`);
  } else {
    errors.add(
      ["kind"],
      "unknown-kind",
      `Unknown document kind ${JSON.stringify(input["kind"])}.`,
      `Use one of: ${KINDS.join(", ")}.`,
    );
  }

  return errors.list.length > 0
    ? { ok: false, errors: errors.list }
    : // Every property was checked above; the narrowing is this function's job.
      { ok: true, value: input as Document };
}

function validateEntity(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "revision", "fields"], []);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkRevision(errors, doc);

  const fields = checkArray(errors, doc, [], "fields");
  if (!fields) return;
  const ids: { id: string; path: Path }[] = [];
  fields.forEach((field, i) => {
    const path = ["fields", i];
    if (!isObject(field)) {
      errors.add(path, "type", "A field must be a JSON object.", 'Use { "id", "type", "label" }.');
      return;
    }
    validateField(errors, field, path);
    if (typeof field["id"] === "string") ids.push({ id: field["id"], path: [...path, "id"] });
  });
  reportDuplicates(errors, ids, "field", "an entity");
}

function validateField(errors: Errors, field: JsonObject, path: Path): void {
  const type = field["type"];
  if (type === undefined) {
    errors.add([...path, "type"], "required", 'Missing required property "type".', `Add "type": one of ${FIELD_TYPES.join(", ")}.`);
    return;
  }
  if (!FIELD_TYPES.some((t) => t === type)) {
    errors.add(
      [...path, "type"],
      "unknown-field-type",
      `Unknown field type ${JSON.stringify(type)}.`,
      `Pre-contract field types: ${FIELD_TYPES.join(", ")}.`,
    );
    return;
  }
  // type === "text"
  checkKeys(errors, field, path, ["id", "type", "label"], ["required"]);
  checkId(errors, field, path, "id");
  checkNonEmptyString(errors, field, path, "label");
  checkBoolean(errors, field, path, "required");
}

function validateForm(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "sections"], []);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");

  const sections = checkArray(errors, doc, [], "sections");
  if (!sections) return;
  const sectionIds: { id: string; path: Path }[] = [];
  const placed: { id: string; path: Path }[] = [];
  sections.forEach((section, i) => {
    const path = ["sections", i];
    if (!isObject(section)) {
      errors.add(path, "type", "A section must be a JSON object.", 'Use { "id", "items" }.');
      return;
    }
    checkKeys(errors, section, path, ["id", "items"], ["title"]);
    checkId(errors, section, path, "id");
    checkNonEmptyString(errors, section, path, "title");
    if (typeof section["id"] === "string") sectionIds.push({ id: section["id"], path: [...path, "id"] });

    const items = checkArray(errors, section, path, "items");
    items?.forEach((item, j) => {
      const itemPath = [...path, "items", j];
      if (!isObject(item)) {
        errors.add(itemPath, "type", "A form item must be a JSON object.", 'Use { "field": "<field id>" }.');
        return;
      }
      checkKeys(errors, item, itemPath, ["field"], []);
      checkId(errors, item, itemPath, "field");
      if (typeof item["field"] === "string") placed.push({ id: item["field"], path: [...itemPath, "field"] });
    });
  });
  reportDuplicates(errors, sectionIds, "section", "a form");
  reportDuplicates(errors, placed, "placed field", "a form (each field appears once)");
}

// ---- checks ---------------------------------------------------------------

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reports missing required properties and any property not listed. */
function checkKeys(errors: Errors, obj: JsonObject, path: Path, required: readonly string[], optional: readonly string[]): void {
  for (const key of required) {
    if (!(key in obj)) errors.add([...path, key], "required", `Missing required property "${key}".`, `Add "${key}".`);
  }
  const allowed = [...required, ...optional];
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.add([...path, key], "unknown-property", `Unknown property "${key}".`, `Remove it. Allowed here: ${allowed.join(", ")}.`);
    }
  }
}

function checkSpecVersion(errors: Errors, doc: JsonObject): void {
  const v = doc["specVersion"];
  if (v === undefined || v === SPEC_VERSION) return;
  if (typeof v !== "number") {
    errors.add(["specVersion"], "type", '"specVersion" must be a number.', `Use ${SPEC_VERSION}.`);
  } else {
    errors.add(
      ["specVersion"],
      "unsupported-spec-version",
      `specVersion ${v} is not supported.`,
      `Pre-contract documents use specVersion ${SPEC_VERSION}.`,
    );
  }
}

function checkId(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v === undefined) return;
  if (typeof v !== "string") {
    errors.add([...path, key], "type", `"${key}" must be a string.`, ID_HINT);
  } else if (!ID_PATTERN.test(v)) {
    errors.add([...path, key], "invalid-value", `${JSON.stringify(v)} is not a valid id.`, ID_HINT);
  }
}

function checkRevision(errors: Errors, doc: JsonObject): void {
  const v = doc["revision"];
  if (v === undefined) return;
  if (typeof v !== "number") {
    errors.add(["revision"], "type", '"revision" must be a number.', "Use a whole number, starting at 1.");
  } else if (!Number.isInteger(v) || v < 1) {
    errors.add(["revision"], "invalid-value", `revision ${v} is not a positive whole number.`, "Use a whole number, starting at 1.");
  }
}

function checkNonEmptyString(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v === undefined) return;
  if (typeof v !== "string") {
    errors.add([...path, key], "type", `"${key}" must be a string.`, `Give "${key}" a text value.`);
  } else if (v.trim() === "") {
    errors.add([...path, key], "invalid-value", `"${key}" must not be empty.`, `Give "${key}" a non-empty value.`);
  }
}

function checkBoolean(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v !== undefined && typeof v !== "boolean") {
    errors.add([...path, key], "type", `"${key}" must be true or false.`, `Use true or false (without quotes).`);
  }
}

function checkArray(errors: Errors, obj: JsonObject, path: Path, key: string): readonly unknown[] | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.add([...path, key], "type", `"${key}" must be an array.`, `Use [ ... ].`);
    return undefined;
  }
  return v;
}

function reportDuplicates(errors: Errors, entries: readonly { id: string; path: Path }[], what: string, scope: string): void {
  const seen = new Set<string>();
  for (const { id, path } of entries) {
    if (seen.has(id)) {
      errors.add(path, "duplicate-id", `Duplicate ${what} id "${id}".`, `Ids must be unique within ${scope}; rename or remove this one.`);
    }
    seen.add(id);
  }
}
