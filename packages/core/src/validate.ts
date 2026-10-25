// PRE-CONTRACT (P0-04). Hand-written structural validation for the skeleton
// documents. The validator library and generated JSON Schemas are a Phase 1
// decision (P1-01). Collects every error instead of stopping at the first.
// `validateDocument` checks one document's shape; `validateDocuments` adds the
// cross-document referential checks (entity exists, field ids exist on it,
// widgets point at existing views) that only hold across a whole set.

import { CONDITION_OPS, MAX_RELATIVE_DAYS, RELATIVE_DATE_OPS, isRelativeDate } from "./condition.js";
import type { Condition, ConditionOp, ViewerCondition } from "./condition.js";
import { BOARD_CARD_FIELDS_MAX, BOARD_GROUP_BY_MAX, BOARD_GROUP_FIELD_TYPES, BOARD_TITLE_FIELD_TYPES, CALENDAR_DETAIL_FIELDS_MAX, CALENDAR_COLOR_FIELD_TYPES, CALENDAR_TITLE_FIELD_TYPES, DOCUMENT_KINDS, GRID_COLUMNS_DEFAULT, GRID_ITEM_KEYS, GRID_ITEM_MAX, ID_HINT, ID_PATTERN, MAX_CONDITION_DEPTH, MAX_GRID_COLUMNS, MAX_ROW_ACTION_DEPTH, MEASURE_FIELD_TYPES, MEASURE_PRODUCT_OPS, PAGE_SIZE_MAX, SERIES_GROUP_FIELD_TYPES, VIEWER_FACTS_MAX, VIEWER_FACT_VALUES_MAX, VIEWER_FACT_VALUES_MIN } from "./contract.js";
import { ACTIONS_MAX, ACTION_CONFIRM_TONES, ACTION_INPUT_FIELD_TYPES, ACTION_INPUT_MAX, CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT, CALENDAR_MAX_ENTRIES_PER_DAY_MAX, CALENDAR_MODES, COMPARE_NEIGHBOURS, FORM_ITEM_LABEL_MAX, RECORD_ACTIONS_MAX, FIELD_TYPES, MEASURE_OPS, ROW_ACTION_MODES, SERIES_BUCKETS, SERIES_DISPLAYS, SERIES_LIMIT_DEFAULT, SERIES_LIMIT_MAX, SERIES_SORT_BYS, SERIES_SORT_DIRS, SPEC_VERSION, SUPPORTED_SPEC_VERSIONS, VIEWER_FACT_TYPES, WIDGET_TYPES, defaultTitleField, optionValue } from "./document.js";
import type { BoardView, CalendarView, Document, DashboardView, EntityDocument, Field, FieldType, FormView, Measure, SeriesWidget, TableView, ViewerDocument, ViewerFact } from "./document.js";
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
  } else if (input["kind"] === "viewer") {
    validateViewer(errors, input);
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
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "revision", "fields"], ["actions"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkRevision(errors, doc);
  validateActions(errors, doc);

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

/** Checks an entity's `actions` (RFC 0007): the shape of each action, its confirm and its input fields. Names of fields are checked against the entity in the set pass. */
function validateActions(errors: Errors, doc: JsonObject): void {
  const actions = checkArray(errors, doc, [], "actions");
  if (!actions) return;
  if (actions.length > ACTIONS_MAX) {
    errors.add(["actions"], "invalid-value", `An entity declares at most ${ACTIONS_MAX} actions, but ${actions.length} are listed.`, `Remove ${actions.length - ACTIONS_MAX}.`);
  }
  const ids: { id: string; path: Path }[] = [];
  actions.forEach((action, i) => {
    const path: Path = ["actions", i];
    if (!isObject(action)) {
      errors.add(path, "type", "An action must be a JSON object.", 'Use { "id", "label" } and optionally "confirm", "input", "visibleWhen".');
      return;
    }
    checkKeys(errors, action, path, ["id", "label"], ["confirm", "input", "visibleWhen"]);
    checkId(errors, action, path, "id");
    checkNonEmptyString(errors, action, path, "label");
    if (typeof action["id"] === "string") ids.push({ id: action["id"], path: [...path, "id"] });
    validateActionConfirm(errors, action["confirm"], [...path, "confirm"]);
    validateActionInput(errors, action["input"], [...path, "input"]);
    checkCondition(errors, action["visibleWhen"], [...path, "visibleWhen"]);
  });
  reportDuplicates(errors, ids, "action", "an entity");
}

/** Checks a view's `recordActions` (RFC 0007): 1 to RECORD_ACTIONS_MAX ids, each once. That each names an action of the entity is checked in the set pass. */
function checkRecordActions(errors: Errors, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.add(["recordActions"], "type", '"recordActions" must be an array.', 'Use [ "apply", "reject" ].');
    return;
  }
  if (value.length === 0) {
    errors.add(["recordActions"], "empty", '"recordActions" lists no actions.', 'Add an action id of the entity, or remove "recordActions".');
  } else if (value.length > RECORD_ACTIONS_MAX) {
    errors.add(["recordActions"], "invalid-value", `A view offers at most ${RECORD_ACTIONS_MAX} actions, but ${value.length} are listed.`, `Remove ${value.length - RECORD_ACTIONS_MAX}.`);
  }
  const ids: { id: string; path: Path }[] = [];
  value.forEach((id: unknown, i) => {
    if (typeof id !== "string") {
      errors.add(["recordActions", i], "type", "An action id must be a string.", 'Use the id of an action of the entity, e.g. "apply".');
    } else if (!ID_PATTERN.test(id)) {
      errors.add(["recordActions", i], "invalid-value", `${JSON.stringify(id)} is not a valid id.`, ID_HINT);
    } else {
      ids.push({ id, path: ["recordActions", i] });
    }
  });
  reportDuplicates(errors, ids, "action", "recordActions");
}

function validateActionConfirm(errors: Errors, confirm: unknown, path: Path): void {
  if (confirm === undefined) return;
  if (!isObject(confirm)) {
    errors.add(path, "type", '"confirm" must be an object.', 'Use { "message": "Apply this decision?" }.');
    return;
  }
  checkKeys(errors, confirm, path, ["message"], ["title", "confirmLabel", "tone"]);
  checkNonEmptyString(errors, confirm, path, "message");
  checkNonEmptyString(errors, confirm, path, "title");
  checkNonEmptyString(errors, confirm, path, "confirmLabel");
  const tone = confirm["tone"];
  if (tone !== undefined && !ACTION_CONFIRM_TONES.some((t) => t === tone)) {
    errors.add([...path, "tone"], "invalid-value", `Unknown tone ${JSON.stringify(tone)}.`, `Use one of: ${ACTION_CONFIRM_TONES.join(", ")}.`, ACTION_CONFIRM_TONES);
  }
}

