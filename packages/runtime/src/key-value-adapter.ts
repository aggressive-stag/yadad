import type { BatchOperations, BatchResult, DataAdapter, DataRecord, DocumentError } from "@yadad/core";
import { RecordConflictError, RecordNotFoundError, RecordValidationError } from "@yadad/core";
import { runQuery, validateFieldIds } from "./memory-adapter.js";
import type { AdapterOptions } from "./memory-adapter.js";

/**
 * The part of the Web Storage API the adapter needs. window.localStorage and
 * sessionStorage fit it as-is; tests can pass a Map-backed object.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * A DataAdapter that keeps each entity's records as JSON under
 * `<prefix>:records:<entity>` in a key-value store, e.g. localStorage, so
 * they survive a reload. Queries run in process with the memory adapter's
 * semantics. Unreadable stored data is reported, never overwritten.
 */
export function createKeyValueAdapter(store: KeyValueStore, prefix: string, options?: AdapterOptions): DataAdapter {
  const key = (entity: string) => `${prefix}:records:${entity}`;

  const load = (entity: string): DataRecord[] => {
    const raw = store.getItem(key(entity));
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Stored records for "${entity}" are not valid JSON (key "${key(entity)}"); they were left untouched.`);
    }
    if (!Array.isArray(parsed)) throw new Error(`Stored records for "${entity}" are not a list (key "${key(entity)}"); they were left untouched.`);
    // Records saved before `version` existed get a stable derived version, so a
    // stale-baseVersion check behaves the same across reads (not a fresh one each).
    return (parsed as DataRecord[]).map((r) => (r.version !== undefined ? r : { ...r, version: `legacy-${r.id}` }));
  };
  const save = (entity: string, records: readonly DataRecord[]) => store.setItem(key(entity), JSON.stringify(records));

  /**
   * Unique across reloads and tabs: time, a random part (two adapters created
   * in the same millisecond, e.g. two tabs, would otherwise collide) and a
   * per-adapter counter. Used for both ids and versions.
   */
  const session = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  const newToken = () => `${Date.now().toString(36)}-${session}-${(counter++).toString(36)}`;

  return {
    async find(entity, query) {
      return runQuery(load(entity), query);
    },
    async findOne(entity, id) {
      return load(entity).find((r) => r.id === id) ?? null;
    },
    async create(entity, values, meta) {
      const issues = validateFieldIds(options?.fields, entity, values, ["values"]);
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      const records = load(entity);
      const record: DataRecord = { id: newToken(), entityId: entity, entityRevision: meta.entityRevision, version: newToken(), values: { ...values } };
      save(entity, [...records, record]);
      return record;
    },
    async update(entity, id, patch, meta) {
      const records = load(entity);
      const existing = records.find((r) => r.id === id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      const issues = validateFieldIds(options?.fields, entity, patch, ["values"]);
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      if (meta.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      const record: DataRecord = { ...existing, entityRevision: meta.entityRevision, version: newToken(), values: { ...existing.values, ...patch } };
      save(entity, records.map((r) => (r.id === id ? record : r)));
      return record;
    },
    async delete(entity, id, meta) {
      const records = load(entity);
      const existing = records.find((r) => r.id === id);
      if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${id}".`);
      if (meta?.baseVersion !== undefined && existing.version !== meta.baseVersion) {
        throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
      }
      save(entity, records.filter((r) => r.id !== id));
    },
    async batch(entity, ops: BatchOperations, meta): Promise<BatchResult> {
      const records = load(entity);
      const creates = ops.create ?? [];
      const deletes = ops.delete ?? [];
      // Validate everything before writing anything: atomic all-or-nothing.
      const issues: DocumentError[] = [];
      creates.forEach((values, i) => {
        issues.push(...validateFieldIds(options?.fields, entity, values, ["create", i, "values"]));
      });
      if (issues.length > 0) throw new RecordValidationError("Some values were rejected.", issues);
      for (const del of deletes) {
        const existing = records.find((r) => r.id === del.id);
        if (!existing) throw new RecordNotFoundError(`No "${entity}" record with id "${del.id}".`);
        if (del.baseVersion !== undefined && existing.version !== del.baseVersion) {
          throw new RecordConflictError(`The "${entity}" record was changed since you loaded it.`, existing);
        }
      }
      const remaining = records.filter((r) => !deletes.some((d) => d.id === r.id));
      const created: DataRecord[] = [];
      for (const values of creates) {
        const record: DataRecord = { id: newToken(), entityId: entity, entityRevision: meta.entityRevision, version: newToken(), values: { ...values } };
        created.push(record);
      }
      save(entity, [...remaining, ...created]);
      return { created, deleted: deletes.map((d) => d.id) };
    },
  };
}
