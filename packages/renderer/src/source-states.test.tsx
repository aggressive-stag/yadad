// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoardView, CalendarView, DataRecord, Document, EntityDocument, FormView, TableView } from "@yadad/core";
import { viewStates } from "@yadad/runtime";
import { createStateAdapter, mockRegistry, sourceStates } from "@yadad/testing";
import type { StateAdapter, StateAdapterOptions } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const NOW = new Date(2026, 9, 15, 10, 0, 0);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["Home", "Work"] } },
    { id: "due", type: "date", label: "Due" },
  ],
};
const base = { specVersion: 4 as const, revision: 1, dataSource: "default", entity: "task" };
const form: FormView = { ...base, kind: "form", id: "task_form", sections: [{ id: "main", items: [{ field: "title" }, { field: "list" }] }] };
const table: TableView = { ...base, kind: "table", id: "task_table", columns: [{ field: "title", editable: true }, { field: "list" }] };
const board: BoardView = { ...base, kind: "board", id: "task_board", groupBy: [{ field: "list" }], titleField: "title", editable: true };
const calendar: CalendarView = { ...base, kind: "calendar", id: "task_calendar", dateField: "due", editable: true };
const documents: Document[] = [entity, form, table, board, calendar];

const records: DataRecord[] = [
  { id: "rec-1", entityId: "task", entityRevision: 1, version: "1", values: { title: "Pay rent", list: "Home", due: "2026-10-15" } },
  { id: "rec-2", entityId: "task", entityRevision: 1, version: "1", values: { title: "Call Ada", list: "Work", due: "2026-10-16" } },
];

const sources = (adapter: StateAdapter) => new Map([["default", adapter]]);
const adapterWith = (options: StateAdapterOptions) => createStateAdapter(records, options);
const alert = () => screen.findByRole("alert");