function validateActionInput(errors: Errors, input: unknown, path: Path): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.add(path, "type", '"input" must be an array.', 'Use [ { "id": "reason", "type": "text", "label": "Reason" } ].');
    return;
  }
  if (input.length === 0 || input.length > ACTION_INPUT_MAX) {
    errors.add(path, "invalid-value", `An action asks for 1 to ${ACTION_INPUT_MAX} input fields, but ${input.length} are listed.`, input.length === 0 ? 'Add a field, or remove "input".' : `Remove ${input.length - ACTION_INPUT_MAX}.`);
  }
  const ids: { id: string; path: Path }[] = [];
  input.forEach((field, i) => {
    const fieldPath: Path = [...path, i];
    if (!isObject(field)) {
      errors.add(fieldPath, "type", "An input field must be a JSON object.", 'Use { "id", "type", "label" }.');
      return;
    }
    const type = field["type"];
    if (type === "reference") {
      errors.add([...fieldPath, "type"], "invalid-value", "An action cannot ask for a reference field.", `Use one of: ${ACTION_INPUT_FIELD_TYPES.join(", ")} (a picker needs a target query, which actions do not have yet).`, ACTION_INPUT_FIELD_TYPES);
    } else if (typeof type === "string" && !isFieldType(type)) {
      errors.add([...fieldPath, "type"], "unknown-field-type", `Unknown field type ${JSON.stringify(type)}.`, `Input field types: ${ACTION_INPUT_FIELD_TYPES.join(", ")}.`, ACTION_INPUT_FIELD_TYPES);
    } else {
      validateField(errors, field, fieldPath);
    }
    if (typeof field["id"] === "string") ids.push({ id: field["id"], path: [...fieldPath, "id"] });
  });
  reportDuplicates(errors, ids, "input field", "an action");
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
    case "datetime":
      checkIsoDatetime(errors, field, path, "min");
      checkIsoDatetime(errors, field, path, "max");
      checkRange(errors, field, path, (v): v is string => typeof v === "string" && isIsoDatetime(v));
      return;
    case "reference":
      checkId(errors, field, path, "entity");
      if (field["display"] !== undefined) checkId(errors, field, path, "display");
      if (field["colorFrom"] !== undefined) checkId(errors, field, path, "colorFrom");
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
  datetime: { required: [], optional: ["min", "max"] },
  reference: { required: ["entity"], optional: ["display", "colorFrom"] },
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
      checkKeys(errors, item, itemPath, ["field"], ["visibleWhen", "requiredWhen", "clearWhenHidden", "label"]);
      checkId(errors, item, itemPath, "field");
      checkBoundedLabel(errors, item, itemPath, "label");
      checkCondition(errors, item["visibleWhen"], [...itemPath, "visibleWhen"]);
      checkCondition(errors, item["requiredWhen"], [...itemPath, "requiredWhen"]);
      checkBoolean(errors, item, itemPath, "clearWhenHidden");
      if (item["clearWhenHidden"] === true && containsViewerLeaf(item["visibleWhen"])) {
        errors.add([...itemPath, "clearWhenHidden"], "invalid-value", "clearWhenHidden cannot be combined with a viewer condition in visibleWhen.", "Clearing would erase a value the viewer cannot see. Remove clearWhenHidden.");
      }
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
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "columns"], ["title", "sort", "pageSize", "filter", "quickFilters", "rowAction", "recordActions", "addForm"]);
  checkCondition(errors, doc["filter"], ["filter"], "filter");
  checkRowAction(errors, doc["rowAction"]);
  checkRecordActions(errors, doc["recordActions"]);
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
    checkKeys(errors, column, path, ["field"], ["editable", "visibleWhen", "editableWhen", "compare"]);
    checkId(errors, column, path, "field");
    checkCompare(errors, column, path);
    checkBoolean(errors, column, path, "editable");
    checkCondition(errors, column["visibleWhen"], [...path, "visibleWhen"], "viewer");
    checkCondition(errors, column["editableWhen"], [...path, "editableWhen"], "viewer");
    checkEditableWhen(errors, column, path);
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
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "dateField"], ["title", "titleField", "detailFields", "colorField", "maxEntriesPerDay", "filter", "sort", "modes", "weekStartsOn", "editable", "editableWhen", "rowAction", "recordActions"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");
  checkNonEmptyString(errors, doc, [], "title");
  for (const key of CALENDAR_ID_KEYS) checkId(errors, doc, [], key);
  checkCondition(errors, doc["filter"], ["filter"], "filter");
  checkRowAction(errors, doc["rowAction"]);
  checkRecordActions(errors, doc["recordActions"]);
  checkSort(errors, doc, "a calendar's sort");
  checkBoolean(errors, doc, [], "editable");
  checkCondition(errors, doc["editableWhen"], ["editableWhen"], "viewer");
  checkEditableWhen(errors, doc, []);

  const cap = doc["maxEntriesPerDay"];
  if (cap !== undefined && (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > CALENDAR_MAX_ENTRIES_PER_DAY_MAX)) {
    errors.add(["maxEntriesPerDay"], "invalid-value", `maxEntriesPerDay must be an integer from 1 to ${CALENDAR_MAX_ENTRIES_PER_DAY_MAX} (default ${CALENDAR_MAX_ENTRIES_PER_DAY_DEFAULT}).`, "Use a whole day-cell count in that range.");
  }

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
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "entity", "revision", "dataSource", "groupBy"], ["title", "titleField", "cardFields", "filter", "sort", "editable", "editableWhen", "rowAction", "recordActions", "columnsFrom"]);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkId(errors, doc, [], "entity");
  checkRevision(errors, doc);
  checkNonEmptyString(errors, doc, [], "dataSource");
  checkNonEmptyString(errors, doc, [], "title");
  checkId(errors, doc, [], "titleField");
  checkCondition(errors, doc["filter"], ["filter"], "filter");
  checkRowAction(errors, doc["rowAction"]);
  checkRecordActions(errors, doc["recordActions"]);
  checkSort(errors, doc, "a board's sort");
  checkBoolean(errors, doc, [], "editable");
  checkCondition(errors, doc["editableWhen"], ["editableWhen"], "viewer");
  checkEditableWhen(errors, doc, []);

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
  checkKeys(errors, value, path, ["open", "bind"], ["mode", "visibleWhen"]);
  checkId(errors, value, path, "open");
  checkCondition(errors, value["visibleWhen"], [...path, "visibleWhen"], "viewer");
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
    checkKeys(errors, tab, path, ["id", "title", "items"], ["columns", "visibleWhen"]);
    checkCondition(errors, tab["visibleWhen"], [...path, "visibleWhen"], "viewer");
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
        : widget === "series"
          ? { required: ["label", "view", "groupBy", "measure", "display"], optional: ["sort", "limit", "filter"] }
          : { required: ["view"], optional: [] };
  checkKeys(errors, item, path, ["id", "x", "y", "w", "h", "widget", ...keys.required], [...keys.optional, "visibleWhen"]);
  checkCondition(errors, item["visibleWhen"], [...path, "visibleWhen"], "viewer");
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
  if (widget !== undefined && !WIDGET_TYPES.includes(widget as (typeof WIDGET_TYPES)[number])) {
    errors.add([...path, "widget"], "invalid-value", `Unknown widget ${JSON.stringify(widget)}.`, `Use one of: ${WIDGET_TYPES.join(", ")}.`);
  }
  checkId(errors, item, path, "view");
  if (widget === "count" || widget === "stat" || widget === "series") {
    checkNonEmptyString(errors, item, path, "label");
    checkCondition(errors, item["filter"], [...path, "filter"], "filter");
  }
  if (widget === "stat") checkMeasure(errors, item["measure"], [...path, "measure"]);
  if (widget === "series") checkSeries(errors, item, path);
  return usable;
}

