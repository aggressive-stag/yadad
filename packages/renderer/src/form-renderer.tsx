import { conditionFields, jsonPointer, sectionItems } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, FieldValue, FormItem, FormSection, FormView, ReferenceField, Registry, ResolvedViewer } from "@yadad/core";
import { applyFormRules, emptyFormState, evaluateFormRules, restoreDraft, setFieldValue, submitBatchCreate, submitForm } from "@yadad/runtime";
import type { DraftStore, FormState, RestoredDraft } from "@yadad/runtime";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { DocumentSet } from "./document-set.js";
import { checkViewSetup } from "./setup.js";
import { renderInput } from "./fields.js";
import type { CommonInputProps, FieldFormatting } from "./fields.js";
import { useReferences } from "./references.js";
import { SubRecordChecklist } from "./sub-records.js";
import { useViewerSetup } from "./viewer.js";
import { useContentStable } from "./use-stable.js";

/** The most rows the batch composer holds; `initialRows` is clamped to it and "+ another" stops there. */
export const BATCH_ROW_CAP = 50;

export interface FormRendererProps {
  readonly entity: EntityDocument;
  readonly view: FormView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  /**
   * The documents of the target entities of the entity's reference fields,
   * by id (the entity itself is not needed here). The picker's options are
   * loaded from the form's own data source.
   */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  readonly onSaved?: (record: DataRecord) => void;
  /**
   * How many empty rows a batch composer (`repeat: "batch"`) starts with.
   * Default 1, clamped to 1..`BATCH_ROW_CAP`; read once, and ignored when the
   * view is not a batch composer.
   */
  readonly initialRows?: number;
  /**
   * Opt-in drafts: unsaved input is kept in the store (debounced, default
   * 400 ms) and restored on the next load, until it is saved or discarded.
   */
  readonly drafts?: { readonly store: DraftStore; readonly debounceMs?: number };
  /**
   * Who is viewing (RFC 0006), from `resolveViewer`. Fields hidden for this
   * viewer are not shown, validated or saved. Needed when the form reads a
   * viewer fact; a form that reads none works without it.
   */
  readonly viewer?: ResolvedViewer;
  /**
   * The document set, used only to find the viewer document: without a
   * `viewer`, the form uses that document's defaults. A form that reads a
   * viewer fact and has neither shows an error.
   */
  readonly documents?: DocumentSet;
  /** The viewer's locale and zone for datetime fields (RFC 0007); absent, the environment's. */
  readonly formatting?: FieldFormatting;
  /**
   * The record the sub-record sections hang off (RFC 0009 item 3): the rows are
   * the child records whose `via` names it. A create form has no parent until
   * the record exists, and its sections say so.
   */
  readonly parent?: DataRecord;
  /** Change this to reload the sub-record rows, alongside the renderer's own reloads. */
  readonly reloadKey?: unknown;
}

/**
 * Renders a form view for its entity. Every visible piece (sections, fields,
 * the Save button) comes from the injected registry; saving goes through
 * runtime and the data adapter.
 */
function clampRows(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 1;
  return Math.min(BATCH_ROW_CAP, Math.max(1, Math.floor(n)));
}

