// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ForbiddenError, RecordValidationError } from "@yadad/core";
import type { BoardView, DashboardView, DataAdapter, EntityDocument, Registry, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { DashboardRenderer } from "./dashboard-renderer.js";
import type { DocumentSet } from "./document-set.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["Home", "Work"] } },
    { id: "done", type: "boolean", label: "Done" },
    { id: "assignee", type: "reference", label: "Assignee", entity: "person", display: "name" },
    { id: "notes", type: "text", label: "Notes" },
  ],
};
const person: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "person",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name" }],
};

const board: BoardView = {
  kind: "board",
  specVersion: 4,
  id: "tasks_board",
  title: "Tasks",
  entity: "task",
  revision: 1,
  dataSource: "default",
  groupBy: [{ field: "list" }, { field: "done" }, { field: "assignee" }],
  titleField: "title",
  cardFields: ["notes"],
  editable: true,
};
const history: TableView = { kind: "table", specVersion: 4, id: "task_history", title: "Task history", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title" }, { field: "list" }] };
const documents: DocumentSet = {
  entities: new Map([
    [entity.id, entity],
    [person.id, person],
  ]),
  views: new Map<string, BoardView | TableView>([
    [board.id, board],
    [history.id, history],
  ]),
};

async function seed() {
  const db = createMemoryAdapter();
  const ada = await db.create("person", { name: "Ada" }, { entityRevision: 1 });
  const bo = await db.create("person", { name: "Bo" }, { entityRevision: 1 });
  const ids: Record<string, string> = { Ada: ada.id, Bo: bo.id };
  for (const values of [
    { title: "Pay rent", list: "Home", done: false, assignee: ada.id, notes: "Due soon" },
    { title: "Call Ada", list: "Work", done: true },
    { title: "Book flights", list: "Home", done: false, assignee: bo.id },
    { title: "Unsorted" },
  ]) {
    const record = await db.create("task", values, { entityRevision: 1 });
    ids[values.title] = record.id;
  }
  return { db, ids };
}

interface Options {
  readonly view?: BoardView;
  readonly adapter?: DataAdapter;
  readonly registry?: Registry<ReactNode>;
  readonly groupBy?: string;
  readonly onGroupByChange?: (field: string) => void;
  readonly docs?: DocumentSet;
  readonly reloadKey?: unknown;
}

async function open(options: Options = {}) {
  const seeded = await seed();
  const adapter = options.adapter ?? seeded.db;
  const props = {
    entity,
    view: options.view ?? board,
    registry: options.registry ?? mockRegistry,
    dataSources: new Map([["default", adapter]]),
    entities: documents.entities,
    documents: options.docs ?? documents,
    ...(options.groupBy !== undefined ? { groupBy: options.groupBy } : {}),
    ...(options.onGroupByChange ? { onGroupByChange: options.onGroupByChange } : {}),
    ...(options.reloadKey !== undefined ? { reloadKey: options.reloadKey } : {}),
  };
  const ui = render(<BoardRenderer {...props} />);
  await screen.findByText("Pay rent");
  return { ...seeded, rerender: (next: Partial<Options>) => ui.rerender(<BoardRenderer {...props} {...next} />) };
}

const column = (id: string): HTMLElement => screen.getByTestId(`column-${id}`);
const titles = (id: string): string[] => [...column(id).querySelectorAll("[data-yadad-board-title]")].map((n) => n.textContent ?? "");
const status = (): string => screen.getByTestId("board-status").textContent ?? "";
const groupBy = (field: string): void => {
  fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), { target: { value: field } });
};

