import type {
  BoardProps,
  BooleanField,
  ButtonProps,
  CalendarProps,
  CountWidgetProps,
  DateField, DatetimeField,
  DialogProps,
  DiffSegment,
  DisplayProps,
  FieldDisplayProps,
  FieldInputProps,
  ErrorSummaryProps,
  Field,
  FieldFrameProps,
  InputProps,
  NumberField,
  PagerProps,
  PanelProps,
  RecordActionItem,
  Registry,
  SectionProps,
  SelectField,
  SeriesWidgetProps,
  TagsField,
  TimeField,
  TableProps,
  TabsProps,
} from "@yadad/core";
import { optionColor, optionLabel, optionValue } from "@yadad/core"; // RFC 0008: card 47a
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Unstyled stub components with data-testid hooks, one per field type.
 * Engine tests and the showcase use these instead of real components, so
 * engine CI never needs the components repo.
 */
export const mockRegistry: Registry<ReactNode> = {
  fields: {
    text: { type: "text", Input: MockTextInput, Display: MockTextDisplay },
    number: { type: "number", Input: MockNumberInput, Display: MockDisplay },
    boolean: { type: "boolean", Input: MockBooleanInput, Display: MockDisplay },
    select: { type: "select", Input: MockSelectInput, Display: MockDisplay },
    date: { type: "date", Input: MockDateInput, Display: MockDisplay },
    datetime: { type: "datetime", Input: MockDatetimeInput, Display: MockDatetimeDisplay },
    reference: { type: "reference", Input: MockReferenceInput, Display: MockReferenceDisplay },
    time: { type: "time", Input: MockTimeInput, Display: MockDisplay }, // RFC 0008: card 47k
    tags: { type: "tags", Input: MockTagsInput, Display: MockTagsDisplay }, // RFC 0008: card 47k
  },
  layout: { FieldFrame: MockFieldFrame, Section: MockSection, Button: MockButton, Table: MockTable, ErrorSummary: MockErrorSummary, Tabs: MockTabs, Panel: MockPanel, Calendar: MockCalendar, Board: MockBoard, Dialog: MockDialog, Pager: MockPager },
  widgets: { count: MockCount, series: MockSeries },
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

function MockTextInput(props: FieldInputProps<"text">): ReactNode {
  return <input {...controlProps(props)} type="text" maxLength={props.field.maxLength} {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})} value={props.value ?? ""} onChange={(e) => props.onChange(orUndefined(e.target.value))} />;
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
      {props.field.options.values.map((o) => (
        <option key={optionValue(o)} value={optionValue(o)} {...(optionColor(o) === undefined ? {} : { "data-color": optionColor(o) })}>
          {optionLabel(o)}
        </option>
      ))} /* RFC 0008: cards 47a/47e */
    </select>
  );
}

function MockDateInput(props: InputProps<DateField, string>): ReactNode {
  const { field, value, onChange } = props;
  return (
    <input {...controlProps(props)} type="date" min={field.min} max={field.max} value={value ?? ""} onChange={(e) => onChange(orUndefined(e.target.value))} />
  );
}

function MockTimeInput(props: InputProps<TimeField, string>): ReactNode {
  const { field, value, onChange } = props;
  return <input {...controlProps(props)} type="time" min={field.min} max={field.max} step={field.step !== undefined ? field.step * 60 : undefined} value={value ?? ""} onChange={(e) => onChange(orUndefined(e.target.value))} />;
}

function MockTagsInput(props: InputProps<TagsField, readonly string[]>): ReactNode {
  const { value, onChange } = props;
  return <input {...controlProps(props)} type="text" value={(value ?? []).join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((t) => t.trim()).filter((t) => t !== ""))} />;
}

function MockTagsDisplay(props: DisplayProps<TagsField, readonly string[]>): ReactNode {
  return <span data-testid={`display-${props.field.id}`}>{(props.value ?? []).join(", ")}</span>;
}