const MEASURE_HINT = 'Use { "op": "count" }, { "op": "sum", "field": "<number field>" } or { "op": "sum", "product": ["<number field>", "<number field>"] }.';

const GROUP_BY_HINT = 'Use { "field": "<select, boolean, reference, text or date field>" }, optionally with "bucket": "day" | "week" | "month" (dates only).';
const SERIES_SORT_HINT = 'Use { "by": "group" | "value", "dir": "asc" | "desc" }, or leave "sort" out for group ascending.';

/**
 * Shape of a series widget's own properties (RFC 0001 slice 2): enums, the
 * closed `groupBy`/`sort` objects, and the `limit` bound. The measure reuses
 * stat's shape check. Which fields may group, bucket-on-date and the
 * date-sort rules are cross-document checks (card 43c).
 */
function checkSeries(errors: Errors, item: JsonObject, path: Path): void {
  const display = item["display"];
  if (display !== undefined && (typeof display !== "string" || !(SERIES_DISPLAYS as readonly string[]).includes(display))) {
    errors.add([...path, "display"], "invalid-value", `Unknown series display ${JSON.stringify(display)}.`, `Use one of: ${SERIES_DISPLAYS.join(", ")}.`, SERIES_DISPLAYS);
  }
  const groupBy = item["groupBy"];
  if (groupBy !== undefined) {
    if (!isObject(groupBy)) {
      errors.add([...path, "groupBy"], "type", "A groupBy must be a JSON object.", GROUP_BY_HINT);
    } else {
      checkKeys(errors, groupBy, [...path, "groupBy"], ["field"], ["bucket"]);
      checkId(errors, groupBy, [...path, "groupBy"], "field");
      const bucket = groupBy["bucket"];
      if (bucket !== undefined && (typeof bucket !== "string" || !(SERIES_BUCKETS as readonly string[]).includes(bucket))) {
        errors.add([...path, "groupBy", "bucket"], "invalid-value", `Unknown bucket ${JSON.stringify(bucket)}.`, `Use one of: ${SERIES_BUCKETS.join(", ")}.`, SERIES_BUCKETS);
      }
    }
  }
  const sort = item["sort"];
  if (sort !== undefined) {
    if (!isObject(sort)) {
      errors.add([...path, "sort"], "type", "A sort must be a JSON object.", SERIES_SORT_HINT);
    } else {
      checkKeys(errors, sort, [...path, "sort"], ["by", "dir"], []);
      const by = sort["by"];
      if (by !== undefined && (typeof by !== "string" || !(SERIES_SORT_BYS as readonly string[]).includes(by))) {
        errors.add([...path, "sort", "by"], "invalid-value", `Unknown sort "by" ${JSON.stringify(by)}.`, `Use one of: ${SERIES_SORT_BYS.join(", ")}.`, SERIES_SORT_BYS);
      }
      const dir = sort["dir"];
      if (dir !== undefined && (typeof dir !== "string" || !(SERIES_SORT_DIRS as readonly string[]).includes(dir))) {
        errors.add([...path, "sort", "dir"], "invalid-value", `Unknown sort "dir" ${JSON.stringify(dir)}.`, `Use one of: ${SERIES_SORT_DIRS.join(", ")}.`, SERIES_SORT_DIRS);
      }
    }
  }
  if (item["limit"] !== undefined && !isWhole(item["limit"], 1, SERIES_LIMIT_MAX)) {
    errors.add([...path, "limit"], "invalid-value", `"limit" must be a whole number from 1 to ${SERIES_LIMIT_MAX}.`, `Groups beyond the cap are dropped (the newest buckets are kept for a date series); the default is ${SERIES_LIMIT_DEFAULT}.`);
  }
  checkMeasure(errors, item["measure"], [...path, "measure"]);
}

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
  viewerIn: '{ "op": "viewerIn", "fact": "<viewer fact id>", "values": ["editor", "owner"] } (a list under "values")',
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

/**
 * Where a condition sits (RFC 0006): `any` takes record and viewer leaves (form
 * items), `viewer` only viewer leaves (places with no record), `filter` only
 * record leaves (a filter is sent to the server).
 */
type ConditionPlace = "any" | "viewer" | "filter";

