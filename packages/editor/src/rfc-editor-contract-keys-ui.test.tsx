// @vitest-environment jsdom
// Card 47g: every control this card adds writes its exact contract key, and the edited
// document round-trips through core's validator (edit → document → validate).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SPEC_VERSION, sectionItems, validateDocument } from "@yadad/core";
import type { BoardView, CalendarView, EntityDocument, FormView, TableView, ViewerDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { BoardViewEditor } from "./board-view-editor.js";
import { CalendarViewEditor } from "./calendar-view-editor.js";
import { ConditionBuilder, builtOf } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { EntityFieldsEditor } from "./entity-fields-editor.js";
import { FormViewEditor } from "./form-view-editor.js";
import { TableViewEditor } from "./table-view-editor.js";
import { optionRowsFromValues, optionValuesFromRows } from "./field-options.js";

afterEach(cleanup);

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const selectByTestid = (testid: string) => document.querySelector(`[data-testid="input-${testid}"]`) as HTMLSelectElement;
const pick = (testid: string, value: string) => fireEvent.change(selectByTestid(testid), { target: { value } });
const type2 = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label) as HTMLInputElement, { target: { value } });

const bookingEntity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "booking",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "when", type: "date", label: "When" },
    { id: "checked_out", type: "boolean", label: "Checked out" },
    { id: "notes", type: "text", label: "Notes" },
  ],
};

