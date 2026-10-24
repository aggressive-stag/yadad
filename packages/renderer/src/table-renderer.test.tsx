// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, TableView } from "@yadad/core";
import { createDraftStore, createMemoryAdapter } from "@yadad/runtime";
import type { DraftStorage, DraftStore } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
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

async function setup(props: { view?: TableView; drafts?: { readonly store: DraftStore; readonly debounceMs?: number } } = {}): Promise<{ db: DataAdapter; rerender: (key: number) => void; remount: () => Promise<void> }> {
  const db = createMemoryAdapter();
  for (const values of [
    { day: "2026-10-01", exercise: "Squat", weight: 100, done: true },
    { day: "2026-10-03", exercise: "Bench", weight: 80, done: false },
    { day: "2026-10-02", exercise: "Squat", weight: 105, done: true },
  ]) {
    await db.create("workout_set", values, { entityRevision: 1 });
  }
  const dataSources = new Map([["default", db]]);
  const ui = (key: number) => (
    <TableRenderer entity={entity} view={props.view ?? view} registry={mockRegistry} dataSources={dataSources} reloadKey={key} {...(props.drafts !== undefined ? { drafts: props.drafts } : {})} />
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
