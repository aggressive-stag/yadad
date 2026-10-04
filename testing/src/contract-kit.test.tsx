// @vitest-environment jsdom
import type { InputProps, Registry, TextField } from "@yadad/core";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { describeRegistryContract, registryContractChecks } from "./contract-kit";
import { mockRegistry } from "./mock-registry";

// The mock registry must pass its own kit.
describeRegistryContract(mockRegistry);

/** Runs every check and returns the failing check names. */
async function failing(registry: Registry<ReactNode>): Promise<string[]> {
  const failed: string[] = [];
  for (const check of registryContractChecks(registry)) {
    if ((await check.run()).length > 0) failed.push(check.name);
  }
  return failed;
}

const withInput = (Input: (props: InputProps<TextField, string>) => ReactNode): Registry<ReactNode> => ({
  ...mockRegistry,
  fields: { ...mockRegistry.fields, text: { ...mockRegistry.fields.text, Input } },
});

describe("the kit catches broken components", () => {
  test("a table without sortable header buttons or header ids", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Table: ({ caption, columns, rows }) => (
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.id}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {r.cells.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      },
    };
    expect(await failing(registry)).toEqual(["layout: Table is named by its caption, with sortable headers and rows"]);
    const problems = await registryContractChecks(registry).at(-1)!.run();
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('id="kit-col-day"'), expect.stringContaining("button to sort"), expect.stringContaining("empty content")]),
    );
  });

  test("an input that ignores inputId", async () => {
    const registry = withInput(({ value, onChange }) => (
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
    ));
    expect(await failing(registry)).toEqual(
      expect.arrayContaining(["text: renders a control labelled by FieldFrame", "text: passes axe (valid and invalid)"]),
    );
  });

  test("an input that emits an empty string instead of undefined", async () => {
    const registry = withInput(({ inputId, value, onChange, invalid, describedBy, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(["text: emits undefined when cleared"]);
  });

  test("an input that ignores invalid", async () => {
    const registry = withInput(({ inputId, value, onChange, describedBy, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} aria-describedby={describedBy} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(['text: sets aria-invalid="true" when invalid']);
  });

  test("an input that does not link its errors", async () => {
    const registry = withInput(({ inputId, value, onChange, invalid, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} aria-invalid={invalid} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(["text: links its errors with aria-describedby"]);
  });

  test("a checkbox that emits undefined instead of false when unticked", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      fields: {
        ...mockRegistry.fields,
        boolean: {
          ...mockRegistry.fields.boolean,
          Input: ({ inputId, value, onChange, invalid, describedBy, labelledBy }) => (
            <input id={inputId} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} aria-invalid={invalid} aria-describedby={describedBy} aria-labelledby={labelledBy} />
          ),
        },
      },
    };
    expect(await failing(registry)).toEqual(["boolean: emits false when cleared"]);
  });

  test("a field frame without a label or errors", async () => {
    const registry: Registry<ReactNode> = { ...mockRegistry, layout: { ...mockRegistry.layout, FieldFrame: ({ children }) => <div>{children}</div> } };
    expect(await failing(registry)).toEqual(
      expect.arrayContaining([
        "text: renders a control labelled by FieldFrame",
        "text: links its errors with aria-describedby",
        "text: passes axe (valid and invalid)",
      ]),
    );
  });
});
