import type { DataAdapter, DataRecord, FieldValue, SortSpec } from "@yadad/core";
import { evaluateCondition } from "./condition";

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
      const { filter } = query;
      const matching = [...table(entity).values()].filter((r) => !filter || evaluateCondition(filter, r.values));
      const all = sortRecords(matching, query.sort ?? []);
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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Orders two field values; null and missing values come last whatever the direction. */
export function compareFieldValues(a: FieldValue | undefined, b: FieldValue | undefined, dir: "asc" | "desc"): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : typeof a === "boolean" && typeof b === "boolean"
        ? Number(a) - Number(b)
        : collator.compare(String(a), String(b));
  return dir === "asc" ? order : -order;
}

/** Stable multi-key sort; ties keep creation order. */
export function sortRecords(records: readonly DataRecord[], sort: readonly SortSpec[]): DataRecord[] {
  return [...records].sort((a, b) => {
    for (const { field, dir } of sort) {
      const order = compareFieldValues(a.values[field], b.values[field], dir);
      if (order !== 0) return order;
    }
    return 0;
  });
}
