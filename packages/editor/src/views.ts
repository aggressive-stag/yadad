import { jsonPointer } from "@yadad/core";
import type { DocumentError, EntityDocument, FormView, SortSpec, TableView } from "@yadad/core";
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

/** Turns a viewer quick filter on a field on or off. */
export function setQuickFilter(view: TableView, fieldId: string, on: boolean): PatchOperation[] {
  const filters = view.filters ?? [];
  const has = filters.some((f) => f.field === fieldId);
  if (on === has) return [];
  const next = (on ? [...filters, { field: fieldId }] : filters.filter((f) => f.field !== fieldId)).map((f) => ({ field: f.field }));
  return setOptional(view.filters !== undefined, "/filters", next.length > 0 ? next : undefined);
}
