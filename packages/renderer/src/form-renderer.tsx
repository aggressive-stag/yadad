import { jsonPointer } from "@yadad/core";
import type { DataAdapter, DataRecord, DocumentError, EntityDocument, Field, FieldValue, FormItem, FormView, Registry } from "@yadad/core";
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
    const { FieldFrame } = registry.layout;
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
      <FieldFrame
        key={field.id}
        inputId={inputId}
        errorId={errorId}
        label={field.label}
        required={field.required === true}
        errors={errors}
      >
        {renderInput(registry, field, state.values[field.id], common, onChange)}
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

interface CommonInputProps {
  readonly inputId: string;
  readonly invalid: boolean;
  readonly describedBy?: string;
}

const asString = (v: FieldValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Looks up the field's registry entry by type. The switch narrows the field
 * and its stored value together, so every entry gets exactly its own props.
 */
function renderInput(
  registry: Registry<ReactNode>,
  field: Field,
  value: FieldValue | undefined,
  common: CommonInputProps,
  onChange: (value: FieldValue | undefined) => void,
): ReactNode {
  switch (field.type) {
    case "text": {
      const { Input } = registry.fields.text;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
    case "number": {
      const { Input } = registry.fields.number;
      return <Input {...common} field={field} value={typeof value === "number" ? value : undefined} onChange={onChange} />;
    }
    case "boolean": {
      const { Input } = registry.fields.boolean;
      return <Input {...common} field={field} value={typeof value === "boolean" ? value : undefined} onChange={onChange} />;
    }
    case "select": {
      const { Input } = registry.fields.select;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
    case "date": {
      const { Input } = registry.fields.date;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
  }
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
