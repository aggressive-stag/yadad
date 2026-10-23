import { BOARD_CARD_FIELDS_MAX, BOARD_GROUP_BY_MAX, BOARD_GROUP_FIELD_TYPES, BOARD_TITLE_FIELD_TYPES, CALENDAR_DETAIL_FIELDS_MAX, CALENDAR_MODES, MEASURE_FIELD_TYPES, RECORD_ACTIONS_MAX, SERIES_DISPLAYS, SERIES_GROUP_FIELD_TYPES, SERIES_LIMIT_MAX, SERIES_SORT_BYS, SERIES_SORT_DIRS, jsonPointer, validateDocuments } from "@yadad/core";
import type { BoardView, CalendarMode, CalendarView, ColumnCompare, Condition, DashboardView, DocumentError, EntityDocument, FieldType, FormView, GridItem, Measure, MeasureOp, RowAction, SeriesBucket, SeriesDisplay, SeriesSortBy, SeriesSortDir, SeriesWidget, SortSpec, TableView, ViewerCondition } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

// Patches for form and table views. Views are layout only: they reference
// entity fields by id, so every edit here is safe for saved records. Each
// patch starts with a `test` so it refuses to apply to a stale document.

export type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const ok = (patch: PatchOperation[]): Result => ({ ok: true, patch });
const fail = (path: (string | number)[], message: string, hint: string): Result => ({ ok: false, error: { path: jsonPointer(path), code: "invalid-value", message, hint } });

/** Fields of the entity that the form does not place yet, in entity order. */
export function fieldsNotOnForm(entity: EntityDocument, view: FormView): string[] {
  const placed = new Set(view.sections.flatMap((s) => s.items.map((i) => i.field)));
  return entity.fields.map((f) => f.id).filter((id) => !placed.has(id));
}

/** Fields of the entity that the table does not show as a column yet, in entity order. */
export function fieldsNotInTable(entity: EntityDocument, view: TableView): string[] {
  const shown = new Set(view.columns.map((c) => c.field));
  return entity.fields.map((f) => f.id).filter((id) => !shown.has(id));
}

function sectionIndex(view: FormView, sectionId: string): number {
  return view.sections.findIndex((s) => s.id === sectionId);
}

/** Appends an empty section. */
export function addSection(view: FormView, sectionId: string, title?: string): PatchOperation[] {
  return [{ op: "add", path: "/sections/-", value: { id: sectionId, ...(title ? { title } : {}), items: [] } }];
}

/** Sets or clears a section's title. */
export function setSectionTitle(view: FormView, sectionId: string, title: string): Result {
  const s = sectionIndex(view, sectionId);
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Pick an existing section.");
  const guard: PatchOperation = { op: "test", path: `/sections/${s}/id`, value: sectionId };
  const trimmed = title.trim();
  if (trimmed !== "") return ok([guard, { op: view.sections[s]?.title === undefined ? "add" : "replace", path: `/sections/${s}/title`, value: trimmed }]);
  return ok(view.sections[s]?.title === undefined ? [] : [guard, { op: "remove", path: `/sections/${s}/title` }]);
}

/** Removes a section and the items in it. The fields stay on the entity. */
export function removeSection(view: FormView, sectionId: string): Result {
  const s = sectionIndex(view, sectionId);
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Pick an existing section.");
  return ok([
    { op: "test", path: `/sections/${s}/id`, value: sectionId },
    { op: "remove", path: `/sections/${s}` },
  ]);
}

