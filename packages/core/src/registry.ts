// PRE-CONTRACT registry shape: one entry per field type plus FieldFrame.
// Section, Tabs, GridItem, CellEditor, widgets and optionsSchema come later.

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

/**
 * Exact-key lookup: one entry per field type, enforced by the type system
 * (a mapped type over FieldType, not an index signature).
 */
export interface Registry<N> {
  readonly fields: { readonly [K in FieldType]: FieldTypeEntry<K, N> };
  readonly layout: {
    readonly FieldFrame: Component<FieldFrameProps<N>, N>;
  };
}
