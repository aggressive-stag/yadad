import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, FormItem, FormView, Registry } from "@yadad/core";
import { emptyFormState, setFieldValue, submitForm } from "@yadad/runtime";
import type { FormState } from "@yadad/runtime";
import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";

export interface FormRendererProps {
  readonly entity: EntityDocument;
  readonly view: FormView;
  readonly registry: Registry<ReactNode>;
  /** Host-provided adapters, looked up by the view's `dataSource` key. */
  readonly dataSources: ReadonlyMap<string, DataAdapter>;
  readonly onSaved?: (record: DataRecord) => void;
}

/**
 * Renders a form view for its entity. Components come only from the
 * injected registry; saving goes through runtime and the data adapter.
 * Pre-contract: sections render as plain fieldsets until the registry
 * gains a Section layout component.
 */
export function FormRenderer({ entity, view, registry, dataSources, onSaved }: FormRendererProps): ReactNode {
  const formId = useId();
  const [state, setState] = useState<FormState>(emptyFormState);
  const [saving, setSaving] = useState(false);

  const adapter = dataSources.get(view.dataSource);
  const setupErrors = checkSetup(entity, view, adapter);
  if (setupErrors.length > 0) return <ErrorList errors={setupErrors} />;

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
    if (!field) return null; // reported by checkSetup
    const { Input } = registry.fields[field.type];
    const { FieldFrame } = registry.layout;
    const inputId = `${formId}-${field.id}`;
    const errors = state.errors.filter((e) => e.path === jsonPointer([field.id]));
    return (
      <FieldFrame key={field.id} inputId={inputId} label={field.label} required={field.required === true} errors={errors}>
        <Input
          inputId={inputId}
          field={field}
          value={state.values[field.id] ?? undefined}
          onChange={(value) => setState((s) => setFieldValue(s, field.id, value))}
          invalid={errors.length > 0}
        />
      </FieldFrame>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate data-yadad-form={view.id}>
      {view.sections.map((section) => (
        <fieldset key={section.id} data-yadad-section={section.id}>
          {section.title !== undefined && <legend>{section.title}</legend>}
          {section.items.map(renderItem)}
        </fieldset>
      ))}
      {formErrors.length > 0 && <ErrorList errors={formErrors} />}
      <button type="submit" disabled={saving}>
        Save
      </button>
    </form>
  );
}

/** Problems that stop the view from rendering at all, in the core error format. */
function checkSetup(entity: EntityDocument, view: FormView, adapter: DataAdapter | undefined): DocumentError[] {
  const errors: DocumentError[] = [];
  if (view.entity !== entity.id) {
    errors.push({
      path: "/entity",
      code: "invalid-value",
      message: `Form "${view.id}" is for entity "${view.entity}", but was given "${entity.id}".`,
      hint: "Pass the entity document the view names.",
    });
  }
  if (!adapter) {
    errors.push({
      path: "/dataSource",
      code: "invalid-value",
      message: `No data source "${view.dataSource}" was provided.`,
      hint: `Add "${view.dataSource}" to the dataSources the host passes in.`,
    });
  }
  view.sections.forEach((section, i) =>
    section.items.forEach((item, j) => {
      if (!entity.fields.some((f) => f.id === item.field)) {
        errors.push({
          path: jsonPointer(["sections", i, "items", j, "field"]),
          code: "invalid-value",
          message: `Field "${item.field}" does not exist on entity "${entity.id}".`,
          hint: `Use one of: ${entity.fields.map((f) => f.id).join(", ")}.`,
        });
      }
    }),
  );
  return errors;
}

function ErrorList({ errors }: { readonly errors: readonly DocumentError[] }): ReactNode {
  return (
    <ul role="alert" data-yadad-errors="">
      {errors.map((e) => (
        <li key={`${e.path} ${e.code}`} data-path={e.path} data-code={e.code}>
          {e.message} {e.hint}
        </li>
      ))}
    </ul>
  );
}