/** Validates an optional condition (undefined is fine). */
function checkCondition(errors: Errors, value: unknown, path: Path, place: ConditionPlace = "any", depth = 0): void {
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
  if (place === "viewer" && typeof op === "string" && (CONDITION_OPS as readonly string[]).includes(op) && op !== "viewerIn" && op !== "and" && op !== "or" && op !== "not") {
    errors.add(path, "invalid-value", "Only viewer conditions are allowed here.", "Use op viewerIn, optionally inside and, or, not.");
    return;
  }
  switch (op) {
    case "viewerIn": {
      if (place === "filter") {
        errors.add(path, "invalid-value", "A filter cannot depend on the viewer.", "Filters are sent to the server. Scope records on the server, or hide this view with a viewer condition.");
        return;
      }
      checkConditionKeys(errors, value, path, op, ["fact", "values"]);
      checkId(errors, value, path, "fact");
      const values = checkArray(errors, value, path, "values");
      if (!values) return;
      if (values.length === 0 || values.length > VIEWER_FACT_VALUES_MAX) {
        errors.add([...path, "values"], "invalid-value", `"values" must list 1 to ${VIEWER_FACT_VALUES_MAX} values, but ${values.length} are listed.`, `Use ${CONDITION_SHAPES.viewerIn}.`);
      }
      const seen: unknown[] = [];
      values.forEach((v, i) => {
        if (typeof v !== "string" && typeof v !== "boolean") {
          errors.add([...path, "values", i], "type", "Each value must be text or true/false.", `Use ${CONDITION_SHAPES.viewerIn}.`);
        } else if (seen.includes(v)) {
          errors.add([...path, "values", i], "invalid-value", `Value ${JSON.stringify(v)} is listed twice.`, "Remove the duplicate.");
        } else seen.push(v);
      });
      return;
    }
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
      list?.forEach((c, i) => checkCondition(errors, c, [...path, "conditions", i], place, depth + 1));
      return;
    }
    case "not":
      checkConditionKeys(errors, value, path, op, ["condition"]);
      checkCondition(errors, value["condition"], [...path, "condition"], place, depth + 1);
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

/** True when a raw condition contains a `viewerIn` leaf anywhere (shape not required to be valid). */
function containsViewerLeaf(value: unknown, depth = 0): boolean {
  if (!isObject(value) || depth > MAX_CONDITION_DEPTH) return false;
  if (value["op"] === "viewerIn") return true;
  if (Array.isArray(value["conditions"])) return value["conditions"].some((c: unknown) => containsViewerLeaf(c, depth + 1));
  return containsViewerLeaf(value["condition"], depth + 1);
}

/** `editableWhen` only narrows `editable: true`, so it needs it (RFC 0006). */
/** Checks a column's `compare` (RFC 0007): exactly one of `to` and `field`, and not on an editable column. Field types are checked in the set pass. */
function checkCompare(errors: Errors, column: JsonObject, path: Path): void {
  const compare = column["compare"];
  if (compare === undefined) return;
  const cpath = [...path, "compare"];
  if (!isObject(compare)) {
    errors.add(cpath, "type", '"compare" must be an object.', 'Use { "to": "previousRow" } or { "field": "<text field id>" }.');
    return;
  }
  checkKeys(errors, compare, cpath, [], ["to", "field"]);
  const hasTo = compare["to"] !== undefined;
  const hasField = compare["field"] !== undefined;
  if (hasTo && hasField) {
    errors.add(cpath, "invalid-value", '"compare" takes "to" or "field", not both.', 'Keep one: { "to": "previousRow" } or { "field": "<text field id>" }.');
  } else if (!hasTo && !hasField && Object.keys(compare).every((k) => k === "to" || k === "field")) {
    errors.add(cpath, "required", '"compare" needs "to" or "field".', 'Use { "to": "previousRow" } or { "field": "<text field id>" }.');
  }
  if (hasTo && !COMPARE_NEIGHBOURS.some((n) => n === compare["to"])) {
    errors.add([...cpath, "to"], "invalid-value", `Unknown neighbour ${JSON.stringify(compare["to"])}.`, `Use one of: ${COMPARE_NEIGHBOURS.join(", ")}.`, COMPARE_NEIGHBOURS);
  }
  checkId(errors, compare, cpath, "field");
  if (column["editable"] === true) {
    errors.add(cpath, "invalid-value", "A column that compares cannot also be editable.", "An edited cell has no meaningful diff. Remove compare or editable.");
  }
}

function checkEditableWhen(errors: Errors, owner: JsonObject, path: Path): void {
  if (owner["editableWhen"] !== undefined && owner["editable"] !== true) {
    errors.add([...path, "editableWhen"], "invalid-value", `"editableWhen" has no effect while "editable" is not true.`, "editableWhen only narrows editable: true. Set editable to true or remove editableWhen.");
  }
}

// ---- viewer document ------------------------------------------------------

function validateViewer(errors: Errors, doc: JsonObject): void {
  checkKeys(errors, doc, [], ["kind", "specVersion", "id", "revision", "facts"], []);
  checkSpecVersion(errors, doc);
  checkId(errors, doc, [], "id");
  checkRevision(errors, doc);

  const facts = checkArray(errors, doc, [], "facts");
  if (!facts) return;
  if (facts.length === 0 || facts.length > VIEWER_FACTS_MAX) {
    errors.add(["facts"], "invalid-value", `A viewer declares 1 to ${VIEWER_FACTS_MAX} facts, but ${facts.length} are listed.`, facts.length === 0 ? 'Add a fact, e.g. { "id": "beta", "label": "Beta features", "type": "boolean", "default": false }.' : `Remove ${facts.length - VIEWER_FACTS_MAX}.`);
  }
  const seen = new Set<string>();
  facts.forEach((fact, i) => {
    const path: Path = ["facts", i];
    if (!isObject(fact)) {
      errors.add(path, "type", "A fact must be a JSON object.", 'Use { "id", "label", "type", "default" }.');
      return;
    }
    validateViewerFact(errors, fact, path);
    const id = fact["id"];
    if (typeof id === "string" && ID_PATTERN.test(id)) {
      if (seen.has(id)) errors.add([...path, "id"], "invalid-value", `Fact "${id}" is declared twice.`, "Fact ids are unique; rename or remove this one.");
      else seen.add(id);
    }
  });
}

const VIEWER_DEFAULT_HINT = "The value a viewer gets when the host says nothing; pick the least-privileged one.";

function validateViewerFact(errors: Errors, fact: JsonObject, path: Path): void {
  checkKeys(errors, fact, path, ["id", "label", "type"], ["options", "default"]);
  checkId(errors, fact, path, "id");
  checkNonEmptyString(errors, fact, path, "label");
  const type = fact["type"];
  if (type !== undefined && !VIEWER_FACT_TYPES.some((t) => t === type)) {
    errors.add([...path, "type"], "invalid-value", `Unknown viewer fact type ${JSON.stringify(type)}.`, `Use one of: ${VIEWER_FACT_TYPES.join(", ")}.`, VIEWER_FACT_TYPES);
    return;
  }
  const dflt = fact["default"];
  if (type === "boolean") {
    if ("options" in fact) errors.add([...path, "options"], "unknown-property", 'A boolean fact has no "options".', "Remove options.");
    if (dflt === undefined) errors.add([...path, "default"], "required", 'Missing required property "default".', VIEWER_DEFAULT_HINT);
    else if (typeof dflt !== "boolean") errors.add([...path, "default"], "type", 'A boolean fact\'s "default" must be true or false.', "Use true or false (without quotes).");
    return;
  }
  let values: readonly string[] | undefined;
  if (type === "select") {
    const options = fact["options"];
    const opath = [...path, "options"];
    if (options === undefined) errors.add(opath, "required", 'A select fact needs "options".', 'Add "options": { "source": "static", "values": ["viewer", "editor"] }.');
    else if (!isObject(options)) errors.add(opath, "type", '"options" must be an object.', 'Use { "source": "static", "values": ["viewer", "editor"] }.');
    else {
      checkKeys(errors, options, opath, ["source", "values"], []);
      if (options["source"] !== undefined && options["source"] !== "static") {
        errors.add([...opath, "source"], "invalid-value", `Unknown options source ${JSON.stringify(options["source"])}.`, 'Use "static".');
      }
      const list = checkArray(errors, options, opath, "values");
      if (list) {
        if (list.length < VIEWER_FACT_VALUES_MIN || list.length > VIEWER_FACT_VALUES_MAX) {
          errors.add([...opath, "values"], "invalid-value", `A select fact lists ${VIEWER_FACT_VALUES_MIN} to ${VIEWER_FACT_VALUES_MAX} values, but ${list.length} are listed.`, list.length < VIEWER_FACT_VALUES_MIN ? "Add a value, or make this a boolean fact." : `Remove ${list.length - VIEWER_FACT_VALUES_MAX}.`);
        }
        const seenValues = new Set<string>();
        list.forEach((v, j) => {
          const vpath = [...opath, "values", j];
          const value = typeof v === "string" ? v : isObject(v) && typeof v["value"] === "string" ? v["value"] : undefined;
          if (value === undefined || value.trim() === "") {
            errors.add(vpath, "invalid-value", "Each value must be non-empty text or { \"value\", \"label?\", \"color?\" }.", "Remove it or give it a name.");
            return;
          }
          if (seenValues.has(value)) errors.add(vpath, "invalid-value", `Value "${value}" is listed twice.`, "Remove the duplicate.");
          else seenValues.add(value);
          if (!isObject(v)) return;
          checkKeys(errors, v, vpath, ["value"], ["label", "color"]);
          checkBoundedLabel(errors, v, vpath, "label");
          if (v["color"] !== undefined && (typeof v["color"] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v["color"]))) {
            errors.add([...vpath, "color"], "invalid-value", 'Option color must be "#RRGGBB".', `Got ${JSON.stringify(v["color"])}. Use six hex digits with a leading #.`);
          }
        });
        values = list.map((v) => (typeof v === "string" ? v : isObject(v) && typeof v["value"] === "string" ? v["value"] : "")).filter((s) => s !== "");
      }
    }
    if (dflt === undefined) errors.add([...path, "default"], "required", 'Missing required property "default".', VIEWER_DEFAULT_HINT);
    else if (typeof dflt !== "string") errors.add([...path, "default"], "type", 'A select fact\'s "default" must be one of its values (text).', "Use one of options.values.");
    else if (values && !values.includes(dflt)) {
      errors.add([...path, "default"], "invalid-value", `Default ${JSON.stringify(dflt)} is not one of the fact's values.`, `Use one of: ${values.join(", ")}.`, values);
    }
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

/** The one stored form of an instant: "YYYY-MM-DDTHH:MM:SS.sssZ" naming a real moment (RFC 0007). */
export function isIsoDatetime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value;
}

function checkIsoDatetime(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v !== undefined && (typeof v !== "string" || !isIsoDatetime(v))) {
    errors.add([...path, key], "invalid-value", `"${key}" must be an instant like "2026-10-17T09:30:00.000Z".`, "Write 2026-10-17T09:30:00.000Z: UTC, three fractional digits, a trailing Z.");
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
    const vpath = [...path, "values", i];
    if (typeof v === "string") {
      if (v.trim() === "") {
        errors.add(vpath, "invalid-value", "Each choice must be non-empty text.", "Remove it or give it a name.");
        return;
      }
      if (seen.has(v)) errors.add(vpath, "duplicate-id", `Choice "${v}" is listed twice.`, "Remove the duplicate.");
      else seen.add(v);
      return;
    }
    if (!isObject(v)) {
      errors.add(vpath, "invalid-value", "Each choice must be non-empty text or { \"value\", \"label?\", \"color?\" }.", "Remove it or give it a name.");
      return;
    }
    checkKeys(errors, v, vpath, ["value"], ["label", "color"]);
    const value = typeof v["value"] === "string" ? v["value"] : undefined;
    if (value === undefined || value.trim() === "") return; // checkKeys already reported a missing value
    if (seen.has(value)) errors.add(vpath, "duplicate-id", `Choice "${value}" is listed twice.`, "Remove the duplicate.");
    else seen.add(value);
    checkBoundedLabel(errors, v, vpath, "label");
    if (v["color"] !== undefined && (typeof v["color"] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v["color"]))) {
      errors.add([...vpath, "color"], "invalid-value", 'Option color must be "#RRGGBB".', `Got ${JSON.stringify(v["color"])}. Use six hex digits with a leading #.`);
    }
  });
}

