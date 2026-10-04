import type {
  BooleanField,
  DateField,
  DisplayProps,
  Field,
  FieldFrameProps,
  InputProps,
  NumberField,
  Registry,
  SelectField,
  TextField,
} from "@yadad/core";
import type { ReactNode } from "react";

/**
 * Unstyled stub components with data-testid hooks, one per field type.
 * Engine tests and the showcase use these instead of real components, so
 * engine CI never needs the components repo.
 */
export const mockRegistry: Registry<ReactNode> = {
  fields: {
    text: { type: "text", Input: MockTextInput, Display: MockDisplay },
    number: { type: "number", Input: MockNumberInput, Display: MockDisplay },
    boolean: { type: "boolean", Input: MockBooleanInput, Display: MockDisplay },
    select: { type: "select", Input: MockSelectInput, Display: MockDisplay },
    date: { type: "date", Input: MockDateInput, Display: MockDisplay },
  },
  layout: { FieldFrame: MockFieldFrame },
};

/** Attributes every mock control shares. */
function controlProps<F extends Field, V>({ inputId, field, invalid, describedBy }: InputProps<F, V>) {
  return {
    id: inputId,
    "data-testid": `input-${field.id}`,
    "aria-invalid": invalid,
    "aria-describedby": describedBy,
    "aria-required": field.required === true,
  };
}

/** Text-like controls store "" as no value. */
const orUndefined = (s: string): string | undefined => (s === "" ? undefined : s);

function MockTextInput(props: InputProps<TextField, string>): ReactNode {
  return <input {...controlProps(props)} type="text" value={props.value ?? ""} onChange={(e) => props.onChange(orUndefined(e.target.value))} />;
}

function MockNumberInput(props: InputProps<NumberField, number>): ReactNode {
  const { field, value, onChange } = props;
  return (
    <input
      {...controlProps(props)}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step ?? "any"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

function MockBooleanInput(props: InputProps<BooleanField, boolean>): ReactNode {
  return <input {...controlProps(props)} type="checkbox" checked={props.value === true} onChange={(e) => props.onChange(e.target.checked)} />;
}

function MockSelectInput(props: InputProps<SelectField, string>): ReactNode {
  return (
    <select {...controlProps(props)} value={props.value ?? ""} onChange={(e) => props.onChange(orUndefined(e.target.value))}>
      <option value="">Choose…</option>
      {props.field.options.values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function MockDateInput(props: InputProps<DateField, string>): ReactNode {
  const { field, value, onChange } = props;
  return (
    <input {...controlProps(props)} type="date" min={field.min} max={field.max} value={value ?? ""} onChange={(e) => onChange(orUndefined(e.target.value))} />
  );
}

function MockDisplay({ field, value }: DisplayProps<Field, string | number | boolean>): ReactNode {
  const text = value === undefined ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return <span data-testid={`display-${field.id}`}>{text}</span>;
}

function MockFieldFrame({ inputId, errorId, label, required, errors, children }: FieldFrameProps<ReactNode>): ReactNode {
  return (
    <div data-testid="field-frame">
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {errors.length > 0 && (
        <div id={errorId} role="alert">
          {errors.map((e) => (
            <p key={`${e.path} ${e.code}`} data-testid="field-error" data-code={e.code}>
              {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
