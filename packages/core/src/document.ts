// PRE-CONTRACT (P0-04). Just enough document shape for the Phase 0 walking
// skeleton: one entity, one form view, one field type. Phase 1 replaces this
// with contract-v0 (RFC-0001); do not build on it beyond Phase 0.

/** Engine document format version. Pre-contract documents are version 0. */
export const SPEC_VERSION = 0;
export type SpecVersion = typeof SPEC_VERSION;

/** Field types known to the pre-contract skeleton. */
export const FIELD_TYPES = ["text"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface TextField {
  readonly id: string;
  readonly type: "text";
  readonly label: string;
  readonly required?: boolean;
}

/** Discriminated on `type`. */
export type Field = TextField;

/** Data model: owns fields, types and validation. */
export interface EntityDocument {
  readonly kind: "entity";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly revision: number;
  readonly fields: readonly Field[];
}

export interface FormItem {
  /** Id of a field on the view's entity. */
  readonly field: string;
}

export interface FormSection {
  readonly id: string;
  readonly title?: string;
  readonly items: readonly FormItem[];
}

/** Layout only: references entity fields by id. */
export interface FormView {
  readonly kind: "form";
  readonly specVersion: SpecVersion;
  readonly id: string;
  readonly entity: string;
  readonly revision: number;
  /** Key the host maps to a DataAdapter. Never a URL. */
  readonly dataSource: string;
  readonly sections: readonly FormSection[];
}

/** Discriminated on `kind`. Table and dashboard views arrive with contract-v0. */
export type ViewDocument = FormView;
export type Document = EntityDocument | ViewDocument;
export type DocumentKind = Document["kind"];
