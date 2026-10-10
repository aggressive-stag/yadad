// PRE-CONTRACT (P0-04). Hand-written structural validation for the skeleton
// documents. The validator library and generated JSON Schemas are a Phase 1
// decision (P1-01). Collects every error instead of stopping at the first.
// `validateDocument` checks one document's shape; `validateDocuments` adds the
// cross-document referential checks (entity exists, field ids exist on it,
// widgets point at existing views) that only hold across a whole set.

import { CONDITION_OPS } from "./condition.js";
import type { Condition, ConditionOp } from "./condition.js";
import { DOCUMENT_KINDS, GRID_COLUMNS_DEFAULT, GRID_ITEM_KEYS, GRID_ITEM_MAX, ID_HINT, ID_PATTERN, MAX_CONDITION_DEPTH, MAX_GRID_COLUMNS, PAGE_SIZE_MAX } from "./contract.js";
import { FIELD_TYPES, SPEC_VERSION, WIDGET_TYPES } from "./document.js";
import type { Document, DashboardView, EntityDocument, FieldType, FormView, TableView } from "./document.js";
import { jsonPointer } from "./errors.js";
import type { DocumentError, ErrorCode } from "./errors.js";

/**
 * Errors make a document invalid. Warnings never do: they flag documents that
 * are valid but probably not what the author meant, such as a form with no fields.
 */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly DocumentError[] }
  | { readonly ok: false; readonly errors: readonly DocumentError[]; readonly warnings: readonly DocumentError[] };


type Path = readonly (string | number)[];
type JsonObject = { readonly [key: string]: unknown };

class Errors {
  readonly list: DocumentError[] = [];
  readonly warnings: DocumentError[] = [];
  add(path: Path, code: ErrorCode, message: string, hint: string, allowed?: readonly string[]): void {
    this.list.push(allowed ? { path: jsonPointer(path), code, message, hint, allowed } : { path: jsonPointer(path), code, message, hint });
  }
  warn(path: Path, message: string, hint: string): void {
    this.warnings.push({ path: jsonPointer(path), code: "empty", message, hint });
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
  } else if (input["kind"] === "dashboard") {
    validateDashboard(errors, input);
  } else if (input["kind"] === undefined) {
    errors.add(["kind"], "required", 'Missing required property "kind".', `Add "kind": one of ${DOCUMENT_KINDS.join(", ")}.`);
  } else {
    errors.add(
      ["kind"],
      "unknown-kind",
      `Unknown document kind ${JSON.stringify(input["kind"])}.`,
      `Use one of: ${DOCUMENT_KINDS.join(", ")}.`,
      DOCUMENT_KINDS,
    );
  }

  return errors.list.length > 0
    ? { ok: false, errors: errors.list, warnings: errors.warnings }
    : // Every property was checked above; the narrowing is this function's job.
      { ok: true, value: input as Document, warnings: errors.warnings };
}

function validateEntity(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "revision", "fields"], []);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkRevision(errors, doc);

  const fields = checkArray(errors, doc, [], "fields");
  if (!fields) return;
  if (fields.length === 0) errors.warn(["fields"], "This entity has no fields yet.", 'Add a field, e.g. { "id": "name", "type": "text", "label": "Name" }.');
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
      FIELD_TYPES,
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
      checkKeys(errors, item, itemPath, ["field"], ["visibleWhen", "requiredWhen", "clearWhenHidden"]);
      checkId(errors, item, itemPath, "field");
      checkCondition(errors, item["visibleWhen"], [...itemPath, "visibleWhen"]);
      checkCondition(errors, item["requiredWhen"], [...itemPath, "requiredWhen"]);
      checkBoolean(errors, item, itemPath, "clearWhenHidden");
      if (typeof item["field"] === "string") placed.push({ id: item["field"], path: [...itemPath, "field"] });
    });
  });
  reportDuplicates(errors, sectionIds, "section", "a form");
  reportDuplicates(errors, placed, "placed field", "a form (each field appears once)");
  // An empty form validates but renders only a Save button.
  if (placed.length === 0) errors.warn(["sections"], "This form shows no fields.", 'Place a field in a section: { "field": "<field id>" }.');
  else
    sections.forEach((section, i) => {
      if (isObject(section) && Array.isArray(section["items"]) && section["items"].length === 0) {
        errors.warn(["sections", i, "items"], `Section ${JSON.stringify(section["id"])} has no fields.`, "Place a field in it or remove the section.");
      }
    });
}

