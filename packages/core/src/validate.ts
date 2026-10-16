// PRE-CONTRACT (P0-04). Hand-written structural validation for the skeleton
// documents. The validator library and generated JSON Schemas are a Phase 1
// decision (P1-01). Collects every error instead of stopping at the first.
// `validateDocument` checks one document's shape; `validateDocuments` adds the
// cross-document referential checks (entity exists, field ids exist on it,
// widgets point at existing views) that only hold across a whole set.

import { CONDITION_OPS, MAX_RELATIVE_DAYS, RELATIVE_DATE_OPS, isRelativeDate } from "./condition.js";
import type { Condition, ConditionOp } from "./condition.js";
import { BOARD_CARD_FIELDS_MAX, BOARD_GROUP_BY_MAX, BOARD_GROUP_FIELD_TYPES, BOARD_TITLE_FIELD_TYPES, CALENDAR_DETAIL_FIELDS_MAX, CALENDAR_COLOR_FIELD_TYPES, CALENDAR_TITLE_FIELD_TYPES, DOCUMENT_KINDS, GRID_COLUMNS_DEFAULT, GRID_ITEM_KEYS, GRID_ITEM_MAX, ID_HINT, ID_PATTERN, MAX_CONDITION_DEPTH, MAX_GRID_COLUMNS, MAX_ROW_ACTION_DEPTH, MEASURE_FIELD_TYPES, MEASURE_PRODUCT_OPS, PAGE_SIZE_MAX } from "./contract.js";
import { CALENDAR_MODES, FIELD_TYPES, MEASURE_OPS, ROW_ACTION_MODES, SPEC_VERSION, SUPPORTED_SPEC_VERSIONS, WIDGET_TYPES } from "./document.js";
import type { BoardView, CalendarView, Document, DashboardView, EntityDocument, Field, FieldType, FormView, Measure, TableView } from "./document.js";
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
  } else if (input["kind"] === "calendar") {
    validateCalendar(errors, input);
  } else if (input["kind"] === "board") {
    validateBoard(errors, input);
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
    case "reference":
      checkId(errors, field, path, "entity");
      if (field["display"] !== undefined) checkId(errors, field, path, "display");
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
  reference: { required: ["entity"], optional: ["display"] },
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
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "columns"], ["title", "sort", "pageSize", "filter", "quickFilters", "rowAction"]);
  checkCondition(errors, doc["filter"], ["filter"]);
  checkRowAction(errors, doc["rowAction"]);
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

  checkSort(errors, doc, "a table's sort");

  const pageSize = doc["pageSize"];
  if (pageSize !== undefined && (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX)) {
    errors.add(["pageSize"], "invalid-value", `"pageSize" must be a whole number from 1 to ${PAGE_SIZE_MAX}.`, "Use e.g. 25.");
  }
}

/** Shape of a `sort` array: { field, dir? } entries, each field once. */
function checkSort(errors: Errors, doc: JsonObject, scope: string): void {
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
  reportDuplicates(errors, sorted, "sort", scope);
}

const CALENDAR_ID_KEYS = ["dateField", "titleField", "colorField"] as const;

function validateCalendar(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "dateField"], ["title", "titleField", "detailFields", "colorField", "filter", "sort", "modes", "weekStartsOn", "editable", "rowAction"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");
  checkNonEmptyString(errors, doc, [], "title");
  for (const key of CALENDAR_ID_KEYS) checkId(errors, doc, [], key);
  checkCondition(errors, doc["filter"], ["filter"]);
  checkRowAction(errors, doc["rowAction"]);
  checkSort(errors, doc, "a calendar's sort");
  checkBoolean(errors, doc, [], "editable");

  const details = checkArray(errors, doc, [], "detailFields");
  if (details) {
    if (details.length > CALENDAR_DETAIL_FIELDS_MAX) {
      errors.add(["detailFields"], "invalid-value", `A calendar shows at most ${CALENDAR_DETAIL_FIELDS_MAX} detail fields, but ${details.length} are listed.`, `Remove ${details.length - CALENDAR_DETAIL_FIELDS_MAX}.`);
    }
    const seen = new Set<string>();
    details.forEach((d, i) => {
      if (typeof d !== "string") errors.add(["detailFields", i], "type", "A detail field must be a field id string.", ID_HINT);
      else if (!ID_PATTERN.test(d)) errors.add(["detailFields", i], "invalid-value", `${JSON.stringify(d)} is not a valid id.`, ID_HINT);
      else if (seen.has(d)) errors.add(["detailFields", i], "invalid-value", `Detail field "${d}" is listed twice.`, "Remove the duplicate.");
      else seen.add(d);
    });
  }

  const modes = checkArray(errors, doc, [], "modes");
  if (modes) {
    if (modes.length === 0) errors.add(["modes"], "invalid-value", "A calendar needs at least one mode.", `Use e.g. ["month", "week"]. Allowed: ${CALENDAR_MODES.join(", ")}.`, [...CALENDAR_MODES]);
    const seen = new Set<unknown>();
    modes.forEach((m, i) => {
      if (!CALENDAR_MODES.some((x) => x === m)) {
        errors.add(["modes", i], "invalid-value", `Unknown calendar mode ${JSON.stringify(m)}.`, `Use one of: ${CALENDAR_MODES.join(", ")}.`, [...CALENDAR_MODES]);
      } else if (seen.has(m)) {
        errors.add(["modes", i], "invalid-value", `Mode ${JSON.stringify(m)} is listed twice.`, "Remove the duplicate.");
      } else seen.add(m);
    });
  }

  const weekStartsOn = doc["weekStartsOn"];
  if (weekStartsOn !== undefined) {
    if (typeof weekStartsOn !== "number") errors.add(["weekStartsOn"], "type", '"weekStartsOn" must be a number.', "Use 0 (Sunday) to 6 (Saturday); 1 is Monday.");
    else if (!isWhole(weekStartsOn, 0, 6)) errors.add(["weekStartsOn"], "invalid-value", `weekStartsOn ${weekStartsOn} is not a whole number from 0 to 6.`, "Use 0 (Sunday) to 6 (Saturday); 1 is Monday.");
  }
}

