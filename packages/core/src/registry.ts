// PRE-CONTRACT (P0-04). Registry shape for the walking skeleton: text field
// and FieldFrame only. Section, Tabs, GridItem, CellEditor, widgets and
// optionsSchema arrive with contract-v0.

import type { Field, FieldType, TextField } from "./document";
import type { DocumentError } from "./errors";

/**
 * A UI component, kept structural so core needs no React. React function
 * components satisfy it; the renderer binds it to React.
 */
export type Component<P> = (props: P) => unknown;

/** Field value types by field type. */
export interface FieldValueTypes {
  readonly text: string;
}

/** The field definition type for each field type. */
export interface FieldDefinitions {
  readonly text: TextField;
}

export interface InputProps<F extends Field, V> {
  /** DOM id for the control, so FieldFrame can point its label at it. */
  readonly inputId: string;
  readonly field: F;
  /** undefined = no value yet. */
  readonly value: V | undefined;
  readonly onChange: (value: V | undefined) => void;
  readonly invalid: boolean;
}

export interface DisplayProps<F extends Field, V> {
  readonly field: F;
  readonly value: V | undefined;
}

export interface FieldTypeEntry<K extends FieldType> {
  readonly type: K;
  readonly Input: Component<InputProps<FieldDefinitions[K], FieldValueTypes[K]>>;
  readonly Display: Component<DisplayProps<FieldDefinitions[K], FieldValueTypes[K]>>;
}

/** Label, help and error chrome around every Input. */
export interface FieldFrameProps {
  readonly inputId: string;
  readonly label: string;
  readonly required: boolean;
  readonly errors: readonly DocumentError[];
  readonly children: unknown;
}

/**
 * Exact-key lookup: one entry per field type, enforced by the type system
 * (a mapped type over FieldType, not an index signature).
 */
export interface Registry {
  readonly fields: { readonly [K in FieldType]: FieldTypeEntry<K> };
  readonly layout: {
    readonly FieldFrame: Component<FieldFrameProps>;
  };
}
