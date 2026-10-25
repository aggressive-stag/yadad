// PRE-CONTRACT. DataAdapter from ARCHITECTURE.md §10 and docs/records-protocol.md.
// Query filter and sort arrive with the condition AST. Records carry an opaque
// `version`; writes send it back as `baseVersion` and a stale one is a conflict.

/** A single field value: text, select and date are strings, then numbers and booleans. null is empty. */
export type FieldValue = string | number | boolean | readonly string[] | null;

/**
 * Field values keyed by field id. Records are user data, not documents, so
 * this is the one deliberate map in core: field ids are defined by users.
 */
export type RecordValues = Readonly<Record<string, FieldValue>>;

/**
 * What the current viewer may do with one record (RFC 0006). A missing key
 * means "not stated": the action is offered and the server decides.
 */
export interface RecordPermissions {
  readonly update?: boolean;
  readonly delete?: boolean;
  /**
   * Action id to allowed (RFC 0007); only `false` restricts. The second
   * deliberate map in core, after `RecordValues`: its keys are action ids
   * chosen by users, which core cannot list. A missing key means "not stated":
   * the action is offered and the server decides.
   */
  readonly actions?: Readonly<Record<string, boolean>>;
  /**
   * Field id to allowed (RFC 0008 item 9); only `false` restricts, and a
   * field absent from the map means `update` stands. The third deliberate
   * map, for the same reason: its keys are field ids chosen by users. It
   * narrows what the view offers (drag, inline edit, the completion tick);
   * the server still enforces every write.
   */
  readonly fields?: Readonly<Record<string, boolean>>;
}

export interface DataRecord {
  /** Opaque, chosen by the adapter. Never reused for a different record, even after a delete. */
  readonly id: string;
  readonly entityId: string;
  /** Entity revision the record was saved under; old records upcast on read. */
  readonly entityRevision: number;
  /**
   * Opaque; changes on every write that changes the record (an empty patch
   * leaves it as is). The client sends it back as `baseVersion` on writes.
   */
  readonly version: string;
  readonly values: RecordValues;
  /** Present only when the server states permissions. A hint for the UI, never sent back on writes. */
  readonly can?: RecordPermissions;
}

import type { Condition } from "./condition.js";
import type { SortSpec } from "./document.js";
import type { DocumentError } from "./errors.js";

export interface Query {
  /** Only records matching this. */
  readonly filter?: Condition;
  /** Sort keys in priority order. Empty values sort last in both directions. */
  readonly sort?: readonly SortSpec[];
  /**
   * Offset paging, or (when the server counts nothing) cursor paging: the
   * `cursor` is the opaque `next` of the previous page, never parsed by the
   * client (RFC 0007). `limit: 0` asks for a count and needs `total`.
   */
  readonly page?: { readonly offset: number; readonly limit: number } | { readonly cursor: string; readonly limit: number };
}

export interface Page<T> {
  readonly items: readonly T[];
  /** The number of matching records. Absent when the server does not count (it then answers with `next`). */
  readonly total?: number;
  /** Opaque token for the following page; `null` or absent at the end. A page with neither `total` nor `next` is the last. */
  readonly next?: string | null;
}

/** What running an action needs (RFC 0007): the input fields' values and the guard, the version the client last read. */
export interface ActionRequest {
  /** The declared input fields' values; absent when the action has none. */
  readonly input?: RecordValues;
  /** `baseVersion` is required here: a stale action is a conflict, checked before `input`. */
  readonly meta: WriteMeta & { readonly baseVersion: string };
}

/** What a write needs: the entity revision, and the record's version if the client read it. */
export interface WriteMeta {
  readonly entityRevision: number;
  /**
   * The version the record was last read at. A write whose `baseVersion` no
   * longer matches the stored record is a conflict. `create` omits it; `delete`
   * carries it only when the client has one.
   */
  readonly baseVersion?: string;
}

/** One atomic step: create many and delete many, all or nothing. */
export interface BatchOperations {
  /** New records, in order. */
  readonly create?: readonly RecordValues[];
  /** Existing records to remove, in order. `baseVersion` is optional per item. */
  readonly delete?: readonly { readonly id: string; readonly baseVersion?: string }[];
}

export interface BatchResult {
  readonly created: readonly DataRecord[];
  readonly deleted: readonly string[];
}

/** The category of a failed record operation, mirroring docs/records-protocol.md. */
export type AdapterErrorCode = "not-found" | "conflict" | "validation" | "unauthorized" | "forbidden";

/** Base class for every error a DataAdapter throws, so hosts can tell failures apart. */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}

/** No such entity or record (the protocol's 404). */
export class RecordNotFoundError extends AdapterError {
  constructor(message: string) {
    super("not-found", message);
    this.name = "RecordNotFoundError";
  }
}

/**
 * The record changed, or was deleted, since the client read it (the protocol's
 * 409). `current` is the server's copy, for showing or merging, or null if it is gone.
 */
export class RecordConflictError extends AdapterError {
  readonly current: DataRecord | null;
  constructor(message: string, current: DataRecord | null) {
    super("conflict", message);
    this.name = "RecordConflictError";
    this.current = current;
  }
}

/** The values were rejected (the protocol's 400). `issues` use the document-error shape. */
export class RecordValidationError extends AdapterError {
  readonly issues: readonly DocumentError[];
  constructor(message: string, issues: readonly DocumentError[]) {
    super("validation", message);
    this.name = "RecordValidationError";
    this.issues = issues;
  }
}

/** Not signed in (the protocol's 401). */
export class UnauthorizedError extends AdapterError {
  constructor(message: string) {
    super("unauthorized", message);
    this.name = "UnauthorizedError";
  }
}

/** Signed in but not allowed (the protocol's 403). */
export class ForbiddenError extends AdapterError {
  constructor(message: string) {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

/** Injected by the host and looked up by a view's `dataSource` key. */
export interface DataAdapter {
  find(entity: string, query: Query): Promise<Page<DataRecord>>;
  findOne(entity: string, id: string): Promise<DataRecord | null>;
  create(entity: string, values: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  /**
   * Merges `patch` over the record: an omitted field is unchanged, `null` clears
   * it. An empty patch is a no-op that returns the current record, version
   * unchanged; a stale `baseVersion` is still a conflict.
   */
  update(entity: string, id: string, patch: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  delete(entity: string, id: string, meta?: WriteMeta): Promise<void>;
  /** Create and delete many in one atomic step; if any item fails, nothing is written. */
  batch(entity: string, ops: BatchOperations, meta: WriteMeta): Promise<BatchResult>;
  /**
   * Runs a declared action on a record (RFC 0007). Optional until the next
   * major release: a view with `recordActions` rendered with an adapter that
   * has none shows an error instead of buttons that fail. Resolves to the
   * record after the action (with its new `can`), or null when the action
   * removed it. A refusal is a `ForbiddenError`, a stale or no longer
   * applicable action a `RecordConflictError`, bad input a `RecordValidationError`.
   */
  act?(entity: string, id: string, action: string, request: ActionRequest): Promise<DataRecord | null>;
}