function validateBoard(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "groupBy"], ["title", "titleField", "cardFields", "filter", "sort", "editable", "rowAction"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");
  checkNonEmptyString(errors, doc, [], "title");
  checkId(errors, doc, [], "titleField");
  checkCondition(errors, doc["filter"], ["filter"]);
  checkRowAction(errors, doc["rowAction"]);
  checkSort(errors, doc, "a board's sort");
  checkBoolean(errors, doc, [], "editable");

  const groupBy = checkArray(errors, doc, [], "groupBy");
  if (groupBy) {
    if (groupBy.length === 0) errors.add(["groupBy"], "invalid-value", "A board needs at least one grouping.", 'Add { "field": "<field id>" }.');
    else if (groupBy.length > BOARD_GROUP_BY_MAX) errors.add(["groupBy"], "invalid-value", `A board allows at most ${BOARD_GROUP_BY_MAX} groupings, but ${groupBy.length} are listed.`, `Remove ${groupBy.length - BOARD_GROUP_BY_MAX}.`);
    const seen = new Set<string>();
    groupBy.forEach((g, i) => {
      const path: Path = ["groupBy", i];
      if (!isObject(g)) {
        errors.add(path, "type", "A grouping must be a JSON object.", 'Use { "field": "<field id>" }.');
        return;
      }
      checkKeys(errors, g, path, ["field"], []);
      checkId(errors, g, path, "field");
      const field = g["field"];
      if (typeof field === "string" && ID_PATTERN.test(field)) {
        if (seen.has(field)) errors.add([...path, "field"], "invalid-value", `Grouping field "${field}" is listed twice.`, "Remove the duplicate.");
        else seen.add(field);
      }
    });
  }

  const cardFields = checkArray(errors, doc, [], "cardFields");
  if (cardFields) {
    if (cardFields.length > BOARD_CARD_FIELDS_MAX) {
      errors.add(["cardFields"], "invalid-value", `A board shows at most ${BOARD_CARD_FIELDS_MAX} card fields, but ${cardFields.length} are listed.`, `Remove ${cardFields.length - BOARD_CARD_FIELDS_MAX}.`);
    }
    const seen = new Set<string>();
    cardFields.forEach((d, i) => {
      if (typeof d !== "string") errors.add(["cardFields", i], "type", "A card field must be a field id string.", ID_HINT);
      else if (!ID_PATTERN.test(d)) errors.add(["cardFields", i], "invalid-value", `${JSON.stringify(d)} is not a valid id.`, ID_HINT);
      else if (seen.has(d)) errors.add(["cardFields", i], "invalid-value", `Card field "${d}" is listed twice.`, "Remove the duplicate.");
      else seen.add(d);
    });
  }
}

const ROW_ACTION_HINT = 'Use { "open": "<table view id>", "bind": [{ "field": "<field here>", "to": "<field on the target>" }] }.';

function checkRowAction(errors: Errors, value: unknown): void {
  if (value === undefined) return;
  const path: Path = ["rowAction"];
  if (!isObject(value)) {
    errors.add(path, "type", "A rowAction must be a JSON object.", ROW_ACTION_HINT);
    return;
  }
  checkKeys(errors, value, path, ["open", "bind"], ["mode"]);
  checkId(errors, value, path, "open");
  if (value["mode"] !== undefined && !ROW_ACTION_MODES.some((m) => m === value["mode"])) {
    errors.add([...path, "mode"], "invalid-value", `Unsupported rowAction mode ${JSON.stringify(value["mode"])}.`, `Use "replace" (the only mode so far; "dialog" is planned). Allowed: ${ROW_ACTION_MODES.join(", ")}.`, [...ROW_ACTION_MODES]);
  }
  const bind = checkArray(errors, value, path, "bind");
  if (bind?.length === 0) errors.add([...path, "bind"], "invalid-value", "A rowAction needs at least one binding.", 'Add { "field": "<field here>", "to": "<field on the target>" }.');
  const targets: { id: string; path: Path }[] = [];
  bind?.forEach((b, i) => {
    const bpath = [...path, "bind", i];
    if (!isObject(b)) {
      errors.add(bpath, "type", "A binding must be a JSON object.", 'Use { "field": "<field here>", "to": "<field on the target>" }.');
      return;
    }
    checkKeys(errors, b, bpath, ["field", "to"], []);
    checkId(errors, b, bpath, "field");
    checkId(errors, b, bpath, "to");
    if (typeof b["to"] === "string") targets.push({ id: b["to"], path: [...bpath, "to"] });
  });
  reportDuplicates(errors, targets, "binding", "a rowAction (each target field is bound once)");
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
  const keys =
    widget === "count"
      ? { required: ["label", "view"], optional: ["filter"] }
      : widget === "stat"
        ? { required: ["label", "view", "measure"], optional: ["filter"] }
        : { required: ["view"], optional: [] };
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
  if (widget !== undefined && widget !== "view" && widget !== "count" && widget !== "stat") {
    errors.add([...path, "widget"], "invalid-value", `Unknown widget ${JSON.stringify(widget)}.`, `Use one of: ${WIDGET_TYPES.join(", ")}.`);
  }
  checkId(errors, item, path, "view");
  if (widget === "count" || widget === "stat") {
    checkNonEmptyString(errors, item, path, "label");
    checkCondition(errors, item["filter"], [...path, "filter"]);
  }
  if (widget === "stat") checkMeasure(errors, item["measure"], [...path, "measure"]);
  return usable;
}

