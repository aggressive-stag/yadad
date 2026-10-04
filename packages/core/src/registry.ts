// PRE-CONTRACT registry shape: one entry per field type plus layout chrome
// (FieldFrame, Section, Button, Table). CellEditor, widgets and optionsSchema come later.

import type { BooleanField, DateField, Field, FieldType, NumberField, SelectField, TextField } from "./document";
import type { DocumentError } from "./errors";

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
}

/** The field definition type for each field type. */
export interface FieldDefinitions {
  readonly text: TextField;
  readonly number: NumberField;
  readonly boolean: BooleanField;
  readonly select: SelectField;
  readonly date: DateField;
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

export interface FieldTypeEntry<K extends FieldType, N> {
  readonly type: K;
  readonly Input: Component<InputProps<FieldDefinitions[K], FieldValueTypes[K]>, N>;
  readonly Display: Component<DisplayProps<FieldDefinitions[K], FieldValueTypes[K]>, N>;
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
  };
}
