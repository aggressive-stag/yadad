// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ForbiddenError, validateDocument } from "@yadad/core";
import type { DashboardView, DataAdapter, Document, EntityDocument, ResolvedViewer, ViewDocument, ViewerDocument } from "@yadad/core";
import { createMemoryAdapter, resolveViewer } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const NOW = new Date(2026, 9, 15, 10, 0, 0);
const load = (name: string): Document => {
  const result = validateDocument(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!result.ok) throw new Error(`${name} is invalid`);
  return result.value;
};
const entity = load("entity-task") as EntityDocument;
const viewerDocument = load("viewer-full") as ViewerDocument;
const views = ["table-task-viewer", "table-task-history", "calendar-task-viewer", "board-task-viewer", "form-task-viewer", "dashboard-task-viewer"].map((n) => load(n) as ViewDocument);
const byId = (id: string) => views.find((v) => v.id === id)!;
const table = byId("task_viewer_table") as Extract<ViewDocument, { kind: "table" }>;
const calendar = byId("task_viewer_calendar") as Extract<ViewDocument, { kind: "calendar" }>;
const board = byId("task_viewer_board") as Extract<ViewDocument, { kind: "board" }>;
const form = byId("task_viewer_form") as Extract<ViewDocument, { kind: "form" }>;
const dashboard = byId("task_viewer_dashboard") as DashboardView;
const set: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map(views.map((v) => [v.id, v])), viewer: viewerDocument };
const setWithoutViewer: DocumentSet = { entities: set.entities, views: set.views };

const as = (role: string, beta = false): ResolvedViewer =>
  resolveViewer(viewerDocument, [{ fact: "role", value: role }, { fact: "beta", value: beta }]).viewer;

/** Two tasks; "Locked task" is locked to everyone by the adapter. */
async function seed(adapterOverrides?: Partial<DataAdapter>) {
  const db = createMemoryAdapter({ recordPermissions: (r) => (r.values["title"] === "Locked task" ? { update: false } : undefined) });
  for (const values of [
    { title: "Open task", status: "todo", assignee: "alice", priority: "low", due_date: "2026-10-15" },
    { title: "Locked task", status: "doing", assignee: "bob", priority: "high", due_date: "2026-10-16" },
  ]) {
    await db.create("task", values, { entityRevision: 1 });
  }
  return new Map<string, DataAdapter>([["default", adapterOverrides ? { ...db, ...adapterOverrides } : db]]);
}

const common = { entity, registry: mockRegistry, entities: set.entities };
const editButtons = () => screen.queryAllByRole("button", { name: "Edit" }).length;
const openButtons = () => screen.queryAllByRole("button", { name: /^Open / }).length;
const headers = () => screen.queryAllByRole("columnheader").map((h) => h.textContent).filter((t) => t !== "Actions");

async function table_(viewer: ResolvedViewer | undefined, documents: DocumentSet | undefined = set) {
  const dataSources = await seed();
  render(<TableRenderer {...common} view={table} dataSources={dataSources} {...(documents ? { documents } : {})} {...(viewer ? { viewer } : {})} />);
  await screen.findByText("Open task");
}