/** Moves a section one place up (-1) or down (+1). */
export function moveSection(view: FormView, sectionId: string, by: -1 | 1): Result {
  const s = sectionIndex(view, sectionId);
  const to = s + by;
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Pick an existing section.");
  if (to < 0 || to >= view.sections.length) return fail(["sections", s], `"${sectionId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([
    { op: "test", path: `/sections/${s}/id`, value: sectionId },
    { op: "move", from: `/sections/${s}`, path: `/sections/${to}` },
  ]);
}

/** Places a field on the form, at the end of a section. */
export function addFormItem(view: FormView, sectionId: string, fieldId: string): Result {
  const s = sectionIndex(view, sectionId);
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Add a section first.");
  return ok([
    { op: "test", path: `/sections/${s}/id`, value: sectionId },
    { op: "add", path: `/sections/${s}/items/-`, value: { field: fieldId } },
  ]);
}

function findItem(view: FormView, fieldId: string): { s: number; i: number } | undefined {
  for (const [s, section] of view.sections.entries()) {
    const i = section.items.findIndex((item) => item.field === fieldId);
    if (i >= 0) return { s, i };
  }
  return undefined;
}

/** Takes a field off the form. Its conditions go with it; the field stays on the entity. */
export function removeFormItem(view: FormView, fieldId: string): Result {
  const at = findItem(view, fieldId);
  if (!at) return fail(["sections"], `"${fieldId}" is not on this form.`, "Nothing to remove.");
  return ok([
    { op: "test", path: `/sections/${at.s}/items/${at.i}/field`, value: fieldId },
    { op: "remove", path: `/sections/${at.s}/items/${at.i}` },
  ]);
}

/**
 * Moves a field one place up (-1) or down (+1). At the edge of a section it
 * crosses into the neighbouring section, so a field can travel the whole form.
 */
export function moveFormItem(view: FormView, fieldId: string, by: -1 | 1): Result {
  const at = findItem(view, fieldId);
  if (!at) return fail(["sections"], `"${fieldId}" is not on this form.`, "Add it first.");
  const from = `/sections/${at.s}/items/${at.i}`;
  const guard: PatchOperation = { op: "test", path: `${from}/field`, value: fieldId };
  const count = view.sections[at.s]?.items.length ?? 0;
  const inside = at.i + by;
  if (inside >= 0 && inside < count) return ok([guard, { op: "move", from, path: `/sections/${at.s}/items/${inside}` }]);
  const next = at.s + by;
  if (next < 0 || next >= view.sections.length) return fail(["sections", at.s, "items", at.i], `"${fieldId}" is already ${by < 0 ? "first" : "last"} on the form.`, "Move it the other way.");
  // Into the neighbouring section: at its end when moving up, at its start when moving down.
  const target = by < 0 ? `/sections/${next}/items/-` : `/sections/${next}/items/0`;
  return ok([guard, { op: "move", from, path: target }]);
}

/**
 * Moves a field to `toIndex` (the position it takes after the move) in
 * `sectionId`, one patch for the whole move, within or across sections.
 * Dropping a field where it already is produces no patch, so a no-op drop
 * does not become an undo step.
 */
export function moveFieldTo(view: FormView, fieldId: string, sectionId: string, toIndex: number): Result {
  const at = findItem(view, fieldId);
  if (!at) return fail(["sections"], `"${fieldId}" is not on this form.`, "Add it first.");
  const from = `/sections/${at.s}/items/${at.i}`;
  const s = sectionIndex(view, sectionId);
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Pick an existing section.");
  const count = view.sections[s]?.items.length ?? 0;
  const slots = s === at.s ? count - 1 : count; // positions the field can take after the move
  if (toIndex < 0 || toIndex > slots) return fail(["sections", s], `No position ${toIndex + 1} in this section.`, "Drop it where a row would fit.");
  const guard: PatchOperation = { op: "test", path: `${from}/field`, value: fieldId };
  if (s === at.s && toIndex === at.i) return ok([]);
  return ok([guard, { op: "move", from, path: `/sections/${s}/items/${toIndex}` }]);
}

/** Moves a section to `toIndex` (the position it takes after the move), one patch for the whole move. */
export function moveSectionTo(view: FormView, sectionId: string, toIndex: number): Result {
  const s = sectionIndex(view, sectionId);
  if (s < 0) return fail(["sections"], `No section "${sectionId}".`, "Pick an existing section.");
  if (toIndex < 0 || toIndex >= view.sections.length) return fail(["sections", s], `No position ${toIndex + 1} in this form.`, "Drop it where a section would fit.");
  if (toIndex === s) return ok([]);
  // A move op's path is the index the item takes after the move, so the drop index goes straight in.
  return ok([
    { op: "test", path: `/sections/${s}/id`, value: sectionId },
    { op: "move", from: `/sections/${s}`, path: `/sections/${toIndex}` },
  ]);
}

/** Moves a column to `toIndex` (the position it takes after the move), one patch for the whole move. */
export function moveColumnTo(view: TableView, fieldId: string, toIndex: number): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  if (toIndex < 0 || toIndex >= view.columns.length) return fail(["columns", c], `No position ${toIndex + 1} in this table.`, "Drop it where a column would fit.");
  if (toIndex === c) return ok([]);
  // A move op's path is the index the item takes after the move, so the drop index goes straight in.
  return ok([{ op: "test", path: `/columns/${c}/field`, value: fieldId }, { op: "move", from: `/columns/${c}`, path: `/columns/${toIndex}` }]);
}

/** Shows a field as the last column. */
export function addColumn(view: TableView, fieldId: string): PatchOperation[] {
  return [{ op: "add", path: "/columns/-", value: { field: fieldId } }];
}

function columnIndex(view: TableView, fieldId: string): number {
  return view.columns.findIndex((c) => c.field === fieldId);
}

/** Removes a column. A table keeps at least one column, so removing the last is refused. */
export function removeColumn(view: TableView, fieldId: string): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Nothing to remove.");
  if (view.columns.length === 1) return fail(["columns", c], "A table needs at least one column.", "Add another column before removing this one.");
  return ok([
    { op: "test", path: `/columns/${c}/field`, value: fieldId },
    { op: "remove", path: `/columns/${c}` },
  ]);
}

/** Moves a column one place left (-1) or right (+1). */
export function moveColumn(view: TableView, fieldId: string, by: -1 | 1): Result {
  const c = columnIndex(view, fieldId);
  const to = c + by;
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  if (to < 0 || to >= view.columns.length) return fail(["columns", c], `"${fieldId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([
    { op: "test", path: `/columns/${c}/field`, value: fieldId },
    { op: "move", from: `/columns/${c}`, path: `/columns/${to}` },
  ]);
}

/** Lets rows edit a column in place, or stops them. */
export function setColumnEditable(view: TableView, fieldId: string, editable: boolean): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  const guard: PatchOperation = { op: "test", path: `/columns/${c}/field`, value: fieldId };
  const has = view.columns[c]?.editable !== undefined;
  if (editable) return ok([guard, { op: has ? "replace" : "add", path: `/columns/${c}/editable`, value: true }]);
  // editableWhen only narrows editable: true, so it goes with it.
  const narrowed = view.columns[c]?.editableWhen !== undefined ? [{ op: "remove" as const, path: `/columns/${c}/editableWhen` }] : [];
  return ok(has ? [guard, ...narrowed, { op: "remove", path: `/columns/${c}/editable` }] : []);
}

/** Sets or clears the viewer condition that shows a column (RFC 0006). */
export function setColumnVisibleWhen(view: TableView, fieldId: string, condition: ViewerCondition | undefined): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  const ops = setOptional(view.columns[c]?.visibleWhen !== undefined, `/columns/${c}/visibleWhen`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: `/columns/${c}/field`, value: fieldId }, ...ops]);
}

/** Sets or clears the viewer condition that allows editing a column in place. The column must be editable. */
export function setColumnEditableWhen(view: TableView, fieldId: string, condition: ViewerCondition | undefined): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  if (condition !== undefined && view.columns[c]?.editable !== true) return fail(["columns", c, "editableWhen"], `${fieldId} is not editable in place.`, "Make the column editable first: editableWhen only narrows editable.");
  const ops = setOptional(view.columns[c]?.editableWhen !== undefined, `/columns/${c}/editableWhen`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: `/columns/${c}/field`, value: fieldId }, ...ops]);
}

/**
 * Sets, changes or clears a column's compare setting (RFC 0007): the cell
 * shows the column's value as the after and the comparator's as the before.
 * Text columns only, never an editable column (an edited cell has no
 * meaningful diff), and `field` names another text field of the same entity.
 */
