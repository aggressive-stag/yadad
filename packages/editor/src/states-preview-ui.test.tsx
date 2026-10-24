// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SPEC_VERSION } from "@yadad/core";
import type { Document, EntityDocument, FormView } from "@yadad/core";
import type { ViewState } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { FormViewEditor } from "./form-view-editor.js";
import { compareStates, StatesPreview } from "./states-preview.js";
import type { StateCheckFinding, StatesPreviewProps } from "./states-preview.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "done"] } },
    { id: "note", type: "text", label: "Note" },
  ],
};

const form: FormView = {
  kind: "form",
  specVersion: 4,
  id: "task_form",
  entity: "task",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }, { field: "note" }] }],
};

const now = new Date("2026-10-17T10:00:00");
const renderState: StatesPreviewProps["renderState"] = (state) => <div data-testid="render">{state.label}</div>;
const ids = () => screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-yadad-state")).map((li) => li.getAttribute("data-yadad-state"));

/** The editor and the preview side by side, the way a host wires them. */
function Host({ checkStates }: { checkStates?: StatesPreviewProps["checkStates"] }) {
  const [edited, setEdited] = useState<FormView>(form);
  return (
    <>
      <FormViewEditor view={form} entity={entity} registry={mockRegistry} onSave={() => {}} onChange={setEdited} onCancel={() => {}} />
      <StatesPreview view={edited} saved={form} documents={[entity]} now={now} renderState={renderState} {...(checkStates ? { checkStates } : {})} />
    </>
  );
}