function validateTable(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "columns"], ["title", "sort", "pageSize", "filter", "quickFilters"]);
  checkCondition(errors, doc["filter"], ["filter"]);
  const filters = checkArray(errors, doc, [], "quickFilters");
  const filtered: { id: string; path: Path }[] = [];
  filters?.forEach((f, i) => {
    const path = ["quickFilters", i];
    if (!isObject(f)) {
      errors.add(path, "type", "A filter must be a JSON object.", 'Use { "field": "<field id>" }.');
      return;
    }
    checkKeys(errors, f, path, ["field"], []);
    checkId(errors, f, path, "field");
    if (typeof f["field"] === "string") filtered.push({ id: f["field"], path: [...path, "field"] });
  });
  reportDuplicates(errors, filtered, "filter", "a table's quick filters");
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
  if (pageSize !== undefined && (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX)) {
    errors.add(["pageSize"], "invalid-value", `"pageSize" must be a whole number from 1 to ${PAGE_SIZE_MAX}.`, "Use e.g. 25.");
  }
}

function validateDashboard(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "revision", "tabs"], ["title"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "title");

  const tabs = checkArray(errors, doc, [], "tabs");
  if (tabs?.length === 0) errors.add(["tabs"], "invalid-value", "A dashboard needs at least one tab.", 'Add { "id", "title", "items" }.');
  const tabIds: { id: string; path: Path }[] = [];
  tabs?.forEach((tab, i) => {
    const path = ["tabs", i];
    if (!isObject(tab)) {
      errors.add(path, "type", "A tab must be a JSON object.", 'Use { "id", "title", "items" }.');
      return;
    }
    checkKeys(errors, tab, path, ["id", "title", "items"], ["columns"]);
    checkId(errors, tab, path, "id");
    checkNonEmptyString(errors, tab, path, "title");
    if (typeof tab["id"] === "string") tabIds.push({ id: tab["id"], path: [...path, "id"] });
    const columns = tab["columns"] === undefined ? GRID_COLUMNS_DEFAULT : tab["columns"];
    if (!isWhole(columns, 1, MAX_GRID_COLUMNS)) {
      errors.add([...path, "columns"], "invalid-value", `"columns" must be a whole number from 1 to ${MAX_GRID_COLUMNS}.`, "Use e.g. 12.");
    }
    const items = checkArray(errors, tab, path, "items");
    const itemIds: { id: string; path: Path }[] = [];
    const placed: Rect[] = [];
    items?.forEach((item, j) => {
      const itemPath = [...path, "items", j];
      if (!isObject(item)) {
        errors.add(itemPath, "type", "A grid item must be a JSON object.", 'Use { "id", "x", "y", "w", "h", "widget": "view", "view": "<view id>" }.');
        return;
      }
      if (validateGridItem(errors, item, itemPath, typeof columns === "number" ? columns : GRID_COLUMNS_DEFAULT)) {
        placed.push({ x: item["x"] as number, y: item["y"] as number, w: item["w"] as number, h: item["h"] as number, index: j, name: typeof item["id"] === "string" ? `"${item["id"]}"` : `item ${j}` });
      }
      if (typeof item["id"] === "string") itemIds.push({ id: item["id"], path: [...itemPath, "id"] });
    });
    reportDuplicates(errors, itemIds, "grid item", "a tab");
    if (items?.length === 0) errors.warn([...path, "items"], `Tab ${JSON.stringify(tab["title"] ?? tab["id"])} has no widgets.`, "Add a widget or remove the tab.");
    for (const [a, b] of overlaps(placed)) {
      errors.add([...path, "items", b.index], "invalid-value", `${b.name} would overlap ${a.name}.`, "Move or resize one of them.");
    }
  });
  reportDuplicates(errors, tabIds, "tab", "a dashboard");
}

