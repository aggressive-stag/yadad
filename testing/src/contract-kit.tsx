// Contract test kit (ARCHITECTURE.md §12), imported as "@yadad/testing/contract-kit"
// so the main entry (the mock registry) stays free of test-runner code. The
// components repo runs it against every registry; engine CI runs it against
// the mock registry. Needs a DOM: call it from a test file with
// `// @vitest-environment jsdom`.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FIELD_TYPES } from "@yadad/core";
import type { DocumentError, FieldDefinitions, FieldType, FieldValueTypes, Registry } from "@yadad/core";
import axe from "axe-core";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

/** A field definition and a value to drive it with, per field type. */
export interface FieldSample<K extends FieldType> {
  readonly field: FieldDefinitions[K];
  readonly value: FieldValueTypes[K];
}

export type FieldSamples = { readonly [K in FieldType]: FieldSample<K> };

export const defaultSamples: FieldSamples = {
  text: { field: { id: "name", type: "text", label: "Name", required: true }, value: "Ada" },
  number: { field: { id: "weight", type: "number", label: "Weight", min: 0, step: 2.5, unit: "kg" }, value: 102.5 },
  boolean: { field: { id: "warmup", type: "boolean", label: "Warm-up set" }, value: true },
  select: {
    field: { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    value: "Bench",
  },
  date: { field: { id: "day", type: "date", label: "Day" }, value: "2026-10-04" },
};

/** How to read and drive a control holding values of type V. */
interface Driver<V> {
  readonly jsonType: "string" | "number" | "boolean";
  /** What clearing the control must emit: undefined (no value), or false for a checkbox. */
  readonly cleared: V | undefined;
  read(control: HTMLElement): unknown;
  change(control: HTMLElement, value: V): void;
  clear(control: HTMLElement): void;
  /** Whether Display's text shows the value. */
  shows(text: string, value: V): boolean;
}

const controlValue = (control: HTMLElement): string | undefined =>
  control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    ? control.value
    : undefined;

const typeIn = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const stringDriver: Driver<string> = {
  jsonType: "string",
  cleared: undefined,
  read: controlValue,
  change: typeIn,
  clear: (control) => typeIn(control, ""),
  shows: (text, value) => text.includes(value),
};

const drivers: { readonly [K in FieldType]: Driver<FieldValueTypes[K]> } = {
  text: stringDriver,
  select: stringDriver,
  date: stringDriver,
  number: {
    jsonType: "number",
    cleared: undefined,
    read: (control) => {
      const v = controlValue(control);
      return v === undefined || v === "" ? undefined : Number(v);
    },
    change: (control, value) => typeIn(control, String(value)),
    clear: (control) => typeIn(control, ""),
    shows: (text, value) => text.includes(String(value)),
  },
  boolean: {
    jsonType: "boolean",
    cleared: false,
    read: (control) => (control instanceof HTMLInputElement ? control.checked : control.getAttribute("aria-checked") === "true"),
    change: (control, value) => {
      if (drivers.boolean.read(control) !== value) fireEvent.click(control);
    },
    clear: (control) => {
      if (drivers.boolean.read(control) === true) fireEvent.click(control);
    },
    shows: (text, value) => (value ? /yes|true|✓/i : /no|false|✗/i).test(text),
  },
};

export interface ContractCheck {
  readonly name: string;
  /** Resolves to the problems found; [] means the check passed. */
  run(): Promise<readonly string[]>;
}

const sampleError: DocumentError = {
  path: "/value",
  code: "required",
  message: "This value is required.",
  hint: "Enter a value.",
};

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Every contract check for a registry, without registering tests. Checks
 * render into the shared document and clean up after themselves, so run them
 * one at a time (await each), never concurrently.
 */
export function registryContractChecks(registry: Registry<ReactNode>, samples: FieldSamples = defaultSamples): readonly ContractCheck[] {
  return [...FIELD_TYPES.flatMap((type) => checksFor(type, registry, samples)), ...layoutChecks(registry)];
}

function checksFor<K extends FieldType>(type: K, registry: Registry<ReactNode>, samples: FieldSamples): ContractCheck[] {
  return fieldChecks(type, registry, samples[type], drivers[type]);
}

/** Registers one Vitest test per contract check. */
export function describeRegistryContract(registry: Registry<ReactNode>, samples: FieldSamples = defaultSamples): void {
  describe("yadad registry contract", () => {
    for (const check of registryContractChecks(registry, samples)) {
      test(check.name, async () => {
        expect(await check.run()).toEqual([]);
      });
    }
  });
}

function fieldChecks<K extends FieldType>(
  type: K,
  registry: Registry<ReactNode>,
  sample: FieldSample<K>,
  driver: Driver<FieldValueTypes[K]>,
): ContractCheck[] {
  const entry = registry.fields[type];
  const { Input, Display } = entry;
  const { FieldFrame } = registry.layout;
  const inputId = `yadad-contract-${sample.field.id}`;
  const errorId = `${inputId}-errors`;

  const renderField = (props: {
    value?: FieldValueTypes[K];
    errors?: readonly DocumentError[];
    onChange?: (value: FieldValueTypes[K] | undefined) => void;
  }) => {
    const errors = props.errors ?? [];
    return render(
      <FieldFrame inputId={inputId} errorId={errorId} label={sample.field.label} required={sample.field.required === true} errors={errors}>
        <Input
          inputId={inputId}
          field={sample.field}
          value={props.value}
          onChange={props.onChange ?? (() => {})}
          invalid={errors.length > 0}
          {...(errors.length > 0 ? { describedBy: errorId } : {})}
        />
      </FieldFrame>,
    );
  };

  /** Renders, runs `inspect`, and always cleans up the DOM. */
  const check = (name: string, inspect: (problems: string[]) => void | Promise<void>): ContractCheck => ({
    name: `${type}: ${name}`,
    async run() {
      const problems: string[] = [];
      try {
        await inspect(problems);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  });

  const control = (problems: string[]): HTMLElement | null => {
    const el = document.getElementById(inputId);
    if (!el) problems.push(`Input must render an element with id="${inputId}" (its inputId prop).`);
    return el;
  };

  return [
    check("registry key matches entry.type", (problems) => {
      if (entry.type !== type) problems.push(`registry.fields.${type}.type is "${entry.type}".`);
    }),

    check("renders a control labelled by FieldFrame", (problems) => {
      renderField({});
      const el = control(problems);
      if (!el) return;
      const labelled = screen.queryAllByLabelText(sample.field.label, { exact: false });
      if (!labelled.includes(el)) {
        problems.push(`FieldFrame's label "${sample.field.label}" must point at the Input (label for="${inputId}").`);
      }
    }),

    check("shows the value it is given", (problems) => {
      renderField({ value: sample.value });
      const el = control(problems);
      if (el && driver.read(el) !== sample.value) {
        problems.push(`Input given ${JSON.stringify(sample.value)} shows ${JSON.stringify(driver.read(el))}.`);
      }
    }),

    check(`emits a JSON ${driver.jsonType} on change`, (problems) => {
      const emitted: unknown[] = [];
      renderField({ onChange: (v) => emitted.push(v) });
      const el = control(problems);
      if (!el) return;
      driver.change(el, sample.value);
      const last = emitted.at(-1);
      if (emitted.length === 0) problems.push("Input did not call onChange.");
      else if (typeof last !== driver.jsonType || last !== sample.value) {
        problems.push(`onChange got ${JSON.stringify(last)} (${typeof last}); expected the ${driver.jsonType} ${JSON.stringify(sample.value)}.`);
      }
    }),

    check(`emits ${JSON.stringify(driver.cleared) ?? "undefined"} when cleared`, (problems) => {
      const emitted: unknown[] = [];
      renderField({ value: sample.value, onChange: (v) => emitted.push(v) });
      const el = control(problems);
      if (!el) return;
      driver.clear(el);
      if (emitted.length === 0) problems.push("Input did not call onChange when cleared.");
      else if (emitted.at(-1) !== driver.cleared) {
        problems.push(`Clearing must emit ${JSON.stringify(driver.cleared) ?? "undefined"}, got ${JSON.stringify(emitted.at(-1))}.`);
      }
    }),

    check('sets aria-invalid="true" when invalid', (problems) => {
      renderField({ errors: [sampleError] });
      const el = control(problems);
      if (el && el.getAttribute("aria-invalid") !== "true") problems.push('Input with invalid=true must set aria-invalid="true".');
    }),

    check("links its errors with aria-describedby", (problems) => {
      renderField({ errors: [sampleError] });
      const el = control(problems);
      if (!el) return;
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/);
      if (!ids.includes(errorId)) problems.push(`Input must set aria-describedby to its describedBy prop ("${errorId}").`);
      const errorsEl = document.getElementById(errorId);
      if (!errorsEl) problems.push(`FieldFrame must put id="${errorId}" (its errorId prop) on the element holding the errors.`);
      else if (!errorsEl.textContent.includes(sampleError.message)) problems.push(`The element with id="${errorId}" must contain the error message.`);
    }),

    check("is named by labelledBy when given (e.g. a table column header)", (problems) => {
      const labelId = `${inputId}-external-label`;
      render(
        <div>
          <span id={labelId}>{sample.field.label}</span>
          <Input inputId={inputId} field={sample.field} value={undefined} onChange={() => {}} invalid={false} labelledBy={labelId} />
        </div>,
      );
      const el = control(problems);
      if (el && !(el.getAttribute("aria-labelledby") ?? "").split(/\s+/).includes(labelId)) {
        problems.push(`Input must set aria-labelledby to its labelledBy prop ("${labelId}").`);
      }
    }),

    check("Display shows the value", (problems) => {
      const { container } = render(<Display field={sample.field} value={sample.value} />);
      if (!driver.shows(container.textContent, sample.value)) problems.push(`Display did not show ${JSON.stringify(sample.value)}.`);
    }),

    check("passes axe (valid and invalid)", async (problems) => {
      for (const invalid of [false, true]) {
        const { container } = renderField({ value: sample.value, errors: invalid ? [sampleError] : [] });
        const results = await axe.run(container, { runOnly: { type: "tag", values: AXE_TAGS } });
        for (const v of results.violations) problems.push(`axe ${v.id} (${invalid ? "invalid" : "valid"}): ${v.help}`);
        cleanup();
      }
    }),
  ];
}

/** Renders, runs `inspect`, and always cleans up the DOM. */
function layoutCheck(name: string, inspect: (problems: string[]) => void | Promise<void>): ContractCheck {
  return {
    name: `layout: ${name}`,
    async run() {
      const problems: string[] = [];
      try {
        await inspect(problems);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  };
}

async function axeProblems(container: Element, what: string): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: "tag", values: AXE_TAGS } });
  return results.violations.map((v) => `axe ${v.id} (${what}): ${v.help}`);
}

function layoutChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const { Section, Button, Table } = registry.layout;

  const columns = [
    { id: "day", headerId: "kit-col-day", label: "Day", sortable: true, sort: "desc" as const },
    { id: "weight", headerId: "kit-col-weight", label: "Weight", sortable: true },
    { id: "actions", headerId: "kit-col-actions", label: "Actions", sortable: false },
  ];
  const rows = [
    { id: "1", cells: ["2026-10-04", "100 kg", "—"] },
    { id: "2", cells: ["2026-10-03", "95 kg", "—"] },
  ];

  return [
    layoutCheck("Section is a group named by its title", async (problems) => {
      const { container } = render(
        <Section id="details" title="Details">
          <span>inside</span>
        </Section>,
      );
      const group = screen.queryByRole("group", { name: "Details" });
      if (!group) problems.push('Section with title "Details" must render a group (e.g. fieldset/legend) named "Details".');
      else if (!group.textContent.includes("inside")) problems.push("Section must render its children inside the group.");
      problems.push(...(await axeProblems(container, "section")));
      cleanup();
      render(
        <Section id="plain">
          <span>untitled</span>
        </Section>,
      );
      if (!screen.queryByText("untitled")) problems.push("Section without a title must still render its children.");
    }),

    layoutCheck("Button renders a button with its label, type and state", async (problems) => {
      let pressed = 0;
      const { container } = render(
        <>
          <Button label="Save" type="submit" variant="primary" disabled={false} />
          <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={() => pressed++} />
          <Button label="Busy" type="button" variant="secondary" disabled onPress={() => pressed++} />
        </>,
      );
      const save = screen.queryByRole("button", { name: "Save" });
      if (!save) problems.push('Button must render role="button" named by its label.');
      else if (save.getAttribute("type") !== "submit") problems.push('Button with type="submit" must submit its form (type="submit").');
      const cancel = screen.queryByRole("button", { name: "Cancel" });
      if (cancel) fireEvent.click(cancel);
      if (pressed !== 1) problems.push("Clicking a button must call onPress once.");
      const busy = screen.queryByRole("button", { name: "Busy" });
      if (busy) fireEvent.click(busy);
      if (busy && !(busy as HTMLButtonElement).disabled && busy.getAttribute("aria-disabled") !== "true") problems.push("A disabled Button must be disabled.");
      if (pressed !== 1) problems.push("A disabled Button must not call onPress.");
      problems.push(...(await axeProblems(container, "buttons")));
    }),

    layoutCheck("Table is named by its caption, with sortable headers and rows", async (problems) => {
      const sorted: string[] = [];
      const { container } = render(<Table caption="Sets" columns={columns} rows={rows} onSort={(id) => sorted.push(id)} empty="No sets" />);
      if (!screen.queryByRole("table", { name: "Sets" })) problems.push('Table must render role="table" named by its caption.');
      for (const c of columns) {
        const th = document.getElementById(c.headerId);
        if (!th) problems.push(`The "${c.label}" header must have id="${c.headerId}" (its headerId) so editors can be labelled by it.`);
        else if (!th.textContent.includes(c.label)) problems.push(`Header ${c.headerId} must show "${c.label}".`);
      }
      const day = document.getElementById("kit-col-day");
      if (day && day.getAttribute("aria-sort") !== "descending") problems.push('The sorted column header must set aria-sort="descending".');
      const sortButton = day ? Array.from(day.querySelectorAll("button")).at(0) : undefined;
      if (!sortButton) problems.push("Sortable headers must contain a button to sort by them.");
      else fireEvent.click(sortButton);
      if (sorted.join() !== "day") problems.push(`Activating the Day header must call onSort("day"), got [${sorted.join(", ")}].`);
      const actions = document.getElementById("kit-col-actions");
      if (actions?.querySelector("button")) problems.push("Headers that are not sortable must not offer a sort button.");
      if (screen.queryAllByRole("row").length !== rows.length + 1) problems.push("Table must render one row per entry plus the header row.");
      if (!screen.queryByText("95 kg")) problems.push("Table must render every cell.");
      problems.push(...(await axeProblems(container, "table")));
      cleanup();
      render(<Table caption="Sets" columns={columns} rows={[]} onSort={() => {}} empty="No sets" />);
      if (!screen.queryByText("No sets")) problems.push("An empty Table must show its empty content.");
    }),
  ];
}
