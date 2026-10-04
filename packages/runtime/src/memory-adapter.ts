import type { DataAdapter, DataRecord } from "@yadad/core";

/** In-memory DataAdapter for tests, the showcase and local dev. Nothing persists. */
export function createMemoryAdapter(): DataAdapter {
  const tables = new Map<string, Map<string, DataRecord>>();
  let nextId = 1;

  const table = (entity: string): Map<string, DataRecord> => {
    let t = tables.get(entity);
    if (!t) {
      t = new Map();
      tables.set(entity, t);
    }
    return t;
  };

  return {
    async find(entity, query) {
      const all = [...table(entity).values()];
      const items = query.page ? all.slice(query.page.offset, query.page.offset + query.page.limit) : all;
      return { items, total: all.length };
    },
    async findOne(entity, id) {
      return table(entity).get(id) ?? null;
    },
    async create(entity, values, meta) {
      const record: DataRecord = {
        id: String(nextId++),
        entityId: entity,
        entityRevision: meta.entityRevision,
        values: { ...values },
      };
      table(entity).set(record.id, record);
      return record;
    },
    async update(entity, id, patch, meta) {
      const existing = table(entity).get(id);
      if (!existing) throw new Error(`No "${entity}" record with id "${id}".`);
      const record: DataRecord = {
        ...existing,
        entityRevision: meta.entityRevision,
        values: { ...existing.values, ...patch },
      };
      table(entity).set(id, record);
      return record;
    },
    async delete(entity, id) {
      table(entity).delete(id);
    },
  };
}
