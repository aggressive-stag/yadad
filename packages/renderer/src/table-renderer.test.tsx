// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, FormView, TableView } from "@yadad/core";
import type { DocumentSet } from "./document-set.js";
import { createDraftStore, createMemoryAdapter } from "@yadad/runtime";
import type { DraftStorage, DraftStore } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "workout_set",
  revision: 3,
  fields: [
    { id: "day", type: "date", label: "Day", required: true },
    { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    { id: "weight", type: "number", label: "Weight", min: 0, step: 2.5 },
    { id: "done", type: "boolean", label: "Done" },
  ],
};

const view: TableView = {
  kind: "table",
  specVersion: 0,
  id: "sets",
  title: "Sets",
  entity: "workout_set",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "day" }, { field: "exercise" }, { field: "weight", editable: true }, { field: "done", editable: true }],
  sort: [{ field: "day", dir: "desc" }],
  pageSize: 2,
};

async function setup(props: { view?: TableView; drafts?: { readonly store: DraftStore; readonly debounceMs?: number }; savedFilter?: string; onSavedFilterChange?: (id: string | undefined) => void; dataSources?: ReadonlyMap<string, DataAdapter> } = {}): Promise<{ db: DataAdapter; rerender: (key: number) => void; remount: () => Promise<void> }> {
  const db = createMemoryAdapter();
  for (const values of [
    { day: "2026-10-01", exercise: "Squat", weight: 100, done: true },
    { day: "2026-10-03", exercise: "Bench", weight: 80, done: false },
    { day: "2026-10-02", exercise: "Squat", weight: 105, done: true },
  ]) {
    await db.create("workout_set", values, { entityRevision: 1 });
  }
  const dataSources = props.dataSources ?? new Map([["default", db]]);
  const ui = (key: number) => (
    <TableRenderer
      entity={entity}
      view={props.view ?? view}
      registry={mockRegistry}
      dataSources={dataSources}
      reloadKey={key}
      {...(props.drafts !== undefined ? { drafts: props.drafts } : {})}
      {...(props.savedFilter !== undefined ? { savedFilter: props.savedFilter } : {})}
      {...(props.onSavedFilterChange !== undefined ? { onSavedFilterChange: props.onSavedFilterChange } : {})}
    />
  );
  const { rerender, unmount } = render(ui(0));
  await screen.findAllByRole("row");
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return {
    db,
    rerender: (key) => rerender(ui(key)),
    remount: async () => {
      unmount();
      render(ui(0));
      await screen.findAllByRole("row");
      await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    },
  };
}

function memoryStorage(): DraftStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** Day of each body row, top to bottom. */
const days = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);

const header = (label: string) => screen.getByRole("columnheader", { name: new RegExp(`^${label}`) });