const isWhole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Validates one grid item; true when its position is usable for the overlap check. */
function validateGridItem(errors: Errors, item: JsonObject, path: Path, columns: number): boolean {
  const widget = item["widget"];
  const keys = widget === "count" ? { required: ["label", "view"], optional: ["filter"] } : { required: ["view"], optional: [] };
  checkKeys(errors, item, path, ["id", "x", "y", "w", "h", "widget", ...keys.required], keys.optional);
  checkId(errors, item, path, "id");
  let usable = true;
  for (const { key, min } of GRID_ITEM_KEYS) {
    if (item[key] !== undefined && !isWhole(item[key], min, GRID_ITEM_MAX)) {
      errors.add([...path, key], "invalid-value", `"${key}" must be a whole number of at least ${min}.`, "Grid positions count columns and rows from 0.");
      usable = false;
    } else if (item[key] === undefined) usable = false;
  }
  if (usable && (item["x"] as number) + (item["w"] as number) > columns) {
    errors.add([...path, "w"], "invalid-value", `The item runs past the tab's ${columns} columns.`, "Reduce x or w.");
  }
  if (widget !== undefined && widget !== "view" && widget !== "count") {
    errors.add([...path, "widget"], "invalid-value", `Unknown widget ${JSON.stringify(widget)}.`, `Use one of: ${WIDGET_TYPES.join(", ")}.`);
  }
  checkId(errors, item, path, "view");
  if (widget === "count") {
    checkNonEmptyString(errors, item, path, "label");
    checkCondition(errors, item["filter"], [...path, "filter"]);
  }
  return usable;
}

type Rect = { x: number; y: number; w: number; h: number; index: number; name: string };

function overlaps(rects: readonly Rect[]): [Rect, Rect][] {
  const found: [Rect, Rect][] = [];
  rects.forEach((b, j) => {
    const a = rects.slice(0, j).find((a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
    if (a) found.push([a, b]);
  });
  return found;
}

// ---- conditions -----------------------------------------------------------

const isScalar = (v: unknown): boolean => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";
const CONDITION_HINT = 'Use e.g. { "op": "eq", "field": "exercise", "value": "Squat" }.';

/** The exact shape each op takes, so a hint shows the one the author is writing. */
const CONDITION_SHAPES: { readonly [K in ConditionOp]: string } = {
  eq: '{ "op": "eq", "field": "<field id>", "value": "Squat" }',
  neq: '{ "op": "neq", "field": "<field id>", "value": "Squat" }',
  gt: '{ "op": "gt", "field": "<field id>", "value": 100 }',
  gte: '{ "op": "gte", "field": "<field id>", "value": 100 }',
  lt: '{ "op": "lt", "field": "<field id>", "value": 100 }',
  lte: '{ "op": "lte", "field": "<field id>", "value": 100 }',
  in: '{ "op": "in", "field": "<field id>", "values": ["Squat", "Bench"] } (a list under "values")',
  contains: '{ "op": "contains", "field": "<field id>", "value": "text" }',
  empty: '{ "op": "empty", "field": "<field id>" }',
  notEmpty: '{ "op": "notEmpty", "field": "<field id>" }',
  and: '{ "op": "and", "conditions": [ <condition>, ... ] } (a list under "conditions")',
  or: '{ "op": "or", "conditions": [ <condition>, ... ] } (a list under "conditions")',
  not: '{ "op": "not", "condition": <condition> } (one condition under "condition")',
};

/** Keys authors swap by one letter; an unknown one suggests its twin when that is what the op takes. */
const NEAR_MISSES: Readonly<Record<string, string>> = { value: "values", values: "value", condition: "conditions", conditions: "condition" };

/** Like checkKeys, with hints that show this op's exact shape and catch near misses. */
function checkConditionKeys(errors: Errors, obj: JsonObject, path: Path, op: ConditionOp, required: readonly string[]): void {
  const shape = `Use ${CONDITION_SHAPES[op]}.`;
  const allowed = ["op", ...required];
  // Unknown keys first: a near miss is usually why the required key is missing.
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const twin = NEAR_MISSES[key];
    const message = twin !== undefined && allowed.includes(twin) ? `"${op}" takes "${twin}", not "${key}".` : `Unknown property "${key}" for "${op}".`;
    errors.add([...path, key], "unknown-property", message, shape, allowed);
  }
  for (const key of allowed) {
    if (!(key in obj)) errors.add([...path, key], "required", `Missing required property "${key}" for "${op}".`, shape);
  }
}

/** Validates an optional condition (undefined is fine). */
function checkCondition(errors: Errors, value: unknown, path: Path, depth = 0): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.add(path, "type", "A condition must be a JSON object.", CONDITION_HINT);
    return;
  }
  if (depth >= MAX_CONDITION_DEPTH) {
    errors.add(path, "invalid-value", `Conditions may nest at most ${MAX_CONDITION_DEPTH} levels.`, "Flatten it with and/or.");
    return;
  }
  const op = value["op"];
  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains":
      checkConditionKeys(errors, value, path, op, ["field", "value"]);
      checkId(errors, value, path, "field");
      if (value["value"] !== undefined && !(op === "contains" ? typeof value["value"] === "string" : isScalar(value["value"]))) {
        errors.add([...path, "value"], "type", `"value" must be ${op === "contains" ? "text" : "text, a number or true/false"}.`, `Use ${CONDITION_SHAPES[op]}.`);
      }
      return;
    case "in": {
      checkConditionKeys(errors, value, path, op, ["field", "values"]);
      checkId(errors, value, path, "field");
      const values = checkArray(errors, value, path, "values");
      values?.forEach((v, i) => {
        if (!isScalar(v)) errors.add([...path, "values", i], "type", "Each value must be text, a number or true/false.", `Use ${CONDITION_SHAPES.in}.`);
      });
      return;
    }
    case "empty":
    case "notEmpty":
      checkConditionKeys(errors, value, path, op, ["field"]);
      checkId(errors, value, path, "field");
      return;
    case "and":
    case "or": {
      checkConditionKeys(errors, value, path, op, ["conditions"]);
      const list = checkArray(errors, value, path, "conditions");
      list?.forEach((c, i) => checkCondition(errors, c, [...path, "conditions", i], depth + 1));
      return;
    }
    case "not":
      checkConditionKeys(errors, value, path, op, ["condition"]);
      checkCondition(errors, value["condition"], [...path, "condition"], depth + 1);
      return;
    case undefined:
      errors.add([...path, "op"], "required", 'Missing required property "op".', `Add "op": one of ${CONDITION_OPS.join(", ")}.`);
      return;
    default:
      errors.add(
        [...path, "op"],
        "invalid-value",
        `Unknown condition op ${JSON.stringify(op)}.`,
        `Use one of: ${CONDITION_OPS.join(", ")}.`,
        CONDITION_OPS,
      );
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

