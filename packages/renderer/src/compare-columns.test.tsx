// @vitest-environment jsdom
import type { EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "note",
  revision: 1,
  fields: [
    { id: "body", type: "text", label: "Body" },
    { id: "title", type: "text", label: "Title" },
  ],
};

/** History sorted oldest first: `previousRow` is the previous version (RFC 0007 "Meaning"). */
const table = (compare: NonNullable<TableView["columns"][number]["compare"]>, extra: Partial<TableView> = {}): TableView => ({
  kind: "table",
  specVersion: 1,
  id: "notes",
  entity: "note",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "body", compare }],
  ...extra,
});

async function seeded(count: number): Promise<ReturnType<typeof createMemoryAdapter>> {
  const db = createMemoryAdapter();
  const bodies = ["one", "one two", "one two three", "one two three four", "one two three five", "one"];
  for (let i = 0; i < count; i++) {
    await db.create("note", { body: bodies[i % bodies.length]!, title: `note ${i}` }, { entityRevision: 1 });
  }
  return db;
}

const bodyCells = () => screen.getAllByRole("row").slice(1).flatMap((r) => [...r.querySelectorAll("[data-testid='display-body']")]);
const marks = (cell: Element): string =>
  [...cell.querySelectorAll("ins, del")]
    .map((m) => `${m.tagName === "INS" ? "+" : "-"}${m.textContent?.replace(/^(added: |removed: )/, "") ?? ""}`)
    .join(" ");

/** The cell's "after" side: same + added text, with <del> rows and the hidden labels stripped — must equal the cell's own value. */
const afterText = (cell: Element): string => {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("del, [data-testid='diff-added-label'], [data-testid='diff-removed-label']").forEach((n) => n.remove());
  return clone.textContent ?? "";
};

/** The cell as the eye reads it: the diff text without the visually hidden "added:"/"removed:" labels. */
const visibleText = (cell: Element): string => {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("[data-testid='diff-added-label'], [data-testid='diff-removed-label']").forEach((n) => n.remove());
  return clone.textContent ?? "";
};

describe("compare columns", () => {
  test("previousRow marks what changed against the row above; the oldest row is plain", async () => {
    const db = await seeded(3); // "one" | "one two" | "one two three"
    render(<TableRenderer entity={entity} view={table({ to: "previousRow" })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(3));
    const [first, second, third] = bodyCells();
    expect(first!.querySelectorAll("ins, del")).toHaveLength(0); // the oldest version: no neighbour, plain text
    expect(marks(second!)).toBe("+ two");
    expect(visibleText(third!)).toBe("one two three"); // the after is the row's own text
  });

  test("nextRow diffs against the row below; the newest row is plain", async () => {
    const db = await seeded(3);
    render(<TableRenderer entity={entity} view={table({ to: "nextRow" })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(3));
    const [first, second, third] = bodyCells();
    expect(marks(first!)).toBe("- two"); // before is next row: "two" is in it and not here
    expect(marks(second!)).toBe("- three");
    expect(third!.querySelectorAll("ins, del")).toHaveLength(0);
  });

  test("field diffs the column against another text field of the same record", async () => {
    const db = await seeded(2); // body "one"/"one two", title "note 0"/"note 1"
    render(<TableRenderer entity={entity} view={table({ field: "title" })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(2));
    const [first, second] = bodyCells();
    // before = title ("note 0"), after = body ("one"): nothing shared, so the title's words drop and the body's appear.
    expect(marks(first!)).toContain("+one");
    expect(marks(first!)).toContain("-note");
    expect(afterText(second!)).toBe("one two"); // after = the cell's own value
  });

  test("an empty comparator counts as the empty string: everything is added", async () => {
    const db = createMemoryAdapter();
    await db.create("note", { body: "words" }, { entityRevision: 1 }); // no title to compare with
    render(<TableRenderer entity={entity} view={table({ field: "title" })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(1));
    const cell = bodyCells()[0]!;
    expect(cell.querySelector("del")).toBeNull();
    expect(cell.querySelector("ins")?.textContent).toBe("added: words"); // the hidden label, not colour
    expect(cell.textContent).toBe("added: words");
  });

  test("the first row of page two still has its neighbour, and the extra row is not shown", async () => {
    const db = await seeded(4); // bodies: one | one two | one two three | one two three four
    render(<TableRenderer entity={entity} view={table({ to: "previousRow" }, { pageSize: 2 })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(2));
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    // page 2: rows "one two three" and "one two three four"
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    next.click();
    await waitFor(() => expect(bodyCells()).toHaveLength(2)); // NOT 3: the edge row stays out of the table
    const [first] = bodyCells();
    expect(visibleText(first!)).toBe("one two three");
    expect(marks(first!)).toBe("+ three"); // diffed against page 1's last row, loaded from beyond the edge
  });

  test("the oldest row overall is plain even when it is the first row of a page", async () => {
    const db = await seeded(4);
    render(<TableRenderer entity={entity} view={table({ to: "previousRow" }, { pageSize: 2 })} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(bodyCells()).toHaveLength(2));
    const [first] = bodyCells();
    expect(first!.querySelectorAll("ins, del")).toHaveLength(0); // offset-0 page: neighbourQuery clamps, there is nothing older
  });
});
