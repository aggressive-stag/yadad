import { conditionFields, jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, EntityDocument, FieldValue, FormItem, FormView, Registry } from "@yadad/core";
import { applyFormRules, emptyFormState, evaluateFormRules, restoreDraft, setFieldValue, submitForm } from "@yadad/runtime";
import type { DraftStore, FormState, RestoredDraft } from "@yadad/runtime";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { checkViewSetup } from "./setup.js";
import { renderInput } from "./fields.js";
import type { CommonInputProps } from "./fields.js";

export interface FormRendererProps {
  readonly entity: EntityDocument;
  readonly view: FormView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly onSaved?: (record: DataRecord) => void;
  /**
   * Opt-in drafts: unsaved input is kept in the store (debounced, default
   * 400 ms) and restored on the next load, until it is saved or discarded.
   */
  readonly drafts?: { readonly store: DraftStore; readonly debounceMs?: number };
}

/**
 * Renders a form view for its entity. Every visible piece (sections, fields,
 * the Save button) comes from the injected registry; saving goes through
 * runtime and the data adapter.
 */
export function FormRenderer({ entity, view, registry, dataSources, onSaved, drafts }: FormRendererProps): ReactNode {
  const formId = useId();
  const store = drafts?.store;
  const [initial] = useState(() => {
    const draft = store?.load(view.id);
    return draft ? restoreDraft(entity, draft) : null;
  });
  const [restored, setRestored] = useState<RestoredDraft | null>(initial);
  const [state, setState] = useState<FormState>(initial ? { values: initial.values, errors: [] } : emptyFormState);
  const [saving, setSaving] = useState(false);
  // Only input typed in this session is written back, so restoring alone never touches the stored draft.
  const typed = useRef(false);

  const debounceMs = drafts?.debounceMs ?? 400;
  useEffect(() => {
    if (!store || !typed.current) return;
    const timer = setTimeout(() => {
      // Store what the form would save, so hidden clearWhenHidden values are not kept.
      const values = applyFormRules(entity, view, state.values).values;
      if (Object.keys(values).length === 0) store.clear(view.id);
      else store.save(view.id, undefined, { values, entityRevision: entity.revision, savedAt: Date.now() });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [store, debounceMs, entity, view, state.values]);

  const adapter = dataSources.get(view.dataSource);
  const refs = view.sections.flatMap((section, i) =>
    section.items.flatMap((item, j) => {
      const path = ["sections", i, "items", j];
      return [
        { field: item.field, path: [...path, "field"] },
        ...(item.visibleWhen ? conditionFields(item.visibleWhen).map((field) => ({ field, path: [...path, "visibleWhen"] })) : []),
        ...(item.requiredWhen ? conditionFields(item.requiredWhen).map((field) => ({ field, path: [...path, "requiredWhen"] })) : []),
      ];
    }),
  );
  const setupErrors = checkViewSetup(entity, view, adapter, refs);
  const { FieldFrame, Section, Button, ErrorSummary } = registry.layout;
  if (setupErrors.length > 0) return <ErrorSummary errors={setupErrors} />;

  const rules = evaluateFormRules(view, state.values);
  // Errors for fields not on screen (hidden or not in this view) go in the summary.
  const shown = new Set(view.sections.flatMap((s) => s.items.map((i) => i.field)).filter((id) => !rules.hidden.has(id)));
  const formErrors = state.errors.filter((e) => !entity.fields.some((f) => shown.has(f.id) && e.path === jsonPointer([f.id])));

  async function save(): Promise<void> {
    if (!adapter || saving) return;
    setSaving(true);
    const effective = applyFormRules(entity, view, state.values);
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

  const discard = (): void => {
    typed.current = false;
    store?.clear(view.id);
    setRestored(null);
    setState(emptyFormState);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void save();
  };

  const renderItem = (item: FormItem): ReactNode => {
    const field = entity.fields.find((f) => f.id === item.field);
    if (!field || rules.hidden.has(field.id)) return null; // unknown fields are reported by checkViewSetup
    const inputId = `${formId}-${field.id}`;
    const errorId = `${inputId}-errors`;
    const errors = state.errors.filter((e) => e.path === jsonPointer([field.id]));
    const common: CommonInputProps = {
      inputId,
      invalid: errors.length > 0,
      ...(errors.length > 0 ? { describedBy: errorId } : {}),
    };
    const onChange = (value: FieldValue | undefined) => {
      typed.current = true;
      setState((s) => setFieldValue(s, field.id, value));
    };
    return (
      <FieldFrame key={field.id} inputId={inputId} errorId={errorId} label={field.label} required={field.required === true || rules.required.has(field.id)} errors={errors}>
        {renderInput(registry, field, state.values[field.id], common, onChange)}
      </FieldFrame>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate data-yadad-form={view.id}>
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
      {view.sections.map((section) => (
        <Section key={section.id} id={section.id} {...(section.title !== undefined ? { title: section.title } : {})}>
          {section.items.map(renderItem)}
        </Section>
      ))}
      {formErrors.length > 0 && <ErrorSummary errors={formErrors} />}
      <Button label="Save" type="submit" variant="primary" disabled={saving} />
    </form>
  );
}
