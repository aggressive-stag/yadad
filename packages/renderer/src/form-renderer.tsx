import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, EntityDocument, FieldValue, FormItem, FormView, Registry } from "@yadad/core";
import { emptyFormState, setFieldValue, submitForm } from "@yadad/runtime";
import type { FormState } from "@yadad/runtime";
import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { checkViewSetup, ErrorList } from "./errors";
import { renderInput } from "./fields";
import type { CommonInputProps } from "./fields";

export interface FormRendererProps {
  readonly entity: EntityDocument;
  readonly view: FormView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly onSaved?: (record: DataRecord) => void;
}

/**
 * Renders a form view for its entity. Every visible piece (sections, fields,
 * the Save button) comes from the injected registry; saving goes through
 * runtime and the data adapter.
 */
export function FormRenderer({ entity, view, registry, dataSources, onSaved }: FormRendererProps): ReactNode {
  const formId = useId();
  const [state, setState] = useState<FormState>(emptyFormState);
  const [saving, setSaving] = useState(false);

  const adapter = dataSources.get(view.dataSource);
  const refs = view.sections.flatMap((section, i) =>
    section.items.map((item, j) => ({ field: item.field, path: ["sections", i, "items", j, "field"] })),
  );
  const setupErrors = checkViewSetup(entity, view, adapter, refs);
  if (setupErrors.length > 0) return <ErrorList errors={setupErrors} />;

  const { FieldFrame, Section, Button } = registry.layout;
  const fieldPaths = new Set(entity.fields.map((f) => jsonPointer([f.id])));
  const formErrors = state.errors.filter((e) => !fieldPaths.has(e.path));

  async function save(): Promise<void> {
    if (!adapter || saving) return;
    setSaving(true);
    const result = await submitForm(entity, state.values, adapter);
    setSaving(false);
    if (result.ok) {
      setState(emptyFormState);
      onSaved?.(result.record);
    } else {
      setState((s) => ({ ...s, errors: result.errors }));
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void save();
  };

  const renderItem = (item: FormItem): ReactNode => {
    const field = entity.fields.find((f) => f.id === item.field);
    if (!field) return null; // reported by checkViewSetup
    const inputId = `${formId}-${field.id}`;
    const errorId = `${inputId}-errors`;
    const errors = state.errors.filter((e) => e.path === jsonPointer([field.id]));
    const common: CommonInputProps = {
      inputId,
      invalid: errors.length > 0,
      ...(errors.length > 0 ? { describedBy: errorId } : {}),
    };
    const onChange = (value: FieldValue | undefined) => setState((s) => setFieldValue(s, field.id, value));
    return (
      <FieldFrame key={field.id} inputId={inputId} errorId={errorId} label={field.label} required={field.required === true} errors={errors}>
        {renderInput(registry, field, state.values[field.id], common, onChange)}
      </FieldFrame>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate data-yadad-form={view.id}>
      {view.sections.map((section) => (
        <Section key={section.id} id={section.id} {...(section.title !== undefined ? { title: section.title } : {})}>
          {section.items.map(renderItem)}
        </Section>
      ))}
      {formErrors.length > 0 && <ErrorList errors={formErrors} />}
      <Button label="Save" type="submit" variant="primary" disabled={saving} />
    </form>
  );
}