describe("board in each source state", () => {
  const open = (adapter: StateAdapter) =>
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={sources(adapter)} />);
  const status = () => screen.getByTestId("board-status").textContent ?? "";
  const moveTo = (title: string, columnId: string): void => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Move to… ${title}`) }));
    fireEvent.change(screen.getByRole("combobox", { name: new RegExp(`^Move ${title}`) }), { target: { value: columnId } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
  };
  const home = () => [...screen.getByTestId("column-v:Home").querySelectorAll("[data-yadad-board-title]")].map((n) => n.textContent);

  test("loading shows the loading UI and no cards", async () => {
    open(adapterWith({ source: "loading" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("board").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Pay rent")).toBeNull();
  });

  test("a failed read shows ErrorSummary with the message", async () => {
    open(adapterWith({ source: "error", message: "Server is down" }));
    expect((await alert()).textContent).toContain("Could not load records: Server is down");
    expect(screen.getByTestId("error-summary")).toBeTruthy();
  });

  test("a refused save (400) puts the card back and shows the field error", async () => {
    const adapter = adapterWith({ source: "refused", field: "list", message: "Work is full." });
    open(adapter);
    await screen.findByText("Pay rent");
    moveTo("Pay rent", "v:Work");
    expect((await alert()).textContent).toContain("Work is full.");
    await waitFor(() => expect(home()).toContain("Pay rent"));
    expect(adapter.records().find((r) => r.id === "rec-1")?.values["list"]).toBe("Home");
  });

  test("a refused save (403) puts the card back and shows the message", async () => {
    open(adapterWith({ source: "refused", status: 403, message: "Not yours." }));
    await screen.findByText("Pay rent");
    moveTo("Pay rent", "v:Work");
    const shown = await alert();
    expect(shown.textContent).toContain("Not yours.");
    expect(shown.querySelector("[data-code='forbidden']")).toBeTruthy();
    await waitFor(() => expect(home()).toContain("Pay rent"));
    await waitFor(() => expect(status()).toBe("Could not move Pay rent: Not yours."));
  });

  test("a conflict shows the conflict message and puts the card back", async () => {
    open(adapterWith({ source: "conflict", message: "Changed elsewhere." }));
    await screen.findByText("Pay rent");
    moveTo("Pay rent", "v:Work");
    const shown = await alert();
    expect(shown.querySelector("[data-code='conflict']")).toBeTruthy();
    expect(shown.textContent).toContain("Changed elsewhere.");
    await waitFor(() => expect(home()).toContain("Pay rent"));
  });
});

describe("calendar in each source state", () => {
  const open = (adapter: StateAdapter) =>
    render(<CalendarRenderer entity={entity} view={calendar} registry={mockRegistry} dataSources={sources(adapter)} now={NOW} />);
  const cell = (date: string): HTMLElement => document.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
  const moveTo = (title: string, date: string): void => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Move to day… ${title}`) }));
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: date } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
  };

  test("loading shows the loading UI", async () => {
    open(adapterWith({ source: "loading" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("calendar").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Pay rent")).toBeNull();
  });

  test("a failed read shows ErrorSummary with the message", async () => {
    open(adapterWith({ source: "error", message: "Server is down" }));
    expect((await alert()).textContent).toContain("Could not load records: Server is down");
  });

  test.each([
    ["a 400", { source: "refused", message: "No weekends.", field: "due" } as const, "No weekends.", "invalid-value"],
    ["a 403", { source: "refused", status: 403, message: "Not yours." } as const, "Not yours.", "forbidden"],
    ["a 409", { source: "conflict", message: "Changed elsewhere." } as const, "Changed elsewhere.", "conflict"],
  ])("%s on a move reverts and shows the message", async (_name, options, message, code) => {
    open(adapterWith(options));
    await screen.findByText("Pay rent");
    moveTo("Pay rent", "2026-10-17");
    const shown = await alert();
    expect(shown.textContent).toContain(message);
    expect(shown.querySelector(`[data-code='${code}']`)).toBeTruthy();
    await waitFor(() => expect(within(cell("2026-10-15")).getByText("Pay rent")).toBeTruthy());
    expect(within(cell("2026-10-17")).queryByText("Pay rent")).toBeNull();
  });
});

describe("table in each source state", () => {
  const open = (adapter: StateAdapter) =>
    render(<TableRenderer entity={entity} view={table} registry={mockRegistry} dataSources={sources(adapter)} />);
  const firstRow = () => screen.getAllByRole("row")[1]!;
  const editAndSave = async (): Promise<void> => {
    await screen.findByText("Pay rent");
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(firstRow()).getByRole("textbox", { name: "Title" }), { target: { value: "Pay the rent" } });
    fireEvent.click(within(firstRow()).getByRole("button", { name: "Save" }));
  };

  test("loading shows the loading text", async () => {
    open(adapterWith({ source: "loading" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  test("a failed read shows the message", async () => {
    open(adapterWith({ source: "error", message: "Server is down" }));
    expect(await screen.findByText("Could not load records: Server is down")).toBeTruthy();
  });

  test.each([
    ["a 400", { source: "refused", message: "Title is taken.", field: "title" } as const, "Title is taken."],
    ["a 403", { source: "refused", status: 403, message: "Not yours." } as const, "Not yours."],
    ["a 409", { source: "conflict", message: "Changed elsewhere." } as const, undefined],
  ])("%s on an edit shows the error and does not change the record", async (_name, options, message) => {
    const adapter = adapterWith(options);
    open(adapter);
    await editAndSave();
    const shown = await alert();
    if (message) expect(shown.textContent).toContain(message);
    expect(adapter.records().find((r) => r.id === "rec-1")?.values["title"]).toBe("Pay rent");
  });
});

describe("form in each source state", () => {
  const open = (adapter: StateAdapter) =>
    render(<FormRenderer entity={entity} view={form} registry={mockRegistry} dataSources={sources(adapter)} />);
  const submit = (): void => {
    fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), { target: { value: "New task" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  };

  test("a refused save (400) shows the field error and keeps the draft", async () => {
    const adapter = adapterWith({ source: "refused", field: "title", message: "Title is taken." });
    open(adapter);
    submit();
    const shown = await alert();
    expect(shown.textContent).toContain("Title is taken.");
    expect(screen.getByRole("textbox", { name: /Title/ }).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("textbox", { name: /Title/ }) as HTMLInputElement).value).toBe("New task");
    expect(adapter.records()).toHaveLength(2);
  });

  test("a refused save (403) shows the message", async () => {
    open(adapterWith({ source: "refused", status: 403, message: "Not yours." }));
    submit();
    const shown = await alert();
    expect(shown.textContent).toContain("Not yours.");
    expect(shown.querySelector("[data-code='forbidden']")).toBeTruthy();
  });

  test("a conflict shows the conflict message", async () => {
    open(adapterWith({ source: "conflict" }));
    submit();
    const shown = await alert();
    expect(shown.querySelector("[data-code='conflict']")).toBeTruthy();
    expect(shown.textContent).toContain("changed elsewhere");
  });
});

describe("source states from viewStates", () => {
  test("every source state of a board renders with its own adapter", async () => {
    const result = sourceStates(viewStates(board, documents, { now: NOW }), documents);
    const error = result.states.find((s) => s.source === "error")!;
    render(<BoardRenderer entity={entity} view={board} registry={mockRegistry} dataSources={sources(error.adapter({ message: "Down" }))} />);
    expect((await alert()).textContent).toContain("Down");
  });
});