export function setColumnCompare(view: TableView, fieldId: string, compare: ColumnCompare | undefined, entity: EntityDocument): Result {
  const c = columnIndex(view, fieldId);
  if (c < 0) return fail(["columns"], `"${fieldId}" is not a column.`, "Add it first.");
  const guard: PatchOperation = { op: "test", path: `/columns/${c}/field`, value: fieldId };
  if (compare === undefined) {
    const ops = view.columns[c]?.compare !== undefined ? [{ op: "remove" as const, path: `/columns/${c}/compare` }] : [];
    return ok(ops.length === 0 ? [] : [guard, ...ops]);
  }
  const column = view.columns[c];
  if (column?.editable === true) return fail(["columns", c, "compare"], `${fieldId} is editable in place.`, "A column that compares cannot also be editable — an edited cell has no meaningful diff. Make it read-only first.");
  const type = entity.fields.find((f) => f.id === fieldId)?.type;
  if (type !== "text") return fail(["columns", c, "compare"], `A compare column must show text; ${fieldId} is ${type ?? "not a field of this entity"}.`, "Only text columns compare — a select is a value, not a text, and numbers have no words.");
  const hasTo = compare.to !== undefined;
  const hasField = compare.field !== undefined;
  if (hasTo === hasField) return fail(["columns", c, "compare"], "A compare takes the previous row, the next row, or another text field — not both, and not neither.", 'Use { "to": "previousRow" } or { "field": "<text field id>" }.');
  if (hasField) {
    const other = entity.fields.find((f) => f.id === compare.field);
    if (compare.field === fieldId) return fail(["columns", c, "compare", "field"], "A column cannot compare with itself.", "Pick another text field, or compare with a neighbouring row.");
    if (other?.type !== "text") return fail(["columns", c, "compare", "field"], other === undefined ? `"${compare.field}" is not a field of entity "${entity.id}".` : `"${compare.field}" is ${other.type}, not text.`, `Use another text field of ${entity.id}: ${entity.fields.filter((f) => f.type === "text" && f.id !== fieldId).map((f) => f.id).join(", ") || "(none left)"}.`);
  }
  return ok([guard, ...setOptional(column?.compare !== undefined, `/columns/${c}/compare`, compare as unknown as Json)]);
}

/** Sets or clears the viewer condition under which the row action opens its target (RFC 0006). Works on a table, calendar or board. */
export function setRowActionVisibleWhen(view: TableView | CalendarView | BoardView, condition: ViewerCondition | undefined): Result {
  const action = view.rowAction;
  if (!action) return fail(["rowAction"], "This view has no row action.", "Set a row action first.");
  const ops = setOptional(action.visibleWhen !== undefined, "/rowAction/visibleWhen", condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: "/id", value: view.id }, ...ops]);
}

/** A table, calendar or board: the three views that offer record actions (RFC 0007). */
export type ActionOfferingView = TableView | CalendarView | BoardView;

/**
 * Offers the entity's actions on the view's records, in this order (RFC 0007):
 * 1 to RECORD_ACTIONS_MAX ids, each once, each an action of the entity. An
 * empty list removes `recordActions` — offering nothing is the same as the
 * key being absent, and the validator refuses an empty array. The candidate
 * document goes through the validator, so a stale or unknown action id is
 * refused here rather than at save time.
 */
export function setRecordActions(view: ActionOfferingView, entity: EntityDocument, ids: readonly string[]): Result {
  const declared = new Set((entity.actions ?? []).map((a) => a.id));
  for (const id of ids) {
    if (!declared.has(id)) return fail(["recordActions"], `"${id}" is not an action of entity "${entity.id}".`, declared.size > 0 ? `Use one of: ${[...declared].join(", ")}, or add the action to the entity first.` : `Entity "${entity.id}" declares no actions; add the action to the entity first.`);
  }
  if (ids.length > RECORD_ACTIONS_MAX) return fail(["recordActions"], `A view offers at most ${RECORD_ACTIONS_MAX} actions, but ${ids.length} are listed.`, "Remove some.");
  if (JSON.stringify(view.recordActions ?? []) === JSON.stringify(ids)) return ok([]);
  const ops = setOptional(view.recordActions !== undefined, "/recordActions", ids.length > 0 ? ([...ids] as unknown as Json) : undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: "/id", value: view.id }, ...ops]);
}

/** Adds an action to what the view offers, at the end. Refused when it is already offered or the cap is reached. */
export function offerRecordAction(view: ActionOfferingView, entity: EntityDocument, actionId: string): Result {
  const offered = view.recordActions ?? [];
  if (offered.includes(actionId)) return fail(["recordActions"], `The view already offers "${actionId}".`, "It is in the offered list already.");
  if (offered.length >= RECORD_ACTIONS_MAX) return fail(["recordActions"], `A view offers at most ${RECORD_ACTIONS_MAX} actions.`, "Remove one before adding another.");
  return setRecordActions(view, entity, [...offered, actionId]);
}

/** Stops the view offering an action, keeping the order of the rest. */
export function unofferRecordAction(view: ActionOfferingView, entity: EntityDocument, actionId: string): Result {
  const offered = view.recordActions ?? [];
  if (!offered.includes(actionId)) return fail(["recordActions"], `The view does not offer "${actionId}".`, "Nothing to remove.");
  return setRecordActions(view, entity, offered.filter((id) => id !== actionId));
}

