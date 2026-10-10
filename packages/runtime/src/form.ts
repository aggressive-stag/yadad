import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, FieldValue, RecordValues } from "@yadad/core";
import { ForbiddenError, RecordConflictError, RecordNotFoundError, RecordValidationError, UnauthorizedError } from "@yadad/core";
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
 * then saves only the changed values under the entity's current revision. The
 * loaded record's version is sent as `baseVersion`, so a change made elsewhere
 * surfaces as a conflict instead of silently overwriting it. When nothing
 * changed, nothing is sent and the record comes back as it was.
 */
export async function submitEdit(entity: EntityDocument, record: DataRecord, patch: RecordValues, adapter: DataAdapter): Promise<SubmitResult> {
  const errors = validateRecord(entity, { ...record.values, ...patch });
  if (errors.length > 0) return { ok: false, errors };
  // A missing value and null both mean empty, so clearing an empty field is no change.
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => (record.values[key] ?? null) !== value));
  if (Object.keys(changed).length === 0) return { ok: true, record };
  try {
    const saved = await adapter.update(entity.id, record.id, changed, { entityRevision: entity.revision, baseVersion: record.version });
    return { ok: true, record: saved };
  } catch (error) {
    return { ok: false, errors: adapterFailure(error) };
  }
}

/** Validates against the entity, then creates the record under the entity's current revision. */
export async function submitForm(entity: EntityDocument, values: RecordValues, adapter: DataAdapter): Promise<SubmitResult> {
  const errors = validateRecord(entity, values);
  if (errors.length > 0) return { ok: false, errors };
  try {
    const record = await adapter.create(entity.id, values, { entityRevision: entity.revision });
    return { ok: true, record };
  } catch (error) {
    return { ok: false, errors: adapterFailure(error) };
  }
}

/**
 * Turns a failed save (a thrown adapter error) into the form's error list, so
 * the existing error display can show it. Validation errors pass their issues
 * through; a conflict and the other failures become a single summary line.
 */
function adapterFailure(error: unknown): readonly DocumentError[] {
  if (error instanceof RecordValidationError) return error.issues;
  if (error instanceof RecordConflictError) {
    return [
      {
        path: "",
        code: "conflict",
        message: "This record was changed elsewhere. Reload to see the latest version.",
        hint: "Reload to load the latest version, then re-apply your change.",
      },
    ];
  }
  if (error instanceof RecordNotFoundError) {
    return [{ path: "", code: "not-found", message: "This record no longer exists.", hint: "Reload to refresh the list." }];
  }
  if (error instanceof UnauthorizedError) {
    return [{ path: "", code: "unauthorized", message: error.message, hint: "Sign in and try again." }];
  }
  if (error instanceof ForbiddenError) {
    return [{ path: "", code: "forbidden", message: error.message, hint: "You are not allowed to save this." }];
  }
  const message = error instanceof Error ? error.message : "Could not save this record.";
  return [{ path: "", code: "invalid-value", message, hint: "Reload and try again." }];
}