// ---- set of documents: cross-reference validation -------------------------

/**
 * Validates a set of documents together, in addition to checking each one on
 * its own (as `validateDocument` does). Cross-document references that only
 * hold across the whole set are checked here:
 *
 * - every form/table view's `entity` exists and is an entity document;
 * - every field id a form (items and conditions), table (columns, sort, quick
 *   filters, fixed filter) or a dashboard `count` widget's filter uses exists
 *   on that view's entity;
 * - a dashboard `view` widget points at an existing form or table, and a
 *   `count` widget points at an existing table;
 * - document ids are unique per kind across the set.
 *
 * Errors that belong to a single document carry that document's id in
 * `DocumentError.document`; `path` is still a JSON Pointer into that one
 * document. Returns `ok` only when every document is structurally valid and
 * every reference resolves.
 */
export function validateDocuments(inputs: readonly unknown[]): ValidationResult<readonly Document[]> {
  const results = inputs.map(validateDocument);
  const errors: DocumentError[] = [];
  const warnings: DocumentError[] = [];
  const okDocs: Document[] = [];
  results.forEach((result, i) => {
    const label = documentLabel(inputs[i]);
    const tag = (e: DocumentError) => (label === undefined ? e : { ...e, document: label });
    warnings.push(...result.warnings.map(tag));
    if (result.ok) okDocs.push(result.value);
    else errors.push(...result.errors.map(tag));
  });
  checkSetReferences(errors, okDocs);
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: okDocs, warnings };
}

/** The id of a document when it is a plain object with a string "id". */
function documentLabel(input: unknown): string | undefined {
  return isObject(input) && typeof input["id"] === "string" ? input["id"] : undefined;
}

interface SetIndex {
  readonly entities: Map<string, EntityDocument>;
  readonly forms: Map<string, FormView>;
  readonly tables: Map<string, TableView>;
  readonly dashboards: Map<string, DashboardView>;
}

