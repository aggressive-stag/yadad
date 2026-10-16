// PRE-CONTRACT registry shape: one entry per field type plus layout chrome
// (FieldFrame, Section, Button, Table, ErrorSummary, Tabs, Panel) and widgets.
// CellEditor and optionsSchema come later.

import type { BooleanField, CalendarMode, DateField, Field, FieldType, NumberField, ReferenceField, SelectField, TextField } from "./document.js";
import type { DocumentError } from "./errors.js";

/**
 * A UI component, kept structural so core needs no React. `N` is the UI
 * library's node type: the renderer uses Registry<ReactNode>, which makes
 * every entry a React function component with no casts.
 */
export type Component<P, N> = (props: P) => N;

/** Field value types by field type. */
export interface FieldValueTypes {
  readonly text: string;
  readonly number: number;
  readonly boolean: boolean;
  readonly select: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** The target record's id. */
  readonly reference: string;
}

/** The field definition type for each field type. */
export interface FieldDefinitions {
  readonly text: TextField;
  readonly number: NumberField;
  readonly boolean: BooleanField;
  readonly select: SelectField;
  readonly date: DateField;
  readonly reference: ReferenceField;
}

export interface InputProps<F extends Field, V> {
  /** DOM id for the control, so FieldFrame can point its label at it. */
  readonly inputId: string;
  readonly field: F;
  /** undefined = no value yet. */
  readonly value: V | undefined;
  readonly onChange: (value: V | undefined) => void;
  readonly invalid: boolean;
  /** Id of the element holding this field's errors, for aria-describedby. Set only while there are errors. */
  readonly describedBy?: string;
  /** Id(s) of the element naming this control (aria-labelledby), when it has no label of its own, e.g. a table column header. */
  readonly labelledBy?: string;
}

export interface DisplayProps<F extends Field, V> {
  readonly field: F;
  readonly value: V | undefined;
}

/** One record a reference picker offers: its id (the stored value) and the text that labels it. */
export interface ReferenceOption {
  readonly id: string;
  readonly label: string;
}

/**
 * What the renderer knows about the options of a reference picker. The renderer
 * loads them from the target entity's data source; the component only shows
 * them. `more` is true when the target has more records than `options` holds.
 */
export type ReferenceOptions =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly options: readonly ReferenceOption[]; readonly more: boolean };

/** Props a reference Input gets besides the common ones. */
export interface ReferenceInputExtras {
  readonly options: ReferenceOptions;
  /**
   * The label of the current value, when the renderer could resolve it. The
   * value may be missing from `options` (beyond the cap, or deleted), so the
   * Input must still show it.
   */
  readonly valueLabel?: string;
}

/**
 * Props a reference Display gets besides the common ones. `label` is the text
 * to show: the referenced record's label, its raw id while loading or when
 * the lookup failed ("error"), or "Unknown" when the record no longer exists.
 */
export interface ReferenceDisplayExtras {
  readonly label: string;
  readonly status: "loading" | "found" | "missing" | "error";
}

/** Extra Input props per field type; only reference has any. */
export interface FieldInputExtras {
  readonly text: Record<never, never>;
  readonly number: Record<never, never>;
  readonly boolean: Record<never, never>;
  readonly select: Record<never, never>;
  readonly date: Record<never, never>;
  readonly reference: ReferenceInputExtras;
}

/** Extra Display props per field type; only reference has any. */
export interface FieldDisplayExtras {
  readonly text: Record<never, never>;
  readonly number: Record<never, never>;
  readonly boolean: Record<never, never>;
  readonly select: Record<never, never>;
  readonly date: Record<never, never>;
  readonly reference: ReferenceDisplayExtras;
}

export type FieldInputProps<K extends FieldType> = InputProps<FieldDefinitions[K], FieldValueTypes[K]> & FieldInputExtras[K];
export type FieldDisplayProps<K extends FieldType> = DisplayProps<FieldDefinitions[K], FieldValueTypes[K]> & FieldDisplayExtras[K];

export interface FieldTypeEntry<K extends FieldType, N> {
  readonly type: K;
  readonly Input: Component<FieldInputProps<K>, N>;
  readonly Display: Component<FieldDisplayProps<K>, N>;
}

/** Label, help and error chrome around every Input. */
export interface FieldFrameProps<N> {
  readonly inputId: string;
  /** Id to put on the errors element; the Input points aria-describedby at it. */
  readonly errorId: string;
  readonly label: string;
  readonly required: boolean;
  readonly errors: readonly DocumentError[];
  readonly children: N;
}

