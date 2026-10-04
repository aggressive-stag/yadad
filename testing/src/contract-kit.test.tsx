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
  fields: { text: { ...mockRegistry.fields.text, Input } },
});

describe("the kit catches broken components", () => {
  test("an input that ignores inputId", async () => {
    const registry = withInput(({ value, onChange }) => (
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
    ));
    expect(await failing(registry)).toEqual(
      expect.arrayContaining(["text: renders a control labelled by FieldFrame", "text: passes axe (valid and invalid)"]),
    );
  });

  test("an input that emits an empty string instead of undefined", async () => {
    const registry = withInput(({ inputId, value, onChange, invalid }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} />
    ));
    expect(await failing(registry)).toEqual(["text: emits undefined when cleared"]);
  });

  test("an input that ignores invalid", async () => {
    const registry = withInput(({ inputId, value, onChange }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
    ));
    expect(await failing(registry)).toEqual(['text: sets aria-invalid="true" when invalid']);
  });

  test("a field frame without a label or errors", async () => {
    const registry: Registry<ReactNode> = { ...mockRegistry, layout: { FieldFrame: ({ children }) => <div>{children}</div> } };
    expect(await failing(registry)).toEqual(
      expect.arrayContaining([
        "text: renders a control labelled by FieldFrame",
        "text: FieldFrame shows each error message",
        "text: passes axe (valid and invalid)",
      ]),
    );
  });
});
