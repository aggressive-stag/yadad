import { formatDateTime, instantToLocal, localToInstant, LOCAL_DATETIME_PATTERN } from "@yadad/runtime";

import { isIsoDatetime } from "@yadad/core";
import type { DiffSegment, Field, FieldValue, Registry } from "@yadad/core";
import type { ReactNode } from "react";
import type { ReferenceSupport } from "./references.js";

/** Props every Input gets besides its field, value and onChange. */
export interface CommonInputProps {
  readonly inputId: string;
  readonly invalid: boolean;
  readonly describedBy?: string;
  readonly labelledBy?: string;
}

/**
 * The viewer's locale and zone (RFC 0007). Renderers take it as an optional
 * `formatting` prop; absent, the environment's are used.
 */
export interface FieldFormatting {
  readonly locale?: string;
  readonly timeZone?: string;
}

/** The environment's IANA zone, for the picker conversions when `formatting` has none. */
const environmentTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const asString = (v: FieldValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const asNumber = (v: FieldValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
const asBoolean = (v: FieldValue | undefined): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** RFC 0007: card 35b. A registry without the optional fields.datetime shows an ErrorSummary naming the key. */
function missingDatetime(registry: Registry<ReactNode>, field: Field): ReactNode {
  const { ErrorSummary } = registry.layout;
  return (
    <ErrorSummary
      errors={[
        {
          path: "/fields/datetime",
          code: "required",
          message: `This registry has no fields.datetime component, so the datetime field ${field.id} cannot be shown.`,
          hint: "Add a fields.datetime entry (an Input and a Display) to the registry.",
        },
      ]}
    />
  );
}

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
  references: ReferenceSupport,
  formatting?: FieldFormatting,
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
    case "datetime": {
      if (!registry.fields.datetime) return missingDatetime(registry, field);
      const { Input } = registry.fields.datetime;
      // RFC 0007: the picker shows the local wall time in the viewer's zone; onChange stores the instant back.
      const stored = asString(value);
      const zone = formatting?.timeZone ?? environmentTimeZone();
      const local = stored !== undefined && isIsoDatetime(stored) ? instantToLocal(stored, zone) : "";
      return (
        <Input
          {...common}
          field={field}
          value={local}
          onChange={(v) => {
            const localValue = asString(v);
            if (localValue === undefined || localValue === "") return onChange(undefined);
            // A malformed value reaches the Input only from a bad document; pass it through for the validation error.
            if (!LOCAL_DATETIME_PATTERN.test(localValue)) return onChange(localValue);
            onChange(localToInstant(localValue, zone));
          }}
        />
      );
    }
    case "reference": {
      const { Input } = registry.fields.reference;
      const id = asString(value);
      return <Input {...common} {...references.input(field, id)} field={field} value={id} onChange={onChange} />;
    }
  }
}

/** Renders the field's read-only Display from the registry. */
export function renderDisplay(
  registry: Registry<ReactNode>,
  field: Field,
  value: FieldValue | undefined,
  references: ReferenceSupport,
  formatting?: FieldFormatting,
  diff?: readonly DiffSegment[],
): ReactNode {
  switch (field.type) {
    case "text": {
      const { Display } = registry.fields.text;
      return <Display field={field} value={asString(value)} {...(diff !== undefined ? { diff } : {})} />;
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
    case "datetime": {
      if (!registry.fields.datetime) return missingDatetime(registry, field);
      const { Display } = registry.fields.datetime;
      const stored = asString(value);
      // RFC 0007: the Display gets the formatted text and the stored instant (for a <time dateTime>). A value the document should not have (not an instant) has no formatting: show it raw, the validation error names it.
      const text = stored !== undefined && isIsoDatetime(stored) ? formatDateTime(stored, formatting) : stored;
      return <Display field={field} value={stored} {...(text !== undefined ? { text } : {})} />;
    }
    case "reference": {
      const { Display } = registry.fields.reference;
      const id = asString(value);
      // An empty reference has no record to look up: show nothing.
      return <Display {...(id === undefined || id === "" ? { label: "", status: "found" as const } : references.display(field, id))} field={field} value={id} />;
    }
  }
}
