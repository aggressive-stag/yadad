// PRE-CONTRACT (P0-04). The error format is meant to survive into contract-v0;
// the code list will grow.

import type { ERROR_CODES } from "./contract.js";

/**
 * The error codes a validator or data adapter reports. Document validation
 * (validateDocument, validateDocuments) uses the first ten; the data-adapter
 * codes (docs/records-protocol.md) reuse the same shape, so an error body has
 * the form of a DocumentError either way.
 */
export type ErrorCode = (typeof ERROR_CODES)[number]
  | "not-found" // no such entity or record
  | "conflict" // the record changed (or was deleted) since it was read
  | "unauthorized" // not signed in
  | "forbidden"; // signed in but not allowed

/** One problem with a document. Readable by a person, actionable by an agent. */
export interface DocumentError {
  /** JSON Pointer (RFC 6901) into the document; "" is the document itself. */
  readonly path: string;
  readonly code: ErrorCode;
  readonly message: string;
  /** What to change to fix it. */
  readonly hint: string;
  /**
   * When validating a set of documents together, the id of the document this
   * error belongs to (see `validateDocuments`). Absent for single-document errors.
   */
  readonly document?: string;
  /**
   * Machine-readable list of the values that would have been accepted, when the
   * problem is "not one of a known set" (unknown reference, unknown kind, ...).
   * The human-facing `hint` is unchanged.
   */
  readonly allowed?: readonly string[];
}

/** Builds a JSON Pointer from path segments, escaping "~" and "/". */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments
    .map((s) => "/" + String(s).replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("");
}
