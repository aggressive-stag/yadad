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
  return FIELD_TYPES.flatMap((type) => checksFor(type, registry, samples));
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
