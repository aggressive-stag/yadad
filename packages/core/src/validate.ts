// PRE-CONTRACT (P0-04). Hand-written structural validation for the skeleton
// documents. The validator library and generated JSON Schemas are a Phase 1
// decision (P1-01); referential checks (view fields exist on the entity) are
// P1-05. Collects every error instead of stopping at the first.

import { FIELD_TYPES, SPEC_VERSION } from "./document";
import type { Document, FieldType } from "./document";
import { jsonPointer } from "./errors";
import type { DocumentError, ErrorCode } from "./errors";

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DocumentError[] };

const KINDS = ["entity", "form", "table"] as const;
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
  } else if (input["kind"] === "table") {
    validateTable(errors, input);
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
  if (!isFieldType(type)) {
    errors.add(
      [...path, "type"],
      "unknown-field-type",
      `Unknown field type ${JSON.stringify(type)}.`,
      `Field types: ${FIELD_TYPES.join(", ")}.`,
    );
    return;
  }
  const keys = FIELD_KEYS[type];
  checkKeys(errors, field, path, ["id", "type", "label", ...keys.required], ["required", ...keys.optional]);
  checkId(errors, field, path, "id");
  checkNonEmptyString(errors, field, path, "label");
  checkBoolean(errors, field, path, "required");

  switch (type) {
    case "number":
      checkFiniteNumber(errors, field, path, "min");
      checkFiniteNumber(errors, field, path, "max");
      checkFiniteNumber(errors, field, path, "step");
      if (typeof field["step"] === "number" && field["step"] <= 0) {
        errors.add([...path, "step"], "invalid-value", '"step" must be greater than 0.', "Use a positive number, e.g. 0.5.");
      }
      checkNonEmptyString(errors, field, path, "unit");
      checkRange(errors, field, path, (v): v is number => typeof v === "number");
      return;
    case "select":
      checkStaticOptions(errors, field, [...path, "options"]);
      return;
    case "date":
      checkIsoDate(errors, field, path, "min");
      checkIsoDate(errors, field, path, "max");
      checkRange(errors, field, path, (v): v is string => typeof v === "string" && isIsoDate(v));
      return;
  }
}

/** Properties each field type allows beyond id, type, label and required. */
const FIELD_KEYS: { readonly [K in FieldType]: { readonly required: readonly string[]; readonly optional: readonly string[] } } = {
  text: { required: [], optional: [] },
  number: { required: [], optional: ["min", "max", "step", "unit"] },
  boolean: { required: [], optional: [] },
  select: { required: ["options"], optional: [] },
  date: { required: [], optional: ["min", "max"] },
};

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

function validateTable(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "columns"], ["title", "sort", "pageSize"]);
  checkNonEmptyString(errors, doc, [], "title");
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");

  const columns = checkArray(errors, doc, [], "columns");
  if (columns?.length === 0) errors.add(["columns"], "invalid-value", "A table needs at least one column.", 'Add { "field": "<field id>" }.');
  const shown: { id: string; path: Path }[] = [];
  columns?.forEach((column, i) => {
    const path = ["columns", i];
    if (!isObject(column)) {
      errors.add(path, "type", "A column must be a JSON object.", 'Use { "field": "<field id>" }.');
      return;
    }
    checkKeys(errors, column, path, ["field"], ["editable"]);
    checkId(errors, column, path, "field");
    checkBoolean(errors, column, path, "editable");
    if (typeof column["field"] === "string") shown.push({ id: column["field"], path: [...path, "field"] });
  });
  reportDuplicates(errors, shown, "column", "a table (each field appears once)");

  const sort = checkArray(errors, doc, [], "sort");
  const sorted: { id: string; path: Path }[] = [];
  sort?.forEach((key, i) => {
    const path = ["sort", i];
    if (!isObject(key)) {
      errors.add(path, "type", "A sort key must be a JSON object.", 'Use { "field": "<field id>", "dir": "asc" }.');
      return;
    }
    checkKeys(errors, key, path, ["field", "dir"], []);
    checkId(errors, key, path, "field");
    if (key["dir"] !== undefined && key["dir"] !== "asc" && key["dir"] !== "desc") {
      errors.add([...path, "dir"], "invalid-value", `Unknown sort direction ${JSON.stringify(key["dir"])}.`, 'Use "asc" or "desc".');
    }
    if (typeof key["field"] === "string") sorted.push({ id: key["field"], path: [...path, "field"] });
  });
  reportDuplicates(errors, sorted, "sort", "a table's sort");

  const pageSize = doc["pageSize"];
  if (pageSize !== undefined && (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)) {
    errors.add(["pageSize"], "invalid-value", '"pageSize" must be a whole number from 1 to 1000.', "Use e.g. 25.");
  }
}

// ---- checks ---------------------------------------------------------------

function isFieldType(value: unknown): value is FieldType {
  return FIELD_TYPES.some((t) => t === value);
}

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

function checkFiniteNumber(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
    errors.add([...path, key], "type", `"${key}" must be a number.`, "Use a plain number, e.g. 10.");
  }
}

/** "YYYY-MM-DD" that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function checkIsoDate(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v !== undefined && (typeof v !== "string" || !isIsoDate(v))) {
    errors.add([...path, key], "invalid-value", `"${key}" must be a date like "2026-10-04".`, "Use YYYY-MM-DD.");
  }
}

/** Reports min above max, when both are valid values of the same kind. */
function checkRange(errors: Errors, obj: JsonObject, path: Path, valid: (v: unknown) => v is number | string): void {
  const min = obj["min"];
  const max = obj["max"];
  if (valid(min) && valid(max) && min > max) {
    errors.add([...path, "min"], "invalid-value", `"min" (${String(min)}) is above "max" (${String(max)}).`, "Swap them or fix one.");
  }
}

function checkStaticOptions(errors: Errors, field: JsonObject, path: Path): void {
  const options = field["options"];
  if (options === undefined) return;
  if (!isObject(options)) {
    errors.add(path, "type", '"options" must be an object.', 'Use { "source": "static", "values": ["A", "B"] }.');
    return;
  }
  checkKeys(errors, options, path, ["source", "values"], []);
  if (options["source"] !== undefined && options["source"] !== "static") {
    errors.add([...path, "source"], "invalid-value", `Unknown options source ${JSON.stringify(options["source"])}.`, 'Use "static".');
  }
  const values = checkArray(errors, options, path, "values");
  if (!values) return;
  if (values.length === 0) {
    errors.add([...path, "values"], "invalid-value", "A select needs at least one choice.", 'Add choices, e.g. ["Squat", "Bench"].');
  }
  const seen = new Set<string>();
  values.forEach((v, i) => {
    if (typeof v !== "string" || v.trim() === "") {
      errors.add([...path, "values", i], "invalid-value", "Each choice must be non-empty text.", "Remove it or give it a name.");
    } else if (seen.has(v)) {
      errors.add([...path, "values", i], "duplicate-id", `Choice "${v}" is listed twice.`, "Remove the duplicate.");
    } else {
      seen.add(v);
    }
  });
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