describe("table", () => {
  test("columns hidden by viewerIn are not shown, for a refused viewer and an allowed one", async () => {
    await table_(as("viewer"));
    expect(headers()).toEqual(["Title", "Status"]);
    cleanup();
    await table_(as("editor", true));
    expect(headers()).toEqual(expect.arrayContaining(["Title", "Status", "Assignee", "Priority"]));
  });

  test("editableWhen gates in-place editing for a refused and an allowed viewer, and a locked record has none", async () => {
    const gated = { ...table, columns: [table.columns[0]!, { field: "assignee" }] }; // only title is editable, and only for editors and owners
    const open = async (viewer: ResolvedViewer) => {
      render(<TableRenderer {...common} view={gated} dataSources={await seed()} documents={set} viewer={viewer} />);
      await screen.findByText("Open task");
    };
    await open(as("viewer"));
    expect(editButtons()).toBe(0);
    cleanup();
    await open(as("editor"));
    expect(editButtons()).toBe(1); // "Locked task" is locked by the adapter
  });

  test("the row action is offered only while rowAction.visibleWhen holds", async () => {
    await table_(as("viewer"));
    expect(openButtons()).toBe(0);
    cleanup();
    await table_(as("editor"));
    expect(openButtons()).toBe(2);
    cleanup();
    await table_(as("viewer", true));
    expect(openButtons()).toBe(2);
  });

  test("a viewer who may see no column gets a notice", async () => {
    const narrow = { ...table, columns: [{ ...table.columns[2]! }] };
    const dataSources = await seed();
    render(<TableRenderer {...common} view={narrow} dataSources={dataSources} documents={set} viewer={as("viewer")} />);
    expect(await screen.findByText("There is nothing to show you here.")).toBeTruthy();
  });

  test("without a viewer prop the set's viewer document at its defaults applies", async () => {
    await table_(undefined);
    expect(headers()).toEqual(["Title", "Status"]);
    expect(openButtons()).toBe(0);
  });

  test("without a viewer prop and without the set, a view that reads a fact shows an error", async () => {
    const dataSources = await seed();
    render(<TableRenderer {...common} view={table} dataSources={dataSources} />);
    const summary = await screen.findByTestId("error-summary");
    expect(summary.querySelector("[data-path='/viewer'][data-code='required']")).toBeTruthy();
    expect(summary.textContent).toContain("Pass viewer={resolveViewer(viewerDocument, facts)}");
  });

  test("a view that reads no fact needs no viewer", async () => {
    const plain = byId("task_history") as typeof table;
    const dataSources = await seed();
    render(<TableRenderer {...common} view={plain} dataSources={dataSources} />);
    expect(await screen.findByText("Open task")).toBeTruthy();
  });

  test("a refused write (403) still reverts and shows the message", async () => {
    const dataSources = await seed({ update: () => Promise.reject(new ForbiddenError("You may not change this task.")) });
    render(<TableRenderer {...common} view={table} dataSources={dataSources} documents={set} viewer={as("owner")} />);
    await screen.findByText("Open task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByTestId("input-status"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/You may not change this task/)).toBeTruthy();
    expect(screen.queryAllByTestId("display-status").map((e) => e.textContent)).not.toContain("done");
  });
});

describe("form", () => {
  const open = (viewer: ResolvedViewer | undefined, documents?: DocumentSet) =>
    render(<FormRenderer {...common} view={form} dataSources={new Map([["default", createMemoryAdapter()]])} {...(documents ? { documents } : {})} {...(viewer ? { viewer } : {})} />);

  test("items hidden by viewerIn are not rendered, for a refused viewer and an allowed one", () => {
    open(as("viewer"));
    expect(screen.queryByTestId("input-assignee")).toBeNull();
    expect(screen.queryByTestId("input-due_date")).toBeNull();
    cleanup();
    open(as("editor"));
    expect(screen.queryByTestId("input-assignee")).toBeTruthy();
    expect(screen.queryByTestId("input-due_date")).toBeTruthy();
  });

  test("a viewer leaf in requiredWhen marks the field required", () => {
    open(as("viewer", true));
    expect(screen.getByText(/^Priority/).textContent).toContain("*");
    cleanup();
    open(as("viewer", false));
    expect(screen.getByText(/^Priority/).textContent).not.toContain("*");
  });

  test("the missing-viewer default comes from the set, and a bare form shows the error", () => {
    open(undefined, set);
    expect(screen.queryByTestId("input-assignee")).toBeNull();
    cleanup();
    open(undefined);
    expect(screen.getByTestId("error-summary").querySelector("[data-path='/viewer']")).toBeTruthy();
  });
});

describe("calendar", () => {
  const open = async (viewer: ResolvedViewer | undefined, dataSources?: Map<string, DataAdapter>) => {
    render(<CalendarRenderer {...common} view={calendar} dataSources={dataSources ?? (await seed())} documents={set} now={NOW} {...(viewer ? { viewer } : {})} />);
    await screen.findByText("Open task");
  };
  const moves = () => screen.queryAllByRole("button", { name: /^Move to day…/ });

  test("moving is offered to an editor, per record, and not to a viewer", async () => {
    await open(as("viewer"));
    expect(moves()).toHaveLength(0);
    cleanup();
    await open(as("editor"));
    expect(moves()).toHaveLength(1); // the locked record has none
    expect(moves()[0]!.getAttribute("aria-label")).toContain("Open task");
  });

  test("entries open the row action only while it is visible", async () => {
    await open(as("viewer"));
    expect(screen.queryAllByRole("button", { name: /task/ }).filter((b) => !b.getAttribute("aria-label")?.startsWith("Move"))).toHaveLength(0);
    cleanup();
    await open(as("editor"));
    expect(screen.getAllByRole("button", { name: /Open task|Locked task/ }).length).toBeGreaterThan(0);
  });

  test("the missing-viewer default offers no move", async () => {
    await open(undefined);
    expect(moves()).toHaveLength(0);
  });

  test("a refused move (403) still reverts", async () => {
    const dataSources = await seed({ update: () => Promise.reject(new ForbiddenError("No.")) });
    await open(as("owner"), dataSources);
    fireEvent.click(moves()[0]!);
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(screen.getByTestId("calendar-status").textContent).toMatch(/No\./));
    expect(document.querySelector('[data-date="2026-10-15"]')!.textContent).toContain("Open task");
  });
});