/** Moves an offered action one place, keeping the rest in order. */
export function moveOfferedRecordAction(view: ActionOfferingView, entity: EntityDocument, actionId: string, by: -1 | 1): Result {
  const offered = [...(view.recordActions ?? [])];
  const from = offered.indexOf(actionId);
  if (from < 0) return fail(["recordActions"], `The view does not offer "${actionId}".`, "Offer it first.");
  const to = from + by;
  if (to < 0 || to >= offered.length) return fail(["recordActions"], `"${actionId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  [offered[from], offered[to]] = [offered[to] as string, offered[from] as string];
  return setRecordActions(view, entity, offered);
}

/** Sets or clears the viewer condition that lists a dashboard tab. */
export function setTabVisibleWhen(view: DashboardView, tabId: string, condition: ViewerCondition | undefined): Result {
  const t = view.tabs.findIndex((tab) => tab.id === tabId);
  if (t < 0) return fail(["tabs"], `No tab "${tabId}".`, "Pick an existing tab.");
  const ops = setOptional(view.tabs[t]?.visibleWhen !== undefined, `/tabs/${t}/visibleWhen`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: `/tabs/${t}/id`, value: tabId }, ...ops]);
}

/** Sets or clears the viewer condition that renders a dashboard widget; hidden, its cell stays empty. */
export function setItemVisibleWhen(view: DashboardView, tabId: string, itemId: string, condition: ViewerCondition | undefined): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  const ops = setOptional(item.visibleWhen !== undefined, `/tabs/${t}/items/${i}/visibleWhen`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [{ op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId }, ...ops]);
}

/** Sets or clears the viewer condition that allows moving on a calendar. The calendar must be editable. */
export function setCalendarEditableWhen(view: CalendarView, condition: ViewerCondition | undefined): Result {
  if (condition !== undefined && view.editable !== true) return fail(["editableWhen"], "This calendar is not editable.", "Let entries be moved first: editableWhen only narrows editable.");
  const ops = setOptional(view.editableWhen !== undefined, "/editableWhen", condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [guardCalendar(view), ...ops]);
}

/** Sets or clears the viewer condition that allows moving on a board. The board must be editable. */
export function setBoardEditableWhen(view: BoardView, condition: ViewerCondition | undefined): Result {
  if (condition !== undefined && view.editable !== true) return fail(["editableWhen"], "This board is not editable.", "Let cards be moved first: editableWhen only narrows editable.");
  const ops = setOptional(view.editableWhen !== undefined, "/editableWhen", condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [guardBoard(view), ...ops]);
}

/** Sets an optional top-level property, or removes it when the value is undefined. */
function setOptional(present: boolean, path: string, value: Json | undefined): PatchOperation[] {
  if (value === undefined) return present ? [{ op: "remove", path }] : [];
  return [{ op: present ? "replace" : "add", path, value }];
}

/** Sets the table's caption; an empty title removes it. */
export function setTableTitle(view: TableView, title: string): PatchOperation[] {
  const trimmed = title.trim();
  return setOptional(view.title !== undefined, "/title", trimmed === "" ? undefined : trimmed);
}

/** Sets the initial sort to one key, or clears it. */
export function setTableSort(view: TableView, sort: SortSpec | undefined): PatchOperation[] {
  return setOptional(view.sort !== undefined, "/sort", sort ? [{ field: sort.field, dir: sort.dir }] : undefined);
}

/** Sets rows per page; undefined goes back to the default. */
export function setPageSize(view: TableView, pageSize: number | undefined): PatchOperation[] {
  return setOptional(view.pageSize !== undefined, "/pageSize", pageSize);
}

/**
 * How a quick filter treats a field type: select and boolean match exactly,
 * text by substring, number and date as a from/to range. Every field type
 * has an entry, so adding a type forces a decision here.
 */
export const QUICK_FILTER_KINDS: { readonly [K in FieldType]: "match" | "contains" | "range" | undefined } = {
  select: "match",
  boolean: "match",
  text: "contains",
  number: "range",
  date: "range",
  datetime: "range", // RFC 0007: a from/to range; the viewer types it in its zone, the renderer converts (35c)
  reference: undefined,
};

/** Said where a field cannot be a quick filter. */
export const QUICK_FILTER_REASON = "Quick filters work on select, boolean, text, number, date and datetime fields.";

/** Whether a field of this type can be a quick filter. */
export function canQuickFilter(type: FieldType | undefined): boolean {
  return type !== undefined && QUICK_FILTER_KINDS[type] !== undefined;
}

/** Turns a viewer quick filter on a field on or off. */
export function setQuickFilter(view: TableView, fieldId: string, on: boolean): PatchOperation[] {
  const filters = view.quickFilters ?? [];
  const has = filters.some((f) => f.field === fieldId);
  if (on === has) return [];
  const next = (on ? [...filters, { field: fieldId }] : filters.filter((f) => f.field !== fieldId)).map((f) => ({ field: f.field }));
  return setOptional(view.quickFilters !== undefined, "/quickFilters", next.length > 0 ? next : undefined);
}

// ---- conditions -----------------------------------------------------------
// A condition is a whole object: set it or remove it, one guarded patch each.
// The builder (conditions.ts) decides what a condition may look like; the
// document validator is the backstop, run on the patched document by the
// session.

/** Sets or clears a form item's "show only when" or "required while" condition. */
export function setFormItemCondition(view: FormView, fieldId: string, key: "visibleWhen" | "requiredWhen", condition: Condition | undefined): Result {
  const at = findItem(view, fieldId);
  if (!at) return fail(["sections"], `No field "${fieldId}" on this form.`, "Add it first.");
  const guard: PatchOperation = { op: "test", path: `/sections/${at.s}/items/${at.i}/field`, value: fieldId };
  const ops = setOptional(view.sections[at.s]?.items[at.i]?.[key] !== undefined, `/sections/${at.s}/items/${at.i}/${key}`, condition as unknown as Json | undefined);
  return ok(ops.length === 0 ? [] : [guard, ...ops]);
}

/** Sets or clears a form item's "clear the value while hidden" flag. */
export function setClearWhenHidden(view: FormView, fieldId: string, on: boolean): Result {
  const at = findItem(view, fieldId);
  if (!at) return fail(["sections"], `No field "${fieldId}" on this form.`, "Add it first.");
  const path = `/sections/${at.s}/items/${at.i}/clearWhenHidden`;
  const has = view.sections[at.s]?.items[at.i]?.clearWhenHidden !== undefined;
  const ops = on
    ? (has ? [{ op: "replace" as const, path, value: true }] : [{ op: "add" as const, path, value: true }])
    : has
      ? [{ op: "remove" as const, path }]
      : [];
  return ok([{ op: "test", path: `/sections/${at.s}/items/${at.i}/field`, value: fieldId }, ...ops]);
}

/** Sets or clears a table's fixed filter ("rows always match"). */
export function setTableFilter(view: TableView, condition: Condition | undefined): Result {
  return ok(setOptional(view.filter !== undefined, "/filter", condition as unknown as Json | undefined));
}

/** Sets or clears the filter of a count or stat widget. The widget's table keeps its own fixed filter. */
export function setCountWidgetFilter(view: DashboardView, tabId: string, itemId: string, condition: Condition | undefined): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget === "view") return fail(["tabs", t, "items", i], `Widget "${itemId}" is an embedded view.`, "Counts, stats and series have filters; views are embedded as-is.");
  const path = `/tabs/${t}/items/${i}/filter`;
  return ok([{ op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId }, ...setOptional(item.filter !== undefined, path, condition as unknown as Json | undefined)]);
}

/** Replaces a stat widget's measure. */
export function setStatMeasure(view: DashboardView, tabId: string, itemId: string, measure: Measure): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "stat") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a stat.`, "Only stat widgets have a measure.");
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    { op: "replace", path: `/tabs/${t}/items/${i}/measure`, value: measure as unknown as Json },
  ]);
}

// ---- series (RFC 0001 slice 2) ----------------------------------------------
// A series' controls are choices, and every choice is checked against the
// entity the same way the validator checks the finished document: the editor
// can only ever offer what 43c's rules accept, so a pick never leaves an
// invalid widget behind. Changing the groupBy field drops the bucket, which
// only rides a date field.

/** The field types a series may group by (the validator's rule, one source). */
export const seriesGroupTypes = SERIES_GROUP_FIELD_TYPES;

/** The entity fields a series may group by, in entity order. */
export function groupableFieldIds(entity: EntityDocument): string[] {
  return [...new Set(entity.fields.filter((f) => SERIES_GROUP_FIELD_TYPES.includes(f.type)).map((f) => f.id))];
}

/** The series' groupBy, as a patch piece: the field, plus a bucket only on a date field. */
function groupByValue(entity: EntityDocument, field: string, bucket: SeriesBucket | undefined): SeriesWidget["groupBy"] {
  return entity.fields.find((f) => f.id === field && f.type === "date") ? { field, ...(bucket ? { bucket } : {}) } : { field };
}

