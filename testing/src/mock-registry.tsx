import type {
  BooleanField,
  ButtonProps,
  DateField,
  DisplayProps,
  ErrorSummaryProps,
  Field,
  FieldFrameProps,
  InputProps,
  NumberField,
  Registry,
  SectionProps,
  SelectField,
  TableProps,
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
  layout: { FieldFrame: MockFieldFrame, Section: MockSection, Button: MockButton, Table: MockTable, ErrorSummary: MockErrorSummary },
};

/** Attributes every mock control shares. */
function controlProps<F extends Field, V>({ inputId, field, invalid, describedBy, labelledBy }: InputProps<F, V>) {
  return {
    id: inputId,
    "data-testid": `input-${field.id}`,
    "aria-invalid": invalid,
    "aria-describedby": describedBy,
    "aria-labelledby": labelledBy,
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

function MockSection({ id, title, children }: SectionProps<ReactNode>): ReactNode {
  return (
    <fieldset data-testid={`section-${id}`}>
      {title !== undefined && <legend>{title}</legend>}
      {children}
    </fieldset>
  );
}

function MockButton({ label, type, variant, disabled, onPress }: ButtonProps): ReactNode {
  return (
    <button type={type} data-variant={variant} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  );
}

const ariaSort = (sort: "asc" | "desc" | undefined) => (sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined);

function MockTable({ caption, columns, rows, onSort, empty }: TableProps<ReactNode>): ReactNode {
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.id} id={c.headerId} scope="col" aria-sort={ariaSort(c.sort)}>
              {c.sortable ? (
                <button type="button" onClick={() => onSort(c.id)}>
                  {c.label}
                </button>
              ) : (
                c.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              {row.cells.map((cell, i) => (
                <td key={columns[i]?.id ?? i}>{cell}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function MockErrorSummary({ id, errors }: ErrorSummaryProps): ReactNode {
  return (
    <div id={id} role="alert" data-testid="error-summary">
      <ul>
        {errors.map((e) => (
          <li key={`${e.path} ${e.code}`} data-path={e.path} data-code={e.code}>
            {e.message} {e.hint}
          </li>
        ))}
      </ul>
    </div>
  );
}
