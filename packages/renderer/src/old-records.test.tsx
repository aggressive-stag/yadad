// @vitest-environment jsdom
// What the engine does with records saved before the entity changed (card 87).
// These tests record today's behaviour; docs/records-protocol.md and
// ARCHITECTURE.md section 8 describe it. The only renderer that edits an
// existing record is the table, through its inline edit.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, FieldValue, RecordValues, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

// The entity today (revision 3). Since the records below were saved, `legacy`
// was removed, `priority` became required and "archived" left `status`.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 10,
  id: "task",
  revision: 3,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "closed"] } },
    { id: "priority", type: "number", label: "Priority", required: true },
  ],
};

const view: TableView = {
  kind: "table",
  specVersion: 10,
  id: "tasks",
  entity: "task",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "title", editable: true }, { field: "status" }, { field: "priority" }],
};

interface UpdateCall {
  readonly id: string;
  readonly patch: Readonly<Record<string, FieldValue>>;
  readonly entityRevision: number;
}

async function open(values: RecordValues, entityRevision: number): Promise<{ calls: UpdateCall[]; db: DataAdapter; row: () => HTMLElement }> {
  const db = createMemoryAdapter();
  await db.create("task", values, { entityRevision });
  const calls: UpdateCall[] = [];
  const adapter: DataAdapter = {
    ...db,
    update: async (entityId, id, patch, meta) => {
      calls.push({ id, patch: { ...patch }, entityRevision: meta.entityRevision });
      return db.update(entityId, id, patch, meta);
    },
  };
  render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", adapter]])} />);
  await screen.findAllByRole("row");
  await waitFor(() => expect(screen.getAllByRole("row").length).toBe(2));
  return { calls, db, row: () => screen.getAllByRole("row")[1]! };
}

async function editTitle(row: () => HTMLElement, value: string): Promise<void> {
  fireEvent.click(within(row()).getByRole("button", { name: "Edit" }));
  const input = await within(row()).findByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value } });
  fireEvent.click(within(row()).getByRole("button", { name: "Save" }));
}

describe("a record saved before the entity changed", () => {
  test("a value for a field the entity no longer has: the table ignores it and a save sends only the changed field", async () => {
    const { calls, db, row } = await open({ title: "A", status: "open", priority: 1, legacy: "old" }, 1);
    expect(row().textContent).toContain("A");
    expect(row().textContent).not.toContain("old");
    await editTitle(row, "A2");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.patch).toEqual({ title: "A2" }); // `legacy` is not sent
    expect(calls[0]!.entityRevision).toBe(3); // the record is re-stamped with the entity's revision
    const stored = (await db.find("task", {})).items[0]!;
    expect(stored.values["legacy"]).toBe("old"); // the server still holds it: the client never strips it
    expect(stored.entityRevision).toBe(3);
  });

  test("a record missing a field that became required: the cell is empty and a save of another field is refused on the client", async () => {
    const { calls, row } = await open({ title: "B", status: "open" }, 1);
    expect(row().textContent).toContain("B");
    await editTitle(row, "B2");
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(calls.length).toBe(0); // validateRecord refused it before any request
    expect(screen.getAllByRole("alert")[0]!.textContent).toMatch(/Priority/);
  });

  test("a select value that is no longer an option: shown as stored, and a save of another field is refused on the client", async () => {
    const { calls, row } = await open({ title: "C", status: "archived", priority: 2 }, 1);
    expect(row().textContent).toContain("archived");
    await editTitle(row, "C2");
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(calls.length).toBe(0);
    expect(screen.getAllByRole("alert")[0]!.textContent).toMatch(/Status/);
  });

  test("an otherwise valid record with a lower entityRevision: shown and edited like any other, and re-stamped on save", async () => {
    const { calls, db, row } = await open({ title: "D", status: "closed", priority: 3 }, 1);
    expect(row().textContent).toContain("D");
    await editTitle(row, "D2");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ patch: { title: "D2" }, entityRevision: 3 });
    expect((await db.find("task", {})).items[0]!.entityRevision).toBe(3);
  });
});
