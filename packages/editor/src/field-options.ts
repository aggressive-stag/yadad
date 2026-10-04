import { isIsoDate } from "@yadad/core";
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
};

const str = (v: FieldValue | undefined): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const num = (v: FieldValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
const date = (v: FieldValue | undefined): string | undefined => (typeof v === "string" && isIsoDate(v) ? v : undefined);

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
    case "select": {
      const values = (str(v["choices"]) ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      return { ...base, type, options: { source: "static", values } };
    }
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
    case "select":
      return { ...base, choices: field.options.values.join(", ") };
    default:
      return base;
  }
}
