// PRE-CONTRACT registry shape: one entry per field type plus layout chrome
// (FieldFrame, Section, Button, Table, ErrorSummary, Tabs, Panel) and widgets.
// CellEditor and optionsSchema come later.

import type { BooleanField, CalendarMode, DateField, DatetimeField, Field, FieldType, Measure, NumberField, ReferenceField, SelectField, SeriesDisplay, TagsField, TextField, TimeField } from "./document.js";
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
  /** "YYYY-MM-DDTHH:MM:SS.sssZ": UTC, milliseconds, `Z`. */
  readonly datetime: string;
  /** The target record's id. */
  readonly reference: string;
  /** "HH:MM" (RFC 0008 item 14). */
  readonly time: string;
  /** An array of non-empty strings, in the order entered (RFC 0008 item 15). */
  readonly tags: readonly string[];
}

/** The field definition type for each field type. */
export interface FieldDefinitions {
  readonly text: TextField;
  readonly number: NumberField;
  readonly boolean: BooleanField;
  readonly select: SelectField;
  readonly date: DateField;
  readonly datetime: DatetimeField;
  readonly reference: ReferenceField;
  readonly time: TimeField;
  readonly tags: TagsField;
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
  /**
   * The referenced record's own colour as `#RRGGBB`, when the reference field
   * declares `colorFrom` and the colour resolved (RFC 0008 item 8). A swatch
   * hint only: the component paints it, the renderer only passes it.
   */
  readonly color?: string;
}

/** Extra Input props per field type; only reference has any. */
export interface FieldInputExtras {
  readonly text: Record<never, never>;
  readonly number: Record<never, never>;
  readonly boolean: Record<never, never>;
  readonly select: Record<never, never>;
  readonly date: Record<never, never>;
  readonly datetime: Record<never, never>;
  readonly reference: ReferenceInputExtras;
  readonly time: Record<never, never>;
  readonly tags: Record<never, never>;
}

