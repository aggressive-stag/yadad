// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ForbiddenError, RecordValidationError } from "@yadad/core";
import type { CalendarView, DashboardView, DataAdapter, EntityDocument, Query, Registry, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CalendarRenderer } from "./calendar-renderer.js";
import type { CalendarRendererProps } from "./calendar-renderer.js";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";

afterEach(cleanup);

const NOW = new Date(2026, 9, 15, 10, 0, 0); // Thursday 15 October 2026, local

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 3,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "due", type: "date", label: "Due" },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["Home", "Work"] } },
    { id: "assignee", type: "text", label: "Assignee" },
  ],
};

const base = { kind: "calendar", specVersion: 3, entity: "task", revision: 1, dataSource: "default", dateField: "due" } as const;
const calendar: CalendarView = { ...base, id: "tasks_calendar", title: "Tasks", detailFields: ["assignee"], colorField: "list", editable: true };

const history: TableView = { kind: "table", specVersion: 3, id: "task_history", title: "Task history", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "due" }], quickFilters: [{ field: "list" }, { field: "assignee" }] };
const documents: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map<string, CalendarView | TableView>([[calendar.id, calendar], [history.id, history]]) };

async function seed(extra: readonly Record<string, string>[] = []) {
  const db = createMemoryAdapter();
  const ids: Record<string, string> = {};
  for (const values of [
    { title: "Pay rent", due: "2026-10-15", list: "Home", assignee: "Ada" },
    { title: "Call Ada", due: "2026-10-15", list: "Work" },
    { title: "Book flights", due: "2026-10-20", list: "Home" },
    { title: "Prepare slides", due: "2026-09-30", list: "Work" }, // a leading day of the October grid
    { title: "Far away", due: "2027-02-01", list: "Home" },
    { title: "Undated", list: "Home" },
    ...extra,
  ]) {
    const record = await db.create("task", values, { entityRevision: 1 });
    ids[values["title"] ?? ""] = record.id;
  }
  return { db, ids };
}

interface Options {
  readonly view?: CalendarView;
  readonly adapter?: DataAdapter;
  readonly registry?: Registry<ReactNode>;
  readonly docs?: DocumentSet | undefined;
}

async function open(options: Options = {}) {
  const seeded = await seed();
  const adapter = options.adapter ?? seeded.db;
  render(
    <CalendarRenderer
      entity={entity}
      view={options.view ?? calendar}
      registry={options.registry ?? mockRegistry}
      dataSources={new Map([["default", adapter]])}
      {...("docs" in options ? (options.docs ? { documents: options.docs } : {}) : { documents })}
      now={NOW}
    />,
  );
  await screen.findByText("Pay rent");
  return seeded;
}

const cell = (date: string): HTMLElement => document.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const status = () => screen.getByTestId("calendar-status").textContent;

