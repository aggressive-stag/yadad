import { optionLabel, optionValue } from "@yadad/core";
import type { EntityDocument, Field, FieldValue, QuickFilter, QuickFilterDefault, QuickFilterRange, Registry, TableView } from "@yadad/core";
import { useState } from "react";
import type { ReactNode } from "react";
import { instantFromPanel, panelFromInstant } from "./field-options.js";
import { asText, choiceField, propertyInput, toolbarStyle } from "./ui.js";
import { QUICK_FILTER_KINDS, setQuickFilterSettings } from "./views.js";
import type { EditorResult } from "./save-result.js";

const NO_DEFAULT = "(no default)";
const YES = "Yes";
const NO = "No";

interface QuickFiltersPanelProps {
  readonly view: TableView;
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  readonly run: (result: EditorResult, onOk?: () => void) => boolean;
  readonly announce: (message: string) => void;
  readonly base: string;
}

/** A range end as the panel shows it: datetime ends as a native datetime box value. */
const endForPanel = (field: Field, v: string | number | undefined): FieldValue | undefined => (field.type === "datetime" ? (panelFromInstant(typeof v === "string" ? v : undefined) ?? undefined) : v);
const endFromPanel = (field: Field, v: FieldValue | undefined): string | number | undefined => {
  if (field.type === "number") return typeof v === "number" ? v : undefined;
  if (field.type === "datetime") return instantFromPanel(v);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/**
 * What each quick filter starts with (RFC 0010 items 4 and 5): a label of its
 * own, a placeholder for a text filter, and a first value of the kind the
 * filter takes. The default is the initial state only; viewers clear it like
 * any chip. Each row is edited as a draft and applied as one undoable step.
 */
export function QuickFiltersPanel({ view, entity, registry, run, announce, base }: QuickFiltersPanelProps): ReactNode {
  const { Section } = registry.layout;
  const filters = view.quickFilters ?? [];
  if (filters.length === 0) return null;
  return (
    <Section id={`${base}-quick-filters`} title="Quick filters">
      {filters.map((qf) => {
        const field = entity.fields.find((f) => f.id === qf.field);
        return field ? <QuickFilterRow key={`${qf.field}:${JSON.stringify(qf)}`} qf={qf} field={field} view={view} registry={registry} run={run} announce={announce} base={base} /> : null;
      })}
    </Section>
  );
}

interface QuickFilterRowProps {
  readonly qf: QuickFilter;
  readonly field: Field;
  readonly view: TableView;
  readonly registry: Registry<ReactNode>;
  readonly run: QuickFiltersPanelProps["run"];
  readonly announce: (message: string) => void;
  readonly base: string;
}

function QuickFilterRow({ qf, field, view, registry, run, announce, base }: QuickFilterRowProps): ReactNode {
  const { Button } = registry.layout;
  const [label, setLabel] = useState(qf.label ?? "");
  const [placeholder, setPlaceholder] = useState(qf.placeholder ?? "");
  const [def, setDef] = useState<QuickFilterDefault | undefined>(qf.default);
  const kind = QUICK_FILTER_KINDS[field.type];
  const id = `${base}-qf-${qf.field}`;

  const defaultInput = (): ReactNode => {
    const dId = `${id}-default`;
    if (kind === "range") {
      const range: QuickFilterRange = typeof def === "object" && def !== null && !Array.isArray(def) ? (def as QuickFilterRange) : {};
      return (["from", "to"] as const).map((end) =>
        propertyInput(registry, `${dId}-${end}`, { id: `${qf.field}_default_${end}`, type: field.type, label: `${field.label} default ${end}` } as Field, endForPanel(field, range[end]), (v) => {
          const next: Record<string, string | number> = {};
          const from = end === "from" ? endFromPanel(field, v) : range.from;
          const to = end === "to" ? endFromPanel(field, v) : range.to;
          if (from !== undefined) next["from"] = from;
          if (to !== undefined) next["to"] = to;
          setDef(Object.keys(next).length > 0 ? (next as QuickFilterRange) : undefined);
        }),
      );
    }
    if (kind === "contains") return propertyInput(registry, dId, { id: `${qf.field}_default`, type: "text", label: `${field.label} default` }, typeof def === "string" ? def : "", (v) => setDef(asText(v) === "" ? undefined : asText(v)));
    if (field.type === "boolean") {
      const shown = def === true ? YES : def === false ? NO : NO_DEFAULT;
      return propertyInput(registry, dId, choiceField(`${qf.field}_default`, `${field.label} default`, [NO_DEFAULT, YES, NO]), shown, (v) => setDef(v === YES ? true : v === NO ? false : undefined));
    }
    if (field.type === "select" && field.options.source === "static") {
      const values = field.options.values;
      const current = values.find((o) => optionValue(o) === def);
      return propertyInput(registry, dId, choiceField(`${qf.field}_default`, `${field.label} default`, [NO_DEFAULT, ...values.map(optionLabel)]), current ? optionLabel(current) : NO_DEFAULT, (v) => {
        const picked = values.find((o) => optionLabel(o) === v);
        setDef(picked === undefined ? undefined : optionValue(picked));
      });
    }
    return null;
  };

  const settings = { label, placeholder: kind === "contains" ? placeholder : "", default: def };
  const dirty = JSON.stringify([qf.label ?? "", qf.placeholder ?? "", qf.default ?? null]) !== JSON.stringify([label.trim(), settings.placeholder.trim(), def ?? null]);
  return (
    <div data-yadad-quick-filter-row={qf.field} data-yadad-editor-toolbar="" style={toolbarStyle}>
      {propertyInput(registry, `${id}-label`, { id: `${qf.field}_label`, type: "text", label: `${field.label} filter label` }, label, (v) => setLabel(asText(v)))}
      {kind === "contains" && propertyInput(registry, `${id}-placeholder`, { id: `${qf.field}_placeholder`, type: "text", label: `${field.label} filter placeholder` }, placeholder, (v) => setPlaceholder(asText(v)))}
      {defaultInput()}
      <Button
        label={`Apply ${field.label} filter details`}
        type="button"
        variant="secondary"
        disabled={!dirty}
        onPress={() => run(setQuickFilterSettings(view, qf.field, settings, field.type), () => announce(`${field.label} filter: details applied.`))}
      />
    </div>
  );
}