/** A titled group of fields, e.g. a form section. */
export interface SectionProps<N> {
  readonly id: string;
  readonly title?: string;
  readonly children: N;
}

export interface ButtonProps {
  readonly label: string;
  /** "submit" submits the surrounding form; "button" only calls onPress. */
  readonly type: "submit" | "button";
  readonly variant: "primary" | "secondary";
  readonly disabled: boolean;
  readonly onPress?: () => void;
}

export interface TableColumnHeader {
  readonly id: string;
  /** DOM id for the header cell, so inline editors can be labelled by it. */
  readonly headerId: string;
  readonly label: string;
  readonly sortable: boolean;
  /** Set on the column currently sorting the table. */
  readonly sort?: "asc" | "desc";
}

export interface TableRow<N> {
  readonly id: string;
  /** One cell per column, in column order. */
  readonly cells: readonly N[];
}

export interface TableProps<N> {
  /** Accessible name for the table. */
  readonly caption: string;
  readonly columns: readonly TableColumnHeader[];
  readonly rows: readonly TableRow<N>[];
  /** Called with a sortable column's id when the viewer asks to sort by it. */
  readonly onSort: (columnId: string) => void;
  /** Shown instead of rows when there are none. */
  readonly empty: N;
}

/** A list of problems, e.g. a failed save or a view that cannot render. Announced to screen readers. */
export interface ErrorSummaryProps {
  /** DOM id, so inputs can point aria-describedby at it. */
  readonly id?: string;
  readonly errors: readonly DocumentError[];
}

export interface TabsProps<N> {
  /** Accessible name for the tab list. */
  readonly label: string;
  readonly tabs: readonly { readonly id: string; readonly title: string }[];
  readonly selected: string;
  readonly onSelect: (tabId: string) => void;
  /** The selected tab's content. */
  readonly panel: N;
}

/** A card holding one dashboard widget. */
export interface PanelProps<N> {
  readonly title?: string;
  readonly children: N;
}

export interface CountWidgetProps {
  readonly label: string;
  /** undefined while loading, or when a stat has no value (see `text`). */
  readonly value: number | undefined;
  /**
   * Set by `stat` widgets: the number already formatted for display (locale
   * grouping, at most two decimals), or "\u2014" when there is nothing to
   * show. Show it instead of `value` when present; a component that ignores it
   * still shows `value`. Counts never set it.
   */
  readonly text?: string;
}

/** Widget components by widget type; "view" widgets render through the renderer itself. */
export interface WidgetComponents<N> {
  readonly count: Component<CountWidgetProps, N>;
}

/** One entry (a record) on a calendar day (RFC 0004). */
export interface CalendarEntry<N> {
  /** The record id. */
  readonly id: string;
  /** Title and detail fields, built by the renderer. */
  readonly content: N;
  /** Plain-text accessible name: title, details and the colour text. */
  readonly label: string;
  /** A colour slot from 0 to 7 and its text; the component maps slots to its own colours. Colour is never the only signal. */
  readonly color?: { readonly slot: number; readonly label: string };
  /** The calendar is editable and no move of this entry is in flight. */
  readonly movable: boolean;
  /** A move of this entry is in flight. */
  readonly pending: boolean;
}

export interface CalendarDayProps<N> {
  /** "YYYY-MM-DD" */
  readonly date: string;
  readonly dayOfMonth: number;
  /** 0 = Sunday */
  readonly weekday: number;
  /** Long form for accessible names, e.g. "Thursday 15 October 2026". */
  readonly label: string;
  /** Always true in week mode. */
  readonly inMonth: boolean;
  readonly isToday: boolean;
  /** All of the day's entries, in sort order. */
  readonly entries: readonly CalendarEntry<N>[];
}

/**
 * A month or week of days with entries. The renderer owns data, range,
 * optimistic state and announcements; the component owns drawing and every
 * drag (RFC 0004). `layout.Calendar` is optional in this version: a registry
 * without it cannot show a calendar view, and the renderer says so.
 */
