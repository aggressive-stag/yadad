import type { DataAdapter, DataRecord } from "@yadad/core";
import { runQuery } from "./memory-adapter.js";

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
export function createKeyValueAdapter(store: KeyValueStore, prefix: string): DataAdapter {
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
    return parsed as DataRecord[];
  };
  const save = (entity: string, records: readonly DataRecord[]) => store.setItem(key(entity), JSON.stringify(records));

  /**
   * Unique across reloads and tabs: time, a random part (two adapters created
   * in the same millisecond, e.g. two tabs, would otherwise collide) and a
   * per-adapter counter.
   */
  const session = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  const newId = () => `${Date.now().toString(36)}-${session}-${(counter++).toString(36)}`;

  return {
    async find(entity, query) {
      return runQuery(load(entity), query);
    },
    async findOne(entity, id) {
      return load(entity).find((r) => r.id === id) ?? null;
    },
    async create(entity, values, meta) {
      const records = load(entity);
      const record: DataRecord = { id: newId(), entityId: entity, entityRevision: meta.entityRevision, values: { ...values } };
      save(entity, [...records, record]);
      return record;
    },
    async update(entity, id, patch, meta) {
      const records = load(entity);
      const existing = records.find((r) => r.id === id);
      if (!existing) throw new Error(`No "${entity}" record with id "${id}".`);
      const record: DataRecord = { ...existing, entityRevision: meta.entityRevision, values: { ...existing.values, ...patch } };
      save(entity, records.map((r) => (r.id === id ? record : r)));
      return record;
    },
    async delete(entity, id) {
      save(entity, load(entity).filter((r) => r.id !== id));
    },
  };
}