function checkSetReferences(errors: DocumentError[], docs: readonly Document[]): void {
  const idx: SetIndex = { entities: new Map(), forms: new Map(), tables: new Map(), dashboards: new Map() };
  for (const doc of docs) {
    switch (doc.kind) {
      case "entity":
        putUnique(idx.entities, doc, "entity", errors);
        break;
      case "form":
        putUnique(idx.forms, doc, "form", errors);
        break;
      case "table":
        putUnique(idx.tables, doc, "table", errors);
        break;
      case "dashboard":
        putUnique(idx.dashboards, doc, "dashboard", errors);
        break;
    }
  }
  const embeddable = [...idx.forms.keys(), ...idx.tables.keys()];
  for (const doc of docs) {
    switch (doc.kind) {
      case "form":
      case "table":
        checkViewFields(errors, doc, idx);
        break;
      case "dashboard":
        checkDashboard(errors, doc, idx, embeddable);
        break;
      default:
        break;
    }
  }
}

/** Reports a document whose id collides with another of the same kind. */
function putUnique<T extends { readonly id: string }>(map: Map<string, T>, doc: T, kind: string, errors: DocumentError[]): void {
  if (map.has(doc.id)) {
    errors.push({
      path: "/id",
      code: "duplicate-id",
      message: `A ${kind} with id "${doc.id}" is defined more than once.`,
      hint: "Document ids must be unique within a kind; rename one of them.",
      document: doc.id,
    });
    return;
  }
  map.set(doc.id, doc);
}

/** Builds a cross-reference error pointing at one document. */
function refError(document: string, path: Path, message: string, hint: string, allowed: readonly string[]): DocumentError {
  return { path: jsonPointer(path), code: "unknown-reference", message, hint, document, allowed };
}

/** Checks that a form or table view's entity and every field it uses exist. */
function checkViewFields(errors: DocumentError[], view: FormView | TableView, idx: SetIndex): void {
  const entity = idx.entities.get(view.entity);
  if (!entity) {
    errors.push(refError(view.id, ["entity"], `View references unknown entity "${view.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
    return;
  }
  const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
  const checkField = (fieldId: string, path: Path): void => {
    if (fieldIds.includes(fieldId)) return;
    errors.push(refError(view.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
  };
  if (view.kind === "form") {
    view.sections.forEach((section, i) => {
      section.items.forEach((item, j) => {
        const itemPath: Path = ["sections", i, "items", j];
        checkField(item.field, [...itemPath, "field"]);
        checkConditionFields(item.visibleWhen, [...itemPath, "visibleWhen"], checkField);
        checkConditionFields(item.requiredWhen, [...itemPath, "requiredWhen"], checkField);
      });
    });
    return;
  }
  view.columns.forEach((column, i) => checkField(column.field, ["columns", i, "field"]));
  view.sort?.forEach((key, i) => checkField(key.field, ["sort", i, "field"]));
  view.quickFilters?.forEach((filter, i) => checkField(filter.field, ["quickFilters", i, "field"]));
  checkConditionFields(view.filter, ["filter"], checkField);
}

/** Calls `check` for every field a condition references, with its JSON Pointer. */
function checkConditionFields(condition: Condition | undefined, base: Path, check: (fieldId: string, path: Path) => void): void {
  if (!condition) return;
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((c, i) => checkConditionFields(c, [...base, "conditions", i], check));
      break;
    case "not":
      checkConditionFields(condition.condition, [...base, "condition"], check);
      break;
    default:
      check(condition.field, [...base, "field"]);
  }
}

/** Checks that a dashboard's widgets point at existing views (and, for counts, valid fields). */
function checkDashboard(errors: DocumentError[], doc: DashboardView, idx: SetIndex, embeddable: readonly string[]): void {
  doc.tabs.forEach((tab, i) => {
    tab.items.forEach((item, j) => {
      const itemPath: Path = ["tabs", i, "items", j];
      if (item.widget === "view") {
        if (!idx.forms.has(item.view) && !idx.tables.has(item.view)) {
          errors.push(refError(doc.id, [...itemPath, "view"], `Widget references unknown view "${item.view}".`, "Point at a form or table view.", embeddable));
        }
        return;
      }
      const table = idx.tables.get(item.view);
      if (!table) {
        errors.push(refError(doc.id, [...itemPath, "view"], `Count widget references unknown table view "${item.view}".`, "Point at a table view.", [...idx.tables.keys()]));
        return;
      }
      const entity = idx.entities.get(table.entity);
      if (!entity) return; // the table's own missing entity is reported on the table
      const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
      checkConditionFields(item.filter, [...itemPath, "filter"], (fieldId, path) => {
        if (!fieldIds.includes(fieldId)) {
          errors.push(refError(doc.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
        }
      });
    });
  });
}