/** A display label: non-empty text, at most FORM_ITEM_LABEL_MAX chars (RFC 0008 items 5/6). */
function checkBoundedLabel(errors: Errors, obj: JsonObject, path: Path, key: string): void {
  const v = obj[key];
  if (v === undefined) return;
  const lpath = [...path, key];
  if (typeof v !== "string" || v.trim() === "") {
    errors.add(lpath, "type", `"${key}" must be non-empty text.`, "Remove it or give it a name.");
    return;
  }
  if (v.length > FORM_ITEM_LABEL_MAX) {
    errors.add(lpath, "invalid-value", `"${key}" is limited to ${FORM_ITEM_LABEL_MAX} characters.`, "Shorten it.");
  }
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
  checkViewerReferences(errors, warnings, okDocs);
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
        checkActionConditions(errors, doc);
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
  const fieldIds = entityFieldIds(entity);
  const checkField = (fieldId: string, path: Path): void => {
    if (fieldIds.includes(fieldId)) return;
    errors.push(refError(view.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
  };
  const checkDates = (condition: Condition | undefined, base: Path): void => {
    checkRelativeDateFields(errors, view.id, entity, condition, base);
    checkReferenceOps(errors, view.id, entity, condition, base);
    checkDatetimeConditions(errors, view.id, entity, condition, base);
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
  if (view.kind === "table" && view.addForm !== undefined) checkAddFormTarget(errors, view, entity, idx);
  view.quickFilters?.forEach((filter, i) => {
    checkField(filter.field, ["quickFilters", i, "field"]);
    checkNotReference(errors, view.id, entity, filter.field, ["quickFilters", i, "field"], "quick filter");
  });
  checkConditionFields(view.filter, ["filter"], checkField);
  checkDates(view.filter, ["filter"]);
  checkRecordActionRefs(errors, view, entity);
  checkCompareFields(errors, view, entity);
  if (view.rowAction) checkRowActionTarget(errors, view, entity, idx);
}

/** Checks each `compare` column against its entity: both fields are text, and `compare.field` is another field than the column's (RFC 0007). */
function checkCompareFields(errors: DocumentError[], view: TableView, entity: EntityDocument): void {
  const textIds = entity.fields.filter((f) => f.type === "text").map((f) => f.id);
  view.columns.forEach((column, i) => {
    const compare = column.compare;
    if (!compare) return;
    const own = entity.fields.find((f) => f.id === column.field);
    if (own && own.type !== "text") {
      errors.push({
        path: jsonPointer(["columns", i, "compare"]),
        code: "invalid-value",
        message: `"compare" works on text fields, but "${own.id}" is a ${own.type} field.`,
        hint: textIds.length > 0 ? `Compare one of the text fields: ${textIds.join(", ")}.` : `Entity "${entity.id}" has no text field; remove compare.`,
        document: view.id,
        allowed: textIds,
      });
    }
    if (compare.field === undefined) return;
    const path: Path = ["columns", i, "compare", "field"];
    const other = entity.fields.find((f) => f.id === compare.field);
    if (!other) {
      errors.push(refError(view.id, path, `Field "${compare.field}" is not on entity "${entity.id}".`, `Use a text field id on "${entity.id}".`, textIds));
    } else if (other.type !== "text") {
      errors.push({ path: jsonPointer(path), code: "invalid-value", message: `"compare.field" must be a text field, but "${other.id}" is a ${other.type} field.`, hint: textIds.length > 0 ? `Use one of: ${textIds.join(", ")}.` : `Entity "${entity.id}" has no text field.`, document: view.id, allowed: textIds });
    } else if (other.id === column.field) {
      errors.push({ path: jsonPointer(path), code: "invalid-value", message: `A column cannot compare "${other.id}" with itself.`, hint: `Use another text field${textIds.length > 1 ? `: ${textIds.filter((id) => id !== other.id).join(", ")}` : ""}, or compare with "to": "previousRow".`, document: view.id, allowed: textIds.filter((id) => id !== other.id) });
    }
  });
}

/** Checks a table's add form (RFC 0008 item 4): it exists, is a form, and shares the entity. */
function checkAddFormTarget(errors: DocumentError[], view: TableView, entity: EntityDocument, idx: SetIndex): void {
  const target = idx.forms.get(view.addForm!);
  if (!target) {
    if (idx.tables.has(view.addForm!) || idx.calendars.has(view.addForm!) || idx.boards.has(view.addForm!) || idx.dashboards.has(view.addForm!)) {
      errors.push({
        path: jsonPointer(["addForm"]),
        code: "invalid-value",
        message: `addForm "${view.addForm}" is not a form view.`,
        hint: "An add form must be a form view over the same entity; point at a form in the set.",
        document: view.id,
        allowed: [...idx.forms.keys()],
      });
    } else {
      errors.push(refError(view.id, ["addForm"], `addForm references unknown view "${view.addForm}".`, "Point at a form view in the set.", [...idx.forms.keys()]));
    }
    return;
  }
  if (target.entity !== entity.id) {
    errors.push({
      path: jsonPointer(["addForm"]),
      code: "invalid-value",
      message: `addForm "${view.addForm}" is a form over "${target.entity}", not over "${entity.id}".`,
      hint: "The add form must create records of the table's own entity.",
      document: view.id,
    });
  }
}

/** Checks a board's columnsFrom (RFC 0008 item 10): only meaningful with a reference groupBy. */
function checkColumnsFrom(errors: DocumentError[], view: BoardView, entity: EntityDocument): void {
  if (view.columnsFrom !== "options") return;
  const first = view.groupBy[0];
  if (!first) return; // the groupBy array itself is reported elsewhere
  const field = entity.fields.find((f) => f.id === first.field);
  if (field && field.type !== "reference") {
    errors.push({
      path: jsonPointer(["columnsFrom"]),
      code: "invalid-value",
      message: `columnsFrom "options" needs a reference groupBy, but "${first.field}" is a ${field.type} field.`,
      hint: 'Drop columnsFrom (records-derived columns) or group by a reference field — options come from the target entity.',
      document: view.id,
    });
  }
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

/** De-duplicated field-id list for `allowed`/hint lists (card 45b: one owner for the seven copies). */
function entityFieldIds(entity: EntityDocument): string[] {
  return [...new Set(entity.fields.map((f) => f.id))];
}

/**
 * The field helpers every view-kind checker repeats (card 45b): `find`/`idsOfType`
 * over the entity plus `unknown`/`typed` error reports on the view document.
 * File-local by design — the error wording is the frozen validator contract.
 */
interface ViewFieldChecker {
  readonly fieldIds: string[];
  readonly find: (id: string) => Field | undefined;
  readonly idsOfType: (types: readonly FieldType[]) => string[];
  readonly unknown: (id: string, path: Path) => void;
  readonly typed: (id: string, path: Path, role: string, types: readonly FieldType[]) => Field | undefined;
}

function viewFieldChecker(errors: DocumentError[], view: { readonly id: string }, entity: EntityDocument, viewKind: "calendar" | "board"): ViewFieldChecker {
  const fieldIds = entityFieldIds(entity);
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
        message: `"${id}" is a ${field.type} field, but a ${viewKind}'s ${role} must be a ${types.join(" or ")} field.`,
        hint:
          // The instants warning is the calendar's (local-day placement); the
          // board's hand-rolled checks never had it — keep the wording frozen.
          field.type === "datetime" && viewKind === "calendar"
            ? "Use a date field; placing instants on local days is not supported yet."
            : allowed.length > 0
              ? `Use one of: ${allowed.join(", ")}.`
              : `Entity "${entity.id}" has no ${types.join(" or ")} field; add one.`,
        document: view.id,
        allowed,
      });
      return undefined;
    }
    return field;
  };
  return { fieldIds, find, idsOfType, unknown, typed };
}