describe("StatesPreview", () => {
  test("shows the states of the view, none marked while nothing is edited", () => {
    render(<StatesPreview view={form} saved={form} documents={[entity]} now={now} renderState={renderState} />);
    expect(ids().length).toBeGreaterThan(0);
    expect(document.querySelector("[data-change='new']")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("None differ from the saved revision.");
  });

  test("the preview frame is a picture: it never takes pointer events", () => {
    // A dashboard editor whose preview overlapped the grid could not be dragged at all — clicks hit the frame.
    render(<StatesPreview view={form} saved={form} documents={[entity]} now={now} renderState={renderState} />);
    const frame = document.querySelector("[data-yadad-state-preview]") as HTMLElement;
    expect(frame.style.pointerEvents).toBe("none");
  });

  test("adding a visibleWhen in the editor adds states and marks them new or changed", () => {
    render(<Host />);
    const before = ids();
    fireEvent.click(screen.getByRole("button", { name: "Show only when: Note" }));
    const op = document.querySelector<HTMLSelectElement>("[data-yadad-rule-builder] select[id$='-op-0']");
    expect(op).toBeTruthy();
    fireEvent.change(op as HTMLSelectElement, { target: { value: "is filled in" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply show only when" }));
    const after = ids();
    expect(after.length).toBeGreaterThan(before.length);
    expect(document.querySelectorAll("[data-change='new'], [data-change='changed']").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toMatch(/new or changed since the saved revision/);
    // Undo returns to the saved revision: nothing is marked.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(ids()).toEqual(before);
    expect(document.querySelector("[data-change='new'], [data-change='changed']")).toBeNull();
  });

  test("a state whose visible fields changed is marked changed; the rest are not", () => {
    const withNote = (value: string): FormView => ({ ...form, sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }, { field: "note", visibleWhen: { op: "eq", field: "status", value } }] }] });
    render(<StatesPreview view={withNote("open")} saved={withNote("done")} documents={[entity]} now={now} renderState={renderState} />);
    const marks = [...document.querySelectorAll("[data-yadad-state]")].map((li) => li.getAttribute("data-change"));
    expect(marks).toContain("changed");
    expect(marks).toContain("unchanged");
    expect(marks).not.toContain("new");
  });

  test("compareStates reports a removed state", () => {
    const state = (id: string): ViewState => ({ id, label: id, values: { a: id }, render: { kind: "form", view: "v", values: {}, now }, viewer: { facts: [] } });
    const result = compareStates(form, [state("a"), state("b")], form, [state("a")]);
    expect(result.removed).toEqual([{ id: "b", label: "b" }]);
    expect(result.changes.get("a")).toBe("unchanged");
  });

  test("compareStates matches by shared axis values: an added axis is not a full replacement", () => {
    const state = (values: Record<string, string>): ViewState => ({
      id: Object.entries(values).map(([k, v]) => `${k}=${v}`).join("|"),
      label: Object.entries(values).map(([k, v]) => `${k} = ${v}`).join(" · "),
      values,
      render: { kind: "form", view: "v", values: {}, now },
      viewer: { facts: [] },
    });
    const savedStates = [state({ status: "open" }), state({ status: "done" })];
    const editedStates = [state({ status: "open", role: "owner" }), state({ status: "open", role: "other" }), state({ status: "done", role: "owner" }), state({ status: "done", role: "other" })];
    const result = compareStates(form, savedStates, form, editedStates);
    expect([...result.changes.values()]).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(result.removed).toEqual([]);
    // A state with a value no saved state has is new; a saved state nothing matches is removed.
    const other = compareStates(form, savedStates, form, [state({ status: "archived", role: "owner" })]);
    expect([...other.changes.values()]).toEqual(["new"]);
    expect(other.removed.map((r) => r.id)).toEqual(["status=open", "status=done"]);
  });

  test("adding a viewer condition marks states changed or unchanged, never all new, and lists none as gone", () => {
    const viewerDoc: Document = { kind: "viewer", specVersion: SPEC_VERSION, id: "viewer", revision: 1, facts: [{ id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "owner"] }, default: "viewer" }] };
    const edited: FormView = { ...form, sections: [{ id: "main", items: [{ field: "title" }, { field: "status" }, { field: "note", visibleWhen: { op: "viewerIn", fact: "role", values: ["owner"] } }] }] };
    render(<StatesPreview view={edited} saved={form} documents={[entity, viewerDoc]} now={now} renderState={renderState} />);
    const marks = [...document.querySelectorAll("[data-yadad-state]")].map((li) => li.getAttribute("data-change"));
    expect(marks.length).toBeGreaterThan(0);
    // Only the "viewer not provided" state, which the saved revision cannot have, is new.
    const fresh = [...document.querySelectorAll("[data-change='new']")].map((li) => li.getAttribute("data-yadad-state"));
    expect(fresh).toEqual(["viewer-not-provided"]);
    expect(marks).toContain("changed");
    expect(screen.getByRole("status").textContent).not.toMatch(/no longer apply/);
    expect(document.querySelector("[data-yadad-states-viewer-axes]")?.textContent).toContain("Role (viewer, owner)");
  });

  test("shows the host's check problems per state, and drops an answer for an older document", async () => {
    const seen: number[] = [];
    const checkStates: StatesPreviewProps["checkStates"] = async ({ states }) => {
      seen.push(states.length);
      const first = states[0];
      return first ? ([{ id: first.id, problems: [{ check: "field-missing", message: "Note is missing" }] }] satisfies StateCheckFinding[]) : [];
    };
    render(<Host checkStates={checkStates} />);
    await waitFor(() => expect(screen.getByText(/Note is missing/)).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Checks found problems in 1 state");
    expect(document.querySelectorAll("[data-yadad-state-marker]").length).toBe(1);
  });

  test("is keyboard usable: a tile button opens the state at full size and closes it again", () => {
    render(<StatesPreview view={form} saved={form} documents={[entity]} now={now} renderState={renderState} />);
    const tile = document.querySelector<HTMLElement>("[data-yadad-state]") as HTMLElement;
    const open = within(tile).getByRole("button");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    open.focus();
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-yadad-state-open]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Close / }));
    expect(document.querySelector("[data-yadad-state-open]")).toBeNull();
  });

  test("reports states it could not build instead of throwing", () => {
    const broken = { ...form, entity: "missing" } as Document as FormView;
    render(<StatesPreview view={broken} saved={broken} documents={[entity]} now={now} renderState={renderState} />);
    expect(screen.getByText("1 states could not be built")).toBeTruthy();
    expect(ids()).toEqual([]);
  });
});

