// @vitest-environment jsdom
import type { CalendarProps, CalendarView, DataAdapter, Document, EntityDocument, FormView, Registry, TableView, ViewerDocument } from "@yadad/core";
import { evaluateFormRules, viewEditable } from "@yadad/runtime";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { mockRegistry } from "./mock-registry.js";
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

  describe("viewer axes", () => {
    const viewerDoc: ViewerDocument = {
      kind: "viewer",
      specVersion: 5,
      id: "viewer",
      revision: 1,
      facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "owner"] }, default: "viewer" }],
    };
    const calendar: CalendarView = {
      ...base,
      specVersion: 5,
      kind: "calendar",
      id: "task_calendar",
      dateField: "due",
      titleField: "title",
      editable: true,
      editableWhen: { op: "viewerIn", fact: "role", values: ["owner"] },
    };
    const dated: EntityDocument = { ...entity, fields: [...entity.fields, { id: "due", type: "date", label: "Due" }] };
    const set: Document[] = [dated, calendar, viewerDoc];

    interface Behaviour {
      readonly alwaysMovable?: boolean;
      readonly neverMovable?: boolean;
      readonly ignoreLock?: boolean;
    }

    /** A calendar stand-in: the registry's Calendar records what the "renderer" gave it. */
    const registryFor = (): Registry<ReactNode> => ({ ...mockRegistry, layout: { ...mockRegistry.layout, Calendar: () => <div data-testid="stub-calendar" /> } });
    const render = (behaviour: Behaviour) => (state: { viewer: never; render: { kind: string; records?: { id: string; can?: { update?: boolean } }[] } }, ctx: { registry: Registry<ReactNode> }): ReactNode => {
      const Calendar = ctx.registry.layout.Calendar!;
      const editable = viewEditable(calendar, state.viewer) && !behaviour.neverMovable || behaviour.alwaysMovable === true;
      const entries = (state.render.records ?? []).map((r) => ({
        id: r.id,
        content: null,
        label: r.id,
        movable: editable && (behaviour.ignoreLock === true || r.can?.update !== false),
        pending: false,
      }));
      const props = {
        label: "c",
        title: "c",
        mode: "month",
        modes: [],
        weekdays: [],
        days: [{ date: "2026-10-17", dayOfMonth: 17, weekday: 6, label: "d", inMonth: true, isToday: true, entries }],
        loading: false,
        announcement: "",
        onModeChange: () => undefined,
        onPrevious: () => undefined,
        onNext: () => undefined,
        onToday: () => undefined,
        ...(editable ? { onMove: () => undefined } : {}),
      } as unknown as CalendarProps<ReactNode>;
      return <Calendar {...props} />;
    };
    const go = (behaviour: Behaviour) =>
      checkViewStates({ view: calendar, documents: set, now: NOW, registry: registryFor(), skip: ["error-message", "accessible-name"], render: render(behaviour) as never });

    test("a calendar that follows the viewer and the locks passes", async () => {
      const results = await go({});
      expect(results.some((r) => r.label.includes("role = owner"))).toBe(true);
      expect(results.some((r) => r.label.includes("record locked"))).toBe(true);
      expect(problems(results)).toEqual([]);
    });

    test("moving offered to a viewer who may not move is reported", async () => {
      expect(checks(await go({ alwaysMovable: true }))).toEqual(["editable-offered"]);
    });

    test("moving offered on a locked record is reported", async () => {
      expect(checks(await go({ ignoreLock: true }))).toEqual(["editable-offered"]);
    });

    test("moving withheld from a viewer who may move is reported", async () => {
      expect(checks(await go({ neverMovable: true }))).toContain("editable-missing");
    });
  });
});