/**
 * The omitted-titleField fallback both calendar and board repeat (card 45b):
 * `defaultTitleField` (card 45a) or a `required` error whose wording names the
 * view's role ("entries"/"cards"). Returns the title to use, if any.
 */
function checkViewTitle(
  errors: DocumentError[],
  view: { readonly id: string },
  entity: EntityDocument,
  checker: ViewFieldChecker,
  titleField: string | undefined,
  titleTypes: readonly FieldType[],
  titleWord: string,
): string | undefined {
  if (titleField !== undefined) {
    return checker.typed(titleField, ["titleField"], "titleField", titleTypes) ? titleField : undefined;
  }
  const title = defaultTitleField(entity);
  if (title === undefined) {
    const allowed = checker.idsOfType(titleTypes);
    errors.push({
      path: jsonPointer(["titleField"]),
      code: "required",
      message: `Entity "${entity.id}" has no text field to title ${titleWord} with, so "titleField" is required.`,
      hint: allowed.length > 0 ? `Set "titleField" to a select field: ${allowed.join(", ")}.` : `Add a text or select field to "${entity.id}" and set "titleField" to it.`,
      document: view.id,
      allowed,
    });
  }
  return title;
}

/**
 * The filter/sort/actions tail both calendar and board run verbatim (card 45b).
 * The order of the checks is part of the frozen error sequence.
 */
function checkViewFilterSortTail(
  errors: DocumentError[],
  checker: ViewFieldChecker,
  entity: EntityDocument,
  view: CalendarView | BoardView,
  idx: SetIndex,
): void {
  checkConditionFields(view.filter, ["filter"], (id, path) => {
    if (!checker.find(id)) checker.unknown(id, path);
  });
  checkRelativeDateFields(errors, view.id, entity, view.filter, ["filter"]);
  checkReferenceOps(errors, view.id, entity, view.filter, ["filter"]);
  checkDatetimeConditions(errors, view.id, entity, view.filter, ["filter"]);
  view.sort?.forEach((key, i) => {
    if (!checker.find(key.field)) checker.unknown(key.field, ["sort", i, "field"]);
    else checkNotReference(errors, view.id, entity, key.field, ["sort", i, "field"], "sort key");
  });
  checkRecordActionRefs(errors, view, entity);
  if (view.rowAction) checkRowActionTarget(errors, view, entity, idx);
  if (view.kind === "board" && view.columnsFrom !== undefined) checkColumnsFrom(errors, view, entity);
}

