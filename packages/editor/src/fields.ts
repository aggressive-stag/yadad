import type { DocumentError, EntityDocument, Field, ViewDocument } from "@yadad/core";
import { conditionFields, jsonPointer } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

/** Patch appending a field to an entity. Adding is always safe for existing records. */
export function addField(entity: EntityDocument, field: Field): PatchOperation[] {
  return [{ op: "add", path: "/fields/-", value: field as unknown as Json }];
}

/**
 * Patch replacing a field's definition. Changing its id or type is refused:
 * existing records hold values under that id and type, so those are
 * destructive edits that need an explicit transform.
 */
export function updateField(entity: EntityDocument, field: Field): { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError } {
  const i = entity.fields.findIndex((f) => f.id === field.id);
  const current = entity.fields[i];
  if (!current) return { ok: false, error: problem(["fields"], `No field "${field.id}" on "${entity.id}".`, "Add it instead of updating it.") };
  if (current.type !== field.type) {
    return {
      ok: false,
      error: problem(["fields", i, "type"], `Changing "${field.id}" from ${current.type} to ${field.type} would invalidate saved records.`, "Add a new field instead."),
    };
  }
  return { ok: true, patch: [{ op: "test", path: `/fields/${i}/id`, value: field.id }, { op: "replace", path: `/fields/${i}`, value: field as unknown as Json }] };
}

/** Where views refer to a field of an entity: columns, form items, sort keys and conditions. */
export function fieldReferences(views: Iterable<ViewDocument>, entityId: string, fieldId: string): string[] {
  const found: string[] = [];
  for (const view of views) {
    if (view.kind === "dashboard") {
      view.tabs.forEach((tab, t) =>
        tab.items.forEach((item, i) => {
          if (item.widget === "count" && item.filter && conditionFields(item.filter).includes(fieldId)) found.push(`${view.id}${jsonPointer(["tabs", t, "items", i, "filter"])}`);
        }),
      );
      continue;
    }
    if (view.entity !== entityId) continue;
    const at = (...path: (string | number)[]) => found.push(`${view.id}${jsonPointer(path)}`);
    if (view.kind === "form") {
      view.sections.forEach((s, si) =>
        s.items.forEach((item, ii) => {
          if (item.field === fieldId) at("sections", si, "items", ii);
          for (const key of ["visibleWhen", "requiredWhen"] as const) {
            const c = item[key];
            if (c && conditionFields(c).includes(fieldId)) at("sections", si, "items", ii, key);
          }
        }),
      );
    } else {
      view.columns.forEach((c, i) => c.field === fieldId && at("columns", i));
      view.sort?.forEach((s, i) => s.field === fieldId && at("sort", i));
      view.filters?.forEach((f, i) => f.field === fieldId && at("filters", i));
      if (view.filter && conditionFields(view.filter).includes(fieldId)) at("filter");
    }
  }
  return found;
}

/** Patch removing a field, refused while any view still refers to it. Saved values stay in old records. */
export function removeField(entity: EntityDocument, fieldId: string, views: Iterable<ViewDocument>): { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError } {
  const i = entity.fields.findIndex((f) => f.id === fieldId);
  if (i < 0) return { ok: false, error: problem(["fields"], `No field "${fieldId}" on "${entity.id}".`, "Nothing to remove.") };
  const refs = fieldReferences(views, entity.id, fieldId);
  if (refs.length > 0) {
    return { ok: false, error: problem(["fields", i], `"${fieldId}" is still used by: ${refs.join(", ")}.`, "Remove it from those views first.") };
  }
  return { ok: true, patch: [{ op: "test", path: `/fields/${i}/id`, value: fieldId }, { op: "remove", path: `/fields/${i}` }] };
}

function problem(path: (string | number)[], message: string, hint: string): DocumentError {
  return { path: jsonPointer(path), code: "invalid-value", message, hint };
}
