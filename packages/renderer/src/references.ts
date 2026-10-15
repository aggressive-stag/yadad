import type { DataAdapter, EntityDocument, ReferenceDisplayExtras, ReferenceField, ReferenceInputExtras, ReferenceOptions } from "@yadad/core";
import { loadReferenceOptions, resolveReferenceLabels } from "@yadad/runtime";
import { useEffect, useMemo, useState } from "react";

/** The label of a record that no longer exists. */
export const UNKNOWN_REFERENCE_LABEL = "Unknown";

/** What fields.tsx needs to render a reference field's Input and Display. */
export interface ReferenceSupport {
  input(field: ReferenceField, id: string | undefined): ReferenceInputExtras;
  display(field: ReferenceField, id: string): ReferenceDisplayExtras;
}

type Targets = ReadonlyMap<string, EntityDocument>;

const labelKey = (field: ReferenceField, id: string): string => JSON.stringify([field.id, id]);

type LabelEntry = { readonly status: "found"; readonly label: string } | { readonly status: "missing" } | { readonly status: "error" };

export interface ReferenceWant {
  readonly field: ReferenceField;
  readonly id: string;
}

/**
 * Loads picker options (for `pickers`) and resolves labels (for `wants`) from
 * the target entities' records. Records come from `adapter`, which is the
 * data source of the view being rendered: one adapter serves every entity of
 * the app. Returns the support object the field renderers use.
 */
export function useReferences(adapter: DataAdapter | undefined, targets: Targets | undefined, pickers: readonly ReferenceField[], wants: readonly ReferenceWant[], reloadKey?: unknown): ReferenceSupport {
  const [options, setOptions] = useState<ReadonlyMap<string, ReferenceOptions>>(new Map());
  const [labels, setLabels] = useState<ReadonlyMap<string, LabelEntry>>(new Map());

  const pickerKey = JSON.stringify(pickers.map((f) => [f.id, f.entity, f.display ?? null]));
  const wantKey = JSON.stringify([...new Set(wants.map((w) => labelKey(w.field, w.id)))].sort());

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    for (const field of pickers) {
      const target = targets?.get(field.entity);
      if (!target) {
        setOptions((m) => new Map(m).set(field.id, { status: "error", message: `Entity "${field.entity}" was not provided to the renderer.` }));
        continue;
      }
      setOptions((m) => (m.has(field.id) ? m : new Map(m).set(field.id, { status: "loading" })));
      loadReferenceOptions(adapter, target, field).then(
        (result) => current && setOptions((m) => new Map(m).set(field.id, { status: "ready", options: result.options, more: result.more })),
        (error: unknown) => current && setOptions((m) => new Map(m).set(field.id, { status: "error", message: error instanceof Error ? error.message : String(error) })),
      );
    }
    return () => {
      current = false;
    };
    // pickerKey stands for `pickers`.
  }, [adapter, targets, pickerKey, reloadKey]);

  useEffect(() => {
    if (!adapter) return;
    let current = true;
    const byField = new Map<string, { field: ReferenceField; ids: string[] }>();
    for (const { field, id } of wants) {
      const group = byField.get(field.id) ?? { field, ids: [] };
      group.ids.push(id);
      byField.set(field.id, group);
    }
    for (const { field, ids } of byField.values()) {
      const target = targets?.get(field.entity);
      const settle = (entry: (id: string) => LabelEntry) => current && setLabels((m) => {
        const next = new Map(m);
        for (const id of ids) next.set(labelKey(field, id), entry(id));
        return next;
      });
      if (!target) {
        settle(() => ({ status: "error" }));
        continue;
      }
      resolveReferenceLabels(adapter, target, field, ids).then(
        (found) => settle((id) => { const label = found.get(id); return label === undefined ? { status: "missing" } : { status: "found", label }; }),
        () => settle(() => ({ status: "error" })),
      );
    }
    return () => {
      current = false;
    };
    // wantKey stands for `wants`.
  }, [adapter, targets, wantKey, reloadKey]);

  return useMemo<ReferenceSupport>(
    () => ({
      input(field, id) {
        const state = options.get(field.id) ?? ({ status: "loading" } as const);
        const entry = id === undefined ? undefined : labels.get(labelKey(field, id));
        return { options: state, ...(entry?.status === "found" ? { valueLabel: entry.label } : {}) };
      },
      display(field, id) {
        const entry = labels.get(labelKey(field, id));
        if (!entry) return { label: id, status: "loading" };
        if (entry.status === "found") return { label: entry.label, status: "found" };
        if (entry.status === "missing") return { label: UNKNOWN_REFERENCE_LABEL, status: "missing" };
        return { label: id, status: "error" };
      },
    }),
    [options, labels],
  );
}