/** Points a series at a different table view. groupBy and measure come in ready for the new table's entity: they are required keys, so a patch may never drop them. */
export function setSeriesView(view: DashboardView, tabId: string, itemId: string, viewId: string, groupBy: SeriesWidget["groupBy"], measure: Measure): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets pick their own table view.");
  if (item.view === viewId && JSON.stringify(item.groupBy) === JSON.stringify(groupBy) && JSON.stringify(item.measure) === JSON.stringify(measure)) return ok([]);
  const path = `/tabs/${t}/items/${i}`;
  return ok([
    { op: "test", path: `${path}/id`, value: itemId },
    { op: "replace", path: `${path}/view`, value: viewId },
    { op: "replace", path: `${path}/groupBy`, value: groupBy as unknown as Json },
    { op: "replace", path: `${path}/measure`, value: measure as unknown as Json },
  ]);
}

/** Sets the series' groupBy field, keeping a bucket only when the field is a date. */
export function setSeriesGroupBy(view: DashboardView, tabId: string, itemId: string, entity: EntityDocument, field: string, bucket?: SeriesBucket): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets group their records.");
  if (!groupableFieldIds(entity).includes(field)) {
    const allowed = groupableFieldIds(entity);
    return fail(["tabs", t, "items", i, "groupBy", "field"], `A series cannot group by "${field}" on "${entity.id}".`, allowed.length > 0 ? `Use one of: ${allowed.join(", ")}.` : `Entity "${entity.id}" has no groupable field; add a select, boolean, reference, text or date field.`);
  }
  const next = groupByValue(entity, field, bucket);
  if (JSON.stringify(item.groupBy) === JSON.stringify(next)) return ok([]);
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    { op: "replace", path: `/tabs/${t}/items/${i}/groupBy`, value: next as unknown as Json },
  ]);
}

/** Sets the series' bucket; only a date groupBy has buckets to set. */
export function setSeriesBucket(view: DashboardView, tabId: string, itemId: string, entity: EntityDocument, bucket: SeriesBucket | undefined): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets bucket their groups.");
  const field = entity.fields.find((f) => f.id === item.groupBy.field);
  if (!field || field.type !== "date") return fail(["tabs", t, "items", i, "groupBy", "bucket"], `"bucket" groups dates; "${item.groupBy.field}" is ${field ? `a ${field.type}` : "a missing"} field.`, "Group by a date field first; only dates have days, weeks and months.");
  if (item.groupBy.bucket === bucket) return ok([]);
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    { op: "replace", path: `/tabs/${t}/items/${i}/groupBy`, value: (bucket === undefined ? { field: item.groupBy.field } : { field: item.groupBy.field, bucket }) as unknown as Json },
  ]);
}

/** Replaces a series widget's measure (the stat's measure picker, reused). */
export function setSeriesMeasure(view: DashboardView, tabId: string, itemId: string, measure: Measure): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets have a grouped measure.");
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    { op: "replace", path: `/tabs/${t}/items/${i}/measure`, value: measure as unknown as Json },
  ]);
}

/** Sets the series' display: table, bar or line. */
export function setSeriesDisplay(view: DashboardView, tabId: string, itemId: string, display: SeriesDisplay): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets have a display.");
  if (item.display === display) return ok([]);
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    { op: "replace", path: `/tabs/${t}/items/${i}/display`, value: display },
  ]);
}

/** Sets the series' sort. undefined returns it to group ascending (the key is removed). */
export function setSeriesSort(view: DashboardView, tabId: string, itemId: string, sort: { by: SeriesSortBy; dir: SeriesSortDir } | undefined): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets sort their groups.");
  if (sort === undefined && item.sort === undefined) return ok([]);
  if (JSON.stringify(item.sort) === JSON.stringify(sort)) return ok([]);
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    ...setOptional(item.sort !== undefined, `/tabs/${t}/items/${i}/sort`, sort as unknown as Json | undefined),
  ]);
}

