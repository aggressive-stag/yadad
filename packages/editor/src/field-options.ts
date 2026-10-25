import { isIsoDate, isIsoDatetime, optionValue } from "@yadad/core";
import type { Field, FieldType, FieldValue, RecordValues } from "@yadad/core";

/**
 * The property panel for each field type, described as fields: the editor
 * renders them with the registry's own inputs. Exhaustive over FieldType, so
 * a new field type cannot ship without its panel.
 */
export const FIELD_PROPERTIES: { readonly [K in FieldType]: readonly Field[] } = {
  text: [],
  boolean: [],
  number: [
    { id: "min", type: "number", label: "Minimum" },
    { id: "max", type: "number", label: "Maximum" },
    { id: "step", type: "number", label: "Step (e.g. 2.5)", min: 0 },
    { id: "unit", type: "text", label: "Unit (e.g. kg)" },
  ],
  select: [{ id: "choices", type: "text", label: "Choices, separated by commas", required: true }],
  date: [
    { id: "min", type: "date", label: "Earliest date" },
    { id: "max", type: "date", label: "Latest date" },
  ],
  // RFC 0007: min and max are canonical instants. The panel accepts the stored
  // form or a bare local time, which is read as UTC (37d).
  datetime: [
    { id: "min", type: "datetime", label: "Earliest instant" },
    { id: "max", type: "datetime", label: "Latest instant" },
  ],
  // The entity editor swaps these for pickers when it knows the other entities.
  reference: [
    { id: "entity", type: "text", label: "Target entity id", required: true },
    { id: "display", type: "text", label: "Display field id (default: the target's first text field)" },
  ],
  // RFC 0008 items 14-15 (card 47k): no property panel for either type; min/max/step on a time are document-only for now.
  time: [],
  tags: [],
};

/** Properties every field has, shown above the type-specific ones. */
export const COMMON_PROPERTIES: readonly Field[] = [
  { id: "id", type: "text", label: "Id (letters, digits, underscores)", required: true },
  { id: "label", type: "text", label: "Label", required: true },
  { id: "required", type: "boolean", label: "Required" },
];

export const FIELD_TYPE_LABELS: { readonly [K in FieldType]: string } = {
  text: "Text",
  number: "Number",
  boolean: "Checkbox",
  select: "Choice list",
  date: "Date",
  datetime: "Date and time",
  reference: "Link to another record",
  time: "Time",
  tags: "Tags",
};

const str = (v: FieldValue | undefined): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const num = (v: FieldValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
const date = (v: FieldValue | undefined): string | undefined => (typeof v === "string" && isIsoDate(v) ? v : undefined);

const BARE_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * A datetime property-panel value as the stored instant. The panel accepts the
 * stored form itself and the bare `YYYY-MM-DDTHH:MM` a native box gives, which
 * is read as UTC — the property panel keeps one clock (the stored one) so the
 * same document shows the same bounds on every machine. Anything else is kept
 * verbatim so the document validator refuses it, naming the stored form.
 */
export function instantFromPanel(value: FieldValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  if (isIsoDatetime(v)) return v;
  if (BARE_LOCAL.test(v)) {
    const d = new Date(`${v}:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v;
}

/** The stored instant in the form a native datetime box shows (UTC, minute precision), or null when absent. */
export function panelFromInstant(instant: string | undefined): string | null {
  return instant !== undefined && isIsoDatetime(instant) ? instant.slice(0, 16) : null;
}

/** Builds a field definition from property panel values; validation of the result happens in the edit session. */
export function fieldFromProperties(type: FieldType, v: RecordValues): Field {
  const base = { id: str(v["id"]) ?? "", label: str(v["label"]) ?? "", ...(v["required"] === true ? { required: true } : {}) };
  const opt = <K extends string, T>(key: K, value: T | undefined) => (value === undefined ? {} : ({ [key]: value } as { [P in K]: T }));
  switch (type) {
    case "text":
      return { ...base, type };
    case "boolean":
      return { ...base, type };
    case "number":
      return { ...base, type, ...opt("min", num(v["min"])), ...opt("max", num(v["max"])), ...opt("step", num(v["step"])), ...opt("unit", str(v["unit"])) };
    case "date":
      return { ...base, type, ...opt("min", date(v["min"])), ...opt("max", date(v["max"])) };
    case "datetime":
      return { ...base, type, ...opt("min", instantFromPanel(v["min"])), ...opt("max", instantFromPanel(v["max"])) };
    case "reference":
      return { ...base, type, entity: str(v["entity"]) ?? "", ...opt("display", str(v["display"])) };
    case "select": {
      const values = (str(v["choices"]) ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      return { ...base, type, options: { source: "static", values } };
    }
    case "time":
    case "tags":
      return { ...base, type };
  }
}

/** Property panel values for an existing field. */
export function propertiesFromField(field: Field): RecordValues {
  const base: Record<string, FieldValue> = { id: field.id, label: field.label, required: field.required === true };
  switch (field.type) {
    case "number":
      return { ...base, min: field.min ?? null, max: field.max ?? null, step: field.step ?? null, unit: field.unit ?? null };
    case "date":
      return { ...base, min: field.min ?? null, max: field.max ?? null };
    case "datetime":
      return { ...base, min: panelFromInstant(field.min), max: panelFromInstant(field.max) };
    case "reference":
      return { ...base, entity: field.entity, display: field.display ?? null };
    case "select":
      return { ...base, choices: field.options.values.map(optionValue).join(", ") }; // RFC 0008: card 47a
    default:
      return base;
  }
}
