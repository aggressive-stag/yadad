import type { Document, DocumentError } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { edit } from "./session.js";
import type { EditSession } from "./session.js";

/** What an editor action returns: a patch, a checked patch, or why the check said no. */
export type EditorResult = PatchOperation[] | { readonly ok: true; readonly patch: PatchOperation[] } | { readonly ok: false; readonly error: DocumentError };

/**
 * Applies an action result through the session and reports it (card 45e):
 * a rejected check or a rejected edit lands in `setProblems`, a clean one
 * clears them and calls `onOk`. The four view editors (`board`, `calendar`,
 * `form`, `table`) all answered "what does a rejected save do" with this
 * same nine-line callback; the rule now lives here once.
 */
export function runEdit<T extends Document>(
  result: EditorResult,
  session: EditSession<T>,
  setSession: (next: EditSession<T>) => void,
  setProblems: (errors: readonly DocumentError[]) => void,
  onOk?: () => void,
): boolean {
  if (!Array.isArray(result) && !result.ok) return setProblems([result.error]), false;
  const patch = Array.isArray(result) ? result : result.patch;
  if (patch.length === 0) return onOk?.(), true;
  const next = applyEdit(session, patch, setSession, setProblems);
  if (next.rejected.length === 0) onOk?.();
  return next.rejected.length === 0;
}

/** Binds the session and its two setters once, so each editor's `run` is one partial application of `runEdit`, never a copy of its rule. */
export function editRunner<T extends Document>(
  session: EditSession<T>,
  setSession: (next: EditSession<T>) => void,
  setProblems: (errors: readonly DocumentError[]) => void,
): (result: EditorResult, onOk?: () => void) => boolean {
  return (result, onOk) => runEdit(result, session, setSession, setProblems, onOk);
}

/**
 * Applies a patch through the session and reports the rejection (card 45e):
 * the shared half of the editors' "apply and announce" helpers, which each
 * wrapped in their own wording (`Not moved: ${…}` + a fallback naming their
 * view kind) — that wording stays with the caller.
 */
export function applyEdit<T extends Document>(
  session: EditSession<T>,
  patch: readonly PatchOperation[],
  setSession: (next: EditSession<T>) => void,
  setProblems: (errors: readonly DocumentError[]) => void,
): EditSession<T> {
  const next = edit(session, patch);
  setSession(next);
  setProblems(next.rejected);
  return next;
}
