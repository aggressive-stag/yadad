// Contract test kit (ARCHITECTURE.md §12). The components repo runs it
// against every registry; engine CI runs it against the mock registry.
// Needs a DOM: call it from a test file with `// @vitest-environment jsdom`.
// Pre-contract: covers the text field and FieldFrame.

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
};

/** How to read and drive each field type's control, and the JSON type its value must have. */
interface Driver<K extends FieldType> {
  readonly jsonType: "string";
  read(control: HTMLElement): unknown;
  change(control: HTMLElement, value: FieldValueTypes[K]): void;
  clear(control: HTMLElement): void;
}

const drivers: { readonly [K in FieldType]: Driver<K> } = {
  text: {
    jsonType: "string",
    read: (control) => (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value : undefined),
    change: (control, value) => fireEvent.change(control, { target: { value } }),
    clear: (control) => fireEvent.change(control, { target: { value: "" } }),
  },
};

export interface ContractCheck {
  readonly name: string;
  /** Resolves to the problems found; [] means the check passed. */
  run(): Promise<readonly string[]>;
}

const sampleError: DocumentError = {
  path: "/name",
  code: "required",
  message: "This value is required.",
  hint: "Enter a value.",
};

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every contract check for a registry, without registering tests. */
export function registryContractChecks(registry: Registry<ReactNode>, samples: FieldSamples = defaultSamples): readonly ContractCheck[] {
  return FIELD_TYPES.flatMap((type) => fieldChecks(type, registry, samples[type], drivers[type]));
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
  driver: Driver<K>,
): ContractCheck[] {
  const entry = registry.fields[type];
  const { Input, Display } = entry;
  const { FieldFrame } = registry.layout;
  const inputId = `yadad-contract-${sample.field.id}`;

  const renderField = (props: {
    value?: FieldValueTypes[K];
    invalid?: boolean;
    errors?: readonly DocumentError[];
    onChange?: (value: FieldValueTypes[K] | undefined) => void;
  }) =>
    render(
      <FieldFrame inputId={inputId} label={sample.field.label} required={sample.field.required === true} errors={props.errors ?? []}>
        <Input
          inputId={inputId}
          field={sample.field}
          value={props.value}
          onChange={props.onChange ?? (() => {})}
          invalid={props.invalid ?? false}
        />
      </FieldFrame>,
    );

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

    check("emits undefined when cleared", (problems) => {
      const emitted: unknown[] = [];
      renderField({ value: sample.value, onChange: (v) => emitted.push(v) });
      const el = control(problems);
      if (!el) return;
      driver.clear(el);
      if (emitted.length === 0) problems.push("Input did not call onChange when cleared.");
      else if (emitted.at(-1) !== undefined) {
        problems.push(`Clearing must emit undefined (no value), got ${JSON.stringify(emitted.at(-1))}.`);
      }
    }),

    check('sets aria-invalid="true" when invalid', (problems) => {
      renderField({ invalid: true });
      const el = control(problems);
      if (el && el.getAttribute("aria-invalid") !== "true") problems.push('Input with invalid=true must set aria-invalid="true".');
    }),

    check("FieldFrame shows each error message", (problems) => {
      renderField({ invalid: true, errors: [sampleError] });
      if (screen.queryAllByText(sampleError.message, { exact: false }).length === 0) {
        problems.push(`FieldFrame did not show the error message "${sampleError.message}".`);
      }
    }),

    check("Display shows the value", (problems) => {
      const { container } = render(<Display field={sample.field} value={sample.value} />);
      if (!container.textContent.includes(String(sample.value))) problems.push(`Display did not show ${JSON.stringify(sample.value)}.`);
    }),

    check("passes axe (valid and invalid)", async (problems) => {
      for (const invalid of [false, true]) {
        const { container } = renderField({ value: sample.value, invalid, errors: invalid ? [sampleError] : [] });
        const results = await axe.run(container, { runOnly: { type: "tag", values: AXE_TAGS } });
        for (const v of results.violations) problems.push(`axe ${v.id} (${invalid ? "invalid" : "valid"}): ${v.help}`);
        cleanup();
      }
    }),
  ];
}
