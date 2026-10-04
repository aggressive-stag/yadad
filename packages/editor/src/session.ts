import { validateDocument } from "@yadad/core";
import type { Document, DocumentError } from "@yadad/core";
import { applyPatch } from "@yadad/runtime";
import type { PatchOperation } from "@yadad/runtime";

/**
 * An editing session over one document. Every change is a JSON Patch that
 * must leave a valid document; the patch log gives undo and redo.
 */
export interface EditSession<T extends Document> {
  /** The document as it was when the session started. */
  readonly base: T;
  /** Accepted edits, oldest first. Replaying them on `base` gives `current`. */
  readonly applied: readonly (readonly PatchOperation[])[];
  /** Undone edits, most recently undone last. Cleared by a new edit. */
  readonly undone: readonly (readonly PatchOperation[])[];
  readonly current: T;
  /** Why the last edit was rejected; empty after a successful edit. */
  readonly rejected: readonly DocumentError[];
}

export function startSession<T extends Document>(doc: T): EditSession<T> {
  return { base: doc, applied: [], undone: [], current: doc, rejected: [] };
}

/** Applies a patch and validates the result. Invalid edits leave the document as it was and say why. */
export function edit<T extends Document>(session: EditSession<T>, patch: readonly PatchOperation[]): EditSession<T> {
  const next = check(session.current, patch);
  if (!next.ok) return { ...session, rejected: next.errors };
  return { ...session, applied: [...session.applied, patch], undone: [], current: next.value, rejected: [] };
}

export function undo<T extends Document>(session: EditSession<T>): EditSession<T> {
  const last = session.applied.at(-1);
  if (!last) return session;
  const applied = session.applied.slice(0, -1);
  return { ...session, applied, undone: [...session.undone, last], current: replay(session.base, applied), rejected: [] };
}

export function redo<T extends Document>(session: EditSession<T>): EditSession<T> {
  const next = session.undone.at(-1);
  if (!next) return session;
  const applied = [...session.applied, next];
  return { ...session, applied, undone: session.undone.slice(0, -1), current: replay(session.base, applied), rejected: [] };
}

export const isDirty = (session: EditSession<Document>): boolean => session.applied.length > 0;

/** The edited document with its revision bumped, ready to store; the base document if nothing changed. */
export function finish<T extends Document>(session: EditSession<T>): T {
  return isDirty(session) ? { ...session.current, revision: session.base.revision + 1 } : session.base;
}

function check<T extends Document>(doc: T, patch: readonly PatchOperation[]): { ok: true; value: T } | { ok: false; errors: readonly DocumentError[] } {
  const patched = applyPatch(doc, patch);
  if (!patched.ok) {
    return { ok: false, errors: [{ path: "", code: "invalid-value", message: `Edit ${patched.index + 1} could not be applied: ${patched.error}`, hint: "The document may have changed; reload and try again." }] };
  }
  const valid = validateDocument(patched.value);
  if (!valid.ok) return { ok: false, errors: valid.errors };
  if (valid.value.kind !== doc.kind || valid.value.id !== doc.id) {
    return { ok: false, errors: [{ path: "", code: "invalid-value", message: "An edit may not change a document's kind or id.", hint: "Create a new document instead." }] };
  }
  return { ok: true, value: patched.value };
}

function replay<T extends Document>(base: T, applied: readonly (readonly PatchOperation[])[]): T {
  let doc = base;
  for (const patch of applied) {
    const result = applyPatch(doc, patch);
    if (!result.ok) throw new Error(`Patch log no longer applies: ${result.error}`); // cannot happen: every patch was checked on this exact sequence
    doc = result.value;
  }
  return doc;
}