/** RFC 0007: the stored instant in the input the browser provides for a date and time; a real component converts to and from the viewer's zone. */
function MockDatetimeInput(props: InputProps<DatetimeField, string>): ReactNode {
  const { value, onChange } = props;
  return <input {...controlProps(props)} type="datetime-local" value={value ?? ""} onChange={(e) => onChange(orUndefined(e.target.value))} />;
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

function MockReferenceDisplay({ field, label, status, color }: FieldDisplayProps<"reference">): ReactNode {
  return (
    <span data-testid={`display-${field.id}`} data-status={status} {...(color === undefined ? {} : { "data-color": color })}>
      {label}
    </span>
  );
}

function MockDisplay({ field, value }: DisplayProps<Field, string | number | boolean>): ReactNode {
  const text = value === undefined ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return <span data-testid={`display-${field.id}`}>{text}</span>;
}

/** RFC 0007: the `<time>` element carries the stored instant in dateTime and the renderer's formatted text as its content (fallback: the raw instant). */
function MockDatetimeDisplay({ field, value, text }: FieldDisplayProps<"datetime">): ReactNode {
  if (value === undefined) return <span data-testid={`display-${field.id}`} />;
  return (
    <time data-testid={`display-${field.id}`} dateTime={value}>
      {text ?? value}
    </time>
  );
}

/** The text Display. With `diff` (a `compare` column) it marks additions and removals without relying on colour. */
function MockTextDisplay({ field, value, diff }: FieldDisplayProps<"text">): ReactNode {
  const text = value ?? "";
  if (diff === undefined) return <span data-testid={`display-${field.id}`}>{text}</span>;
  return (
    <span data-testid={`display-${field.id}`}>
      {diff.map((segment, i) => (
        <MockDiffSegment key={i} segment={segment} />
      ))}
    </span>
  );
}

function MockDiffSegment({ segment }: { segment: DiffSegment }): ReactNode {
  if (segment.kind === "added") {
    return (
      <ins>
        <span className="sr-only" data-testid="diff-added-label">
          {"added: "}
        </span>
        {segment.text}
      </ins>
    );
  }
  if (segment.kind === "removed") {
    return (
      <del>
        <span className="sr-only" data-testid="diff-removed-label">
          {"removed: "}
        </span>
        {segment.text}
      </del>
    );
  }
  return <>{segment.text}</>;
}

/**
 * RFC 0007: the one modal the renderer opens (a confirm, or an action with an
 * input). The renderer builds the children; this provides the modal behaviour:
 * focus moves in on open, Escape and the close control call onClose, and focus
 * returns to the opener on close.
 */
function MockDialog({ label, onClose, children }: DialogProps<ReactNode>): ReactNode {
  // Captured during render: by the time effects run, focus has already moved into the dialog.
  const [opener] = useState<HTMLElement | null>(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    return () => opener?.focus();
  }, [opener]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="dialog"
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button type="button" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {children}
    </div>
  );
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

function MockDoneCheck({ done, label }: { readonly done: { readonly checked: boolean; readonly disabled: boolean; readonly toggle: () => void }; readonly label: string }): ReactNode {
  // The shape the real component set draws: a label wrapping a native checkbox, named "Done: <entry label>".
  return (
    <label>
      <input type="checkbox" aria-label={`Done: ${label}`} checked={done.checked} disabled={done.disabled} onChange={() => done.toggle()} />
      <span aria-hidden="true">Done</span>
    </label>
  );
}

function MockPager({ label, hasPrevious, hasNext, page, pageCount, onPrevious, onNext }: PagerProps): ReactNode {
  return (
    <nav aria-label={label} data-testid="mock-pager" data-yadad-pager="">
      <button type="button" disabled={!hasPrevious} onClick={onPrevious}>
        Previous
      </button>
      <span>{pageCount === undefined ? `Page ${page}` : `Page ${page} of ${pageCount}`}</span>
      <button type="button" disabled={!hasNext} onClick={onNext}>
        Next
      </button>
    </nav>
  );
}

function MockButton({ label, type, variant, disabled, tone, pressed, onPress }: ButtonProps): ReactNode {
  return (
    <button type={type} data-variant={variant} {...(tone !== undefined ? { "data-tone": tone } : {})} {...(pressed !== undefined ? { "aria-pressed": pressed } : {})} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  );
}

const ariaSort = (sort: "asc" | "desc" | undefined) => (sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined);

/** RFC 0007: one button per available action, named by its label, disabled while that record has an action in flight. */
function MockActionButtons({ actions }: { actions: readonly RecordActionItem[] }): ReactNode {
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-testid={`action-${action.id}`}
          data-tone={action.tone}
          data-pending={action.pending}
          disabled={action.pending}
          onClick={action.onPress}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

function MockTable({ caption, columns, rows, onSort, empty, actionsLabel }: TableProps<ReactNode>): ReactNode {
  const withActions = actionsLabel !== undefined && rows.some((row) => row.actions !== undefined && row.actions.length > 0);
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
          {withActions && <th scope="col">{actionsLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + (withActions ? 1 : 0)}>{empty}</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              {row.cells.map((cell, i) => (
                <td key={columns[i]?.id ?? i}>{cell}</td>
              ))}
              {withActions && (
                <td data-testid={`row-actions-${row.id}`}>
                  {row.actions !== undefined && row.actions.length > 0 && <MockActionButtons actions={row.actions} />}
                </td>
              )}
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
 * A series widget as a plain table: one row per group with its label and its
 * formatted value, plus notes for skipped records and a partial read. The
 * contract wants every group in the accessible tree, so this puts them there
 * as text; the drawing (bars, lines) is the components repo's job.
 */
function MockSeries({ label, display, groups, skipped, partial, loading, error, measureLabel }: SeriesWidgetProps): ReactNode {
  return (
    <div data-testid="series" data-display={display} role="group" aria-label={label}>
      <span data-testid="series-label">{label}</span>
      {loading ? (
        <span data-testid="series-loading">loading…</span>
      ) : error !== undefined ? (
        <span data-testid="series-error">{error}</span>
      ) : (
        <table data-testid="series-table" aria-label={`${label}, ${measureLabel}`}>
          <thead>
            <tr>
              <th>Group</th>
              <th>{measureLabel}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} data-testid={`series-group-${g.key}`}>
                <td>{g.label}</td>
                <td>{g.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {skipped > 0 && <span data-testid="series-skipped">{skipped} records without a group</span>}
      {partial !== undefined && (
        <span data-testid="series-partial">
          {partial.read} of {partial.total} records
        </span>
      )}
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
  // RFC 0008 item 7: days whose "+N more" was pressed show all their entries.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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
                    {(day.overflow === undefined || expanded.has(day.date) ? day.entries : day.entries.slice(0, day.overflow.shown)).map((entry) => (
                      <li key={entry.id} data-testid={`entry-${entry.id}`} data-pending={entry.pending} data-slot={entry.color?.slot} {...(entry.color?.color === undefined ? {} : { "data-color": entry.color.color })}>
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
                        {entry.done !== undefined && <MockDoneCheck done={entry.done} label={entry.label} />}
                        {entry.actions !== undefined && entry.actions.length > 0 && <MockActionButtons actions={entry.actions} />}
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
                    {day.overflow !== undefined && !expanded.has(day.date) && (
                      <li>
                        <button type="button" onClick={() => setExpanded((s) => new Set(s).add(day.date))}>
                          {`+${day.overflow.hidden} more`}
                        </button>
                      </li>
                    )}
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

/**
 * A plain board: columns as labelled regions with headings, cards as list
 * items, a group-by select and a "Move to…" control per movable card. No drag
 * (that is the components repo's job); this is the path every user has.
 */
function MockBoard({
  label,
  groupChoices,
  groupField,
  columns,
  hiddenColumns,
  loading,
  notice,
  announcement,
  onGroupBy,
  onOpenCard,
  onMove,
}: BoardProps<ReactNode>): ReactNode {
  const base = useId();
  const [moving, setMoving] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  // The card that was just moved: its node is rebuilt in the new column, so focus is put back on its "Move to…" action.
  const movedCard = useRef<string | undefined>(undefined);
  const finish = (): void => {
    setMoving(undefined);
    queueMicrotask(() => returnFocus.current?.focus());
  };
  useEffect(() => {
    if (movedCard.current === undefined) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    document.querySelector<HTMLElement>(`[data-testid="card-${movedCard.current}"] button[aria-label^="Move to…"]`)?.focus();
  });
  return (
    <section
      role="group"
      aria-label={label}
      aria-busy={loading}
      data-testid="board"
      data-group-field={groupField}
      onKeyDownCapture={() => (movedCard.current = undefined)}
      onPointerDownCapture={() => (movedCard.current = undefined)}
    >
      <h3 id={`${base}-title`}>{label}</h3>
      {groupChoices.length > 1 && (
        <div role="group" aria-label="Group by">
          <label htmlFor={`${base}-group`}>Group by</label>{" "}
          <select id={`${base}-group`} value={groupField} onChange={(e) => onGroupBy(e.target.value)}>
            {groupChoices.map((choice) => (
              <option key={choice.field} value={choice.field}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {notice !== undefined && <div data-testid="board-notice">{notice}</div>}
      <div role="status" aria-live="polite" data-testid="board-status">
        {announcement?.text}
      </div>
      <div data-testid="board-columns">
        {columns.map((column) => (
          <div key={column.id} role="group" aria-label={`${column.label}, ${column.count} cards`} data-testid={`column-${column.id}`} data-droppable={column.droppable} data-count={column.count} {...(column.color === undefined ? {} : { "data-color": column.color })}>
            <h4>
              {column.label} ({column.count})
            </h4>
            <ul data-testid={`cards-${column.id}`}>
              {column.cards.map((card) => (
                <li key={card.id} data-testid={`card-${card.id}`} data-pending={card.pending}>
                  {onOpenCard ? (
                    <button type="button" aria-label={card.label} onClick={() => onOpenCard(card.id)}>
                      {card.content}
                    </button>
                  ) : (
                    <span aria-label={card.label} role="group">
                      {card.content}
                    </span>
                  )}
                  {onMove && card.movable && (
                    <button
                      type="button"
                      aria-label={`Move to… ${card.label}`}
                      style={{ minWidth: 24, minHeight: 24 }}
                      onClick={(e) => {
                        returnFocus.current = e.currentTarget;
                        setTarget("");
                        setMoving(card.id);
                      }}
                    >
                      Move to…
                    </button>
                  )}
                  {card.done !== undefined && <MockDoneCheck done={card.done} label={card.label} />}
                  {card.actions !== undefined && card.actions.length > 0 && <MockActionButtons actions={card.actions} />}
                  {onMove && moving === card.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (target !== "") onMove(card.id, target);
                        movedCard.current = card.id;
                        finish();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") finish();
                      }}
                    >
                      <label>
                        {`Move ${card.label} to`}
                        <select autoFocus value={target} onChange={(e) => setTarget(e.target.value)}>
                          <option value="" disabled>
                            Choose a column
                          </option>
                          {[...columns, ...(hiddenColumns ?? [])]
                            .filter((c) => c.droppable && c.id !== currentColumnId(columns, card.id))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                        </select>
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
          </div>
        ))}
      </div>
    </section>
  );
}

/** The id of the column that contains the card (its "current column"). */
function currentColumnId(columns: readonly { readonly id: string; readonly cards: readonly { readonly id: string }[] }[], cardId: string): string {
  return columns.find((column) => column.cards.some((card) => card.id === cardId))?.id ?? "";
}
