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
  /** The document last stored (the base until a Save is confirmed). The next Save is one revision above it. */
  readonly stored: T;
  /** The edits `stored` already contains: the session is dirty while `applied` differs from this. */
  readonly storedLog: readonly (readonly PatchOperation[])[];
  /** A Save handed to the host and not yet seen coming back: the revision it produced and the edits it held. */
  readonly pending?: { readonly revision: number; readonly log: readonly (readonly PatchOperation[])[] };
  /** Accepted edits, oldest first. Replaying them on `base` gives `current`. */
  readonly applied: readonly (readonly PatchOperation[])[];
  /** Undone edits, most recently undone last. Cleared by a new edit. */
  readonly undone: readonly (readonly PatchOperation[])[];
  readonly current: T;
  /** Why the last edit was rejected; empty after a successful edit. */
  readonly rejected: readonly DocumentError[];
}

export function startSession<T extends Document>(doc: T): EditSession<T> {
  return { base: doc, stored: doc, storedLog: [], applied: [], undone: [], current: doc, rejected: [] };
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

/** Whether the session holds edits the stored document does not. Undoing past a Save makes it dirty again. */
export const isDirty = (session: EditSession<Document>): boolean =>
  session.applied.length !== session.storedLog.length || session.applied.some((patch, i) => patch !== session.storedLog[i]);

/** The edited document with its revision one above the stored one, ready to store; the stored document if nothing changed. */
export function finish<T extends Document>(session: EditSession<T>): T {
  return isDirty(session) ? { ...session.current, revision: session.stored.revision + 1 } : session.stored;
}

/** Records that `session` was just handed to the host to store, so the stored document coming back can be told from a foreign one. */
export function markSaving<T extends Document>(session: EditSession<T>): EditSession<T> {
  return { ...session, pending: { revision: finish(session).revision, log: session.applied } };
}

/**
 * The host passed back a document. The one this session saved becomes the
 * stored document and the session is clean again, with its undo log intact;
 * a document at the revision already stored (a failed save, or a host that
 * rebuilt the same document) changes nothing.
 */
export function follow<T extends Document>(session: EditSession<T>, doc: T): EditSession<T> {
  if (doc.revision === session.stored.revision) return session;
  if (session.pending?.revision !== doc.revision) return session;
  const { pending: _done, ...rest } = session;
  return { ...rest, stored: doc, storedLog: session.pending.log };
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
