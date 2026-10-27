// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DataAdapter, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const owner: EntityDocument = { kind: "entity", specVersion: 10, id: "owner", revision: 1, fields: [{ id: "name", type: "text", label: "Name" }] };
const task: EntityDocument = {
  kind: "entity",
  specVersion: 10,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "owner", type: "reference", label: "Owner", entity: "owner" },
    { id: "state", type: "select", label: "State", options: { source: "static", values: [{ value: "open", label: "Open item" }, "done"] } },
  ],
  actions: [
    { id: "drop", label: "Drop", confirm: { message: "Drop this task?", subjectField: "owner" } },
    { id: "close", label: "Close", confirm: { message: "Close this task?", subjectField: "state" } },
  ],
};
const entities = new Map([["owner", owner], ["task", task]]);
const view: TableView = {
  kind: "table",
  specVersion: 10,
  id: "tasks",
  entity: "task",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "title" }, { field: "owner" }],
  quickFilters: [{ field: "owner" }],
  recordActions: ["drop", "close"],
};

async function seeded(): Promise<DataAdapter> {
  const db = createMemoryAdapter({ actions: { "task.drop": () => ({ values: {} }), "task.close": () => ({ values: {} }) } });
  const ann = await db.create("owner", { name: "Ann" }, { entityRevision: 1 });
  const bo = await db.create("owner", { name: "Bo" }, { entityRevision: 1 });
  await db.create("task", { title: "one", owner: ann.id, state: "open" }, { entityRevision: 1 });
  await db.create("task", { title: "two", owner: bo.id, state: "open" }, { entityRevision: 1 });
  return db;
}

const show = (db: DataAdapter, v: TableView = view) => render(<TableRenderer entity={task} view={v} registry={mockRegistry} dataSources={new Map([["default", db]])} entities={entities} />);
const titles = () => [...document.querySelectorAll("[data-testid='display-title']")].map((e) => e.textContent);

describe("reference quick filter (RFC 0011 item 3)", () => {
  test("offers the target records by label and filters on the chosen id; clearing restores", async () => {
    show(await seeded());
    await waitFor(() => expect(titles()).toEqual(["one", "two"]));
    const select = (await waitFor(() => {
      const el = document.querySelector("[data-yadad-filter-field='owner'] select") as HTMLSelectElement;
      expect(el.querySelectorAll("option").length).toBeGreaterThan(2);
      return el;
    }));
    expect([...select.querySelectorAll("option")].map((o) => o.textContent).slice(1)).toEqual(["Ann", "Bo"]);
    const bo = [...select.querySelectorAll("option")].find((o) => o.textContent === "Bo")!;
    fireEvent.change(select, { target: { value: bo.getAttribute("value") } });
    await waitFor(() => expect(titles()).toEqual(["two"]));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(titles()).toEqual(["one", "two"]));
  });

  test("a failed load shows an inline message and the table still works", async () => {
    const db = await seeded();
    const failing: DataAdapter = Object.assign(Object.create(db), { find: (entity: string, query: never) => (entity === "owner" ? Promise.reject(new Error("boom")) : db.find(entity, query)) }) as DataAdapter;
    show(failing);
    await waitFor(() => expect(document.querySelector("[data-yadad-filter-error]")?.textContent).toContain("boom"));
    expect(titles()).toEqual(["one", "two"]);
  });

  test("while loading, the control is disabled inside the filter", async () => {
    const db = await seeded();
    const slow: DataAdapter = Object.assign(Object.create(db), { find: (entity: string, query: never) => (entity === "owner" ? new Promise(() => undefined) : db.find(entity, query)) }) as DataAdapter;
    show(slow);
    await waitFor(() => expect(document.querySelector("[data-yadad-filter-loading]")).not.toBeNull());
    expect((document.querySelector("[data-yadad-filter-field='owner'] select") as HTMLSelectElement).matches(":disabled")).toBe(true);
  });
});

describe("confirm subject line (RFC 0011 item 2)", () => {
  test("a reference subject shows the target's label", async () => {
    show(await seeded());
    await waitFor(() => expect(document.querySelector("[data-testid='action-drop']")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-testid='action-drop']") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-yadad-confirm-subject]")?.textContent).toContain("Ann"));
    expect(document.querySelector("[data-yadad-confirm-subject]")?.tagName).toBe("P");
  });

  test("a labelled option subject shows its label", async () => {
    show(await seeded());
    await waitFor(() => expect(document.querySelector("[data-testid='action-close']")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-testid='action-close']") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-yadad-confirm-subject]")).not.toBeNull());
    expect(screen.getByText("Close this task?")).toBeTruthy();
  });
});