/** One run of a word diff (RFC 0007): text that is the same in both versions, only in the new one, or only in the old one. */
export interface DiffSegment {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/**
 * Props a text Display gets besides the common ones. `diff`, set only for a
 * `compare` column, is the word diff of the value (the "after") against what it
 * is compared with. A component that ignores it shows the plain value, a safe
 * degradation; one that uses it marks additions and removals without relying
 * on colour (`<ins>` and `<del>`, plus hidden "added:" and "removed:" text).
 */
export interface TextDisplayExtras {
  readonly diff?: readonly DiffSegment[];
}

/** Extra Display props for a datetime (RFC 0007): the formatted text the renderer produced with `formatDateTime`, beside the stored instant in `value`. */
export interface DatetimeDisplayExtras {
  readonly text?: string;
}

/** Extra Display props per field type; only text, datetime and reference have any. */
export interface FieldDisplayExtras {
  readonly text: TextDisplayExtras;
  readonly number: Record<never, never>;
  readonly boolean: Record<never, never>;
  readonly select: Record<never, never>;
  readonly date: Record<never, never>;
  readonly datetime: DatetimeDisplayExtras;
  readonly reference: ReferenceDisplayExtras;
  readonly time: Record<never, never>;
  readonly tags: Record<never, never>;
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
  /**
   * A toggle control's state (RFC 0009 item 5: the named-filter chip row): the
   * component draws the pressed look and sets `aria-pressed`. Absent, a plain
   * push button.
   */
  readonly pressed?: boolean;
  /** "danger" marks a destructive action (an action confirm's tone, RFC 0007); absent is neutral. */
  readonly tone?: "neutral" | "danger";
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

/**
 * One action a record offers (RFC 0007), as plain data and a callback: the
 * component decides how to draw it (a button, a menu item). The renderer never
 * builds the buttons itself.
 */
export interface RecordActionItem {
  readonly id: string;
  readonly label: string;
  readonly tone: "neutral" | "danger";
  /** This record has an action in flight; the component disables its buttons. */
  readonly pending: boolean;
  readonly onPress: () => void;
}

export interface TableRow<N> {
  readonly id: string;
  /** One cell per column, in column order. */
  readonly cells: readonly N[];
  /** The actions available on this row, in order (RFC 0007). Pressing one does not open the row action. Components that ignore it show no buttons. */
  readonly actions?: readonly RecordActionItem[];
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
  /** The header text of the actions column, shown only when some row has actions (RFC 0007). */
  readonly actionsLabel?: string;
}

/** A list of problems, e.g. a failed save or a view that cannot render. Announced to screen readers. */
/**
 * A modal dialog (RFC 0007; RFC 0003's `mode: "dialog"` reuses it). The renderer
 * builds the content (message, input fields, ErrorSummary, Cancel and Confirm
 * Buttons); the component only provides the modal behaviour: focus trapped
 * inside and returned to the pressed control on close, Escape closes, the
 * background inert, scrolls on a phone.
 */
export interface DialogProps<N> {
  /** Accessible name: the action's confirm title, or its label. */
  readonly label: string;
  /** Escape, an outside press, the close control. */
  readonly onClose: () => void;
  readonly children: N;
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

/**
 * One group of a series widget (RFC 0001 slice 2). `key` is the group's
 * identity: the bucket for a date groupBy (`YYYY-MM-DD`, or `YYYY-MM` for
 * month), otherwise the field's value. `label` is what the axis or row shows
 * (a reference group is already labelled with the target's display).
 */
export interface SeriesGroupProps {
  readonly key: string;
  readonly label: string;
  /** undefined stands for no value: a gap bucket of min/max/avg (shown as a dash, and a break in a line). */
  readonly value: number | undefined;
  /** The value already formatted for display (locale grouping, at most two decimals), or "\u2014" when there is nothing to show. Same contract as CountWidgetProps.text. */
  readonly text: string;
}

/**
 * A grouped measure: one number per group, drawn as a table, bar chart or
 * line chart (RFC 0001 slice 2). The renderer owns fetching, grouping, gap
 * filling and formatting; the component owns drawing and never fetches.
 * `widgets.series` is optional in this version: a registry without it cannot
 * show a series widget, and the renderer says so with an error summary
 * naming the key.
 */
export interface SeriesWidgetProps {
  /** The widget's label; doubles as the chart's accessible name. */
  readonly label: string;
  readonly display: SeriesDisplay;
  /** In sort order, gaps filled for a date series sorted by group. May be empty (see `skipped`). */
  readonly groups: readonly SeriesGroupProps[];
  /** Records with no group value: in no group, and in none of the measures. The component may say "N records without a <field>". */
  readonly skipped: number;
  /** Set when the table holds more records than were read: the groups cover only `read` of `total`. */
  readonly partial?: { readonly read: number; readonly total: number };
  /** The groups are being computed. */
  readonly loading: boolean;
  /** A read failed outright; the component shows the message instead of empty axes. */
  readonly error?: string;
  /** What each group's number is, e.g. "Sum of weight × reps" — the value-axis label. Prose for humans; read `aggregation` for behaviour. */
  readonly measureLabel: string;
  /** What the number actually is. Components must branch on this, never on `measureLabel` — labels are copy, this is data. */
  readonly aggregation: Measure["op"];
}

/** Widget components by widget type; "view" widgets render through the renderer itself. */
export interface WidgetComponents<N> {
  readonly count: Component<CountWidgetProps, N>;
  /**
   * Draws a series widget (RFC 0001 slice 2). Optional like `layout.Calendar`:
   * a registry without it renders an error summary naming the key.
   */
  readonly series?: Component<SeriesWidgetProps, N>;
}

/** One entry (a record) on a calendar day (RFC 0004). */
export interface CalendarEntry<N> {
  /** The record id. */
  readonly id: string;
  /** Title and detail fields, built by the renderer. */
  readonly content: N;
  /** Plain-text accessible name: title, details and the colour text. */
  readonly label: string;
  /**
   * A colour slot from 0 to 7 and its text; the component maps slots to its own
   * colours. Colour is never the only signal. `color` (RFC 0008 item 8) is the
   * `#RRGGBB` a reference `colorFrom` resolved — a hint beside the slot, which
   * stays the fallback.
   */
  readonly color?: { readonly slot: number; readonly label: string; readonly color?: string };
  /** The calendar is editable and no move of this entry is in flight. */
  readonly movable: boolean;
  /** A move of this entry is in flight. */
  readonly pending: boolean;
  /**
   * The entry's completion toggle (RFC 0008 item 3): present only when the view
   * declares `doneField`. `checked` is the stored boolean, `disabled` folds in
   * editability, `can.fields` and an in-flight toggle, and `toggle` writes the
   * new value through the view's normal write path. The component renders the
   * checkbox; the renderer owns the write and the announcement.
   */
  readonly done?: { readonly checked: boolean; readonly disabled: boolean; readonly toggle: () => void };
  /** The actions available on this entry, in order (RFC 0007); in the entry's menu where the component has one. */
  readonly actions?: readonly RecordActionItem[];
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
  /** All of the day's entries, in sort order (uncapped — the disclosure below is presentation). */
  readonly entries: readonly CalendarEntry<N>[];
  /**
   * The day's overflow policy (RFC 0008 item 7): the renderer resolves the
   * view's `maxEntriesPerDay` (default 3) into `shown` (how many to show
   * before a "+N more" affordance) and `hidden` (how many sit behind it). Set
   * only when `hidden > 0`. The renderer owns the number; the component owns
   * the disclosure — slicing and the expand affordance are its own, so the
   * entries all stay available.
   */
  readonly overflow?: { readonly shown: number; readonly hidden: number };
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
  /** The card's completion toggle (RFC 0008 item 3), as on a calendar entry: only when the view declares `doneField`. */
  readonly done?: { readonly checked: boolean; readonly disabled: boolean; readonly toggle: () => void };
  /** The actions available on this card, in order (RFC 0007), next to the "Move to..." path. */
  readonly actions?: readonly RecordActionItem[];
}

/** One column of a board: all records sharing one value of the grouping field. */
export interface BoardColumn<N> {
  /** Stable column id: "v:<value>" for a value column, "empty" or "other". */
  readonly id: string;
  /** Accessible heading for the column. */
  readonly label: string;
  /** The column's `#RRGGBB` swatch hint (RFC 0008 item 5), when the grouping option carries one. */
  readonly color?: string;
  /** Cards in `cards` (the loaded cards). */
  readonly count: number;
  /** False for "other"; always true otherwise. */
  readonly droppable: boolean;
  /** All of the column's cards, in sort order. */
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
  /** The choice in use. */
  readonly groupField: string;
  /** In display order; empty while columns are loading or failed. */
  readonly columns: readonly BoardColumn<N>[];
  /** Cards are being fetched; columns are still given. */
  readonly loading: boolean;
  /** E.g. an over-cap message; shown above the board and announced politely. */
  readonly notice?: N;
  /** For the component's live region; `seq` increases on every message so a repeated text is announced again. */
  readonly announcement?: { readonly seq: number; readonly text: string };
  readonly onGroupBy: (field: string) => void;
  /** Set only when the view has a rowAction. */
  readonly onOpenCard?: (recordId: string) => void;
  /** Set only when the view is editable. */
  readonly onMove?: (recordId: string, columnId: string) => void;
}

/**
 * Paging controls (RFC 0008 item 11): optional so a pre-RFC registry keeps
 * today's markup. The renderer owns page state and disables the buttons; the
 * component owns the styling and layout.
 */
export interface PagerProps {
  /** Accessible name of the paging region, e.g. "Tasks pages". */
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** 1-based page number, for the cursor-mode "Page N" text. */
  readonly page: number;
  /** Total pages; undefined in cursor mode, where the total is unknown. */
  readonly pageCount?: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

/**
 * One entry per field type. `datetime` is optional until the reference
 * component set ships it (RFC 0007), like `layout.Calendar`: a document that
 * uses a datetime field with a registry that lacks it shows an error.
 */
export type RequiredFieldEntries<N> = { readonly [K in Exclude<FieldType, "datetime">]: FieldTypeEntry<K, N> };

export type RegistryFields<N> = RequiredFieldEntries<N> & {
  readonly datetime?: FieldTypeEntry<"datetime", N>;
};

/**
 * Exact-key lookup: one entry per field type, enforced by the type system
 * (a mapped type over FieldType, not an index signature), plus layout chrome.
 */
export interface Registry<N> {
  readonly fields: RegistryFields<N>;
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
    /** Optional (RFC 0007): a view with an action that needs a dialog (a confirmation or input) shows an error summary without it. Shared with RFC 0003's dialog mode. */
    readonly Dialog?: Component<DialogProps<N>, N>;
    /** Optional until the reference component set ships a styled pager (RFC 0008 item 11); without it the table keeps its plain nav markup. */
    readonly Pager?: Component<PagerProps, N>;
  };
  readonly widgets: WidgetComponents<N>;
}