describe("StatesPreview product axes (RFC 0007)", () => {
  const actionEntity: EntityDocument = {
    ...entity,
    actions: [
      { id: "apply", label: "Apply" },
      { id: "archive", label: "Archive", confirm: { message: "Archive it?" } },
    ],
  };
  const table = {
    kind: "table",
    specVersion: 4,
    id: "task_table",
    entity: "task",
    revision: 1,
    dataSource: "default",
    columns: [{ field: "title" }, { field: "status" }],
    recordActions: ["apply"],
  } as const;

  test("names the offered action and the paging axis, and an added record action shows as a new axis", () => {
    render(<StatesPreview view={table} saved={table} documents={[actionEntity]} now={now} renderState={renderState} />);
    const line = document.querySelector("[data-yadad-states-product-axes]")?.textContent ?? "";
    expect(line).toContain("action Apply (available, withheld)");
    expect(line).toContain("paging (total, cursor-more, cursor-end)");
    expect(line).not.toContain("Archive"); // only what the view offers
    const withArchive = { ...table, recordActions: ["apply", "archive"] };
    render(<StatesPreview view={withArchive} saved={table} documents={[actionEntity]} now={now} renderState={renderState} />);
    const lines = document.querySelectorAll("[data-yadad-states-product-axes]");
    expect(lines[lines.length - 1]?.textContent).toContain("action Archive (available, withheld)");
  });
});

// Card 46b (todo-app F12 loop 4): the preview runs the same validators `npm test` runs, on
// the draft. Premise correction on the card: F12's literal repro (a column removed while
// quickFilters still names the field) is LEGAL — quickFilters are checked against the
// entity's fields, never the view's columns, and the renderer keeps the filter working
// (table-renderer.tsx:471-476). What `npm test` catches and the preview hid is a
// cross-document break, so that is the case pinned below.
describe("StatesPreview draft validation (F12)", () => {
  const filterTable = {
    kind: "table",
    specVersion: 4,
    id: "task_table",
    entity: "task",
    revision: 1,
    dataSource: "default",
    columns: [{ field: "title" }, { field: "status" }],
    quickFilters: [{ field: "status" }],
  } as const;
  const draftStatus: Document[] = [
    { ...entity, fields: entity.fields.filter((f) => f.id !== "status") },
    filterTable,
  ];

  test("a draft that breaks a reference the saved revision did not flags the problem in the status region", () => {
    render(<StatesPreview view={filterTable} saved={filterTable} documents={draftStatus} now={now} renderState={renderState} />);
    expect(ids().length).toBeGreaterThan(0); // the tiles still build — a filter on a missing field builds states
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("The draft does not validate: 2 problems"); // the column and the quick filter both name the field
    expect(status).toContain('Field "status" is not on entity "task".');
  });

  test("a valid draft carries no validator clause, and F12's dangling-column draft is valid", () => {
    render(<StatesPreview view={filterTable} saved={filterTable} documents={[entity, filterTable]} now={now} renderState={renderState} />);
    expect(screen.getByRole("status").textContent ?? "").not.toContain("does not validate");
    cleanup(); // the F12 repro verbatim: the column is gone but the quick filter keeps the field — legal, so no clause.
    const dangling = { ...filterTable, columns: [{ field: "title" }] };
    render(<StatesPreview view={dangling} saved={filterTable} documents={[entity]} now={now} renderState={renderState} />);
    expect(screen.getByRole("status").textContent ?? "").not.toContain("does not validate");
  });

  test("a rename alone grows no validator clause", () => {
    const renamed: Document[] = [
      { ...entity, fields: entity.fields.map((f) => (f.id === "status" ? { ...f, label: "State" } : f)) },
      filterTable,
    ];
    render(<StatesPreview view={filterTable} saved={filterTable} documents={renamed} now={now} renderState={renderState} />);
    expect(screen.getByRole("status").textContent ?? "").not.toContain("does not validate");
  });
});