/** Sets the series' group cap. undefined returns it to the default (the key is removed). */
export function setSeriesLimit(view: DashboardView, tabId: string, itemId: string, limit: number | undefined): Result {
  const found = findWidget(view, tabId, itemId);
  if (!found.ok) return found.result;
  const { t, i, item } = found;
  if (item.widget !== "series") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a series.`, "Only series widgets cap their groups.");
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return fail(["tabs", t, "items", i, "limit"], `"limit" must be a whole number of at least 1 (at most ${SERIES_LIMIT_MAX}).`, "Groups beyond the cap are dropped; the default is left in place.");
  }
  if (item.limit === limit) return ok([]);
  return ok([
    { op: "test", path: `/tabs/${t}/items/${i}/id`, value: itemId },
    ...setOptional(item.limit !== undefined, `/tabs/${t}/items/${i}/limit`, limit),
  ]);
}

/** The series enums, exported so the editor's pickers show exactly the validator's choices. */
export const SERIES_DISPLAY_CHOICES: readonly SeriesDisplay[] = SERIES_DISPLAYS;
export const SERIES_SORT_BY_CHOICES: readonly SeriesSortBy[] = SERIES_SORT_BYS;
export const SERIES_SORT_DIR_CHOICES: readonly SeriesSortDir[] = SERIES_SORT_DIRS;
/**
 * A measure for `op` over the entity's fields: `field` if it fits the op, else
 * the first field that does; for sum and avg, `times` (a number field) makes
 * it a product. undefined when the entity has no field the op accepts.
 */
export function measureFor(entity: EntityDocument, op: MeasureOp, field?: string, times?: string): Measure | undefined {
  if (op === "count") return { op };
  const accepted = MEASURE_FIELD_TYPES[op];
  const fits = (id: string | undefined) => entity.fields.find((f) => f.id === id && accepted.includes(f.type))?.id;
  const first = fits(field) ?? entity.fields.find((f) => accepted.includes(f.type))?.id;
  if (first === undefined) return undefined;
  if (op === "sum" || op === "avg") {
    const second = entity.fields.find((f) => f.id === times && f.type === "number")?.id;
    if (second !== undefined) return { op, product: [first, second] };
    return { op, field: first };
  }
  return { op, field: first };
}

function findWidget(view: DashboardView, tabId: string, itemId: string): { ok: true; t: number; i: number; item: GridItem } | { ok: false; result: Result } {
  const t = view.tabs.findIndex((tab) => tab.id === tabId);
  if (t < 0) return { ok: false, result: fail(["tabs"], `No tab "${tabId}".`, "Pick an existing tab.") };
  const i = view.tabs[t]?.items.findIndex((item) => item.id === itemId) ?? -1;
  const item = view.tabs[t]?.items[i];
  if (!item) return { ok: false, result: fail(["tabs", t], `No widget "${itemId}" on this tab.`, "Pick a widget on this tab.") };
  return { ok: true, t, i, item };
}

// ---- row action -----------------------------------------------------------

/** The other documents a row action may point at: table views and the entities they (and this table) use. */
export interface RowActionContext {
  readonly tables: readonly TableView[];
  readonly entities: readonly EntityDocument[];
}

/** The table views a row action on `view` may open: every other table in the context. */
export function rowActionTargets(view: TableView, context: RowActionContext): TableView[] {
  return context.tables.filter((t) => t.id !== view.id);
}

/**
 * Sets or clears a table's row action. The candidate is checked against the
 * whole set with the document validator, so an unknown target, fields that
 * are missing or of different types, a cycle or a chain over the depth limit
 * are refused with the validator's own message and hint, and no patch is made.
 */
export function setRowAction(view: TableView, entity: EntityDocument, context: RowActionContext, action: RowAction | undefined): Result {
  const path = "/rowAction";
  if (action === undefined) return ok(setOptional(view.rowAction !== undefined, path, undefined));
  const candidate: TableView = { ...view, rowAction: action };
  const set = [
    entity,
    ...context.entities.filter((e) => e.id !== entity.id),
    ...context.tables.filter((t) => t.id !== view.id),
    candidate,
  ];
  const result = validateDocuments(set);
  const problem = result.ok ? undefined : result.errors.find((e) => e.path.startsWith(path));
  if (problem) return { ok: false, error: { path: problem.path, code: problem.code, message: problem.message, hint: problem.hint } };
  if (JSON.stringify(view.rowAction) === JSON.stringify(action)) return ok([]);
  return ok(setOptional(view.rowAction !== undefined, path, action as unknown as Json));
}

// ---- calendar ---------------------------------------------------------
// A calendar places one entity's records on days by one date field (RFC
// 0004). Most edits here are single top-level properties, each guarded by a
// `test` on the view id so a stale document is refused rather than patched.

function guardCalendar(view: CalendarView): PatchOperation {
  return { op: "test", path: "/id", value: view.id };
}

/** Sets the calendar's caption; an empty title removes it. */
export function setCalendarTitle(view: CalendarView, title: string): PatchOperation[] {
  const trimmed = title.trim();
  return setOptional(view.title !== undefined, "/title", trimmed === "" ? undefined : trimmed);
}

/** Date fields of the entity: candidates for the calendar's `dateField`. */
export function dateFieldsOf(entity: EntityDocument): string[] {
  return entity.fields.filter((f) => f.type === "date").map((f) => f.id);
}

/** Replaces the date field that places entries on days. A calendar always has one. */
export function setCalendarDateField(view: CalendarView, fieldId: string): PatchOperation[] {
  if (fieldId === view.dateField) return [];
  return [guardCalendar(view), { op: "replace", path: "/dateField", value: fieldId }];
}

/** Sets or clears the field shown as an entry's title. Undefined falls back to the entity's first text field. */
export function setCalendarTitleField(view: CalendarView, fieldId: string | undefined): PatchOperation[] {
  return [guardCalendar(view), ...setOptional(view.titleField !== undefined, "/titleField", fieldId)];
}

/** Sets or clears the field that colours entries. */
export function setCalendarColorField(view: CalendarView, fieldId: string | undefined): PatchOperation[] {
  return [guardCalendar(view), ...setOptional(view.colorField !== undefined, "/colorField", fieldId)];
}

/** Fields of the entity that may become the calendar's title, colour or detail fields (not the date field itself). */
export function fieldsNotInCalendarDetails(entity: EntityDocument, view: CalendarView): string[] {
  const used = new Set([view.dateField, view.titleField, ...(view.detailFields ?? [])].filter((id): id is string => id !== undefined));
  return entity.fields.map((f) => f.id).filter((id) => !used.has(id));
}

function detailIndex(view: CalendarView, fieldId: string): number {
  return (view.detailFields ?? []).findIndex((id) => id === fieldId);
}

/** Shows a field under the entry's title. A calendar shows at most CALENDAR_DETAIL_FIELDS_MAX of them. */
export function addCalendarDetailField(view: CalendarView, fieldId: string): Result {
  const current = view.detailFields ?? [];
  if (current.includes(fieldId)) return fail(["detailFields"], `"${fieldId}" is already a detail field.`, "Nothing to add.");
  if (current.length >= CALENDAR_DETAIL_FIELDS_MAX) return fail(["detailFields"], `A calendar shows at most ${CALENDAR_DETAIL_FIELDS_MAX} detail fields.`, "Remove one before adding another.");
  return ok([guardCalendar(view), { op: current.length === 0 ? "add" : "add", path: current.length === 0 ? "/detailFields" : "/detailFields/-", value: current.length === 0 ? [fieldId] : fieldId }]);
}

/** Takes a field out of the detail fields. Removing the last one clears the property. */
export function removeCalendarDetailField(view: CalendarView, fieldId: string): Result {
  const i = detailIndex(view, fieldId);
  if (i < 0) return fail(["detailFields"], `"${fieldId}" is not a detail field.`, "Nothing to remove.");
  const current = view.detailFields ?? [];
  if (current.length === 1) return ok([guardCalendar(view), { op: "remove", path: "/detailFields" }]);
  return ok([guardCalendar(view), { op: "remove", path: `/detailFields/${i}` }]);
}

/** Moves a detail field one place up (-1) or down (+1) in the row shown under the title. */
export function moveCalendarDetailField(view: CalendarView, fieldId: string, by: -1 | 1): Result {
  const i = detailIndex(view, fieldId);
  if (i < 0) return fail(["detailFields"], `"${fieldId}" is not a detail field.`, "Add it first.");
  const to = i + by;
  const current = view.detailFields ?? [];
  if (to < 0 || to >= current.length) return fail(["detailFields", i], `"${fieldId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([guardCalendar(view), { op: "move", from: `/detailFields/${i}`, path: `/detailFields/${to}` }]);
}

/** Sets or clears the calendar's fixed filter ("entries always match"). */
export function setCalendarFilter(view: CalendarView, condition: Condition | undefined): Result {
  return ok([guardCalendar(view), ...setOptional(view.filter !== undefined, "/filter", condition as unknown as Json | undefined)]);
}