/** Checks a calendar's entity and every field it uses. */
function checkCalendarFields(errors: DocumentError[], view: CalendarView, idx: SetIndex): void {
  const entity = idx.entities.get(view.entity);
  if (!entity) {
    errors.push(refError(view.id, ["entity"], `View references unknown entity "${view.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
    return;
  }
  const checker = viewFieldChecker(errors, view, entity, "calendar");
  const { find, unknown, typed, fieldIds } = checker;

  typed(view.dateField, ["dateField"], "dateField", ["date"]);
  const title = checkViewTitle(errors, view, entity, checker, view.titleField, CALENDAR_TITLE_FIELD_TYPES, "entries");
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
  checkViewFilterSortTail(errors, checker, entity, view, idx);
}

/** Checks a board's entity and every field it uses. */
function checkBoardFields(errors: DocumentError[], view: BoardView, idx: SetIndex): void {
  const entity = idx.entities.get(view.entity);
  if (!entity) {
    errors.push(refError(view.id, ["entity"], `View references unknown entity "${view.entity}".`, "Name an entity that exists in the set.", [...idx.entities.keys()]));
    return;
  }
  const checker = viewFieldChecker(errors, view, entity, "board");
  const { find, unknown, fieldIds } = checker;
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
          : field.type === "datetime"
            ? "Use a select, boolean or reference field; grouping by instants is not supported yet."
            : groupableIds.length > 0
            ? `Use one of: ${groupableIds.join(", ")}.`
            : `Entity "${entity.id}" has no groupable field; add a select, boolean or reference field.`,
        document: view.id,
        allowed: groupableIds,
      });
    }
  });

  // Present-case wording is byte-identical to the checker's `typed` for
  // BOARD_TITLE_FIELD_TYPES (verified against the deleted block); only the
  // missing-title noun differs ("cards"), which checkViewTitle parameterises.
  const title = checkViewTitle(errors, view, entity, checker, view.titleField, BOARD_TITLE_FIELD_TYPES, "cards");

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

  checkViewFilterSortTail(errors, checker, entity, view, idx);
}

/** Checks that each id in a view's `recordActions` is an action of the view's entity. */
function checkRecordActionRefs(errors: DocumentError[], view: TableView | CalendarView | BoardView, entity: EntityDocument): void {
  const ids = (entity.actions ?? []).map((a) => a.id);
  view.recordActions?.forEach((id, i) => {
    if (ids.includes(id)) return;
    errors.push(
      refError(view.id, ["recordActions", i], `"${id}" is not an action of entity "${entity.id}".`, ids.length > 0 ? `Use one of: ${ids.join(", ")}, or add the action to the entity first.` : `Entity "${entity.id}" declares no actions; add the action to the entity first.`, ids),
    );
  });
}

/** Checks that the fields an action's `visibleWhen` reads exist on its entity and fit the ops used on them (RFC 0007). */
function checkActionConditions(errors: DocumentError[], entity: EntityDocument): void {
  const fieldIds = entityFieldIds(entity);
  entity.actions?.forEach((action, i) => {
    const base: Path = ["actions", i, "visibleWhen"];
    checkConditionFields(action.visibleWhen, base, (fieldId, path) => {
      if (!fieldIds.includes(fieldId)) {
        errors.push(refError(entity.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
      }
    });
    checkRelativeDateFields(errors, entity.id, entity, action.visibleWhen, base);
    checkReferenceOps(errors, entity.id, entity, action.visibleWhen, base);
    checkDatetimeConditions(errors, entity.id, entity, action.visibleWhen, base);
  });
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
    if (field.colorFrom !== undefined) {
      const colour = target.fields.find((f) => f.id === field.colorFrom);
      if (!colour) {
        errors.push(
          refError(entity.id, [...path, "colorFrom"], `Field "${field.colorFrom}" is not on entity "${target.id}".`, `Use a text or select field id on "${target.id}" (RFC 0008 item 8).`, target.fields.filter(isLabelField).map((f) => f.id)),
        );
      } else if (!isLabelField(colour)) {
        errors.push({
          path: jsonPointer([...path, "colorFrom"]),
          code: "invalid-value",
          message: `"colorFrom" must be a hex text or colour-optioned select field, but "${colour.id}" on "${target.id}" is a ${colour.type} field.`,
          hint: `Use one of: ${target.fields.filter(isLabelField).map((f) => f.id).join(", ") || "(none; add a text field to the target)"}.`,
          document: entity.id,
        });
      }
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
      checkDatetimeConditions(errors, document, entity, condition.condition, [...base, "condition"]);
      return;
    case "viewerIn":
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

/** Reports, on a datetime field, a `contains` or a value that is not an instant in the one stored form (RFC 0007). */
function checkDatetimeConditions(errors: DocumentError[], document: string, entity: EntityDocument, condition: Condition | undefined, base: Path): void {
  if (!condition) return;
  switch (condition.op) {
    case "and":
    case "or":
      condition.conditions.forEach((c, i) => checkDatetimeConditions(errors, document, entity, c, [...base, "conditions", i]));
      return;
    case "not":
      checkDatetimeConditions(errors, document, entity, condition.condition, [...base, "condition"]);
      return;
    case "viewerIn":
    case "empty":
    case "notEmpty":
      return;
    default: {
      const field = entity.fields.find((f) => f.id === condition.field);
      if (field?.type !== "datetime") return;
      const canonical = 'Write an instant like "2026-10-17T09:30:00.000Z": UTC, three fractional digits, a trailing Z.';
      if (condition.op === "contains") {
        errors.push({
          path: jsonPointer([...base, "op"]),
          code: "invalid-value",
          message: `"contains" cannot be used on datetime field "${field.id}": it holds an instant.`,
          hint: "Use one of: eq, neq, gt, gte, lt, lte, in, empty, notEmpty.",
          document,
        });
        return;
      }
      const bad = (path: Path, value: unknown): void => {
        if (isRelativeDate(value)) return; // reported by checkRelativeDateFields
        if (typeof value === "string" && isIsoDatetime(value)) return;
        errors.push({ path: jsonPointer(path), code: "invalid-value", message: `${JSON.stringify(value)} is not an instant in the stored form for datetime field "${field.id}".`, hint: canonical, document });
      };
      if (condition.op === "in") condition.values.forEach((v, i) => bad([...base, "values", i], v));
      else bad([...base, "value"], condition.value);
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
  const sample = type === "number" ? "5" : type === "boolean" ? "true" : type === "datetime" ? '"2026-10-17T09:30:00.000Z"' : '"text"';
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
    case "viewerIn":
      break;
    default:
      check(condition.field, [...base, "field"]);
  }
}

/**
 * Checks a series `groupBy` against the entity (RFC 0001 slice 2, decisions 2
 * and 3): the field exists, its type may be grouped, and `bucket` only rides
 * a date field. Errors list the qualifying fields the way stat's do.
 */
function checkSeriesFields(errors: DocumentError[], document: string, entity: EntityDocument, groupBy: SeriesWidget["groupBy"], base: Path): void {
  const fieldIds = entityFieldIds(entity);
  const field = entity.fields.find((f) => f.id === groupBy.field);
  if (!field) {
    errors.push(refError(document, [...base, "field"], `Field "${groupBy.field}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
    return;
  }
  if (!SERIES_GROUP_FIELD_TYPES.includes(field.type)) {
    const allowed = [...new Set(entity.fields.filter((f) => SERIES_GROUP_FIELD_TYPES.includes(f.type)).map((f) => f.id))];
    errors.push({
      path: jsonPointer([...base, "field"]),
      code: "invalid-value",
      message: `A series cannot group by "${field.id}"; a ${field.type} field is not a select, boolean, reference, text or date field.`,
      hint: allowed.length > 0 ? `Use one of: ${allowed.join(", ")}.` : `Entity "${entity.id}" has no groupable field; add a select, boolean, reference, text or date field.`,
      document,
      allowed,
    });
    return;
  }
  if (groupBy.bucket !== undefined && field.type !== "date") {
    const dated = [...new Set(entity.fields.filter((f) => f.type === "date").map((f) => f.id))];
    errors.push({
      path: jsonPointer([...base, "bucket"]),
      code: "invalid-value",
      message: `"bucket" groups dates; "${field.id}" is a ${field.type} field, which has no days, weeks or months to bucket.`,
      hint: dated.length > 0 ? `Remove "bucket", or group by a date field: ${dated.join(", ")}.` : 'Remove "bucket", or group by a date field; this entity has none.',
      document,
    });
  }
}

/** Checks that a measure's fields exist on the entity and have a type its op accepts. */
function checkMeasureFields(errors: DocumentError[], document: string, entity: EntityDocument, measure: Measure, base: Path): void {
  if (measure.op === "count") return;
  const fieldIds = entityFieldIds(entity);
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
        const what = item.widget === "stat" ? "Stat" : item.widget === "series" ? "Series" : "Count";
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
      const fieldIds = entityFieldIds(entity);
      checkRelativeDateFields(errors, doc.id, entity, item.filter, [...itemPath, "filter"]);
      checkReferenceOps(errors, doc.id, entity, item.filter, [...itemPath, "filter"]);
      checkDatetimeConditions(errors, doc.id, entity, item.filter, [...itemPath, "filter"]);
      checkConditionFields(item.filter, [...itemPath, "filter"], (fieldId, path) => {
        if (!fieldIds.includes(fieldId)) {
          errors.push(refError(doc.id, path, `Field "${fieldId}" is not on entity "${entity.id}".`, `Use a field id on "${entity.id}".`, fieldIds));
        }
      });
      if (item.widget === "stat") checkMeasureFields(errors, doc.id, entity, item.measure, [...itemPath, "measure"]);
      if (item.widget === "series") checkSeriesFields(errors, doc.id, entity, item.groupBy, [...itemPath, "groupBy"]);
      if (item.widget === "series") checkMeasureFields(errors, doc.id, entity, item.measure, [...itemPath, "measure"]);
    });
  });
}