/** Moves an entry through the component's "Move to day…" path. */
function moveTo(title: string, date: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Move to day… ${title}`) }));
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: date } });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
}

describe("calendar rendering", () => {
  test("a month is 42 day cells named by their date, with entries on their days", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    const today = screen.getByRole("gridcell", { name: "Thursday 15 October 2026" });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(within(today).getByRole("group", { name: "Pay rent, Ada, Home" })).toBeTruthy();
    expect(within(today).getByRole("group", { name: "Call Ada, Work" })).toBeTruthy();
    expect(within(cell("2026-10-20")).getByText("Book flights")).toBeTruthy();
    // Entries sort by title within a day; the leading day of September is a real day with its entries.
    expect(within(cell("2026-09-30")).getByText("Prepare slides")).toBeTruthy();
    expect(within(cell("2026-10-15")).getAllByTestId(/^entry-/)).toHaveLength(2);
    expect(screen.queryByText("Far away")).toBeNull();
    expect(screen.queryByText("Undated")).toBeNull();
  });

  test("detail fields use the field's Display; the colour has a legend and a text in the label", async () => {
    await open();
    const rent = screen.getByRole("group", { name: "Pay rent, Ada, Home" });
    expect(within(rent).getByTestId("display-assignee").textContent).toBe("Ada");
    const legend = screen.getByTestId("calendar-legend");
    expect([...legend.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Home", "Work"]);
  });

  test("the range query is the month grid, with the view's order", async () => {
    const { db } = await seed();
    const queries: Query[] = [];
    const spy: DataAdapter = { ...db, find: (name, query) => (queries.push(query), db.find(name, query)) };
    await open({ adapter: spy });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.filter).toEqual({ op: "and", conditions: [{ op: "gte", field: "due", value: "2026-09-28" }, { op: "lte", field: "due", value: "2026-11-08" }] });
    expect(queries[0]?.sort?.[0]).toEqual({ field: "due", dir: "asc" });
  });

  test("a week-only view starts on a week of seven days, Monday first", async () => {
    await open({ view: { ...calendar, modes: ["week"] } });
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
    expect(screen.getByRole("heading", { name: "12 to 18 October 2026" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")[0]?.textContent).toBe("Mon");
    expect(screen.queryByRole("button", { name: "Month" })).toBeNull();
  });

  test("switching mode keeps the anchor; Today comes back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("heading", { name: "12 to 18 October 2026" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Book flights")).toBeNull()); // due the 20th, not in this week
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(await screen.findByRole("heading", { name: "19 to 25 October 2026" })).toBeTruthy();
    await screen.findByText("Book flights");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("heading", { name: "12 to 18 October 2026" })).toBeTruthy();
  });

  test("previous and next load the neighbouring month, and the entries follow", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { name: "November 2026" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Book flights")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeTruthy();
    expect(await screen.findByText("Prepare slides")).toBeTruthy();
  });

  test("a response for a range that is no longer current is discarded", async () => {
    const { db } = await seed();
    const pending: { first: string; resolve: () => void }[] = [];
    const slow: DataAdapter = {
      ...db,
      find: (name, query) => {
        const first = JSON.stringify(query.filter);
        const done = db.find(name, query);
        return pending.length === 0 && first.includes("2026-09-28")
          ? done // the first (October) load is quick
          : new Promise((resolve) => pending.push({ first, resolve: () => void done.then(resolve) }));
      },
    };
    await open({ adapter: slow });
    fireEvent.click(screen.getByRole("button", { name: "Next month" })); // November, slow
    fireEvent.click(screen.getByRole("button", { name: "Next month" })); // December, slow
    expect(screen.getByTestId("calendar").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Book flights")).toBeNull(); // no entries on the wrong days while loading
    pending[1]?.resolve();
    await waitFor(() => expect(screen.getByTestId("calendar").getAttribute("aria-busy")).toBe("false"));
    pending[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeTruthy();
    expect(screen.getByTestId("calendar").getAttribute("aria-busy")).toBe("false");
  });

  test("a failed load shows the message and a Retry that loads again", async () => {
    const { db } = await seed();
    let fail = true;
    const flaky: DataAdapter = { ...db, find: (name, query) => (fail ? Promise.reject(new Error("The server responded with status 503.")) : db.find(name, query)) };
    render(<CalendarRenderer entity={entity} view={calendar} registry={mockRegistry} dataSources={new Map([["default", flaky]])} now={NOW} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load records: The server responded with status 503.");
    expect(screen.getByRole("button", { name: "Next month" })).toBeTruthy(); // the grid stays navigable
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Pay rent")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("past the cap a notice says how many entries are shown, and suggests a week", async () => {
    const { db } = await seed();
    const item = (await db.find("task", {})).items[0]!;
    const many: DataAdapter = {
      ...db,
      find: (_name, query) => Promise.resolve({ items: Array.from({ length: query.page?.limit ?? 500 }, (_, i) => ({ ...item, id: `${query.page && "offset" in query.page ? query.page.offset : 0}-${i}` })), total: 2431 }),
    };
    await open({ adapter: many }).catch(() => undefined);
    const notice = await screen.findByTestId("calendar-notice");
    expect(notice.textContent).toMatch(/Showing the first 2,000 of 2,431 entries in this range\. Switch to a week or narrow the filter\./);
  });

  test("a registry with no calendar component gets an error summary naming the view", async () => {
    const { Calendar: _none, ...layout } = mockRegistry.layout;
    const seeded = await seed();
    render(<CalendarRenderer entity={entity} view={calendar} registry={{ ...mockRegistry, layout }} dataSources={new Map([["default", seeded.db]])} now={NOW} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This registry has no layout.Calendar component, so the calendar view tasks_calendar cannot be shown.");
    expect(alert.querySelector("[data-path='/layout/Calendar'][data-code='required']")).toBeTruthy();
  });

  test("a missing data source or field is reported in the core error format", async () => {
    render(<CalendarRenderer entity={entity} view={{ ...calendar, detailFields: ["nope"] }} registry={mockRegistry} dataSources={new Map()} now={NOW} />);
    const items = [...(await screen.findByRole("alert")).querySelectorAll("li")].map((li) => li.getAttribute("data-path"));
    expect(items).toEqual(["/dataSource", "/detailFields/0"]);
  });
});

describe("moving an entry", () => {
  test("a move sends only the date with the record's version, then shows the entry on the new day", async () => {
    const { db } = await seed();
    const calls: unknown[][] = [];
    const spy: DataAdapter = { ...db, update: (...args) => (calls.push(args), db.update(...args)) };
    await open({ adapter: spy });
    const before = (await db.find("task", { filter: { op: "eq", field: "title", value: "Pay rent" } })).items[0]!;
    moveTo("Pay rent", "2026-10-16");
    // Optimistic: it is already on the new day, and cannot be moved again meanwhile.
    expect(within(cell("2026-10-16")).getByText("Pay rent")).toBeTruthy();
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Friday 16 October 2026"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(1)).toEqual([before.id, { due: "2026-10-16" }, { entityRevision: 1, baseVersion: before.version }]);
    expect(within(cell("2026-10-15")).queryByText("Pay rent")).toBeNull();
    const after = await db.findOne("task", before.id);
    expect(after?.values["due"]).toBe("2026-10-16");
    expect(after?.values["assignee"]).toBe("Ada"); // untouched
    expect(screen.queryByRole("alert")).toBeNull();
    // A second move uses the new version (no conflict).
    moveTo("Pay rent", "2026-10-17");
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Saturday 17 October 2026"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("moving to the same day sends nothing", async () => {
    const { db } = await seed();
    const update = vi.fn(db.update);
    await open({ adapter: { ...db, update } });
    moveTo("Pay rent", "2026-10-15");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(update).not.toHaveBeenCalled();
    expect(status()).toBe("");
  });

  test("a move out of the visible range removes the entry and says where it went", async () => {
    await open();
    moveTo("Pay rent", "2026-12-24");
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Thursday 24 December 2026"));
    expect(screen.queryByText("Pay rent")).toBeNull();
  });

  test("a refused move (403) puts the entry back, shows the message and announces it", async () => {
    const { db } = await seed();
    const refusing: DataAdapter = { ...db, update: () => Promise.reject(new ForbiddenError("You may not change this task.")) };
    await open({ adapter: refusing });
    moveTo("Pay rent", "2026-10-16");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You may not change this task.");
    expect(alert.querySelector("[data-code='forbidden']")).toBeTruthy();
    await waitFor(() => expect(status()).toBe("Could not move Pay rent: You may not change this task."));
    await waitFor(() => expect(within(cell("2026-10-15")).getByText("Pay rent")).toBeTruthy());
    expect(within(cell("2026-10-16")).queryByText("Pay rent")).toBeNull();
  });

  test("a validation error (400) shows the adapter's issues", async () => {
    const { db } = await seed();
    const rejecting: DataAdapter = {
      ...db,
      update: () => Promise.reject(new RecordValidationError("Invalid.", [{ path: "/due", code: "invalid-value", message: "Due cannot be on a weekend.", hint: "Pick a weekday." }])),
    };
    await open({ adapter: rejecting });
    moveTo("Call Ada", "2026-10-17");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Due cannot be on a weekend.");
    expect(within(cell("2026-10-15")).getByText("Call Ada")).toBeTruthy();
  });

  test("a version conflict (409) reverts, shows the message and reloads the server's state", async () => {
    const { db, ids } = await seed();
    await open({ adapter: db });
    // Someone else moves the record to the 21st while this viewer still has the old version.
    await db.update("task", ids["Pay rent"]!, { due: "2026-10-21" }, { entityRevision: 1 });
    moveTo("Pay rent", "2026-10-16");
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-code='conflict']")).toBeTruthy();
    await waitFor(() => expect(status()).toMatch(/^Could not move Pay rent: /));
    // The grid shows what the server has now, not the viewer's guess.
    await waitFor(() => expect(within(cell("2026-10-21")).getByText("Pay rent")).toBeTruthy());
    expect(within(cell("2026-10-15")).queryByText("Pay rent")).toBeNull();
    expect(within(cell("2026-10-16")).queryByText("Pay rent")).toBeNull();
  });

  test("a pending entry is not movable, and a repeated announcement text gets a new seq", async () => {
    const { db } = await seed();
    let release: () => void = () => {};
    const slow: DataAdapter = { ...db, update: (...args) => new Promise((resolve) => (release = () => void db.update(...args).then(resolve))) };
    await open({ adapter: slow });
    moveTo("Call Ada", "2026-10-16");
    const entry = await screen.findAllByTestId(/^entry-/).then((all) => all.find((e) => e.getAttribute("data-pending") === "true")!);
    expect(entry.textContent).toContain("Call Ada");
    expect(within(entry).queryByRole("button", { name: /Move to day/ })).toBeNull();
    release();
    await waitFor(() => expect(status()).toBe("Moved Call Ada to Friday 16 October 2026"));
    expect(screen.queryAllByTestId(/^entry-/).some((e) => e.getAttribute("data-pending") === "true")).toBe(false);
  });

  test("a day outside the date field's own limit is not sent", async () => {
    const limited: EntityDocument = { ...entity, fields: entity.fields.map((f) => (f.id === "due" && f.type === "date" ? { ...f, max: "2026-12-31" } : f)) };
    const { db } = await seed();
    const update = vi.fn(db.update);
    render(<CalendarRenderer entity={limited} view={calendar} registry={mockRegistry} dataSources={new Map([["default", { ...db, update }]])} now={NOW} />);
    await screen.findByText("Pay rent");
    moveTo("Pay rent", "2027-01-05");
    await waitFor(() => expect(status()).toBe("Could not move Pay rent: Due cannot be after 2026-12-31"));
    expect(update).not.toHaveBeenCalled();
    expect(within(cell("2026-10-15")).getByText("Pay rent")).toBeTruthy();
  });

  test("when the view is not editable nothing is movable", async () => {
    const { db } = await seed();
    const update = vi.fn(db.update);
    await open({ view: { ...calendar, editable: false }, adapter: { ...db, update } });
    expect(screen.queryByRole("button", { name: /Move to day/ })).toBeNull();
    const { editable: _editable, ...readOnly } = calendar;
    cleanup();
    await open({ view: readOnly, adapter: { ...db, update } });
    expect(screen.queryByRole("button", { name: /Move to day/ })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("row action", () => {
  const withAction: CalendarView = { ...calendar, rowAction: { open: "task_history", bind: [{ field: "list", to: "list" }] } };

  test("activating an entry opens the target table for it, and Back returns to the same month", async () => {
    await open({ view: withAction });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByRole("heading", { name: "November 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await screen.findByText("Pay rent");
    fireEvent.click(screen.getByRole("button", { name: "Pay rent, Ada, Home" }));
    const heading = await screen.findByRole("heading", { name: "Task history: List = Home" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const table = await screen.findByRole("table", { name: "Task history" });
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBe(5)); // header + the four "Home" tasks
    expect(within(table).queryByText("Call Ada")).toBeNull();
    // The bound field's quick filter is hidden; the others stay.
    expect(screen.queryByLabelText("List")).toBeNull();
    expect(screen.getByLabelText("Assignee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Task history" })).toBeNull();
    expect(screen.getByText("Pay rent")).toBeTruthy();
  });

  test("entries are not buttons without a rowAction", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Pay rent, Ada, Home" })).toBeNull();
  });

  test("a row action whose target cannot be found is reported", async () => {
    await open({ view: withAction, docs: { entities: documents.entities, views: new Map([[calendar.id, calendar]]) } }).catch(() => undefined);
    expect((await screen.findByRole("alert")).textContent).toContain('Row action opens "task_history", which is not a table view in the document set.');
  });
});

describe("in a dashboard", () => {
  const dashboard: DashboardView = {
    kind: "dashboard",
    specVersion: 3,
    id: "overview",
    title: "Overview",
    revision: 1,
    tabs: [{ id: "plan", title: "Plan", items: [{ id: "cal", x: 0, y: 0, w: 12, h: 8, widget: "view", view: "tasks_calendar" }] }],
  };

  test("the view widget embeds a calendar", async () => {
    const { db } = await seed();
    render(<DashboardRenderer dashboard={dashboard} documents={documents} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    expect(await screen.findByRole("region", { name: "Tasks" })).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });

  test("a count widget pointing at a calendar is reported", async () => {
    const { db } = await seed();
    const bad: DashboardView = { ...dashboard, tabs: [{ id: "plan", title: "Plan", items: [{ id: "n", x: 0, y: 0, w: 4, h: 1, widget: "count", label: "Tasks", view: "tasks_calendar" }] }] };
    render(<DashboardRenderer dashboard={bad} documents={documents} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    expect((await screen.findByRole("alert")).textContent).toContain("needs a table view");
  });
});

describe("calendar starting mode and anchor", () => {
  const show = (extra: Partial<CalendarRendererProps>, view: CalendarView = calendar) =>
    render(<CalendarRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", createMemoryAdapter()]])} now={NOW} {...extra} />);

  test("opens on the given mode and the week of the given anchor, and the viewer can still navigate", async () => {
    show({ initialMode: "week", initialAnchor: "2026-12-03" });
    await waitFor(() => expect(screen.getAllByRole("gridcell")).toHaveLength(7));
    expect(cell("2026-12-03")).toBeTruthy();
    expect(cell("2026-10-15")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(cell("2026-12-10")).toBeTruthy());
  });

  test("opens on the month of the given anchor", async () => {
    show({ initialAnchor: "2027-02-10" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "February 2027" })).toBeTruthy());
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });

  test("a mode the view does not offer, or an invalid anchor, falls back to the defaults", async () => {
    show({ initialMode: "week", initialAnchor: "not-a-date" }, { ...calendar, modes: ["month"] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy());
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });
});

describe("record actions on entries (RFC 0007)", () => {
  const actionsEntity: EntityDocument = {
    ...entity,
    actions: [{ id: "publish", label: "Publish" }, { id: "archive", label: "Archive", confirm: { message: "Archive it?", tone: "danger" }, input: [{ id: "reason", type: "text", label: "Reason" }] }],
  };
  const withActions: CalendarView = { ...calendar, recordActions: ["publish", "archive"] };

  /** Buttons inside one entry (several entries offer the same actions). */
  const entryButton = (id: string, action: string): HTMLButtonElement =>
    within(screen.getByTestId(`entry-${id}`)).getByTestId(`action-${action}`) as HTMLButtonElement;
  const confirmButton = (): HTMLButtonElement =>
    [...(document.querySelector("[data-testid='dialog']")?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Archive") as HTMLButtonElement;

  /** Seed the two October tasks into an adapter built with these options; returns it with the record ids by title. */
  async function seeded(options: Parameters<typeof createMemoryAdapter>[0]): Promise<{ db: ReturnType<typeof createMemoryAdapter>; ids: Record<string, string> }> {
    const db = createMemoryAdapter(options);
    const ids: Record<string, string> = {};
    for (const values of [
      { title: "Pay rent", due: "2026-10-15", list: "Home", assignee: "Ada" },
      { title: "Call Ada", due: "2026-10-15", list: "Work" },
    ]) {
      const record = await db.create("task", values, { entityRevision: 1 });
      ids[values.title] = record.id;
    }
    return { db, ids };
  }

  test("an entry offers its available actions, an action runs and reloads, and a withheld action is hidden", async () => {
    let acts = 0;
    const { db, ids } = await seeded({
      actions: {
        "task.publish": (record) => {
          acts++;
          return { values: { assignee: `published:${String(record.values.title)}` } };
        },
        "task.archive": () => ({ remove: true }),
      },
      recordPermissions: (record) => (record.values.title === "Call Ada" ? { actions: { publish: false } } : undefined),
    });
    render(<CalendarRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} now={NOW} />);
    await screen.findByText("Pay rent");
    expect(entryButton(ids["Pay rent"]!, "publish")).toBeTruthy();
    expect(entryButton(ids["Pay rent"]!, "archive")).toBeTruthy();
    expect(within(screen.getByTestId(`entry-${ids["Call Ada"]}`)).queryByTestId("action-publish")).toBeNull(); // withheld by can.actions
    fireEvent.click(entryButton(ids["Pay rent"]!, "publish"));
    await waitFor(() => expect(acts).toBe(1));
    expect(status()).toBe("Publish done"); // the calendar's live region carries it
    await waitFor(() => expect(screen.getByText("published:Pay rent")).toBeTruthy()); // reloaded with the new assignee
  });

  test("a press with no act: the data source replaced the calendar with an ErrorSummary", async () => {
    const db = createMemoryAdapter();
    await db.create("task", { title: "Pay rent", due: "2026-10-15", list: "Home" }, { entityRevision: 1 });
    render(<CalendarRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} now={NOW} />);
    await waitFor(() => expect(document.querySelector("[data-testid='error-summary']")?.textContent).toContain("The data source of view tasks_calendar cannot run actions."));
    expect(screen.queryByRole("grid")).toBeNull();
  });

  test("an action refused shows the view's ErrorSummary and reloads the range", async () => {
    const { db, ids } = await seeded({
      actions: { "task.publish": () => { throw new ForbiddenError("Only editors may publish."); } },
      recordPermissions: () => ({ actions: { archive: false } }),
    });
    render(<CalendarRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} now={NOW} />);
    await screen.findByText("Pay rent");
    fireEvent.click(entryButton(ids["Pay rent"]!, "publish"));
    await waitFor(() => expect(document.querySelector("[data-testid='error-summary']")?.textContent).toContain("Only editors may publish."));
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy()); // reloaded; the entry is as it was
  });

  test("an action with confirm and input opens the dialog built for layout.Dialog", async () => {
    const { db, ids } = await seeded({
      actions: { "task.publish": () => ({ values: {} }), "task.archive": (record, input) => ({ values: { assignee: `archived:${String(input?.reason)}` } }) },
      recordPermissions: () => ({ actions: { publish: false } }),
    });
    render(<CalendarRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} now={NOW} />);
    await screen.findByText("Pay rent");
    fireEvent.click(entryButton(ids["Pay rent"]!, "archive"));
    expect(document.querySelector("[data-testid='dialog']")?.getAttribute("aria-label")).toBe("Archive");
    expect(document.querySelector("[data-testid='dialog']")?.textContent).toContain("Archive it?");
    fireEvent.change(document.querySelector("[data-testid='input-reason']")!, { target: { value: "done" } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByText("archived:done")).toBeTruthy());
  });
});
