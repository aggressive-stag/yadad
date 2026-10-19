import type { DataAdapter, DataRecord, EntityDocument, Field, ReferenceField, ReferenceOption } from "@yadad/core";

/** The most options a reference picker loads; a longer list is cut and flagged with `more`. */
export const REFERENCE_OPTION_LIMIT = 200;

/** The most distinct ids resolved in one call to `resolveReferenceLabels`. */
export const REFERENCE_RESOLVE_LIMIT = 500;

/**
 * The field that labels records of `target` for this reference: the explicit
 * `display` field, else the target's first text field. Undefined when neither
 * exists, in which case records are labelled by their id.
 */
export function referenceDisplayField(target: EntityDocument, field: ReferenceField): Field | undefined {
  if (field.display !== undefined) return target.fields.find((f) => f.id === field.display);
  return target.fields.find((f) => f.type === "text");
}

/** The label of one record: its display value, or its id when that is empty or there is no display field. */
export function referenceLabel(record: DataRecord, display: Field | undefined): string {
  const value = display ? record.values[display.id] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : record.id;
}

export interface ReferenceOptionsResult {
  readonly options: readonly ReferenceOption[];
  /** True when the target has more records than `options` holds. */
  readonly more: boolean;
  /** The target's total record count, so a caller can say how many fit in `options`. */
  readonly total: number;
}

/**
 * Loads the picker options for a reference field from the target entity's
 * adapter: records sorted by the display field (ascending), at most `limit`.
 */
export async function loadReferenceOptions(
  adapter: DataAdapter,
  target: EntityDocument,
  field: ReferenceField,
  limit: number = REFERENCE_OPTION_LIMIT,
): Promise<ReferenceOptionsResult> {
  const display = referenceDisplayField(target, field);
  const page = await adapter.find(target.id, {
    ...(display ? { sort: [{ field: display.id, dir: "asc" }] } : {}),
    page: { offset: 0, limit },
  });
  return {
    options: page.items.map((record) => ({ id: record.id, label: referenceLabel(record, display) })),
    more: page.total !== undefined ? page.total > page.items.length : (page.next ?? null) !== null,
    total: page.total ?? page.items.length, // RFC 0007: card 34h
  };
}

/**
 * Resolves labels for a set of record ids (duplicates and blanks are
 * ignored). The returned map holds only ids whose record exists, so a missing
 * id is how a caller tells a deleted record from a loaded one. Records are
 * fetched one by one with `findOne`, because the query model filters on field
 * values, never on record ids; the fetches run in parallel.
 */
export async function resolveReferenceLabels(
  adapter: DataAdapter,
  target: EntityDocument,
  field: ReferenceField,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const display = referenceDisplayField(target, field);
  const unique = [...new Set(ids.filter((id) => id !== ""))].slice(0, REFERENCE_RESOLVE_LIMIT);
  const records = await Promise.all(unique.map((id) => adapter.findOne(target.id, id)));
  const labels = new Map<string, string>();
  for (const record of records) if (record) labels.set(record.id, referenceLabel(record, display));
  return labels;
}