/** Sets the entry order within a day to one key, or clears it (falls back to the title field, ascending). */
export function setCalendarSort(view: CalendarView, sort: SortSpec | undefined): PatchOperation[] {
  return [guardCalendar(view), ...setOptional(view.sort !== undefined, "/sort", sort ? [{ field: sort.field, dir: sort.dir }] : undefined)];
}

/** Turns a period on or off in the viewer's switcher. Refuses to turn off the last one. */
export function toggleCalendarMode(view: CalendarView, mode: CalendarMode, on: boolean): Result {
  const current = view.modes ?? CALENDAR_MODES;
  const has = current.includes(mode);
  if (on === has) return ok([]);
  if (!on && current.length === 1) return fail(["modes"], "A calendar needs at least one mode.", "Turn on another mode before turning this one off.");
  const next = on ? [...current, mode] : current.filter((m) => m !== mode);
  return ok([guardCalendar(view), ...setOptional(view.modes !== undefined, "/modes", next)]);
}

/** Makes `mode` the default (first) period, keeping the other modes in their relative order. */
export function setCalendarDefaultMode(view: CalendarView, mode: CalendarMode): Result {
  const current = view.modes ?? CALENDAR_MODES;
  if (!current.includes(mode)) return fail(["modes"], `"${mode}" is not one of this calendar's modes.`, "Turn it on first.");
  if (current[0] === mode) return ok([]);
  const next = [mode, ...current.filter((m) => m !== mode)];
  return ok([guardCalendar(view), ...setOptional(view.modes !== undefined, "/modes", next)]);
}

/** Sets or clears the first day of the week; undefined falls back to Monday. */
export function setCalendarWeekStartsOn(view: CalendarView, day: number | undefined): PatchOperation[] {
  return [guardCalendar(view), ...setOptional(view.weekStartsOn !== undefined, "/weekStartsOn", day)];
}

/** Lets a drag to another day change the date field, or stops it. */
export function setCalendarEditable(view: CalendarView, editable: boolean): PatchOperation[] {
  // editableWhen only narrows editable: true, so it goes with it.
  const narrowed = !editable && view.editableWhen !== undefined ? setOptional(true, "/editableWhen", undefined) : [];
  return [guardCalendar(view), ...narrowed, ...setOptional(view.editable !== undefined, "/editable", editable ? true : undefined)];
}

/** The table views a calendar's row action may open: every table in the context (a calendar never is a target). */
export function calendarRowActionTargets(context: RowActionContext): readonly TableView[] {
  return context.tables;
}

/**
 * Sets or clears a calendar's row action. The candidate is checked against
 * the whole set with the document validator, so an unknown target, fields
 * that are missing or of different types, or a chain over the depth limit
 * are refused with the validator's own message and hint, and no patch is made.
 */
export function setCalendarRowAction(view: CalendarView, entity: EntityDocument, context: RowActionContext, action: RowAction | undefined): Result {
  const path = "/rowAction";
  if (action === undefined) return ok(setOptional(view.rowAction !== undefined, path, undefined));
  const candidate: CalendarView = { ...view, rowAction: action };
  const set = [entity, ...context.entities.filter((e) => e.id !== entity.id), ...context.tables, candidate];
  const result = validateDocuments(set);
  const problem = result.ok ? undefined : result.errors.find((e) => e.path.startsWith(path));
  if (problem) return { ok: false, error: { path: problem.path, code: problem.code, message: problem.message, hint: problem.hint } };
  if (JSON.stringify(view.rowAction) === JSON.stringify(action)) return ok([]);
  return ok(setOptional(view.rowAction !== undefined, path, action as unknown as Json));
}

// ---- board -------------------------------------------------------------
// A board shows one entity's records as cards in columns, one column per
// value of a grouping field (RFC 0005). Like the calendar, most edits are a
// single top-level property guarded by a `test` on the view id. Whether a
// field may group, title or fill a card comes from the same lists the
// validator uses.

function guardBoard(view: BoardView): PatchOperation {
  return { op: "test", path: "/id", value: view.id };
}

/** Sets the board's caption; an empty title removes it. */
export function setBoardTitle(view: BoardView, title: string): PatchOperation[] {
  const trimmed = title.trim();
  return setOptional(view.title !== undefined, "/title", trimmed === "" ? undefined : trimmed);
}

/** Fields of the entity a board may group by: select, boolean (not required, since it could only be true) and reference. */
export function groupableFieldsOf(entity: EntityDocument): string[] {
  return entity.fields.filter((f) => BOARD_GROUP_FIELD_TYPES.includes(f.type) && !(f.type === "boolean" && f.required === true)).map((f) => f.id);
}

/** Fields of the entity that may title a card: text and select. */
export function boardTitleFieldsOf(entity: EntityDocument): string[] {
  return entity.fields.filter((f) => BOARD_TITLE_FIELD_TYPES.includes(f.type)).map((f) => f.id);
}

/** The field that titles cards: `titleField`, or else the entity's first text field. */
export function effectiveBoardTitleField(entity: EntityDocument, view: BoardView): string | undefined {
  return view.titleField ?? entity.fields.find((f) => f.type === "text")?.id;
}

/** Groupable fields the board does not list yet, in entity order. */
export function fieldsNotInBoardGroupBy(entity: EntityDocument, view: BoardView): string[] {
  const used = new Set(view.groupBy.map((g) => g.field));
  return groupableFieldsOf(entity).filter((id) => !used.has(id));
}

/** Adds a grouping at the end (the first stays the default). At most BOARD_GROUP_BY_MAX; only groupable fields. */
export function addBoardGroupBy(view: BoardView, entity: EntityDocument, fieldId: string): Result {
  if (view.groupBy.some((g) => g.field === fieldId)) return fail(["groupBy"], `"${fieldId}" is already a grouping.`, "Nothing to add.");
  if (!groupableFieldsOf(entity).includes(fieldId)) return fail(["groupBy"], `"${fieldId}" cannot group a board.`, `Use one of: ${groupableFieldsOf(entity).join(", ")}.`);
  if (view.groupBy.length >= BOARD_GROUP_BY_MAX) return fail(["groupBy"], `A board allows at most ${BOARD_GROUP_BY_MAX} groupings.`, "Remove one before adding another.");
  return ok([guardBoard(view), { op: "add", path: "/groupBy/-", value: { field: fieldId } }]);
}

function groupByIndex(view: BoardView, fieldId: string): number {
  return view.groupBy.findIndex((g) => g.field === fieldId);
}

/** Removes a grouping; at least one stays. */
export function removeBoardGroupBy(view: BoardView, fieldId: string): Result {
  const i = groupByIndex(view, fieldId);
  if (i < 0) return fail(["groupBy"], `"${fieldId}" is not a grouping.`, "Nothing to remove.");
  if (view.groupBy.length === 1) return fail(["groupBy"], "A board needs at least one grouping.", "Add another grouping before removing this one.");
  return ok([guardBoard(view), { op: "remove", path: `/groupBy/${i}` }]);
}

