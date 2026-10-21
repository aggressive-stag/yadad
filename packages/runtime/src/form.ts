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
  // A records host may serve values the entity does not declare (computed or
  // server-managed fields). Those keys belong to the server, not to this edit:
  // keep them out of the merge, or one of them refuses every edit of every
  // record of the entity. Keys the *patch* introduces stay under validation
  // below, so a record the client builds is still checked strictly.
  const declared = new Set(entity.fields.map((f) => f.id));
  const served = Object.fromEntries(Object.entries(record.values).filter(([key]) => declared.has(key)));
  const errors = validateRecord(entity, { ...served, ...patch });
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
 * Locates a server-side issue where the form can show it. The protocol puts a
 * record-value error at `/values/<field>` (a pointer into the request body);
 * the form marks fields at `jsonPointer([field.id])`, so a located error is
 * rewritten to that path and the field gets its message and `aria-invalid`.
 * `""` (form level), `/input/…` and anything else are left as the server sent
 * them.
 */
function locateIssue(issue: DocumentError): DocumentError {
  const located = /^\/values\/([^/]+)$/.exec(issue.path);
  if (located === null || located[1] === undefined) return issue;
  const field = located[1].replaceAll("~1", "/").replaceAll("~0", "~");
  return { ...issue, path: jsonPointer([field]) };
}

/**
 * The protocol's `errors[]` a refused save carries, located for display, when
 * the thrown error has any. `undefined` when it does not (network failure,
 * 5xx, an error with an empty body) — those get a summary line instead.
 */
export function serverValidationIssues(error: unknown): readonly DocumentError[] | undefined {
  if (!(error instanceof RecordValidationError) || error.issues.length === 0) return undefined;
  return error.issues.map(locateIssue);
}

/**
 * Turns a failed save (a thrown adapter error) into the form's error list, so
 * the existing error display can show it. The protocol's `errors[]` pass
 * through with their own message, hint and located field; a conflict and the
 * other failures become a single summary line.
 */
function adapterFailure(error: unknown): readonly DocumentError[] {
  const located = serverValidationIssues(error);
  if (located !== undefined) return located;
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
