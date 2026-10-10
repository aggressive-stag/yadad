// PRE-CONTRACT. DataAdapter from ARCHITECTURE.md §10 and docs/records-protocol.md.
// Query filter and sort arrive with the condition AST. Records carry an opaque
// `version`; writes send it back as `baseVersion` and a stale one is a conflict.

/** A single field value: text, select and date are strings, then numbers and booleans. null is empty. */
export type FieldValue = string | number | boolean | null;

/**
 * Field values keyed by field id. Records are user data, not documents, so
 * this is the one deliberate map in core: field ids are defined by users.
 */
export type RecordValues = Readonly<Record<string, FieldValue>>;

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
}

import type { Condition } from "./condition.js";
import type { SortSpec } from "./document.js";
import type { DocumentError } from "./errors.js";

export interface Query {
  /** Only records matching this. */
  readonly filter?: Condition;
  /** Sort keys in priority order. Empty values sort last in both directions. */
  readonly sort?: readonly SortSpec[];
  readonly page?: { readonly offset: number; readonly limit: number };
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
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
}
