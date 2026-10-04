// PRE-CONTRACT (P0-04). The error format is meant to survive into contract-v0;
// the code list will grow.

export type ErrorCode =
  | "type" // wrong JSON type (object, string, number, ...)
  | "required" // missing property
  | "unknown-property" // property not in the schema (no additionalProperties)
  | "invalid-value" // right type, disallowed value
  | "unknown-kind"
  | "unknown-field-type"
  | "unsupported-spec-version"
  | "duplicate-id";

/** One problem with a document. Readable by a person, actionable by an agent. */
export interface DocumentError {
  /** JSON Pointer (RFC 6901) into the document; "" is the document itself. */
  readonly path: string;
  readonly code: ErrorCode;
  readonly message: string;
  /** What to change to fix it. */
  readonly hint: string;
}

/** Builds a JSON Pointer from path segments, escaping "~" and "/". */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments
    .map((s) => "/" + String(s).replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("");
}
