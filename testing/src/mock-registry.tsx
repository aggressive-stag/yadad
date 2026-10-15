import type {
  BooleanField,
  ButtonProps,
  CalendarProps,
  CountWidgetProps,
  DateField,
  DisplayProps,
  FieldDisplayProps,
  FieldInputProps,
  ErrorSummaryProps,
  Field,
  FieldFrameProps,
  InputProps,
  NumberField,
  PanelProps,
  Registry,
  SectionProps,
  SelectField,
  TableProps,
  TabsProps,
  TextField,
} from "@yadad/core";
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";

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
    reference: { type: "reference", Input: MockReferenceInput, Display: MockReferenceDisplay },
  },
  layout: { FieldFrame: MockFieldFrame, Section: MockSection, Button: MockButton, Table: MockTable, ErrorSummary: MockErrorSummary, Tabs: MockTabs, Panel: MockPanel, Calendar: MockCalendar },
  widgets: { count: MockCount },
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

function MockReferenceInput(props: FieldInputProps<"reference">): ReactNode {
  const { options, value, valueLabel, onChange } = props;
  const listed = options.status === "ready" && options.options.some((o) => o.id === value);
  return (
    <>
      <select {...controlProps(props)} value={value ?? ""} disabled={options.status === "loading"} onChange={(e) => onChange(orUndefined(e.target.value))}>
        <option value="">{options.status === "loading" ? "Loading…" : "Choose…"}</option>
        {value !== undefined && !listed && <option value={value}>{valueLabel ?? value}</option>}
        {options.status === "ready" &&
          options.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
      </select>
      {options.status === "error" && <span data-testid={`options-error-${props.field.id}`}>Could not load choices: {options.message}</span>}
      {options.status === "ready" && options.options.length === 0 && <span data-testid={`options-empty-${props.field.id}`}>No records to choose from.</span>}
      {options.status === "ready" && options.more && <span data-testid={`options-more-${props.field.id}`}>More records exist than are listed.</span>}
    </>
  );
}

function MockReferenceDisplay({ field, label, status }: FieldDisplayProps<"reference">): ReactNode {
  return (
    <span data-testid={`display-${field.id}`} data-status={status}>
      {label}
    </span>
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

function MockTabs({ label, tabs, selected, onSelect, panel }: TabsProps<ReactNode>): ReactNode {
  const base = useId();
  const tabId = (id: string) => `${base}-tab-${id}`;
  /** Arrow keys, Home and End move selection and focus together (WAI-ARIA tabs, automatic activation). */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    document.getElementById(tabId(target.id))?.focus();
  };
  return (
    <div data-testid="tabs">
      <div role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={t.id === selected}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === selected ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={tabId(selected)} tabIndex={0}>
        {panel}
      </div>
    </div>
  );
}

function MockPanel({ title, children }: PanelProps<ReactNode>): ReactNode {
  return (
    <div data-testid="panel">
      {title !== undefined && <h3>{title}</h3>}
      {children}
    </div>
  );
}

function MockCount({ label, value, text }: CountWidgetProps): ReactNode {
  return (
    <div data-testid="count">
      <span>{label}</span> <strong>{text ?? value ?? "…"}</strong>
    </div>
  );
}

/**
 * A plain calendar: a grid of day cells named by their full date, entries as
 * buttons (or text), and a "Move to day…" control per movable entry. No drag
 * (that is the components repo's job); this is the path every user has.
 */
function MockCalendar({
  label,
  title,
  mode,
  modes,
  weekdays,
  days,
  legend,
  loading,
  notice,
  announcement,
  onModeChange,
  onPrevious,
  onNext,
  onToday,
  onOpenEntry,
  onMove,
}: CalendarProps<ReactNode>): ReactNode {
  const base = useId();
  const [moving, setMoving] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const noun = mode === "month" ? "month" : "week";
  const rows = Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const finish = (): void => {
    setMoving(undefined);
    queueMicrotask(() => returnFocus.current?.focus());
  };
  return (
    <section aria-label={label} aria-busy={loading} data-testid="calendar" data-mode={mode}>
      <h3 id={`${base}-title`}>{title}</h3>
      <div role="group" aria-label={`${label} navigation`}>
        <button type="button" aria-label={`Previous ${noun}`} onClick={onPrevious}>
          Previous
        </button>
        <button type="button" onClick={onToday}>
          Today
        </button>
        <button type="button" aria-label={`Next ${noun}`} onClick={onNext}>
          Next
        </button>
        {modes.length > 1 &&
          modes.map((m) => (
            <button key={m.mode} type="button" aria-pressed={m.mode === mode} onClick={() => onModeChange(m.mode)}>
              {m.label}
            </button>
          ))}
      </div>
      {notice !== undefined && <div data-testid="calendar-notice">{notice}</div>}
      <div role="status" aria-live="polite" data-testid="calendar-status">
        {announcement?.text}
      </div>
      {legend.length > 0 && (
        <ul aria-label="Colours" data-testid="calendar-legend">
          {legend.map((l) => (
            <li key={l.label} data-slot={l.slot}>
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <table role="grid" aria-labelledby={`${base}-title`}>
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th key={w.long} scope="col" abbr={w.long}>
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]?.date}>
              {row.map((day) => (
                <td key={day.date} role="gridcell" aria-label={day.label} aria-current={day.isToday ? "date" : undefined} data-date={day.date} data-in-month={day.inMonth}>
                  <span aria-hidden="true">{day.dayOfMonth}</span>
                  {day.isToday && <small> Today</small>}
                  <ul>
                    {day.entries.map((entry) => (
                      <li key={entry.id} data-testid={`entry-${entry.id}`} data-pending={entry.pending} data-slot={entry.color?.slot}>
                        {onOpenEntry ? (
                          <button type="button" aria-label={entry.label} onClick={() => onOpenEntry(entry.id)}>
                            {entry.content}
                          </button>
                        ) : (
                          <span aria-label={entry.label} role="group">
                            {entry.content}
                          </span>
                        )}
                        {onMove && entry.movable && (
                          <button
                            type="button"
                            aria-label={`Move to day… ${entry.label}`}
                            style={{ minWidth: 24, minHeight: 24 }}
                            onClick={(e) => {
                              returnFocus.current = e.currentTarget;
                              setTarget(day.date);
                              setMoving(entry.id);
                            }}
                          >
                            Move to day…
                          </button>
                        )}
                        {onMove && moving === entry.id && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (target !== "") onMove(entry.id, target);
                              finish();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") finish();
                            }}
                          >
                            <label>
                              {`Move ${entry.label} to`}
                              <input type="date" autoFocus value={target} onChange={(e) => setTarget(e.target.value)} />
                            </label>
                            <button type="submit">Move</button>
                            <button type="button" onClick={finish}>
                              Cancel
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
