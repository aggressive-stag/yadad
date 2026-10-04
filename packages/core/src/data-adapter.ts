// PRE-CONTRACT. DataAdapter from ARCHITECTURE.md §10. Query filter
// and sort arrive with the condition AST (P1-04).

/** A single field value: text, select and date are strings, then numbers and booleans. null is empty. */
export type FieldValue = string | number | boolean | null;

/**
 * Field values keyed by field id. Records are user data, not documents, so
 * this is the one deliberate map in core: field ids are defined by users.
 */
export type RecordValues = Readonly<Record<string, FieldValue>>;

export interface DataRecord {
  readonly id: string;
  readonly entityId: string;
  /** Entity revision the record was saved under; old records upcast on read. */
  readonly entityRevision: number;
  readonly values: RecordValues;
}

import type { SortSpec } from "./document";

export interface Query {
  /** Sort keys in priority order. Empty values sort last in both directions. */
  readonly sort?: readonly SortSpec[];
  readonly page?: { readonly offset: number; readonly limit: number };
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export interface WriteMeta {
  readonly entityRevision: number;
}

/** Injected by the host and looked up by a view's `dataSource` key. */
export interface DataAdapter {
  find(entity: string, query: Query): Promise<Page<DataRecord>>;
  findOne(entity: string, id: string): Promise<DataRecord | null>;
  create(entity: string, values: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  update(entity: string, id: string, patch: RecordValues, meta: WriteMeta): Promise<DataRecord>;
  delete(entity: string, id: string): Promise<void>;
}
