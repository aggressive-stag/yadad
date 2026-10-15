import { MEASURE_FIELD_TYPES, jsonPointer, validateDocuments } from "@yadad/core";
import type { Condition, DashboardView, DocumentError, EntityDocument, FieldType, FormView, GridItem, Measure, MeasureOp, RowAction, SortSpec, TableView } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

// Patches for form and table views. Views are layout only: they reference
// entity fields by id, so every edit here is safe for saved records. Each
// patch starts with a `test` so it refuses to apply to a stale document.

type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

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
  return ok(has ? [guard, { op: "remove", path: `/columns/${c}/editable` }] : []);
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
  reference: undefined,
};

/** Said where a field cannot be a quick filter. */
export const QUICK_FILTER_REASON = "Quick filters work on select, boolean, text, number and date fields.";

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
  if (item.widget !== "count" && item.widget !== "stat") return fail(["tabs", t, "items", i], `Widget "${itemId}" is not a count or a stat.`, "Counts and stats have filters; views are embedded as-is.");
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
