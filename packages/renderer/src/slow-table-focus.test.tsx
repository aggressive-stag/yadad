// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, Registry, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

// Card 57e: a row action with a confirm dialog over an adapter that answers over a network. The table keeps the
// old rows until the new ones land, then the component set rebuilds every row (a new key per load stands in
// for that): the rebuild lands long after the focus return's short re-arm window.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "doc",
  revision: 1,
  fields: [
    { id: "n", type: "number", label: "N" },
    { id: "tag", type: "text", label: "Tag" },
  ],
  actions: [{ id: "reject", label: "Reject", confirm: { title: "Reject this", message: "Reject this record?", confirmLabel: "Confirm" } }],
};
const view: TableView = { kind: "table", specVersion: 1, id: "rows", entity: "doc", revision: 1, dataSource: "default", columns: [{ field: "n" }, { field: "tag" }], recordActions: ["reject"] };

let landed = 0; // counts finds that have answered: a new load rebuilds every row
const registry: Registry<ReactNode> = {
  ...mockRegistry,
  layout: {
    ...mockRegistry.layout,
    Table: (props) => {
      return <Fragment key={landed}>{mockRegistry.layout.Table(props)}</Fragment>;
    },
  },
};

function slowTable(db: DataAdapter, ms: { act: number; find: number }): DataAdapter {
  const wait = (n: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, n));
  return {
    ...db,
    act: async (...args: Parameters<NonNullable<DataAdapter["act"]>>) => {
      await wait(ms.act);
      return db.act!(...args);
    },
    find: async (...args: Parameters<DataAdapter["find"]>) => {
      await wait(ms.find);
      landed += 1;
      return db.find(...args);
    },
  };
}

/** A host that re-renders now and then (a clock, a sibling widget's state): every render reaches the focus-return effect. */
function Host({ children }: { children: () => ReactNode }): ReactNode {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 400);
    return () => clearInterval(timer);
  }, []);
  return children();
}

async function open(find: number) {
  const db = createMemoryAdapter({ actions: { "doc.reject": () => ({ values: { tag: "rejected" } }) } });
  await db.create("doc", { n: 1, tag: "draft" }, { entityRevision: 1 });
  await db.create("doc", { n: 2, tag: "draft" }, { entityRevision: 1 });
  const sources = new Map([["default", slowTable(db, { act: 300, find })]]);
  render(<Host>{() => <TableRenderer entity={entity} view={view} registry={registry} dataSources={sources} />}</Host>);
  await waitFor(() => expect(document.querySelectorAll("[data-testid='action-reject']").length).toBe(2), { timeout: 8000 });
  const press = (): HTMLButtonElement => {
    const first = document.querySelectorAll<HTMLButtonElement>("[data-testid='action-reject']")[0] as HTMLButtonElement;
    first.focus();
    fireEvent.click(first);
    return first;
  };
  return { press };
}

describe("a row action's dialog over a slow adapter (card 57e)", () => {
  test.each([700, 2300])("focus ends on the row's Reject after a reload that takes %i ms", async (find) => {
    const { press } = await open(find);
    const first = press();
    const dialog = await screen.findByTestId("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(first.isConnected).toBe(false), { timeout: 10000 });
    await waitFor(() => expect(document.activeElement).toBe(document.querySelectorAll("[data-testid='action-reject']")[0]), { timeout: 5000 });
  }, 25000);

  test("a viewer who clicks elsewhere during the slow reload keeps their focus", async () => {
    const { press } = await open(2300);
    press();
    const dialog = await screen.findByTestId("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
    const other = document.body.appendChild(document.createElement("button"));
    other.focus();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(document.activeElement).toBe(other);
    other.remove();
  }, 25000);
});