export function FormRenderer({ entity: entityProp, view: viewProp, registry, dataSources: dataSourcesProp, entities: entitiesProp, onSaved, drafts, viewer: viewerProp, documents: documentsProp, formatting, parent, reloadKey, initialRows }: FormRendererProps): ReactNode {
  const entity = useContentStable(entityProp);
  const view = useContentStable(viewProp);
  const dataSources = useContentStable(dataSourcesProp);
  const entities = useContentStable(entitiesProp);
  const documents = useContentStable(documentsProp);
  const formId = useId();
  const { viewer, error: viewerError } = useViewerSetup(viewerProp, view, documents);
  const store = drafts?.store;
  const [initial] = useState(() => {
    const draft = store?.load(view.id);
    return draft ? restoreDraft(entity, draft) : null;
  });
  const [restored, setRestored] = useState<RestoredDraft | null>(initial);
  const [state, setState] = useState<FormState>(initial ? { values: initial.values, errors: initial.invalidFields } : emptyFormState);
  const [saving, setSaving] = useState(false);
  // Only input typed in this session is written back, so restoring alone never touches the stored draft.
  const typed = useRef(false);

  // The batch composer (RFC 0009 item 4): `repeat: "batch"` renders the field
  // set once per queued row and the submit writes all rows through one atomic
  // `batch create`. Drafts do not apply — the DraftStore bag holds one
  // record's values, and a composer is quick-add, not an edit in progress.
  const isBatch = view.repeat === "batch";
  const [rows, setRows] = useState<readonly FormState[]>(() =>
    Array.from({ length: isBatch ? clampRows(initialRows) : 1 }, () => emptyFormState),
  );
  const [batchNotice, setBatchNotice] = useState<{ readonly seq: number; readonly text: string } | undefined>(undefined);
  const [batchErrors, setBatchErrors] = useState<readonly DocumentError[]>([]);

  const debounceMs = drafts?.debounceMs ?? 400;
  useEffect(() => {
    if (!store || !typed.current || isBatch) return;
    const timer = setTimeout(() => {
      // Store what the form would save, so hidden clearWhenHidden values are not kept.
      const values = applyFormRules(entity, view, state.values, viewer).values;
      if (Object.keys(values).length === 0) store.clear(view.id);
      else store.save(view.id, undefined, { values, entityRevision: entity.revision, savedAt: Date.now() });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [store, debounceMs, entity, view, state.values, viewer, isBatch]);

  const adapter = dataSources.get(view.dataSource);
  const refEntities = entities ?? documents?.entities;
  const shownRefs = view.sections.flatMap((s) => sectionItems(s).flatMap((i) => entity.fields.filter((f): f is ReferenceField => f.type === "reference" && f.id === i.field)));
  const wants = (isBatch ? rows.map((r) => r.values) : [state.values]).flatMap((values) =>
    shownRefs.flatMap((field) => {
      const value = values[field.id];
      return typeof value === "string" && value !== "" ? [{ field, id: value }] : [];
    }),
  );
  const references = useReferences(adapter, entities, shownRefs, wants);
  const refs = view.sections.flatMap((section, i) =>
    sectionItems(section).flatMap((item, j) => {
      const path = ["sections", i, "items", j];
      return [
        { field: item.field, path: [...path, "field"] },
        ...(item.visibleWhen ? conditionFields(item.visibleWhen).map((field) => ({ field, path: [...path, "visibleWhen"] })) : []),
        ...(item.requiredWhen ? conditionFields(item.requiredWhen).map((field) => ({ field, path: [...path, "requiredWhen"] })) : []),
      ];
    }),
  );
  const setupErrors = [...checkViewSetup(entity, view, adapter, refs), ...(viewerError ? [viewerError] : [])];
  const { FieldFrame, Section, Button, ErrorSummary } = registry.layout;
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

  const rules = evaluateFormRules(view, state.values, viewer);
  // Errors for fields not on screen (hidden or not in this view) go in the summary.
  const shown = new Set(view.sections.flatMap((s) => sectionItems(s).map((i) => i.field)).filter((id) => !rules.hidden.has(id)));
  const formErrors = state.errors.filter((e) => !entity.fields.some((f) => shown.has(f.id) && e.path === jsonPointer([f.id])));

  async function save(): Promise<void> {
    if (!adapter || saving) return;
    setSaving(true);
    const effective = applyFormRules(entity, view, state.values, viewer);
    const result = await submitForm(effective.entity, effective.values, adapter);
    setSaving(false);
    if (result.ok) {
      typed.current = false;
      store?.clear(view.id);
      setRestored(null);
      setState(emptyFormState);
      onSaved?.(result.record);
    } else {
      setState((s) => ({ ...s, errors: result.errors }));
    }
  }

  /** One atomic flush of the composer (RFC 0009 item 4): N validated rows, one `batch create`. */
  async function saveBatch(): Promise<void> {
    if (!adapter || saving) return;
    setSaving(true);
    const effective = rows.map((row) => applyFormRules(entity, view, row.values, viewer).values);
    const result = await submitBatchCreate(entity, effective, adapter);
    setSaving(false);
    if (result.ok) {
      const count = result.records.length;
      setRows([emptyFormState]);
      setBatchErrors([]);
      setBatchNotice((n) => ({ seq: (n?.seq ?? 0) + 1, text: `Added ${count} ${count === 1 ? entity.id : `${entity.id}s`}.` }));
      for (const record of result.records) onSaved?.(record);
    } else {
      setBatchErrors(result.errors);
    }
  }

  const discard = (): void => {
    typed.current = false;
    store?.clear(view.id);
    setRestored(null);
    setState(emptyFormState);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isBatch) void saveBatch();
    else void save();
  };

  const addRow = (): void => setRows((rs) => (rs.length >= BATCH_ROW_CAP ? rs : [...rs, emptyFormState]));

  /** One field of one row: the row supplies values, errors and the write-back. */
  const renderItem = (item: FormItem, rowIndex: number): ReactNode => {
    const rowValues = isBatch ? rows[rowIndex]?.values ?? {} : state.values;
    const rowRules = isBatch ? evaluateFormRules(view, rowValues, viewer) : rules;
    const field = entity.fields.find((f) => f.id === item.field);
    if (!field || rowRules.hidden.has(field.id)) return null; // unknown fields are reported by checkViewSetup
    const inputId = isBatch ? `${formId}-row${rowIndex}-${field.id}` : `${formId}-${field.id}`;
    const errorId = `${inputId}-errors`;
    const rowErrorPrefix = isBatch ? `/rows/${rowIndex}` : "";
    const errors = (isBatch ? batchErrors : state.errors)
      .filter((e) => e.path.startsWith(rowErrorPrefix))
      .map((e) => ({ ...e, path: e.path.slice(rowErrorPrefix.length) }))
      .filter((e) => e.path === jsonPointer([field.id]));
    const common: CommonInputProps = {
      inputId,
      invalid: errors.length > 0,
      ...(errors.length > 0 ? { describedBy: errorId } : {}),
    };
    const onChange = (value: FieldValue | undefined) => {
      typed.current = true;
      if (isBatch) {
        setRows((rs) => rs.map((r, i) => (i === rowIndex ? setFieldValue(r, field.id, value) : r)));
        setBatchErrors((es) => es.filter((e) => !e.path.startsWith(`${rowErrorPrefix}${jsonPointer([field.id])}`)));
      } else {
        setState((s) => setFieldValue(s, field.id, value));
      }
    };
    return (
      <FieldFrame key={field.id} inputId={inputId} errorId={errorId} label={item.label ?? field.label} required={field.required === true || rowRules.required.has(field.id)} errors={errors}>
        {renderInput(registry, field, rowValues[field.id], common, onChange, references, formatting)}
      </FieldFrame>
    );
  };

  const renderSection = (section: FormSection, rowIndex: number, rowKey: string): ReactNode =>
    section.subRecords !== undefined && isBatch && rowIndex > 0 ? null // the checklist is one control, not one per queued row
      : section.subRecords !== undefined && adapter !== undefined ? (
      <SubRecordChecklist
        key={`${rowKey}:${section.id}`}
        entity={entity}
        sub={section.subRecords}
        registry={registry}
        adapter={adapter}
        {...(refEntities !== undefined ? { entities: refEntities } : {})}
        {...(documents !== undefined ? { documents } : {})}
        {...(reloadKey !== undefined ? { reloadKey } : {})}
        {...(parent !== undefined ? { parent } : {})}
      />
    ) : (
      <Section key={`${rowKey}:${section.id}`} id={isBatch ? `${rowKey}:${section.id}` : section.id} {...(section.title !== undefined ? { title: section.title } : {})}>
        {sectionItems(section).map((item) => renderItem(item, rowIndex))}
      </Section>
    );

  const formLevelBatchErrors = batchErrors.filter((e) => !/^\/rows\/\d+\//.test(e.path));

  return (
    <form onSubmit={onSubmit} noValidate data-yadad-form={view.id} data-yadad-repeat={isBatch ? "batch" : undefined}>
      {restored && (
        <div role="status">
          <Section id={`${view.id}-draft`} title={`Restored unsaved changes from ${new Date(restored.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`}>
            <>
              {restored.revisionChanged && <p>This form has changed since then. Check the restored values before saving.</p>}
              {restored.droppedFields.length > 0 && <p>Some values belong to fields this form no longer has and were left out.</p>}
              <Button label="Discard" type="button" variant="secondary" disabled={saving} onPress={discard} />
            </>
          </Section>
        </div>
      )}
      {batchNotice !== undefined && <p role="status" data-yadad-batch-status={view.id}>{batchNotice.text}</p>}
      {rows.map((row, i) => (
        <div key={i} data-yadad-batch-row={isBatch ? i : undefined}>
          {view.sections.map((section) => renderSection(section, i, String(i)))}
          {isBatch && i > 0 && (
            <Button label="Remove row" type="button" variant="secondary" disabled={saving} onPress={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setBatchErrors([]); }} />
          )}
        </div>
      ))}
      {isBatch && (
        <div data-yadad-batch-controls={view.id}>
          <Button label="+ another" type="button" variant="secondary" disabled={saving || rows.length >= BATCH_ROW_CAP} onPress={addRow} />
          <span data-yadad-batch-count={view.id} role="status">{rows.length} {rows.length === 1 ? "row" : "rows"}</span>
        </div>
      )}
      {formErrors.length > 0 && <ErrorSummary errors={formErrors} />}
      {formLevelBatchErrors.length > 0 && <ErrorSummary errors={formLevelBatchErrors} />}
      <Button label={isBatch ? "Add" : "Save"} type="submit" variant="primary" disabled={saving} />
    </form>
  );
}