/** Moves a card through the component's "Move to…" path. */
function moveTo(title: string, columnId: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Move to… ${title}`) }));
  fireEvent.change(screen.getByRole("combobox", { name: new RegExp(`^Move ${title}`) }), { target: { value: columnId } });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
}

describe("groupings", () => {
  test("a select field gives one column per option, plus an empty column for cards without a value", async () => {
    await open();
    expect(screen.getByRole("group", { name: "Tasks" })).toBeTruthy();
    expect(titles("v:Home").sort()).toEqual(["Book flights", "Pay rent"]);
    expect(titles("v:Work")).toEqual(["Call Ada"]);
    expect(titles("empty")).toEqual(["Unsorted"]);
    expect(column("empty").getAttribute("aria-label")).toBe("No List, 1 cards");
  });

  test("card fields use the field's Display and the card's accessible name lists them", async () => {
    await open();
    expect(screen.getByRole("group", { name: "Pay rent, Notes: Due soon" })).toBeTruthy();
    expect(within(column("v:Home")).getByTestId("display-notes").textContent).toBe("Due soon");
  });

  test("a boolean field gives Yes and No columns", async () => {
    await open();
    groupBy("done");
    await waitFor(() => expect(titles("v:true")).toEqual(["Call Ada"]));
    expect(titles("v:false").sort()).toEqual(["Book flights", "Pay rent", "Unsorted"]);
    expect(status()).toBe("Grouped by Done, 2 columns");
  });

  test("a reference field gives one column per target record, in the order of their names", async () => {
    const { ids } = await open();
    groupBy("assignee");
    await waitFor(() => expect(titles(`v:${ids["Ada"]}`)).toEqual(["Pay rent"]));
    expect(titles(`v:${ids["Bo"]}`)).toEqual(["Book flights"]);
    expect(titles("empty").sort()).toEqual(["Call Ada", "Unsorted"]);
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["No Assignee (2)", "Ada (1)", "Bo (1)"]);
  });

  test("a value that matches no column goes to a non-droppable Other column", async () => {
    const { db } = await seed();
    await db.create("task", { title: "Odd", list: "Gone" }, { entityRevision: 1 });
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} />);
    await screen.findByText("Odd");
    expect(titles("other")).toEqual(["Odd"]);
    expect(column("other").getAttribute("data-droppable")).toBe("false");
  });
});

describe("switching the grouping", () => {
  test("uncontrolled: the choice sticks, is reported, and never reloads the cards", async () => {
    const { db } = await seed();
    const find = vi.fn(db.find);
    const changes: string[] = [];
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={new Map([["default", { ...db, find }]])} entities={documents.entities} onGroupByChange={(f) => changes.push(f)} />);
    await screen.findByText("Pay rent");
    const taskCalls = () => find.mock.calls.filter(([name]) => name === "task").length;
    const before = taskCalls();
    groupBy("done");
    await screen.findByTestId("column-v:true");
    expect(changes).toEqual(["done"]);
    expect((screen.getByRole("combobox", { name: "Group by" }) as HTMLSelectElement).value).toBe("done");
    expect(taskCalls()).toBe(before);
  });

  test("controlled: the prop wins until the host changes it; the choice is still reported", async () => {
    const changes: string[] = [];
    const { rerender } = await open({ groupBy: "done", onGroupByChange: (f) => changes.push(f) });
    await screen.findByTestId("column-v:true");
    groupBy("list");
    expect(changes).toEqual(["list"]);
    expect(screen.queryByTestId("column-v:Home")).toBeNull();
    rerender({ groupBy: "list" });
    expect(await screen.findByTestId("column-v:Home")).toBeTruthy();
  });

  test("an unknown controlled id falls back to the first grouping", async () => {
    await open({ groupBy: "nope" });
    expect(screen.getByTestId("column-v:Home")).toBeTruthy();
  });

  test("a single grouping has no switcher", async () => {
    await open({ view: { ...board, groupBy: [{ field: "list" }] } });
    expect(screen.queryByRole("combobox", { name: "Group by" })).toBeNull();
  });
});

describe("moving a card", () => {
  test("sends only the grouping field with the record's version, then shows the card in the new column", async () => {
    const { db, ids } = await seed();
    const calls: unknown[][] = [];
    const spy: DataAdapter = { ...db, update: (...args) => (calls.push(args), db.update(...args)) };
    await open({ adapter: spy });
    const before = (await db.findOne("task", ids["Pay rent"]!))!;
    moveTo("Pay rent", "v:Work");
    expect(titles("v:Work")).toContain("Pay rent"); // optimistic
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Work"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(1)).toEqual([before.id, { list: "Work" }, { entityRevision: 1, baseVersion: before.version }]);
    expect(titles("v:Home")).not.toContain("Pay rent");
    expect((await db.findOne("task", before.id))?.values["list"]).toBe("Work");
    expect(screen.queryByRole("alert")).toBeNull();
    moveTo("Pay rent", "v:Home"); // uses the new version: no conflict
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Home"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("moving to the empty column clears the field", async () => {
    const { db, ids } = await open();
    moveTo("Call Ada", "empty");
    await waitFor(() => expect(status()).toBe("Moved Call Ada to No List"));
    expect((await db.findOne("task", ids["Call Ada"]!))?.values["list"] ?? null).toBeNull();
  });

  test("a reference grouping moves to a target record's id", async () => {
    const { db, ids } = await open();
    groupBy("assignee");
    await screen.findByTestId(`column-v:${ids["Bo"]}`);
    moveTo("Pay rent", `v:${ids["Bo"]}`);
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Bo"));
    expect((await db.findOne("task", ids["Pay rent"]!))?.values["assignee"]).toBe(ids["Bo"]);
  });

  test("a move whose saved record has a new id shows exactly one card in the new column", async () => {
    // A records host whose ids encode the moved value answers the update with
    // a NEW id: the old copy must go and the new one must appear, no reload.
    const { db } = await seed();
    const renaming: DataAdapter = {
      ...db,
      async update(entity, id, patch, meta) {
        const saved = await db.update(entity, id, patch, meta);
        return { ...saved, id: `${id}:${patch["list"] ?? "?"}` };
      },
    };
    await open({ adapter: renaming });
    moveTo("Pay rent", "v:Work");
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Work"));
    expect(titles("v:Work").filter((t) => t === "Pay rent")).toHaveLength(1);
    expect(titles("v:Home")).not.toContain("Pay rent");
  });

  // A consumer saw a card in both its old and new column after a move out of
  // the empty column (reference group-by) until reload. These pin the engine
  // side: whatever the adapter returned (same id, or a new one), the card the
  // renderer moved must live in exactly one column, and stay there across a
  // reloadKey change. `moveTo` is the Move to… path; the drop path needs a
  // Board with drop handlers (the mock set has none and the real component
  // set lives in another repo), so the drop test wires the same call the
  // component set's drop makes: onMove(cardId, columnId) on drop.
  const DRAG_TYPE = "application/x-yadad-board-card";

  function fakeDataTransfer(pairs: readonly (readonly [string, string])[]): DataTransfer {
    const store = new Map<string, string>(pairs);
    return {
      types: [...store.keys()],
      getData: (t: string) => store.get(t) ?? "",
      setData: (t: string, v: string) => void store.set(t, v),
    } as unknown as DataTransfer;
  }

  async function openWithDrop(options: Options = {}) {
    const dropRegistry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Board: (props) => (
          <section data-testid="board">
            <div role="status" aria-live="polite" data-testid="board-status">
              {props.announcement?.text}
            </div>
            {props.columns.map((col) => (
              <div
                key={col.id}
                data-testid={`column-${col.id}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                  const id = e.dataTransfer.getData(DRAG_TYPE);
                  if (col.droppable && id) props.onMove?.(id, col.id);
                }}
              >
                {col.cards.map((card) => (
                  <div key={card.id} data-testid={`card-${card.id}`} data-pending={card.pending} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, card.id)} aria-label={card.label}>
                    {card.content}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ),
      },
    };
    return open({ ...options, registry: dropRegistry });
  }

  const cardNodes = (cardId: string): HTMLElement[] => Array.from(document.querySelectorAll(`[data-testid="card-${cardId}"]`));

  test("a card moved out of the empty column by the Move to… control ends up in exactly one column and stays after a reload", async () => {
    const { db, ids, rerender } = await open({ groupBy: "assignee" });
    await screen.findByTestId(`column-v:${ids["Ada"]}`);
    expect(titles("empty")).toContain("Unsorted");
    moveTo("Unsorted", `v:${ids["Ada"]}`);
    await waitFor(() => expect(status()).toBe("Moved Unsorted to Ada"));
    expect(cardNodes(ids["Unsorted"]!)).toHaveLength(1);
    expect(titles(`v:${ids["Ada"]}`)).toContain("Unsorted");
    expect(titles("empty")).not.toContain("Unsorted");
    expect((await db.findOne("task", ids["Unsorted"]!))?.values["assignee"]).toBe(ids["Ada"]);
    // A host reload (changed reloadKey) must not resurrect the old copy.
    rerender({ reloadKey: "after-move" });
    await waitFor(() => expect(cardNodes(ids["Unsorted"]!)).toHaveLength(1));
    expect(titles(`v:${ids["Ada"]}`)).toContain("Unsorted");
    expect(titles("empty")).not.toContain("Unsorted");
  });

  test("a card dropped from the empty column onto a person column ends up in exactly one column and stays after a reload", async () => {
    const { db, ids, rerender } = await openWithDrop({ groupBy: "assignee" });
    await screen.findByTestId(`column-v:${ids["Ada"]}`);
    fireEvent.drop(screen.getByTestId(`column-v:${ids["Ada"]}`), {
      dataTransfer: fakeDataTransfer([
        [DRAG_TYPE, ids["Unsorted"]!],
        ["text/plain", ids["Unsorted"]!],
      ]),
    });
    await waitFor(() => expect(status()).toBe("Moved Unsorted to Ada"));
    expect(cardNodes(ids["Unsorted"]!)).toHaveLength(1);
    expect((await db.findOne("task", ids["Unsorted"]!))?.values["assignee"]).toBe(ids["Ada"]);
    rerender({ reloadKey: "after-move" });
    await waitFor(() => expect(cardNodes(ids["Unsorted"]!)).toHaveLength(1));
  });

  test("a refused move (403) puts the card back, shows the message and announces it", async () => {
    const { db } = await seed();
    await open({ adapter: { ...db, update: () => Promise.reject(new ForbiddenError("You may not change this task.")) } });
    moveTo("Pay rent", "v:Work");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You may not change this task.");
    expect(alert.querySelector("[data-code='forbidden']")).toBeTruthy();
    await waitFor(() => expect(status()).toBe("Could not move Pay rent: You may not change this task."));
    await waitFor(() => expect(titles("v:Home")).toContain("Pay rent"));
    expect(titles("v:Work")).not.toContain("Pay rent");
  });

  test("focus is not lost when the moved card is rebuilt in its new column, or put back by a refusal", async () => {
    const { db } = await seed();
    let refuse = false;
    await open({ adapter: { ...db, update: (...args) => (refuse ? Promise.reject(new ForbiddenError("No.")) : db.update(...args)) } });
    moveTo("Pay rent", "v:Work");
    await waitFor(() => expect(status()).toBe("Moved Pay rent to Work"));
    // The mock board puts focus back on the rebuilt card's button from an
    // effect, which can settle after the status text: wait for it, as the
    // calendar focus test does. Asserting synchronously raced the rebuild.
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Move to… Pay rent/));
    expect(column("v:Work").contains(document.activeElement)).toBe(true);
    refuse = true;
    moveTo("Pay rent", "v:Home");
    await screen.findByRole("alert");
    await waitFor(() => expect(titles("v:Work")).toContain("Pay rent"));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Move to… Pay rent/));
  });

  test("a validation error (400) shows the adapter's issues and reverts", async () => {
    const { db } = await seed();
    const rejecting: DataAdapter = {
      ...db,
      update: () => Promise.reject(new RecordValidationError("Invalid.", [{ path: "/list", code: "invalid-value", message: "Work is full.", hint: "Pick another list." }])),
    };
    await open({ adapter: rejecting });
    moveTo("Pay rent", "v:Work");
    expect((await screen.findByRole("alert")).textContent).toContain("Work is full.");
    await waitFor(() => expect(titles("v:Home")).toContain("Pay rent"));
  });

  test("a version conflict (409) reverts, shows the message and reloads the server's state", async () => {
    const { db, ids } = await open();
    // Someone else moves the card to the empty column while this viewer has the old version.
    await db.update("task", ids["Pay rent"]!, { list: null }, { entityRevision: 1 });
    moveTo("Pay rent", "v:Work");
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-code='conflict']")).toBeTruthy();
    await waitFor(() => expect(status()).toMatch(/^Could not move Pay rent: /));
    await waitFor(() => expect(titles("empty")).toContain("Pay rent"));
    expect(titles("v:Home")).not.toContain("Pay rent");
    expect(titles("v:Work")).not.toContain("Pay rent");
  });

  test("a pending card is not movable until the update settles", async () => {
    const { db } = await seed();
    let release: () => void = () => {};
    const slow: DataAdapter = { ...db, update: (...args) => new Promise((resolve) => (release = () => void db.update(...args).then(resolve))) };
    await open({ adapter: slow });
    moveTo("Call Ada", "v:Home");
    const card = [...document.querySelectorAll("[data-pending='true']")][0] as HTMLElement;
    expect(card.textContent).toContain("Call Ada");
    expect(within(card).queryByRole("button", { name: /^Move to…/ })).toBeNull();
    release();
    await waitFor(() => expect(status()).toBe("Moved Call Ada to Home"));
    expect(document.querySelector("[data-pending='true']")).toBeNull();
  });

  test("when the view is not editable nothing is movable", async () => {
    const { db } = await seed();
    const update = vi.fn(db.update);
    await open({ view: { ...board, editable: false }, adapter: { ...db, update } });
    expect(screen.queryByRole("button", { name: /^Move to…/ })).toBeNull();
    cleanup();
    const { editable: _editable, ...readOnly } = board;
    await open({ view: readOnly, adapter: { ...db, update } });
    expect(screen.queryByRole("button", { name: /^Move to…/ })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("states", () => {
  test("a registry with no board component gets an error summary naming the view", async () => {
    const { Board: _none, ...layout } = mockRegistry.layout;
    const { db } = await seed();
    render(<BoardRenderer entity={entity} view={board} registry={{ ...mockRegistry, layout }} dataSources={new Map([["default", db]])} entities={documents.entities} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This registry has no layout.Board component, so the board view tasks_board cannot be shown.");
    expect(alert.querySelector("[data-path='/layout/Board'][data-code='required']")).toBeTruthy();
  });

  test("a missing data source or field is reported in the core error format", async () => {
    render(<BoardRenderer entity={entity} view={{ ...board, cardFields: ["nope"] }} registry={mockRegistry} dataSources={new Map()} />);
    const paths = [...(await screen.findByRole("alert")).querySelectorAll("li")].map((li) => li.getAttribute("data-path"));
    expect(paths).toEqual(["/dataSource", "/cardFields/0"]);
  });

  test("a failed load shows the message and a Retry that loads again", async () => {
    const { db } = await seed();
    let fail = true;
    const flaky: DataAdapter = { ...db, find: (name, query) => (fail ? Promise.reject(new Error("The server responded with status 503.")) : db.find(name, query)) };
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={new Map([["default", flaky]])} entities={documents.entities} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load records: The server responded with status 503.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Pay rent")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("past the cap a notice says how many cards are shown", async () => {
    const { db } = await seed();
    const item = (await db.find("task", {})).items[0]!;
    const many: DataAdapter = {
      ...db,
      find: (name, query) =>
        name === "task" ? Promise.resolve({ items: Array.from({ length: query.page?.limit ?? 500 }, (_, i) => ({ ...item, id: `${query.page && "offset" in query.page ? query.page.offset : 0}-${i}` })), total: 1412 }) : db.find(name, query),
    };
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={new Map([["default", many]])} entities={documents.entities} />);
    const notice = await screen.findByTestId("board-notice");
    expect(notice.textContent).toMatch(/Showing the first 1,000 of 1,412 cards\. Narrow the filter\./);
  });
});

describe("row action", () => {
  const withAction: BoardView = { ...board, rowAction: { open: "task_history", bind: [{ field: "list", to: "list" }] } };

  test("activating a card opens the target table for it, and Back returns to the same grouping", async () => {
    await open({ view: withAction });
    groupBy("done");
    await screen.findByTestId("column-v:true");
    fireEvent.click(screen.getByRole("button", { name: "Pay rent, Notes: Due soon" }));
    const heading = await screen.findByRole("heading", { name: "Task history: List = Home" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const table = await screen.findByRole("table", { name: "Task history" });
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBe(3)); // header + the two "Home" tasks
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("table", { name: "Task history" })).toBeNull();
    expect((screen.getByRole("combobox", { name: "Group by" }) as HTMLSelectElement).value).toBe("done");
  });

  test("cards are not buttons without a rowAction", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Pay rent, Notes: Due soon" })).toBeNull();
  });

  test("a row action whose target cannot be found is reported", async () => {
    const { db } = await seed();
    render(<BoardRenderer entity={entity} view={withAction} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={{ entities: documents.entities, views: new Map([[board.id, board]]) }} />);
    expect((await screen.findByRole("alert")).textContent).toContain('Row action opens "task_history", which is not a table view in the document set.');
  });
});

describe("record actions on cards (RFC 0007)", () => {
  const withActions: BoardView = {
    ...board,
    recordActions: ["publish", "archive"],
  };
  const actionsEntity: EntityDocument = {
    ...entity,
    actions: [{ id: "publish", label: "Publish" }, { id: "archive", label: "Archive", confirm: { message: "Archive it?", tone: "danger" }, input: [{ id: "reason", type: "text", label: "Reason" }] }],
  };

  /** Buttons inside one card (several cards offer the same actions). */
  const cardButton = (id: string, action: string): HTMLButtonElement =>
    within(screen.getByTestId(`card-${id}`)).getByTestId(`action-${action}`) as HTMLButtonElement;
  const confirmButton = (): HTMLButtonElement =>
    [...(document.querySelector("[data-testid='dialog']")?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Archive") as HTMLButtonElement;

  /** Seed the four tasks into an adapter built with these options; returns it with the record ids by title. */
  async function seeded(options: Parameters<typeof createMemoryAdapter>[0]): Promise<{ db: ReturnType<typeof createMemoryAdapter>; ids: Record<string, string> }> {
    const db = createMemoryAdapter(options);
    const ids: Record<string, string> = {};
    for (const values of [
      { title: "Pay rent", list: "Home", done: false, notes: "Due soon" },
      { title: "Call Ada", list: "Work", done: true },
      { title: "Book flights", list: "Home", done: false },
      { title: "Unsorted" },
    ]) {
      const record = await db.create("task", values, { entityRevision: 1 });
      ids[values.title] = record.id;
    }
    return { db, ids };
  }

  test("a card offers its available actions, an action runs and reloads, and a withheld action is hidden", async () => {
    let acts = 0;
    const { db, ids } = await seeded({
      actions: {
        "task.publish": (record) => {
          acts++;
          return { values: { notes: `published:${String(record.values.title)}` } };
        },
        "task.archive": () => ({ remove: true }),
      },
      recordPermissions: (record) => (record.values.title === "Call Ada" ? { actions: { publish: false } } : undefined),
    });
    render(
      <BoardRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} />,
    );
    await screen.findByText("Pay rent");
    expect(cardButton(ids["Pay rent"]!, "publish")).toBeTruthy();
    expect(cardButton(ids["Pay rent"]!, "archive")).toBeTruthy();
    expect(within(screen.getByTestId(`card-${ids["Call Ada"]}`)).queryByTestId("action-publish")).toBeNull(); // withheld by can.actions
    fireEvent.click(cardButton(ids["Pay rent"]!, "publish"));
    await waitFor(() => expect(acts).toBe(1));
    // waitFor(acts) proves the handler ran; the live region lands a tick later.
    await waitFor(() => expect(status()).toBe("Publish done")); // the view's live region carries it
    await waitFor(() => expect(screen.getByText("published:Pay rent")).toBeTruthy()); // reloaded with the new notes
    expect(titles("v:Home").sort()).toEqual(["Book flights", "Pay rent"]);
  });

  test("a press with no act: the data source replaced the board with an ErrorSummary", async () => {
    const { db } = await seed(); // no action handlers: the adapter does not advertise act
    render(<BoardRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} />);
    await waitFor(() => expect(document.querySelector("[data-testid='error-summary']")?.textContent).toContain("The data source of view tasks_board cannot run actions."));
    expect(screen.queryByTestId("board-columns")).toBeNull();
  });

  test("an action refused shows the view's ErrorSummary and reloads the cards", async () => {
    const { db, ids } = await seeded({
      actions: { "task.publish": () => { throw new ForbiddenError("Only editors may publish."); } },
      recordPermissions: () => ({ actions: { archive: false } }),
    });
    render(
      <BoardRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} />,
    );
    await screen.findByText("Pay rent");
    fireEvent.click(cardButton(ids["Pay rent"]!, "publish"));
    await waitFor(() => expect(document.querySelector("[data-testid='error-summary']")?.textContent).toContain("Only editors may publish."));
    await waitFor(() => expect(screen.getByText("Due soon")).toBeTruthy()); // reloaded; the card is as it was
  });

  test("an action with confirm and input opens the dialog built for layout.Dialog", async () => {
    const { db, ids } = await seeded({
      actions: { "task.publish": () => ({ values: {} }), "task.archive": (record, input) => ({ values: { notes: `archived:${String(input?.reason)}` } }) },
      recordPermissions: () => ({ actions: { publish: false } }),
    });
    render(
      <BoardRenderer entity={actionsEntity} view={withActions} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={documents.entities} documents={documents} />,
    );
    await screen.findByText("Pay rent");
    fireEvent.click(cardButton(ids["Pay rent"]!, "archive"));
    expect(document.querySelector("[data-testid='dialog']")?.getAttribute("aria-label")).toBe("Archive");
    expect(document.querySelector("[data-testid='dialog']")?.textContent).toContain("Archive it?");
    fireEvent.change(document.querySelector("[data-testid='input-reason']")!, { target: { value: "done" } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByText("archived:done")).toBeTruthy());
  });
});

describe("in a dashboard", () => {
  const dashboard: DashboardView = {
    kind: "dashboard",
    specVersion: 4,
    id: "overview",
    title: "Overview",
    revision: 1,
    tabs: [{ id: "plan", title: "Plan", items: [{ id: "b", x: 0, y: 0, w: 12, h: 8, widget: "view", view: "tasks_board" }] }],
  };

  test("the view widget embeds a board", async () => {
    const { db } = await seed();
    render(<DashboardRenderer dashboard={dashboard} documents={documents} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    expect(await screen.findByRole("group", { name: "Tasks" })).toBeTruthy();
    expect(await screen.findByText("Pay rent")).toBeTruthy();
  });

  test("a count widget pointing at a board is reported", async () => {
    const { db } = await seed();
    const bad: DashboardView = { ...dashboard, tabs: [{ id: "plan", title: "Plan", items: [{ id: "n", x: 0, y: 0, w: 4, h: 1, widget: "count", label: "Tasks", view: "tasks_board" }] }] };
    render(<DashboardRenderer dashboard={bad} documents={documents} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    expect((await screen.findByRole("alert")).textContent).toContain("needs a table view");
  });
});