describe("calendar doneField and maxEntriesPerDay (RFC 0008 items 20, 17)", () => {
  const view: CalendarView = { kind: "calendar", specVersion: SPEC_VERSION, id: "bookings", entity: "booking", revision: 1, dataSource: "default", dateField: "when" };

  function setup() {
    const saved: CalendarView[] = [];
    render(<CalendarViewEditor view={view} entity={bookingEntity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("the Done field picker only offers booleans, plus none", () => {
    setup();
    const offered = Array.from(selectByTestid("done_field").options).map((o) => o.text);
    expect(offered).toContain("Checked out");
    expect(offered).toContain("(none)");
    expect(offered).not.toContain("Notes");
  });

  test("doneField and maxEntriesPerDay are written on Apply settings and validate", () => {
    const saved = setup();
    pick("done_field", "Checked out");
    type2('Entries per day before "+N more"', "3");
    press("Apply settings");
    press("Save calendar");
    expect(saved[0]).toMatchObject({ revision: 2, doneField: "checked_out", maxEntriesPerDay: 3 });
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("an already-valid done field survives Apply settings and validates", () => {
    const saved: CalendarView[] = [];
    render(<CalendarViewEditor view={{ ...view, doneField: "checked_out", maxEntriesPerDay: 5 }} entity={bookingEntity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    press("Apply settings");
    press("Save calendar");
    expect(saved[0]?.doneField).toBe("checked_out");
    expect(saved[0]?.maxEntriesPerDay).toBe(5);
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });
});

const taskEntity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "done", type: "boolean", label: "Done" },
    { id: "list", type: "reference", label: "List", entity: "list" },
  ],
};
const listEntity: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "list",
  revision: 1,
  fields: [
    { id: "name", type: "text", label: "Name", required: true },
    { id: "task", type: "reference", label: "Task", entity: "task" },
    { id: "checked", type: "boolean", label: "Checked" },
    { id: "pos", type: "number", label: "Position" },
  ],
};

describe("board doneField and columnsFrom (RFC 0008 items 3, 10)", () => {
  const board: BoardView = { kind: "board", specVersion: SPEC_VERSION, id: "tasks_board", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "list" }] };

  function setup() {
    const saved: BoardView[] = [];
    render(<BoardViewEditor view={board} entity={taskEntity} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("doneField applies immediately and validates", () => {
    const saved = setup();
    pick("done_field", "Done");
    press("Save board");
    expect(saved[0]?.doneField).toBe("done");
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("columnsFrom appears when the first grouping is a reference and writes \"options\"", () => {
    const saved = setup();
    fireEvent.click(screen.getByLabelText("Build columns from every record of the grouped entity"));
    press("Save board");
    expect(saved[0]?.columnsFrom).toBe("options");
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("no columnsFrom row when the first grouping is not a reference", () => {
    render(<BoardViewEditor view={{ ...board, id: "b2", groupBy: [{ field: "done" }] }} entity={taskEntity} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Build columns from every record of the grouped entity")).toBeNull();
  });
});

describe("table addForm and saved filters (RFC 0008 item 4, RFC 0009 item 5)", () => {
  const table: TableView = { kind: "table", specVersion: SPEC_VERSION, id: "tasks", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "done" }] };
  const form: FormView = { kind: "form", specVersion: SPEC_VERSION, id: "task_form", entity: "task", revision: 1, dataSource: "default", sections: [{ id: "main", items: [{ field: "title" }] }] };
  const context = { tables: [table], entities: [taskEntity, listEntity], forms: [form] };

  function setup() {
    const saved: TableView[] = [];
    render(<TableViewEditor view={table} entity={taskEntity} registry={mockRegistry} context={context} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("the Add button picker lists form views over the same entity and writes addForm", () => {
    const saved = setup();
    pick("add_form", "task_form");
    press("Save table");
    expect(saved[0]?.addForm).toBe("task_form");
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("a saved filter row writes name + condition under filters[] and validates", () => {
    const saved = setup();
    press("Add saved filter");
    const builder = document.querySelector("[data-yadad-saved-filter-builder]") as HTMLElement;
    fireEvent.change(builder.querySelector('[data-testid="input-saved_filter_name"]') as HTMLInputElement, { target: { value: "Open work" } });
    fireEvent.change(builder.querySelector('[data-testid="input-field"]') as HTMLSelectElement, { target: { value: "Done" } });
    fireEvent.change(builder.querySelector('[data-testid="input-op"]') as HTMLSelectElement, { target: { value: "is not" } });
    fireEvent.click(builder.querySelector('[data-testid="input-done"]') as HTMLInputElement); // the value: Done is not checked
    press("Apply saved filter");
    expect(screen.getAllByText(/Open work/).length).toBeGreaterThan(0);
    press("Save table");
    const savedFilter = saved[0]?.filters?.[0];
    expect(savedFilter?.name).toBe("Open work");
    expect(savedFilter?.condition).toBeDefined();
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("removing the last saved filter drops the key", () => {
    const saved: TableView[] = [];
    render(
      <TableViewEditor
        view={{ ...table, filters: [{ id: "f1", name: "Old", condition: { op: "notEmpty", field: "title" } }] }}
        entity={taskEntity}
        registry={mockRegistry}
        context={context}
        onSave={(v) => saved.push(v)}
        onCancel={() => {}}
      />,
    );
    press("Remove saved filter Old");
    press("Save table");
    expect(saved[0]?.filters).toBeUndefined();
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });
});

describe("form editor: item label, batch composer, sub-record checklist (RFC 0008 items 25, 4; RFC 0009 items 3, 4)", () => {
  const form: FormView = {
    kind: "form",
    specVersion: SPEC_VERSION,
    id: "task_form",
    entity: "task",
    revision: 1,
    dataSource: "default",
    sections: [
      { id: "main", title: "Task", items: [{ field: "title" }] },
      { id: "steps", title: "Steps", items: [] },
    ],
  };

  function setup() {
    const saved: FormView[] = [];
    render(<FormViewEditor view={form} entity={taskEntity} entities={[taskEntity, listEntity]} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    return saved;
  }

  test("a per-item label writes FormItem.label and validates", () => {
    const saved = setup();
    type2("Label for Title on this form (optional)", "What needs doing?");
    press("Set label for Title");
    press("Save form");
    expect(sectionItems(saved[0]!.sections[0]!)[0]).toMatchObject({ field: "title", label: "What needs doing?" });
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("the batch composer toggle writes repeat: \"batch\" and clears it", () => {
    const saved = setup();
    press("Turn on batch composer");
    press("Save form");
    expect(saved[0]?.repeat).toBe("batch");
    expect(validateDocument(saved[0]!).ok).toBe(true);
    press("Turn off batch composer");
    press("Save form");
    expect(saved[1]?.repeat).toBeUndefined();
    expect(validateDocument(saved[1]!).ok).toBe(true);
  });

  test("Make checklist opens the builder; Apply writes the subRecords key and validates", () => {
    const saved = setup();
    const makeButtons = screen.getAllByRole("button", { name: "Make checklist" });
    fireEvent.click(makeButtons[makeButtons.length - 1]!); // the empty "steps" section
    const builder = document.querySelector("[data-yadad-subrecord-builder='steps']") as HTMLElement;
    expect(builder).toBeTruthy();
    press("Apply checklist");
    expect(screen.getAllByText(/Checklist over/).length).toBeGreaterThan(0);
    press("Save form");
    const steps = saved[0]?.sections.find((s) => s.id === "steps");
    expect(steps?.subRecords).toMatchObject({ entity: "list", via: "task", titleField: "name", doneField: "checked", orderField: "pos" });
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("Remove checklist leaves an empty fields section", () => {
    const saved: FormView[] = [];
    const withChecklist: FormView = {
      ...form,
      sections: [
        { id: "main", title: "Task", items: [{ field: "title" }] },
        { id: "steps", title: "Steps", subRecords: { entity: "list", via: "task", titleField: "name", doneField: "checked" } },
      ],
    };
    render(<FormViewEditor view={withChecklist} entity={taskEntity} entities={[taskEntity, listEntity]} registry={mockRegistry} onSave={(v) => saved.push(v)} onCancel={() => {}} />);
    expect(screen.getByText(/Checklist over/)).toBeTruthy();
    press("Remove checklist");
    press("Save form");
    expect(saved[0]?.sections[1]?.subRecords).toBeUndefined();
    expect(saved[0]?.sections[1]?.items).toEqual([]);
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });
});

describe("condition builder fieldEqFact (RFC 0009 item 1)", () => {
  const viewer: ViewerDocument = {
    kind: "viewer",
    specVersion: SPEC_VERSION,
    id: "viewer",
    revision: 1,
    facts: [
      { id: "me", label: "Me", type: "select", options: { source: "static", values: ["aggro", "other"] }, default: "aggro" },
      { id: "beta", label: "Beta", type: "boolean", default: false },
    ],
  };

  function H() {
    const [draft, setDraft] = useState<ConditionDraft | undefined>({ combine: "all", comparisons: [{ not: false, op: "eq", field: "title", value: "x" }] });
    return (
      <>
        <ConditionBuilder id="b" label="rows match" registry={mockRegistry} entity={taskEntity} viewer={viewer} draft={draft} onChange={setDraft} />
        <span data-yadad-built="">{JSON.stringify(builtOf(draft))}</span>
      </>
    );
  }

  test("the operator list gains fieldEqFact when the viewer declares facts, and it builds the leaf", () => {
    render(<H />);
    const op = document.querySelector('[data-testid="input-op"]') as HTMLSelectElement;
    const offered = Array.from(op.options).map((o) => o.text);
    expect(offered).toContain("equals the viewer's");
    fireEvent.change(op, { target: { value: "equals the viewer's" } });
    const fact = document.querySelector("[data-yadad-condition-fact='b']") as HTMLSelectElement;
    expect(fact).toBeTruthy();
    fireEvent.change(fact, { target: { value: "me" } });
    const built = JSON.parse((document.querySelector("[data-yadad-built]") as HTMLElement).textContent ?? "null");
    expect(built).toEqual({ op: "fieldEqFact", field: "title", fact: "me" });
  });

  test("no viewer means no fieldEqFact operator", () => {
    function H2() {
      const [draft, setDraft] = useState<ConditionDraft | undefined>({ combine: "all", comparisons: [{ not: false, op: "eq", field: "title", value: "x" }] });
      return <ConditionBuilder id="b2" label="rows match" registry={mockRegistry} entity={taskEntity} draft={draft} onChange={setDraft} />;
    }
    render(<H2 />);
    const offered = Array.from((document.querySelector('[data-testid="input-op"]') as HTMLSelectElement).options).map((o) => o.text);
    expect(offered).not.toContain("equals the viewer's");
  });
});

describe("field options: label + colour rows, multiline/maxLength, colorFrom (RFC 0008 items 5, 13)", () => {
  const selectEntity: EntityDocument = {
    kind: "entity",
    specVersion: SPEC_VERSION,
    id: "gear",
    revision: 1,
    fields: [
      { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["bike", "run"] } },
      { id: "list", type: "reference", label: "List", entity: "list" },
    ],
  };

  test("option rows round-trip value, label and colour, and drop blank rows", () => {
    expect(optionRowsFromValues(["bike", { value: "run", label: "Running", color: "#ff0000" }])).toEqual([{ value: "bike" }, { value: "run", label: "Running", color: "#ff0000" }]);
    expect(optionValuesFromRows([{ value: "bike" }, { value: "run", label: "Running", color: "#ff0000" }, { value: "  " }])).toEqual(["bike", { value: "run", label: "Running", color: "#ff0000" }]);
    // a label equal to the value earns no object: plain strings stay plain
    expect(optionValuesFromRows([{ value: "bike", label: "bike", color: "" }])).toEqual(["bike"]);
  });

  test("the field panel edits option rows and writes the contract shape", () => {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={selectEntity} views={[]} registry={mockRegistry} entities={[selectEntity, listEntity]} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    press("Edit Kind");
    const rows = document.querySelectorAll("[data-yadad-option-row]");
    expect(rows).toHaveLength(2);
    fireEvent.change((rows[1] as HTMLElement).querySelector('[data-testid="input-opt_1_label"]') as HTMLInputElement, { target: { value: "Running" } });
    fireEvent.change((rows[1] as HTMLElement).querySelector('[data-testid="input-opt_1_color"]') as HTMLInputElement, { target: { value: "#ff0000" } });
    press("Apply changes");
    press("Save fields");
    const field = saved[0]?.fields.find((f) => f.id === "kind");
    expect(field?.type === "select" && field.options.values).toEqual(["bike", { value: "run", label: "Running", color: "#ff0000" }]);
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("multiline and maxLength appear for a text field and round-trip", () => {
    const entity: EntityDocument = { kind: "entity", specVersion: SPEC_VERSION, id: "note", revision: 1, fields: [{ id: "body", type: "text", label: "Body", multiline: true, maxLength: 4000 }] };
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={entity} views={[]} registry={mockRegistry} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    press("Edit Body");
    expect((screen.getByLabelText("Multiline (a paragraph box)") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Maximum length (characters)") as HTMLInputElement).value).toBe("4000");
    type2("Maximum length (characters)", "500");
    press("Apply changes");
    press("Save fields");
    const body = saved[0]?.fields[0];
    expect(body?.type === "text" && body.multiline).toBe(true);
    expect(body?.type === "text" && body.maxLength).toBe(500);
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });

  test("colorFrom is offered for a reference field and writes the key", () => {
    const saved: EntityDocument[] = [];
    render(<EntityFieldsEditor entity={selectEntity} views={[]} registry={mockRegistry} entities={[selectEntity, listEntity]} onSave={(e) => saved.push(e)} onCancel={() => {}} />);
    press("Edit List");
    pick("colorFrom", "checked");
    press("Apply changes");
    press("Save fields");
    const list = saved[0]?.fields.find((f) => f.id === "list");
    expect(list?.type === "reference" && list.colorFrom).toBe("checked");
    expect(validateDocument(saved[0]!).ok).toBe(true);
  });
});