describe("TableRenderer", () => {
  test("loads one page of rows in the view's default sort", async () => {
    await setup();
    expect(screen.getByRole("table", { name: "Sets" })).toBeTruthy();
    expect(days()).toEqual(["2026-10-03", "2026-10-02"]);
    expect(header("Day").getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  test("clicking a header sorts by it; clicking again flips it", async () => {
    await setup();
    fireEvent.click(within(header("Weight")).getByRole("button"));
    await waitFor(() => expect(days()).toEqual(["2026-10-03", "2026-10-01"]));
    expect(header("Weight").getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(within(header("Weight")).getByRole("button"));
    await waitFor(() => expect(days()).toEqual(["2026-10-02", "2026-10-01"]));
  });

  test("pages through records", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(days()).toEqual(["2026-10-01"]));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("can.fields locks an inline-editable cell while its row stays editable (RFC 0008 item 9)", async () => {
    const db = createMemoryAdapter();
    await db.create("workout_set", { day: "2026-10-01", exercise: "Squat", weight: 100, done: true }, { entityRevision: 1 });
    const locked: DataAdapter = {
      ...db,
      async find(entity, query) {
        const page = await db.find(entity, query);
        return { ...page, items: page.items.map((r) => ({ ...r, can: { ...r.can, fields: { weight: false } } })) };
      },
    };
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", locked]])} />);
    await screen.findAllByRole("row");
    const firstRow = screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow).getByRole("button", { name: "Edit" })); // the row has an editable field left: done
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).queryByRole("spinbutton", { name: "Weight" })).toBeNull(); // locked: renders as display
    expect(within(row).getByText("100")).toBeTruthy();
    expect(within(row).getByRole("checkbox", { name: "Done" })).toBeTruthy(); // can.fields narrows, it does not forbid
  });

  test("a tags quick filter matches any typed tag and chips combine with or", async () => {
    const tagEntity: EntityDocument = {
      kind: "entity", specVersion: 8, id: "note", revision: 1,
      fields: [{ id: "body", type: "text", label: "Body" }, { id: "tags", type: "tags", label: "Tags" }],
    };
    const tagView: TableView = { kind: "table", specVersion: 8, id: "notes", title: "Notes", entity: "note", revision: 1, dataSource: "default", columns: [{ field: "body" }], quickFilters: [{ field: "tags" }] };
    const db = createMemoryAdapter();
    await db.create("note", { body: "urgent one", tags: ["urgent", "home"] }, { entityRevision: 1 });
    await db.create("note", { body: "home only", tags: ["home"] }, { entityRevision: 1 });
    await db.create("note", { body: "no tags" }, { entityRevision: 1 });
    render(<TableRenderer entity={tagEntity} view={tagView} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await screen.findAllByRole("row");
    const bodies = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(bodies().sort()).toEqual(["home only", "no tags", "urgent one"]);
    const chipInput = () => screen.getByTestId("input-tags") as HTMLInputElement;
    fireEvent.change(chipInput(), { target: { value: "urgent" } });
    await waitFor(() => expect(bodies()).toEqual(["urgent one"]));
    fireEvent.change(chipInput(), { target: { value: "urgent, home" } });
    await waitFor(() => expect(bodies().sort()).toEqual(["home only", "urgent one"])); // ANY tag matches
    fireEvent.change(chipInput(), { target: { value: "" } });
    await waitFor(() => expect(bodies().sort()).toEqual(["home only", "no tags", "urgent one"])); // no chips, no filter
  });

  test("entering edit mode focuses the row's first editable input", async () => {
    await setup();
    const firstRow = screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow).getByRole("button", { name: "Edit" }));
    const weight = within(screen.getAllByRole("row")[1]!).getByRole("spinbutton", { name: "Weight" });
    await waitFor(() => expect(document.activeElement).toBe(weight));
  });

  test("edits a row in place: validates first, then saves under the current revision", async () => {
    const { db } = await setup();
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));

    const weight = within(firstRow()).getByRole("spinbutton", { name: "Weight" });
    fireEvent.change(weight, { target: { value: "81" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("multiple of 2.5");
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(weight.getAttribute("aria-describedby")).toBe(alert.id);

    fireEvent.change(weight, { target: { value: "82.5" } });
    fireEvent.click(within(firstRow()).getByRole("checkbox", { name: "Done" }));
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(firstRow()).queryByRole("spinbutton")).toBeNull());
    expect(firstRow().textContent).toContain("82.5");
    const saved = (await db.find("workout_set", {})).items.find((r) => r.values["day"] === "2026-10-03");
    expect(saved).toMatchObject({ entityRevision: 3, values: { weight: 82.5, done: true, exercise: "Bench" } });
  });

  test("surfaces a conflict when the record changed elsewhere and does not overwrite", async () => {
    const { db } = await setup();
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));

    // While it is open for editing, another writer changes the same record.
    const target = (await db.find("workout_set", { filter: { op: "eq", field: "day", value: "2026-10-03" } })).items[0]!;
    await db.update("workout_set", target.id, { weight: 999 }, { entityRevision: 3, baseVersion: target.version });

    // The row still holds the stale version; saving must show a conflict, not overwrite.
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "82.5" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("changed elsewhere");
    expect(within(firstRow()).queryByRole("spinbutton", { name: "Weight" })).toBeTruthy();
  });

  test("Cancel discards an edit", async () => {
    await setup();
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "50" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Cancel" }));
    expect(firstRow().textContent).toContain("80");
    expect(firstRow().textContent).not.toContain("50");
  });

  test("reloads when reloadKey changes", async () => {
    const { db, rerender } = await setup();
    await db.create("workout_set", { day: "2026-10-04", exercise: "Squat" }, { entityRevision: 3 });
    rerender(1);
    await waitFor(() => expect(days()[0]).toBe("2026-10-04"));
  });

  test("a view without editable columns has no actions column", async () => {
    await setup({ view: { ...view, columns: [{ field: "day" }, { field: "weight" }] } });
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("table drafts", () => {
  /** The stored draft of the Bench row (2026-10-03) — its id comes from the seeded adapter. */
  async function benchId(db: DataAdapter): Promise<string> {
    const page = await db.find("workout_set", { filter: { op: "eq", field: "day", value: "2026-10-03" } });
    return page.items[0]!.id;
  }

  test("typed input in an open edit survives a reload and comes back with a notice", async () => {
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "95" } });
    const id = await benchId(db);
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy());

    await remount();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    const weight = within(firstRow()).getByRole("spinbutton", { name: "Weight" });
    expect((weight as HTMLInputElement).value).toBe("95");
    expect(screen.getByRole("status").textContent).toContain("Restored unsaved changes");
  });

  test("a draft whose typed value no longer fits the schema is restored AND flagged, never dropped", async () => {
    // Card 44c: a stale draft must not be dropped or restored silently. The
    // value (the user's work) comes back, the field is marked invalid, the
    // ErrorSummary names it, and Save is refused until it is fixed.
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const id = await benchId(db);
    // A string in a number field: what a storage/schema drift produces, and
    // exactly what restoreDraft now flags instead of dropping.
    storage.data.set(`yadad:draft:sets:${id}`, JSON.stringify({ values: { weight: "eighty-ish" }, entityRevision: 1, savedAt: Date.now(), recordVersion: "1" }));

    await remount();
    fireEvent.click(within(screen.getAllByRole("row")[1]!).getByRole("button", { name: "Edit" }));
    const weight = within(screen.getAllByRole("row")[1]!).getByRole("spinbutton", { name: "Weight" });
    // The mock number Input is <input type=number>, which cannot render the
    // malformed string — the browser filters it. What the engine guarantees:
    // the field is marked invalid (the value itself stays in form state).
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Restored unsaved changes");
    expect(document.getElementById(`${screen.getByRole("table").id}-edit-errors`)?.textContent ?? document.body.textContent).toContain("must be");

    fireEvent.click(within(screen.getAllByRole("row")[1]!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save" }).length).toBe(1)); // still editing — refused
    const page = await db.find("workout_set", { filter: { op: "eq", field: "day", value: "2026-10-03" } });
    expect(page.items[0]!.values.weight).toBe(80); // the stored record untouched
  });

  test("saving clears the draft; reopening starts from the saved value", async () => {
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "85" } });
    const id = await benchId(db);
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy());
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeUndefined());

    await remount();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    expect((within(firstRow()).getByRole("spinbutton", { name: "Weight" }) as HTMLInputElement).value).toBe("85");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("Cancel clears the draft", async () => {
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "95" } });
    const id = await benchId(db);
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy());
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Cancel" }));
    expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeUndefined();

    await remount();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    expect((within(firstRow()).getByRole("spinbutton", { name: "Weight" }) as HTMLInputElement).value).toBe("80");
  });

  test("a refused save keeps the draft", async () => {
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    // 81 is not a multiple of the field's step (2.5): the save is refused.
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "81" } });
    const id = await benchId(db);
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy());
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy();

    await remount();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    expect((within(firstRow()).getByRole("spinbutton", { name: "Weight" }) as HTMLInputElement).value).toBe("81");
  });

  test("Discard empties the restored values and clears the draft", async () => {
    const storage = memoryStorage();
    const { db, remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "95" } });
    const id = await benchId(db);
    await waitFor(() => expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeTruthy());

    await remount();
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("status")).toBeNull();
    // Empty state means "start from the record again": the cell shows the saved value, not the draft.
    expect((within(firstRow()).getByRole("spinbutton", { name: "Weight" }) as HTMLInputElement).value).toBe("80");
    expect(storage.data.get(`yadad:draft:sets:${id}`)).toBeUndefined();
  });

  test("a draft belongs to its own row: editing another row does not restore it", async () => {
    const storage = memoryStorage();
    const { remount } = await setup({ drafts: { store: createDraftStore(storage), debounceMs: 0 } });
    const firstRow = () => screen.getAllByRole("row")[1]!;
    const secondRow = () => screen.getAllByRole("row")[2]!;
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("spinbutton", { name: "Weight" }), { target: { value: "95" } });
    await waitFor(() => expect([...storage.data.keys()].length).toBe(1));

    await remount();
    fireEvent.click(within(secondRow()).getByRole("button", { name: "Edit" }));
    // The second row's own weight, not the first row's typed draft, and no notice.
    expect((within(secondRow()).getByRole("spinbutton", { name: "Weight" }) as HTMLInputElement).value).toBe("105");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("RFC 0008 surfaces (card 47e)", () => {
  const formView: FormView = {
    kind: "form",
    specVersion: 8,
    id: "set-new",
    entity: "workout_set",
    revision: 1,
    dataSource: "default",
    sections: [{ id: "main", title: "New set", items: [{ field: "day" }] }],
  };

  async function seedSets(): Promise<DataAdapter> {
    const db = createMemoryAdapter();
    for (const values of [
      { day: "2026-10-01", exercise: "Squat", weight: 100, done: true },
      { day: "2026-10-03", exercise: "Bench", weight: 80, done: false },
      { day: "2026-10-02", exercise: "Squat", weight: 105, done: true },
    ]) {
      await db.create("workout_set", values, { entityRevision: 1 });
    }
    return db;
  }

  test("view.addForm puts an Add control under the table that opens the form and creates on save (item 10)", async () => {
    const db = await seedSets();
    const create = vi.fn(db.create);
    const docs: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map([[formView.id, formView]]) };
    render(
      <TableRenderer entity={entity} view={{ ...view, addForm: formView.id }} registry={mockRegistry} dataSources={new Map([["default", { ...db, create }]])} documents={docs} />,
    );
    await screen.findByText("2026-10-03");
    fireEvent.click(screen.getByRole("button", { name: "Add workout_set" }));
    const panel = (await screen.findByText("New set")).closest("form")!;
    fireEvent.input(within(panel).getByTestId("input-day"), { target: { value: "2026-10-05" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toEqual({ day: "2026-10-05" });
    // The panel closes and the rows reload without the host touching reloadKey.
    await screen.findByText("2026-10-05");
    expect(screen.queryByText("New set")).toBeNull(); // the panel closes on save
  });

  test("a missing add form names the broken reference instead of dropping the control silently (item 10)", async () => {
    const db = await seedSets();
    const docs: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map() };
    render(
      <TableRenderer entity={entity} view={{ ...view, addForm: "ghost" }} registry={mockRegistry} dataSources={new Map([["default", db]])} documents={docs} />,
    );
    await screen.findByText("2026-10-03");
    expect((await screen.findByRole("alert")).textContent).toContain('not a form view');
  });

  test("the registry's Pager slot drives paging (item 6)", async () => {
    const db = await seedSets();
    render(<TableRenderer entity={entity} view={{ ...view, pageSize: 1 }} registry={mockRegistry} dataSources={new Map([["default", db]])} documents={{ entities: new Map([[entity.id, entity]]), views: new Map() }} />);
    await screen.findByText("2026-10-03");
    const pager = await screen.findByTestId("mock-pager");
    expect(pager.getAttribute("aria-label")).toBe("Sets pages");
    expect(pager.querySelector("span")?.textContent).toBe("Page 1 of 3");
    fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(pager.querySelector("span")?.textContent).toBe("Page 2 of 3"));
    expect(days()).toEqual(["2026-10-02"]);
  });

  // RFC 0009 item 5: named saved filters as chips. The renderer draws them and
  // joins the lit one's condition into the query; which chip is lit is host state.
  const filteredView: TableView = {
    ...view,
    pageSize: 10,
    filters: [
      { id: "heavy", name: "Heavy", condition: { op: "gte", field: "weight", value: 100 } },
      { id: "bench", name: "Bench day", condition: { op: "eq", field: "exercise", value: "Bench" } },
    ],
  };

  test("a view's named filters render as a chip row", async () => {
    await setup({ view: filteredView });
    const nav = screen.getByRole("navigation", { name: "Saved filters" });
    const chips = within(nav).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Heavy", "Bench day"]);
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  test("pressing a chip reports its id; the host lights it, pressing the lit chip clears it", async () => {
    const onSavedFilterChange = vi.fn();
    await setup({ view: filteredView, onSavedFilterChange });
    const nav = () => screen.getByRole("navigation", { name: "Saved filters" });
    fireEvent.click(within(nav()).getByRole("button", { name: "Heavy" }));
    expect(onSavedFilterChange).toHaveBeenLastCalledWith("heavy");
    // The renderer keeps no chip state: until the host re-renders with savedFilter,
    // the chip stays unlit and pressing it reports the id again.
    fireEvent.click(within(nav()).getByRole("button", { name: "Heavy" }));
    expect(onSavedFilterChange).toHaveBeenLastCalledWith("heavy");
    // Host accepts the choice: now it is lit, and a press means "clear".
    cleanup();
    await setup({ view: filteredView, savedFilter: "heavy", onSavedFilterChange });
    expect(within(nav()).getByRole("button", { name: "Heavy" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(nav()).getByRole("button", { name: "Heavy" }));
    expect(onSavedFilterChange).toHaveBeenLastCalledWith(undefined);
  });

  test("the lit chip's condition narrows the rows and its filter rides the adapter query", async () => {
    // seeded days: 10-01 (100), 10-03 (80), 10-02 (105); Heavy = weight >= 100.
    let seen: unknown = "never";
    const inner = createMemoryAdapter();
    for (const values of [
      { day: "2026-10-01", exercise: "Squat", weight: 100, done: true },
      { day: "2026-10-03", exercise: "Bench", weight: 80, done: false },
      { day: "2026-10-02", exercise: "Squat", weight: 105, done: true },
    ]) {
      await inner.create("workout_set", values, { entityRevision: 1 });
    }
    const spy: DataAdapter = {
      ...inner,
      async find(e, q) {
        seen = q.filter;
        return inner.find(e, q);
      },
    };
    await setup({ view: filteredView, savedFilter: "heavy", dataSources: new Map([["default", spy]]) });
    await waitFor(() => expect(days()).toEqual(["2026-10-02", "2026-10-01"])); // 80 is out
    expect(seen).toMatchObject({ op: "gte", field: "weight", value: 100 }); // the saved condition, not post-filtering
    const nav = screen.getByRole("navigation", { name: "Saved filters" });
    expect(within(nav).getByRole("button", { name: "Heavy" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("an unknown savedFilter id filters nothing and lights no chip", async () => {
    await setup({ view: filteredView, savedFilter: "ghost" });
    expect(days()).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    const nav = screen.getByRole("navigation", { name: "Saved filters" });
    expect(within(nav).getAllByRole("button").every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });

});