describe("board", () => {
  const open = async (viewer: ResolvedViewer | undefined) => {
    render(<BoardRenderer {...common} view={board} dataSources={await seed()} documents={set} {...(viewer ? { viewer } : {})} />);
    await screen.findByText("Open task");
  };
  const moves = () => screen.queryAllByRole("button", { name: /^Move to…/ });

  test("moving is offered to an owner, per record, and not to an editor", async () => {
    await open(as("editor"));
    expect(moves()).toHaveLength(0);
    cleanup();
    await open(as("owner"));
    expect(moves()).toHaveLength(1);
  });

  test("the missing-viewer default offers no move", async () => {
    await open(undefined);
    expect(moves()).toHaveLength(0);
  });
});

describe("dashboard", () => {
  const open = async (viewer: ResolvedViewer | undefined, documents: DocumentSet = set, initialTab?: string) => {
    render(<DashboardRenderer dashboard={dashboard} documents={documents} registry={mockRegistry} dataSources={await seed()} {...(viewer ? { viewer } : {})} {...(initialTab !== undefined ? { initialTab } : {})} />);
    await screen.findByText("Open task");
  };

  test("initialTab opens on the named tab; an unknown or hidden tab falls back to the first visible one", async () => {
    await open(as("owner", true), set, "owners");
    expect(screen.getByRole("tab", { name: "Owners" }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    await open(as("viewer"), set, "ghost"); // no tab names "ghost"
    expect(screen.getByRole("tab", { name: "Everyone" }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    await open(as("viewer"), set, "owners"); // the tab exists, but this viewer may not see it
    expect(screen.getByRole("tab", { name: "Everyone" }).getAttribute("aria-selected")).toBe("true");
  });

  test("tabs and widgets are listed for the viewer who may see them", async () => {
    await open(as("viewer"));
    expect(screen.queryByRole("tab", { name: "Owners" })).toBeNull();
    expect(screen.queryByText("Open tasks")).toBeNull();
    cleanup();
    await open(as("owner", true));
    expect(screen.getByRole("tab", { name: "Owners" })).toBeTruthy();
    expect(screen.getByText("Open tasks")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
  });

  test("the viewer reaches the embedded view and its row action", async () => {
    // role owner: the embedded board is movable; beta decides its row action
    await open(as("owner"));
    expect(screen.queryAllByRole("button", { name: /^Move to…/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^Open / })).toHaveLength(0);
    cleanup();
    await open(as("owner", true));
    expect(screen.queryAllByRole("button", { name: /^Open / }).length).toBeGreaterThan(0);
    cleanup();
    await open(as("viewer"));
    expect(screen.queryAllByRole("button", { name: /^Move to…/ })).toHaveLength(0);
  });

  test("the owners tab embeds a table that hides columns for its viewer", async () => {
    await open(as("owner"));
    fireEvent.click(screen.getByRole("tab", { name: "Owners" }));
    await screen.findAllByRole("columnheader");
    expect(within(screen.getByRole("tabpanel")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Title", "Assignee"]));
    expect(within(screen.getByRole("tabpanel")).queryByText("Priority")).toBeNull();
  });

  test("the missing-viewer default hides what the defaults hide", async () => {
    await open(undefined);
    expect(screen.queryByRole("tab", { name: "Owners" })).toBeNull();
  });

  test("a dashboard whose tabs are all hidden says so", async () => {
    const onlyOwners = { ...dashboard, tabs: [dashboard.tabs[1]!] };
    render(<DashboardRenderer dashboard={onlyOwners} documents={set} registry={mockRegistry} dataSources={await seed()} viewer={as("viewer")} />);
    expect(await screen.findByText("There is nothing to show you here.")).toBeTruthy();
  });

  test("a dashboard that reads a fact without a viewer or a set viewer shows the error", async () => {
    render(<DashboardRenderer dashboard={dashboard} documents={setWithoutViewer} registry={mockRegistry} dataSources={await seed()} />);
    expect((await screen.findByTestId("error-summary")).querySelector("[data-path='/viewer']")).toBeTruthy();
  });
});