/** Moves a grouping by `by` places (negative is up); the first is the default. One place for the Move buttons and arrow keys, any distance for a drag. */
export function moveBoardGroupBy(view: BoardView, fieldId: string, by: number): Result {
  const i = groupByIndex(view, fieldId);
  if (i < 0) return fail(["groupBy"], `"${fieldId}" is not a grouping.`, "Add it first.");
  const to = i + by;
  if (to < 0 || to >= view.groupBy.length) return fail(["groupBy", i], `"${fieldId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([guardBoard(view), { op: "move", from: `/groupBy/${i}`, path: `/groupBy/${to}` }]);
}

/**
 * Sets or clears the title field. A card field that would then repeat the
 * title is dropped in the same patch, so the edit never leaves the board
 * invalid against its entity.
 */
export function setBoardTitleField(view: BoardView, entity: EntityDocument, fieldId: string | undefined): PatchOperation[] {
  if (fieldId === view.titleField) return [];
  const title = fieldId ?? entity.fields.find((f) => f.type === "text")?.id;
  const patch: PatchOperation[] = [guardBoard(view), ...setOptional(view.titleField !== undefined, "/titleField", fieldId)];
  const cards = view.cardFields ?? [];
  if (title !== undefined && cards.includes(title)) {
    const rest = cards.filter((id) => id !== title);
    patch.push(...setOptional(true, "/cardFields", rest.length === 0 ? undefined : rest));
  }
  return patch;
}

/** Fields that may be added as card fields: every field except the card's title and those already shown. */
export function fieldsNotInBoardCards(entity: EntityDocument, view: BoardView): string[] {
  const used = new Set([effectiveBoardTitleField(entity, view), ...(view.cardFields ?? [])].filter((id): id is string => id !== undefined));
  return entity.fields.map((f) => f.id).filter((id) => !used.has(id));
}

function cardIndex(view: BoardView, fieldId: string): number {
  return (view.cardFields ?? []).findIndex((id) => id === fieldId);
}

/** Shows a field under the card's title. At most BOARD_CARD_FIELDS_MAX, never the title field. */
export function addBoardCardField(view: BoardView, entity: EntityDocument, fieldId: string): Result {
  const current = view.cardFields ?? [];
  if (current.includes(fieldId)) return fail(["cardFields"], `"${fieldId}" is already a card field.`, "Nothing to add.");
  if (!entity.fields.some((f) => f.id === fieldId)) return fail(["cardFields"], `"${fieldId}" is not a field of ${entity.id}.`, "Pick a field of the entity.");
  if (fieldId === effectiveBoardTitleField(entity, view)) return fail(["cardFields"], `"${fieldId}" is already shown as the card's title.`, "Pick another field.");
  if (current.length >= BOARD_CARD_FIELDS_MAX) return fail(["cardFields"], `A board shows at most ${BOARD_CARD_FIELDS_MAX} card fields.`, "Remove one before adding another.");
  return ok([guardBoard(view), current.length === 0 ? { op: "add", path: "/cardFields", value: [fieldId] } : { op: "add", path: "/cardFields/-", value: fieldId }]);
}

/** Takes a field out of the card fields. Removing the last one clears the property. */
export function removeBoardCardField(view: BoardView, fieldId: string): Result {
  const i = cardIndex(view, fieldId);
  if (i < 0) return fail(["cardFields"], `"${fieldId}" is not a card field.`, "Nothing to remove.");
  if ((view.cardFields ?? []).length === 1) return ok([guardBoard(view), { op: "remove", path: "/cardFields" }]);
  return ok([guardBoard(view), { op: "remove", path: `/cardFields/${i}` }]);
}

/** Moves a card field by `by` places (negative is up). */
export function moveBoardCardField(view: BoardView, fieldId: string, by: number): Result {
  const i = cardIndex(view, fieldId);
  if (i < 0) return fail(["cardFields"], `"${fieldId}" is not a card field.`, "Add it first.");
  const to = i + by;
  if (to < 0 || to >= (view.cardFields ?? []).length) return fail(["cardFields", i], `"${fieldId}" is already ${by < 0 ? "first" : "last"}.`, "Move it the other way.");
  return ok([guardBoard(view), { op: "move", from: `/cardFields/${i}`, path: `/cardFields/${to}` }]);
}

/** Sets or clears the board's fixed filter ("cards always match"). */
export function setBoardFilter(view: BoardView, condition: Condition | undefined): Result {
  return ok([guardBoard(view), ...setOptional(view.filter !== undefined, "/filter", condition as unknown as Json | undefined)]);
}

/** Sets the card order within a column to one key, or clears it. */
export function setBoardSort(view: BoardView, sort: SortSpec | undefined): PatchOperation[] {
  return [guardBoard(view), ...setOptional(view.sort !== undefined, "/sort", sort ? [{ field: sort.field, dir: sort.dir }] : undefined)];
}

/** Lets a drag to another column change the grouping field, or stops it. */
export function setBoardEditable(view: BoardView, editable: boolean): PatchOperation[] {
  const narrowed = !editable && view.editableWhen !== undefined ? setOptional(true, "/editableWhen", undefined) : [];
  return [guardBoard(view), ...narrowed, ...setOptional(view.editable !== undefined, "/editable", editable ? true : undefined)];
}

/** The table views a board's row action may open: every table in the context (a board never is a target). */
export function boardRowActionTargets(context: RowActionContext): readonly TableView[] {
  return context.tables;
}

/** Sets or clears a board's row action, checked against the whole set by the document validator (as for calendars). */
export function setBoardRowAction(view: BoardView, entity: EntityDocument, context: RowActionContext, action: RowAction | undefined): Result {
  const path = "/rowAction";
  if (action === undefined) return ok(setOptional(view.rowAction !== undefined, path, undefined));
  const candidate: BoardView = { ...view, rowAction: action };
  const set = [entity, ...context.entities.filter((e) => e.id !== entity.id), ...context.tables, candidate];
  const result = validateDocuments(set);
  const problem = result.ok ? undefined : result.errors.find((e) => e.path.startsWith(path));
  if (problem) return { ok: false, error: { path: problem.path, code: problem.code, message: problem.message, hint: problem.hint } };
  if (JSON.stringify(view.rowAction) === JSON.stringify(action)) return ok([]);
  return ok(setOptional(view.rowAction !== undefined, path, action as unknown as Json));
}