// ---- viewer references (RFC 0006) -------------------------------------------

/** Calls `visit` for every `viewerIn` leaf in a condition, with its JSON Pointer path. */
function eachViewerLeaf(condition: Condition | ViewerCondition | undefined, base: Path, visit: (leaf: Extract<Condition, { readonly op: "viewerIn" }>, path: Path) => void): void {
  if (!condition) return;
  switch (condition.op) {
    case "viewerIn":
      visit(condition, base);
      return;
    case "and":
    case "or":
      condition.conditions.forEach((c, i) => eachViewerLeaf(c, [...base, "conditions", i], visit));
      return;
    case "not":
      eachViewerLeaf(condition.condition, [...base, "condition"], visit);
      return;
    default:
      return;
  }
}

/**
 * Checks every `viewerIn` leaf in the set against the set's viewer document
 * (the fact exists, the values fit its type and list), that there is only one
 * viewer document, and warns about a fact nothing reads.
 */
function checkViewerReferences(errors: DocumentError[], warnings: DocumentError[], docs: readonly Document[]): void {
  const viewers = docs.filter((d): d is ViewerDocument => d.kind === "viewer");
  const viewer = viewers[0];
  for (const extra of viewers.slice(1)) {
    errors.push({ path: "", code: "invalid-value", message: `The set has more than one viewer document ("${viewer?.id ?? ""}" and "${extra.id}").`, hint: "A set has one viewer document. Merge the facts.", document: extra.id });
  }
  const facts = new Map<string, ViewerFact>((viewer?.facts ?? []).map((f) => [f.id, f]));
  const factIds = [...facts.keys()];
  const read = new Set<string>();

  for (const doc of docs) {
    const check = (condition: Condition | ViewerCondition | undefined, base: Path): void => {
      eachViewerLeaf(condition, base, (leaf, path) => {
        read.add(leaf.fact);
        const fact = facts.get(leaf.fact);
        if (!fact) {
          errors.push(
            viewer
              ? refError(doc.id, [...path, "fact"], `Viewer fact "${leaf.fact}" is not declared.`, `Use a fact of the viewer document "${viewer.id}", or declare it there.`, factIds)
              : refError(doc.id, [...path, "fact"], "No viewer document declares viewer facts.", "Add a document of kind viewer.", factIds),
          );
          return;
        }
        leaf.values.forEach((value, j) => {
          const vpath = [...path, "values", j];
          if (fact.type === "boolean") {
            if (typeof value !== "boolean") {
              errors.push({ path: jsonPointer(vpath), code: "type", message: `Fact "${fact.id}" is a boolean, but ${JSON.stringify(value)} is text.`, hint: "Use true or false (without quotes).", document: doc.id });
            }
          } else if (typeof value !== "string") {
            const allowedValues = fact.options.values.map(optionValue);
            errors.push({ path: jsonPointer(vpath), code: "type", message: `Fact "${fact.id}" is a select, but ${JSON.stringify(value)} is a boolean.`, hint: `Use one of: ${allowedValues.join(", ")}.`, document: doc.id });
          } else if (!fact.options.values.some((o) => optionValue(o) === value)) {
            const allowedValues = fact.options.values.map(optionValue);
            errors.push({ path: jsonPointer(vpath), code: "invalid-value", message: `${JSON.stringify(value)} is not a value of fact "${fact.id}".`, hint: `Use one of: ${allowedValues.join(", ")}.`, document: doc.id, allowed: allowedValues });
          }
        });
      });
    };
    switch (doc.kind) {
      case "entity":
        doc.actions?.forEach((action, i) => check(action.visibleWhen, ["actions", i, "visibleWhen"]));
        break;
      case "form":
        doc.sections.forEach((section, i) =>
          section.items.forEach((item, j) => {
            check(item.visibleWhen, ["sections", i, "items", j, "visibleWhen"]);
            check(item.requiredWhen, ["sections", i, "items", j, "requiredWhen"]);
          }),
        );
        break;
      case "table":
        doc.columns.forEach((column, i) => {
          check(column.visibleWhen, ["columns", i, "visibleWhen"]);
          check(column.editableWhen, ["columns", i, "editableWhen"]);
        });
        check(doc.rowAction?.visibleWhen, ["rowAction", "visibleWhen"]);
        break;
      case "calendar":
      case "board":
        check(doc.editableWhen, ["editableWhen"]);
        check(doc.rowAction?.visibleWhen, ["rowAction", "visibleWhen"]);
        break;
      case "dashboard":
        doc.tabs.forEach((tab, t) => {
          check(tab.visibleWhen, ["tabs", t, "visibleWhen"]);
          tab.items.forEach((item, i) => check(item.visibleWhen, ["tabs", t, "items", i, "visibleWhen"]));
        });
        break;
      default:
        break;
    }
  }

  viewer?.facts.forEach((fact, i) => {
    if (!read.has(fact.id)) {
      warnings.push({ path: jsonPointer(["facts", i]), code: "empty", message: `Nothing reads the fact "${fact.id}".`, hint: "Use it in a viewerIn condition or remove it.", document: viewer.id });
    }
  });
}
