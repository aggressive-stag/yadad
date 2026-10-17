// @vitest-environment jsdom
import type { DataAdapter, Document, EntityDocument, FormView, TableView } from "@yadad/core";
import { evaluateFormRules } from "@yadad/runtime";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { checkViewStates, problems } from "./state-checks.js";
import type { StateCheck } from "./state-checks.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["bug", "chore"] } },
    { id: "note", type: "text", label: "Note" },
  ],
};
const base = { specVersion: 4 as const, revision: 1, dataSource: "default", entity: "task" };
const form: FormView = {
  ...base,
  kind: "form",
  id: "task_form",
  sections: [
    {
      id: "main",
      items: [
        { field: "title" },
        { field: "kind" },
        { field: "note", visibleWhen: { op: "eq", field: "kind", value: "bug" }, requiredWhen: { op: "eq", field: "kind", value: "bug" } },
      ],
    },
  ],
};
const table: TableView = { ...base, kind: "table", id: "task_table", columns: [{ field: "title" }] };
const documents: Document[] = [entity, form, table];

interface FakeFormOptions {
  readonly ignoreHiding?: boolean;
  readonly hideAlways?: boolean;
  readonly markRequired?: "always" | "never";
  readonly unnamedButton?: boolean;
}

/** A stand-in for a renderer, with switches to break it in each way. */
function FakeForm({ values, options }: { values: Record<string, unknown>; options: FakeFormOptions }): ReactNode {
  const rules = evaluateFormRules(form, values as never);
  return (
    <form data-yadad-form="task_form">
      {form.sections[0]!.items.map((item) => {
        const hidden = options.ignoreHiding ? false : options.hideAlways ? item.field === "title" || rules.hidden.has(item.field) : rules.hidden.has(item.field);
        if (hidden) return null;
        const required = options.markRequired === "always" ? true : options.markRequired === "never" ? false : item.field === "title" || rules.required.has(item.field);
        return (
          <div key={item.field}>
            <label htmlFor={`f1-${item.field}`}>{item.field}</label>
            <input id={`f1-${item.field}`} aria-required={required} />
          </div>
        );
      })}
      {options.unnamedButton ? <button type="button" /> : <button type="submit">Save</button>}
    </form>
  );
}

function FakeList({ adapter, showError }: { adapter: DataAdapter; showError: boolean }): ReactNode {
  const [message, setMessage] = useState<string | undefined>(undefined);
  useEffect(() => {
    adapter.find("task", {}).catch((e: unknown) => setMessage(e instanceof Error ? e.message : "?"));
  }, [adapter]);
  return <div>{showError && message ? <p role="alert">{message}</p> : <p>rows</p>}</div>;
}

const run = (view: FormView | TableView, render: Parameters<typeof checkViewStates>[0]["render"], skip?: StateCheck[]) =>
  checkViewStates({ view, documents, now: NOW, render, ...(skip ? { skip } : {}) });
const formRender = (options: FakeFormOptions = {}) => (state: { render: { kind: string; values?: Record<string, unknown> } }): ReactNode => (
  <FakeForm values={state.render.values ?? {}} options={options} />
);
const checks = (results: Awaited<ReturnType<typeof run>>): string[] => [...new Set(results.flatMap((r) => r.problems.map((p) => p.check)))].sort();

describe("checkViewStates", () => {
  test("a correct form passes in every state", async () => {
    const results = await run(form, formRender());
    expect(results.length).toBeGreaterThan(3);
    expect(problems(results)).toEqual([]);
  });

  test("results carry the state id and label", async () => {
    const [first] = await run(form, formRender());
    expect(first?.id).toBeTruthy();
    expect(first?.label).toBeTruthy();
  });

  test("render throwing is reported", async () => {
    const results = await run(table, () => {
      throw new Error("boom");
    });
    expect(checks(results)).toEqual(["render-threw"]);
    expect(problems(results)[0]).toContain("boom");
  });

  test("an error logged to the console is reported", async () => {
    const results = await run(table, () => {
      console.error("Warning: each child needs a key");
      return <p>rows</p>;
    }, ["error-message"]);
    expect(checks(results)).toEqual(["console-error"]);
  });

  test("a field shown although its visibleWhen is false", async () => {
    expect(checks(await run(form, formRender({ ignoreHiding: true })))).toEqual(["field-shown-but-hidden"]);
  });

  test("a field missing although its visibleWhen is true", async () => {
    expect(checks(await run(form, formRender({ hideAlways: true })))).toContain("field-missing");
  });

  test("a required marker that disagrees with requiredWhen", async () => {
    const never = await run(form, formRender({ markRequired: "never" }));
    expect(checks(never)).toEqual(["required-marker"]);
    const always = await run(form, formRender({ markRequired: "always" }));
    expect(checks(always)).toEqual(["required-marker"]);
  });

  test("an interactive element without an accessible name", async () => {
    const results = await run(form, formRender({ unnamedButton: true }));
    expect(checks(results)).toEqual(["accessible-name"]);
  });

  test("a failed read with no visible message", async () => {
    const results = await run(table, (_s, c) => <FakeList adapter={c.adapter} showError={false} />);
    const failing = results.filter((r) => r.problems.length > 0);
    expect(failing.map((r) => r.id)).toEqual(["records=none;source=error"]);
    expect(checks(results)).toEqual(["error-message"]);
    expect(problems(await run(table, (_s, c) => <FakeList adapter={c.adapter} showError />))).toEqual([]);
  });

  test("skip leaves a check out", async () => {
    expect(problems(await run(form, formRender({ unnamedButton: true }), ["accessible-name"]))).toEqual([]);
  });

  test("problems lists the state label and the check", async () => {
    const lines = problems(await run(table, () => {
      throw new Error("boom");
    }));
    expect(lines[0]).toMatch(/^.+ \[.+\]: render-threw: boom$/);
  });

  test("an unknown view id throws", async () => {
    await expect(checkViewStates({ view: "nope", documents, now: NOW, render: () => null })).rejects.toThrow(/nope/);
  });
});
