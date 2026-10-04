// Same narrowing switch as @yadad/renderer's fields.tsx: the editor may not import
// the renderer (ARCHITECTURE.md §4), and the switch is small enough to repeat.

import type { Field, FieldValue, Registry } from "@yadad/core";
import type { ReactNode } from "react";

/** Props every Input gets besides its field, value and onChange. */
export interface CommonInputProps {
  readonly inputId: string;
  readonly invalid: boolean;
  readonly describedBy?: string;
  readonly labelledBy?: string;
}

const asString = (v: FieldValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: FieldValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
const asBoolean = (v: FieldValue | undefined): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/**
 * Renders the field's Input from the registry. The switch narrows the field
 * and its stored value together, so every entry gets exactly its own props.
 */
export function renderInput(
  registry: Registry<ReactNode>,
  field: Field,
  value: FieldValue | undefined,
  common: CommonInputProps,
  onChange: (value: FieldValue | undefined) => void,
): ReactNode {
  switch (field.type) {
    case "text": {
      const { Input } = registry.fields.text;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
    case "number": {
      const { Input } = registry.fields.number;
      return <Input {...common} field={field} value={asNumber(value)} onChange={onChange} />;
    }
    case "boolean": {
      const { Input } = registry.fields.boolean;
      return <Input {...common} field={field} value={asBoolean(value)} onChange={onChange} />;
    }
    case "select": {
      const { Input } = registry.fields.select;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
    case "date": {
      const { Input } = registry.fields.date;
      return <Input {...common} field={field} value={asString(value)} onChange={onChange} />;
    }
  }
}

/** Renders the field's read-only Display from the registry. */
export function renderDisplay(registry: Registry<ReactNode>, field: Field, value: FieldValue | undefined): ReactNode {
  switch (field.type) {
    case "text": {
      const { Display } = registry.fields.text;
      return <Display field={field} value={asString(value)} />;
    }
    case "number": {
      const { Display } = registry.fields.number;
      return <Display field={field} value={asNumber(value)} />;
    }
    case "boolean": {
      const { Display } = registry.fields.boolean;
      return <Display field={field} value={asBoolean(value)} />;
    }
    case "select": {
      const { Display } = registry.fields.select;
      return <Display field={field} value={asString(value)} />;
    }
    case "date": {
      const { Display } = registry.fields.date;
      return <Display field={field} value={asString(value)} />;
    }
  }
}
