import { optionColor, optionValue } from "@yadad/core";
import type { DataAdapter, DataRecord, EntityDocument, Field, FieldValue, ReferenceField, ReferenceOption } from "@yadad/core";

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

/** The `#RRGGBB` shape the colour surfaces accept (RFC 0008 items 5 and 8). */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * The colour-shaped field `colorFrom` names on the target (RFC 0008 item 8):
 * a text field or a select on the referenced entity. Undefined when the field
 * declares no `colorFrom` or the named field is not colour-shaped — a bad
 * document, which the validator refuses; at run time it means "no colour".
 */
export function referenceColorField(target: EntityDocument, field: ReferenceField): Field | undefined {
  if (field.colorFrom === undefined) return undefined;
  const colour = target.fields.find((f) => f.id === field.colorFrom);
  return colour !== undefined && (colour.type === "text" || colour.type === "select") ? colour : undefined;
}

/**
 * The colour a colour-shaped field's value paints (RFC 0008 item 8): a text
 * value that is already `#RRGGBB`, or the chosen select option's colour.
 * Anything else — free text, an option without a colour — paints none.
 */
export function referenceColorOf(value: FieldValue | undefined, colour: Field): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (colour.type === "text") return HEX_COLOR.test(value) ? value : undefined;
  if (colour.type !== "select") return undefined;
  const hit = colour.options.values.find((o) => optionValue(o) === value);
  return hit === undefined ? undefined : optionColor(hit);
}

/**
 * Resolves the `colorFrom` colour for a set of record ids: the target record's
 * colour-shaped value, kept only when it paints a `#RRGGBB` (RFC 0008 item 8).
 * Same fetch shape as `resolveReferenceLabels` (one `findOne` per id, capped,
 * in parallel); ids whose record is missing or paints no colour are absent.
 */
export async function resolveReferenceColors(adapter: DataAdapter, target: EntityDocument, colour: Field, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))].slice(0, REFERENCE_RESOLVE_LIMIT);
  const records = await Promise.all(unique.map((id) => adapter.findOne(target.id, id)));
  const colors = new Map<string, string>();
  for (const record of records) {
    if (!record) continue;
    const color = referenceColorOf(record.values[colour.id], colour);
    if (color !== undefined) colors.set(record.id, color);
  }
  return colors;
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
