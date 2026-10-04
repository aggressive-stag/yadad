import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, FieldValue, RecordValues } from "@yadad/core";
import { validateRecord } from "./record.js";

/** Headless form state. The renderer holds it; these functions update it. */
export interface FormState {
  readonly values: RecordValues;
  readonly errors: readonly DocumentError[];
}

export const emptyFormState: FormState = { values: {}, errors: [] };

/** Sets one field's value (undefined clears it) and drops that field's errors. */
export function setFieldValue(state: FormState, fieldId: string, value: FieldValue | undefined): FormState {
  const rest = Object.fromEntries(Object.entries(state.values).filter(([key]) => key !== fieldId));
  const path = jsonPointer([fieldId]);
  return {
    values: value === undefined ? rest : { ...rest, [fieldId]: value },
    errors: state.errors.filter((e) => e.path !== path),
  };
}

export type SubmitResult =
  | { readonly ok: true; readonly record: DataRecord }
  | { readonly ok: false; readonly errors: readonly DocumentError[] };

/**
 * Validates an edit to an existing record (merged over its current values),
 * then saves only the changed values under the entity's current revision.
 */
export async function submitEdit(entity: EntityDocument, record: DataRecord, patch: RecordValues, adapter: DataAdapter): Promise<SubmitResult> {
  const errors = validateRecord(entity, { ...record.values, ...patch });
  if (errors.length > 0) return { ok: false, errors };
  const saved = await adapter.update(entity.id, record.id, patch, { entityRevision: entity.revision });
  return { ok: true, record: saved };
}

/** Validates against the entity, then creates the record under the entity's current revision. */
export async function submitForm(entity: EntityDocument, values: RecordValues, adapter: DataAdapter): Promise<SubmitResult> {
  const errors = validateRecord(entity, values);
  if (errors.length > 0) return { ok: false, errors };
  const record = await adapter.create(entity.id, values, { entityRevision: entity.revision });
  return { ok: true, record };
}