export interface CalendarProps<N> {
  /** Accessible name of the whole calendar (the view's title). */
  readonly label: string;
  /** The period heading, e.g. "October 2026". */
  readonly title: string;
  readonly mode: CalendarMode;
  /** The modes the viewer can switch between; one entry means no switcher. */
  readonly modes: readonly { readonly mode: CalendarMode; readonly label: string }[];
  /** Seven, in weekStartsOn order. */
  readonly weekdays: readonly { readonly short: string; readonly long: string }[];
  /** 42 (month) or 7 (week), in order, in rows of 7. */
  readonly days: readonly CalendarDayProps<N>[];
  /** Colour slots present in the range, with their texts. */
  readonly legend: readonly { readonly slot: number; readonly label: string }[];
  /** Entries are being fetched; days are still given. */
  readonly loading: boolean;
  /** E.g. the over-cap message; shown above the grid and announced politely. */
  readonly notice?: N;
  /** For the component's live region; `seq` increases on every message so a repeated text is announced again. */
  readonly announcement?: { readonly seq: number; readonly text: string };
  readonly onModeChange: (mode: CalendarMode) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
  /** Set only when the view has a rowAction. */
  readonly onOpenEntry?: (recordId: string) => void;
  /** Set only when the view is editable. Accepts any real "YYYY-MM-DD", not only visible days. */
  readonly onMove?: (recordId: string, date: string) => void;
}

/** One card on a board column (RFC 0005). */
export interface BoardCard<N> {
  /** The record id. */
  readonly id: string;
  /** Title and card fields, built by the renderer. */
  readonly content: N;
  /** Plain-text accessible name: title and card field values. */
  readonly label: string;
  /** The board is editable and no move of this card is in flight. */
  readonly movable: boolean;
  /** A move of this card is in flight. */
  readonly pending: boolean;
}

/** One column of a board: all records sharing one value of the grouping field. */
export interface BoardColumn<N> {
  /** The grouping field's raw value for this column (a select or boolean value, or a reference's target id). */
  readonly value: string | boolean;
  /** Accessible heading for the column. */
  readonly label: string;
  readonly cards: readonly BoardCard<N>[];
}

/** One field the viewer can group the board by, for the grouping switcher. */
export interface BoardGroupChoice {
  readonly field: string;
  readonly label: string;
}

/**
 * Cards of one entity in columns, one column per value of the grouping field.
 * The renderer owns data, grouping, optimistic state and announcements; the
 * component owns drawing and every drag (RFC 0005). `layout.Board` is
 * optional in this version: a registry without it cannot show a board view,
 * and the renderer says so.
 */
export interface BoardProps<N> {
  /** Accessible name of the whole board (the view's title). */
  readonly label: string;
  /** The fields the viewer can group by; one entry means no switcher. */
  readonly groupChoices: readonly BoardGroupChoice[];
  /** The field currently grouping the board. */
  readonly groupedBy: string;
  readonly columns: readonly BoardColumn<N>[];
  /** Cards are being fetched; columns are still given. */
  readonly loading: boolean;
  /** E.g. an over-cap message; shown above the board and announced politely. */
  readonly notice?: N;
  /** For the component's live region; `seq` increases on every message so a repeated text is announced again. */
  readonly announcement?: { readonly seq: number; readonly text: string };
  readonly onGroupChange: (field: string) => void;
  /** Set only when the view has a rowAction. */
  readonly onOpenCard?: (recordId: string) => void;
  /** Set only when the view is editable. */
  readonly onMove?: (recordId: string, value: string | boolean) => void;
}

/**
 * Exact-key lookup: one entry per field type, enforced by the type system
 * (a mapped type over FieldType, not an index signature), plus layout chrome.
 */
export interface Registry<N> {
  readonly fields: { readonly [K in FieldType]: FieldTypeEntry<K, N> };
  readonly layout: {
    readonly FieldFrame: Component<FieldFrameProps<N>, N>;
    readonly Section: Component<SectionProps<N>, N>;
    readonly Button: Component<ButtonProps, N>;
    readonly Table: Component<TableProps<N>, N>;
    readonly ErrorSummary: Component<ErrorSummaryProps, N>;
    readonly Tabs: Component<TabsProps<N>, N>;
    readonly Panel: Component<PanelProps<N>, N>;
    /** Optional until the reference component set ships a calendar (RFC 0004); then it becomes required. */
    readonly Calendar?: Component<CalendarProps<N>, N>;
    /** Optional until the reference component set ships a board (RFC 0005); then it becomes required. */
    readonly Board?: Component<BoardProps<N>, N>;
  };
  readonly widgets: WidgetComponents<N>;
}