const MEASURE_HINT = 'Use { "op": "count" }, { "op": "sum", "field": "<number field>" } or { "op": "sum", "product": ["<number field>", "<number field>"] }.';

/** Shape of a stat's measure: a closed union on `op`. Field ids and types are checked across the set. */
function checkMeasure(errors: Errors, value: unknown, path: Path): void {
  if (value === undefined) return; // reported as missing by checkKeys
  if (!isObject(value)) {
    errors.add(path, "type", "A measure must be a JSON object.", MEASURE_HINT);
    return;
  }
  const op = value["op"];
  if (op === undefined) {
    errors.add([...path, "op"], "required", 'Missing required property "op".', `Add "op": one of ${MEASURE_OPS.join(", ")}.`);
    return;
  }
  if (typeof op !== "string" || !(MEASURE_OPS as readonly string[]).includes(op)) {
    errors.add([...path, "op"], "invalid-value", `Unknown measure op ${JSON.stringify(op)}.`, `Use one of: ${MEASURE_OPS.join(", ")}.`, MEASURE_OPS);
    return;
  }
  const takesProduct = (MEASURE_PRODUCT_OPS as readonly string[]).includes(op);
  const keys = ["op", ...(op === "count" ? [] : takesProduct ? ["field", "product"] : ["field"])];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.add([...path, key], "unknown-property", `"${op}" does not take "${key}".`, `Allowed here: ${keys.join(", ")}.`, keys);
  }
  if (op === "count") return;
  const hasField = "field" in value;
  const hasProduct = "product" in value;
  if (hasField && hasProduct) {
    errors.add([...path, "product"], "invalid-value", `"${op}" takes either "field" or "product", not both.`, "Remove one of them.");
  } else if (!hasField && !hasProduct) {
    errors.add([...path, "field"], "required", `Missing required property "field".`, takesProduct ? `Add "field", or "product": ["<number field>", "<number field>"].` : 'Add "field".');
  }
  if (hasField) checkId(errors, value, path, "field");
  if (hasProduct) {
    const product = value["product"];
    if (!Array.isArray(product) || product.length !== 2) {
      errors.add([...path, "product"], "invalid-value", '"product" must list exactly two field ids.', 'Use "product": ["<number field>", "<number field>"].');
    } else {
      product.forEach((id: unknown, i) => {
        if (typeof id !== "string") errors.add([...path, "product", i], "type", "A product operand must be a field id string.", ID_HINT);
        else if (!ID_PATTERN.test(id)) errors.add([...path, "product", i], "invalid-value", `${JSON.stringify(id)} is not a valid id.`, ID_HINT);
      });
    }
  }
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
      if (value["value"] === undefined) return;
      if (isRelativeDate(value["value"])) {
        if (op === "contains") {
          errors.add([...path, "value"], "type", '"contains" matches text, not a relative date.', `Use ${CONDITION_SHAPES[op]}; relative dates work with ${RELATIVE_DATE_OPS.join(", ")} on date fields.`);
        } else {
          checkRelativeDate(errors, value["value"], [...path, "value"]);
        }
      } else if (!(op === "contains" ? typeof value["value"] === "string" : isScalar(value["value"]))) {
        errors.add([...path, "value"], "type", `"value" must be ${op === "contains" ? "text" : "text, a number, true/false or { \"daysFromToday\": <whole number> }"}.`, `Use ${CONDITION_SHAPES[op]}.`);
      }
      return;
    case "in": {
      checkConditionKeys(errors, value, path, op, ["field", "values"]);
      checkId(errors, value, path, "field");
      const values = checkArray(errors, value, path, "values");
      values?.forEach((v, i) => {
        if (isRelativeDate(v)) {
          errors.add([...path, "values", i], "type", '"in" lists fixed values; a relative date is not allowed here.', `Use ${CONDITION_SHAPES.in} with fixed values, or compare with gte/lte and { "daysFromToday": N } on a date field.`);
        } else if (!isScalar(v)) {
          errors.add([...path, "values", i], "type", "Each value must be text, a number or true/false.", `Use ${CONDITION_SHAPES.in}.`);
        }
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

/** A relative date is exactly { daysFromToday: <whole number within +-MAX_RELATIVE_DAYS> }. */
function checkRelativeDate(errors: Errors, value: object, path: Path): void {
  const obj = value as JsonObject;
  const shape = 'Use { "daysFromToday": 0 } for today, -7 for a week ago, 1 for tomorrow.';
  for (const key of Object.keys(obj)) {
    if (key !== "daysFromToday") errors.add([...path, key], "unknown-property", `Unknown property "${key}" in a relative date.`, shape, ["daysFromToday"]);
  }
  const days = obj["daysFromToday"];
  if (typeof days !== "number" || !Number.isInteger(days)) {
    errors.add([...path, "daysFromToday"], "type", '"daysFromToday" must be a whole number.', shape);
  } else if (Math.abs(days) > MAX_RELATIVE_DAYS) {
    errors.add([...path, "daysFromToday"], "invalid-value", `"daysFromToday" ${days} is out of range.`, `Use a whole number from -${MAX_RELATIVE_DAYS} to ${MAX_RELATIVE_DAYS}.`);
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
  if (v === undefined) return;
  if (typeof v !== "number") {
    errors.add(["specVersion"], "type", '"specVersion" must be a number.', `Use ${SPEC_VERSION}.`);
  } else if (!SUPPORTED_SPEC_VERSIONS.some((s) => s === v)) {
    errors.add(
      ["specVersion"],
      "unsupported-spec-version",
      `specVersion ${v} is not supported.`,
      `Use specVersion ${SPEC_VERSION} (older documents are upgraded with migrate()).`,
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
  readonly calendars: Map<string, CalendarView>;
  readonly boards: Map<string, BoardView>;
  readonly dashboards: Map<string, DashboardView>;
}

function checkSetReferences(errors: DocumentError[], docs: readonly Document[]): void {
  const idx: SetIndex = { entities: new Map(), forms: new Map(), tables: new Map(), calendars: new Map(), boards: new Map(), dashboards: new Map() };
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
      case "calendar":
        putUnique(idx.calendars, doc, "calendar", errors);
        break;
      case "board":
        putUnique(idx.boards, doc, "board", errors);
        break;
      case "dashboard":
        putUnique(idx.dashboards, doc, "dashboard", errors);
        break;
    }
  }
  const embeddable = [...idx.forms.keys(), ...idx.tables.keys(), ...idx.calendars.keys(), ...idx.boards.keys()];
  checkRowActionChains(errors, idx);
  for (const doc of docs) {
    switch (doc.kind) {
      case "entity":
        checkReferenceFields(errors, doc, idx);
        break;
      case "form":
      case "table":
        checkViewFields(errors, doc, idx);
        break;
      case "calendar":
        checkCalendarFields(errors, doc, idx);
        break;
      case "board":
        checkBoardFields(errors, doc, idx);
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
  const checkDates = (condition: Condition | undefined, base: Path): void => {
    checkRelativeDateFields(errors, view.id, entity, condition, base);
    checkReferenceOps(errors, view.id, entity, condition, base);
  };
  if (view.kind === "form") {
    view.sections.forEach((section, i) => {
      section.items.forEach((item, j) => {
        const itemPath: Path = ["sections", i, "items", j];
        checkField(item.field, [...itemPath, "field"]);
        checkConditionFields(item.visibleWhen, [...itemPath, "visibleWhen"], checkField);
        checkConditionFields(item.requiredWhen, [...itemPath, "requiredWhen"], checkField);
        checkDates(item.visibleWhen, [...itemPath, "visibleWhen"]);
        checkDates(item.requiredWhen, [...itemPath, "requiredWhen"]);
      });
    });
    return;
  }
  view.columns.forEach((column, i) => checkField(column.field, ["columns", i, "field"]));
  view.sort?.forEach((key, i) => {
    checkField(key.field, ["sort", i, "field"]);
    checkNotReference(errors, view.id, entity, key.field, ["sort", i, "field"], "sort key");
  });
  view.quickFilters?.forEach((filter, i) => {
    checkField(filter.field, ["quickFilters", i, "field"]);
    checkNotReference(errors, view.id, entity, filter.field, ["quickFilters", i, "field"], "quick filter");
  });
  checkConditionFields(view.filter, ["filter"], checkField);
  checkDates(view.filter, ["filter"]);
  if (view.rowAction) checkRowActionTarget(errors, view, entity, idx);
}

/** Checks a table's row action: the target is a table, the bound fields exist on both entities and have the same type. */
function checkRowActionTarget(errors: DocumentError[], view: TableView | CalendarView | BoardView, entity: EntityDocument, idx: SetIndex): void {
  const action = view.rowAction;
  if (!action) return;
  const target = idx.tables.get(action.open);
  if (!target) {
    if (idx.forms.has(action.open) || idx.calendars.has(action.open) || idx.boards.has(action.open) || idx.dashboards.has(action.open)) {
      errors.push({
        path: jsonPointer(["rowAction", "open"]),
        code: "invalid-value",
        message: `Row action opens "${action.open}", which is not a table view.`,
        hint: "Row actions open table views only for now (a form target comes later); point at a table view.",
        document: view.id,
        allowed: [...idx.tables.keys()],
      });
    } else {
      errors.push(refError(view.id, ["rowAction", "open"], `Row action opens unknown view "${action.open}".`, "Point at a table view in the set.", [...idx.tables.keys()]));
    }
    return;
  }
  const targetEntity = idx.entities.get(target.entity);
  action.bind.forEach((b, i) => {
    const from = entity.fields.find((f) => f.id === b.field);
    if (!from) {
      const ids = [...new Set(entity.fields.map((f) => f.id))];
      errors.push(refError(view.id, ["rowAction", "bind", i, "field"], `Field "${b.field}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, ids));
    }
    if (!targetEntity) return; // the target's own missing entity is reported on the target
    const to = targetEntity.fields.find((f) => f.id === b.to);
    if (!to) {
      const ids = [...new Set(targetEntity.fields.map((f) => f.id))];
      errors.push(refError(view.id, ["rowAction", "bind", i, "to"], `Field "${b.to}" is not on entity "${targetEntity.id}" (the entity of "${target.id}").`, `Use a field id on "${targetEntity.id}".`, ids));
    }
    if (from && to && !bindable(from, to)) {
      errors.push({
        path: jsonPointer(["rowAction", "bind", i]),
        code: "invalid-value",
        message: `Cannot bind "${b.field}" (${describeKind(from)}) to "${b.to}" (${describeKind(to)}): the field types differ.`,
        hint: `Bind fields of the same type; pick a ${describeKind(from)} field on "${targetEntity.id}".`,
        document: view.id,
      });
    }
  });
}

/** Row bindings compare equal values: same field type, and for references the same target entity. */
function bindable(from: Field, to: Field): boolean {
  return from.type === to.type && (from.type !== "reference" || (to.type === "reference" && from.entity === to.entity));
}

const describeKind = (field: Field): string => (field.type === "reference" ? `reference to ${field.entity}` : field.type);

/** Walks every row action chain: no view may be revisited, and a chain has at most MAX_ROW_ACTION_DEPTH hops. */
function checkRowActionChains(errors: DocumentError[], idx: SetIndex): void {
  const next = (id: string): string | undefined => {
    const open = idx.tables.get(id)?.rowAction?.open;
    return open !== undefined && idx.tables.has(open) ? open : undefined;
  };
  const cyclic = new Set<string>();
  for (const start of idx.tables.keys()) {
    if (cyclic.has(start)) continue;
    const seen = [start];
    for (let cur = next(start); cur !== undefined && !seen.slice(1).includes(cur); cur = next(cur)) {
      if (cur === start) {
        seen.forEach((id) => cyclic.add(id));
        errors.push({
          path: jsonPointer(["rowAction", "open"]),
          code: "invalid-value",
          message: `Row actions form a cycle: ${[...seen, start].join(" -> ")}.`,
          hint: "A chain may not revisit a view it already opened; point this row action at a different table view or remove it.",
          document: seen[seen.length - 1] ?? start,
        });
        break;
      }
      seen.push(cur);
    }
  }
  const hops = (id: string, trail: readonly string[]): number => {
    const n = next(id);
    return n === undefined || trail.includes(n) ? 0 : 1 + hops(n, [...trail, n]);
  };
  for (const id of idx.tables.keys()) {
    if (cyclic.has(id)) continue;
    const n = next(id);
    if (n === undefined) continue;
    const length = hops(id, [id]);
    if (length > MAX_ROW_ACTION_DEPTH && hops(n, [id, n]) <= MAX_ROW_ACTION_DEPTH) {
      errors.push({
        path: jsonPointer(["rowAction", "open"]),
        code: "invalid-value",
        message: `Row actions starting at "${id}" are ${length} hops long; the most allowed is ${MAX_ROW_ACTION_DEPTH}.`,
        hint: `Shorten the chain to at most ${MAX_ROW_ACTION_DEPTH} hops (remove a rowAction).`,
        document: id,
      });
    }
  }
  // A calendar can start a chain but is never a target, so it cannot be part of a cycle; only the length counts.
  for (const calendar of idx.calendars.values()) {
    const open = calendar.rowAction?.open;
    if (open === undefined || !idx.tables.has(open)) continue;
    const rest = hops(open, [open]);
    if (rest <= MAX_ROW_ACTION_DEPTH && 1 + rest > MAX_ROW_ACTION_DEPTH) {
      errors.push({
        path: jsonPointer(["rowAction", "open"]),
        code: "invalid-value",
        message: `Row actions starting at "${calendar.id}" are ${1 + rest} hops long; the most allowed is ${MAX_ROW_ACTION_DEPTH}.`,
        hint: `Shorten the chain to at most ${MAX_ROW_ACTION_DEPTH} hops (remove a rowAction).`,
        document: calendar.id,
      });
    }
  }
  // A board can start a chain but is never a target, so it cannot be part of a cycle; only the length counts.
  for (const board of idx.boards.values()) {
    const open = board.rowAction?.open;
    if (open === undefined || !idx.tables.has(open)) continue;
    const rest = hops(open, [open]);
    if (rest <= MAX_ROW_ACTION_DEPTH && 1 + rest > MAX_ROW_ACTION_DEPTH) {
      errors.push({
        path: jsonPointer(["rowAction", "open"]),
        code: "invalid-value",
        message: `Row actions starting at "${board.id}" are ${1 + rest} hops long; the most allowed is ${MAX_ROW_ACTION_DEPTH}.`,
        hint: `Shorten the chain to at most ${MAX_ROW_ACTION_DEPTH} hops (remove a rowAction).`,
        document: board.id,
      });
    }
  }
}

/** Checks a calendar's entity and every field it uses. */
function checkCalendarFields(errors: DocumentError[], view: CalendarView, idx: SetIndex): void {
  const entity = idx.entities.get(view.entity);
  if (!entity) {
    errors.push(refError(view.id, ["entity"], `View references unknown entity "${view.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
    return;
  }
  const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
  const find = (id: string): Field | undefined => entity.fields.find((f) => f.id === id);
  const idsOfType = (types: readonly FieldType[]): string[] => [...new Set(entity.fields.filter((f) => types.includes(f.type)).map((f) => f.id))];
  const unknown = (id: string, path: Path): void => {
    errors.push(refError(view.id, path, `Field "${id}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
  };
  /** Reports an unknown field, or one whose type is not allowed; returns the field when it is fine. */
  const typed = (id: string, path: Path, role: string, types: readonly FieldType[]): Field | undefined => {
    const field = find(id);
    if (!field) {
      unknown(id, path);
      return undefined;
    }
    if (!types.includes(field.type)) {
      const allowed = idsOfType(types);
      errors.push({
        path: jsonPointer(path),
        code: "invalid-value",
        message: `"${id}" is a ${field.type} field, but a calendar's ${role} must be a ${types.join(" or ")} field.`,
        hint: allowed.length > 0 ? `Use one of: ${allowed.join(", ")}.` : `Entity "${entity.id}" has no ${types.join(" or ")} field; add one.`,
        document: view.id,
        allowed,
      });
      return undefined;
    }
    return field;
  };

  typed(view.dateField, ["dateField"], "dateField", ["date"]);
  let title: string | undefined;
  if (view.titleField !== undefined) {
    if (typed(view.titleField, ["titleField"], "titleField", CALENDAR_TITLE_FIELD_TYPES)) title = view.titleField;
  } else {
    title = entity.fields.find((f) => f.type === "text")?.id;
    if (title === undefined) {
      const allowed = idsOfType(CALENDAR_TITLE_FIELD_TYPES);
      errors.push({
        path: jsonPointer(["titleField"]),
        code: "required",
        message: `Entity "${entity.id}" has no text field to title entries with, so "titleField" is required.`,
        hint: allowed.length > 0 ? `Set "titleField" to a select field: ${allowed.join(", ")}.` : `Add a text or select field to "${entity.id}" and set "titleField" to it.`,
        document: view.id,
        allowed,
      });
    }
  }
  view.detailFields?.forEach((id, i) => {
    const path: Path = ["detailFields", i];
    if (!find(id)) unknown(id, path);
    else if (id === view.dateField || id === title) {
      errors.push({
        path: jsonPointer(path),
        code: "invalid-value",
        message: `Detail field "${id}" is already shown as the calendar's ${id === view.dateField ? "date" : "title"}.`,
        hint: "Remove it or pick another field.",
        document: view.id,
        allowed: fieldIds.filter((f) => f !== view.dateField && f !== title),
      });
    }
  });
  if (view.colorField !== undefined) typed(view.colorField, ["colorField"], "colorField", CALENDAR_COLOR_FIELD_TYPES);
  checkConditionFields(view.filter, ["filter"], (id, path) => {
    if (!find(id)) unknown(id, path);
  });
  checkRelativeDateFields(errors, view.id, entity, view.filter, ["filter"]);
  checkReferenceOps(errors, view.id, entity, view.filter, ["filter"]);
  view.sort?.forEach((key, i) => {
    if (!find(key.field)) unknown(key.field, ["sort", i, "field"]);
    else checkNotReference(errors, view.id, entity, key.field, ["sort", i, "field"], "sort key");
  });
  if (view.rowAction) checkRowActionTarget(errors, view, entity, idx);
}

/** Checks a board's entity and every field it uses. */
function checkBoardFields(errors: DocumentError[], view: BoardView, idx: SetIndex): void {
  const entity = idx.entities.get(view.entity);
  if (!entity) {
    errors.push(refError(view.id, ["entity"], `View references unknown entity "${view.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
    return;
  }
  const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
  const find = (id: string): Field | undefined => entity.fields.find((f) => f.id === id);
  const idsOfType = (types: readonly FieldType[]): string[] => [...new Set(entity.fields.filter((f) => types.includes(f.type)).map((f) => f.id))];
  const unknown = (id: string, path: Path): void => {
    errors.push(refError(view.id, path, `Field "${id}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
  };
  /** A required boolean can only ever be true, so it cannot usefully group a board. */
  const groupable = (field: Field): boolean => BOARD_GROUP_FIELD_TYPES.includes(field.type) && !(field.type === "boolean" && field.required === true);
  const groupableIds = entity.fields.filter(groupable).map((f) => f.id);

  view.groupBy.forEach((g, i) => {
    const path: Path = ["groupBy", i, "field"];
    const field = find(g.field);
    if (!field) {
      unknown(g.field, path);
      return;
    }
    if (!groupable(field)) {
      const required = field.type === "boolean" && field.required === true;
      errors.push({
        path: jsonPointer(path),
        code: "invalid-value",
        message: required
          ? `"${g.field}" is a required boolean field, so it can only be true and cannot group a board.`
          : `"${g.field}" is a ${field.type} field, but a board's groupBy must be a select, boolean or reference field.`,
        hint: required
          ? "Use a different field, or make it optional so it has two values."
          : groupableIds.length > 0
            ? `Use one of: ${groupableIds.join(", ")}.`
            : `Entity "${entity.id}" has no groupable field; add a select, boolean or reference field.`,
        document: view.id,
        allowed: groupableIds,
      });
    }
  });

  let title: string | undefined;
  if (view.titleField !== undefined) {
    const field = find(view.titleField);
    if (!field) {
      unknown(view.titleField, ["titleField"]);
    } else if (!BOARD_TITLE_FIELD_TYPES.includes(field.type)) {
      const allowed = idsOfType(BOARD_TITLE_FIELD_TYPES);
      errors.push({
        path: jsonPointer(["titleField"]),
        code: "invalid-value",
        message: `"${view.titleField}" is a ${field.type} field, but a board's titleField must be a text or select field.`,
        hint: allowed.length > 0 ? `Use one of: ${allowed.join(", ")}.` : `Entity "${entity.id}" has no text or select field; add one.`,
        document: view.id,
        allowed,
      });
    } else {
      title = view.titleField;
    }
  } else {
    title = entity.fields.find((f) => f.type === "text")?.id;
    if (title === undefined) {
      const allowed = idsOfType(BOARD_TITLE_FIELD_TYPES);
      errors.push({
        path: jsonPointer(["titleField"]),
        code: "required",
        message: `Entity "${entity.id}" has no text field to title cards with, so "titleField" is required.`,
        hint: allowed.length > 0 ? `Set "titleField" to a select field: ${allowed.join(", ")}.` : `Add a text or select field to "${entity.id}" and set "titleField" to it.`,
        document: view.id,
        allowed,
      });
    }
  }

  view.cardFields?.forEach((id, i) => {
    const path: Path = ["cardFields", i];
    if (!find(id)) unknown(id, path);
    else if (id === title) {
      errors.push({
        path: jsonPointer(path),
        code: "invalid-value",
        message: `Card field "${id}" is already shown as the board's title.`,
        hint: "Remove it or pick another field.",
        document: view.id,
        allowed: fieldIds.filter((f) => f !== title),
      });
    }
  });

  checkConditionFields(view.filter, ["filter"], (id, path) => {
    if (!find(id)) unknown(id, path);
  });
  checkRelativeDateFields(errors, view.id, entity, view.filter, ["filter"]);
  checkReferenceOps(errors, view.id, entity, view.filter, ["filter"]);
  view.sort?.forEach((key, i) => {
    if (!find(key.field)) unknown(key.field, ["sort", i, "field"]);
    else checkNotReference(errors, view.id, entity, key.field, ["sort", i, "field"], "sort key");
  });
  if (view.rowAction) checkRowActionTarget(errors, view, entity, idx);
}

/** Checks each reference field of an entity: the target entity exists and `display` is a text or select field on it. */
function checkReferenceFields(errors: DocumentError[], entity: EntityDocument, idx: SetIndex): void {
  entity.fields.forEach((field, i) => {
    if (field.type !== "reference") return;
    const path: Path = ["fields", i];
    const target = idx.entities.get(field.entity);
    if (!target) {
      errors.push(refError(entity.id, [...path, "entity"], `Reference field "${field.id}" points at unknown entity "${field.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
      return;
    }
    if (field.display === undefined) return;
    const shown = target.fields.find((f) => f.id === field.display);
    if (!shown) {
      errors.push(
        refError(entity.id, [...path, "display"], `Field "${field.display}" is not on entity "${target.id}".`, `Use a text or select field id on "${target.id}".`, target.fields.filter(isLabelField).map((f) => f.id)),
      );
    } else if (!isLabelField(shown)) {
      errors.push({
        path: jsonPointer([...path, "display"]),
        code: "invalid-value",
        message: `"display" must be a text or select field, but "${shown.id}" on "${target.id}" is a ${shown.type} field.`,
        hint: `Use one of: ${target.fields.filter(isLabelField).map((f) => f.id).join(", ") || "(none; add a text field to the target)"}.`,
        document: entity.id,
      });
    }
  });
}

const isLabelField = (f: Field): boolean => f.type === "text" || f.type === "select";

/** Reference fields cannot be quick filters or sort keys in this version. */
function checkNotReference(errors: DocumentError[], document: string, entity: EntityDocument, fieldId: string, path: Path, what: string): void {
  const field = entity.fields.find((f) => f.id === fieldId);
  if (field?.type !== "reference") return;
  errors.push({
    path: jsonPointer(path),
    code: "invalid-value",
    message: `Reference field "${fieldId}" cannot be a ${what}.`,
    hint: "Reference fields hold a record id, so they cannot be a quick filter or sort key. Use a fixed filter with eq, neq, in, empty or notEmpty instead.",
    document,
  });
}

const REFERENCE_OPS: readonly ConditionOp[] = ["eq", "neq", "in", "empty", "notEmpty"];

/** Reports a comparison other than eq, neq, in, empty and notEmpty on a reference field. */
function checkReferenceOps(errors: DocumentError[], document: string, entity: EntityDocument, condition: Condition | undefined, base: Path): void {
  if (!condition) return;
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((c, i) => checkReferenceOps(errors, document, entity, c, [...base, "conditions", i]));
      return;
    case "not":
      checkReferenceOps(errors, document, entity, condition.condition, [...base, "condition"]);
      return;
    default: {
      const field = entity.fields.find((f) => f.id === condition.field);
      if (field?.type !== "reference" || REFERENCE_OPS.includes(condition.op)) return;
      errors.push({
        path: jsonPointer([...base, "op"]),
        code: "invalid-value",
        message: `"${condition.op}" cannot be used on reference field "${field.id}": it holds a record id.`,
        hint: `Use one of: ${REFERENCE_OPS.join(", ")}.`,
        document,
      });
    }
  }
}

/** Reports a relative date compared with a field that is not a date field (fields that do not exist are reported elsewhere). */
function checkRelativeDateFields(errors: DocumentError[], document: string, entity: EntityDocument, condition: Condition | undefined, base: Path): void {
  if (!condition) return;
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((c, i) => checkRelativeDateFields(errors, document, entity, c, [...base, "conditions", i]));
      return;
    case "not":
      checkRelativeDateFields(errors, document, entity, condition.condition, [...base, "condition"]);
      return;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (!isRelativeDate(condition.value)) return;
      const field = entity.fields.find((f) => f.id === condition.field);
      if (!field || field.type === "date") return;
      errors.push({
        path: jsonPointer([...base, "value"]),
        code: "invalid-value",
        message: `A relative date ({ "daysFromToday" }) can only be compared with a date field, but "${field.id}" is a ${field.type} field.`,
        hint: `Use ${exampleFor(condition.op, field.type)}, or point "${condition.op}" at a date field.`,
        document,
      });
      return;
    }
    default:
      return;
  }
}

/** A correct example of this op on a field of this (non-date) type, for the hint. */
function exampleFor(op: ConditionOp, type: FieldType): string {
  const sample = type === "number" ? "5" : type === "boolean" ? "true" : '"text"';
  return `{ "op": "${op}", "field": "<${type} field>", "value": ${sample} }`;
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

/** Checks that a measure's fields exist on the entity and have a type its op accepts. */
function checkMeasureFields(errors: DocumentError[], document: string, entity: EntityDocument, measure: Measure, base: Path): void {
  if (measure.op === "count") return;
  const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
  const accepted = MEASURE_FIELD_TYPES[measure.op];
  const check = (fieldId: string, path: Path, types: readonly FieldType[]): void => {
    const field = entity.fields.find((f) => f.id === fieldId);
    if (!field) {
      errors.push(refError(document, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
      return;
    }
    if (!types.includes(field.type)) {
      const allowed = [...new Set(entity.fields.filter((f) => types.includes(f.type)).map((f) => f.id))];
      errors.push({
        path: jsonPointer(path),
        code: "invalid-value",
        message: `"${measure.op}" needs a ${types.join(" or ")} field; "${fieldId}" is a ${field.type} field.`,
        hint: allowed.length > 0 ? `Use one of: ${allowed.join(", ")}.` : `Entity "${entity.id}" has no ${types.join(" or ")} field; add one or pick another op.`,
        document,
        allowed,
      });
    }
  };
  if ("product" in measure) measure.product.forEach((id, i) => check(id, [...base, "product", i], ["number"]));
  else check(measure.field, [...base, "field"], accepted);
}

/** Checks that a dashboard's widgets point at existing views (and, for counts, valid fields). */
function checkDashboard(errors: DocumentError[], doc: DashboardView, idx: SetIndex, embeddable: readonly string[]): void {
  doc.tabs.forEach((tab, i) => {
    tab.items.forEach((item, j) => {
      const itemPath: Path = ["tabs", i, "items", j];
      if (item.widget === "view") {
        if (!idx.forms.has(item.view) && !idx.tables.has(item.view) && !idx.calendars.has(item.view) && !idx.boards.has(item.view)) {
          errors.push(refError(doc.id, [...itemPath, "view"], `Widget references unknown view "${item.view}".`, "Point at a form, table, calendar or board view.", embeddable));
        }
        return;
      }
      const table = idx.tables.get(item.view);
      if (!table) {
        const what = item.widget === "stat" ? "Stat" : "Count";
        const message = idx.calendars.has(item.view)
          ? `${what} widgets work from a table view, but "${item.view}" is a calendar view.`
          : idx.boards.has(item.view)
            ? `${what} widgets work from a table view, but "${item.view}" is a board view.`
            : `${what} widget references unknown table view "${item.view}".`;
        errors.push(refError(doc.id, [...itemPath, "view"], message, "Point at a table view.", [...idx.tables.keys()]));
        return;
      }
      const entity = idx.entities.get(table.entity);
      if (!entity) return; // the table's own missing entity is reported on the table
      const fieldIds = [...new Set(entity.fields.map((f) => f.id))];
      checkRelativeDateFields(errors, doc.id, entity, item.filter, [...itemPath, "filter"]);
      checkReferenceOps(errors, doc.id, entity, item.filter, [...itemPath, "filter"]);
      checkConditionFields(item.filter, [...itemPath, "filter"], (fieldId, path) => {
        if (!fieldIds.includes(fieldId)) {
          errors.push(refError(doc.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
        }
      });
      if (item.widget === "stat") checkMeasureFields(errors, doc.id, entity, item.measure, [...itemPath, "measure"]);
    });
  });
}
