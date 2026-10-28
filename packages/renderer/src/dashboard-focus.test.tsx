// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { DashboardView, DataAdapter, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer.js";
import { TableRenderer } from "./table-renderer.js";

// A dashboard holding a table with a toggling record action (Pin <-> Unpin, the record stays in its row)
// and a count over the same entity. The action's onChanged bumps the dashboard, so the table and the count
// reload a second time after the first restore already succeeded.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "doc",
  revision: 1,
  fields: [
    { id: "n", type: "number", label: "N" },
    { id: "pinned", type: "boolean", label: "Pinned" },
  ],
  actions: [
    { id: "pin", label: "Pin", visibleWhen: { op: "eq", field: "pinned", value: false } },
    { id: "unpin", label: "Unpin", visibleWhen: { op: "eq", field: "pinned", value: true } },
  ],
};
const table: TableView = { kind: "table", specVersion: 1, id: "rows", entity: "doc", revision: 1, dataSource: "default", columns: [{ field: "n" }], recordActions: ["pin", "unpin"] };
const dashboard: DashboardView = {
  kind: "dashboard",
  specVersion: 1,
  id: "home",
  revision: 1,
  tabs: [
    {
      id: "t",
      title: "T",
      items: [
        { id: "rows", x: 0, y: 0, w: 8, h: 1, widget: "view", view: "rows" },
        { id: "total", x: 8, y: 0, w: 4, h: 1, widget: "count", label: "All", view: "rows" },
      ],
    },
  ],
};

// A browser drops focus to body the moment the focused node leaves the document; jsdom does not.
let restore: () => void = () => undefined;
beforeEach(() => {
  const original = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    const active = document.activeElement;
    const result = original.call(this, child) as T;
    if (active !== null && active !== document.body && !active.isConnected) (document.body as HTMLElement).focus();
    return result;
  } as typeof Node.prototype.removeChild;
  restore = () => {
    Node.prototype.removeChild = original;
  };
});
afterEach(() => {
  restore();
  cleanup();
});

const drop = (btn: HTMLButtonElement): void => {
  btn.disabled = false; // jsdom refuses to blur a disabled element; the browser already dropped it
  btn.blur();
  btn.disabled = true;
};

async function setup(slowSecondReload: boolean): Promise<{ press: HTMLButtonElement; releaseAct: () => void; releaseSecond: () => void }> {
  const base = createMemoryAdapter({ actions: { "doc.pin": () => ({ values: { pinned: true } }) } });
  await base.create("doc", { n: 1, pinned: false }, { entityRevision: 1 });
  await base.create("doc", { n: 2, pinned: false }, { entityRevision: 1 });
  let releaseAct: () => void = () => undefined;
  const actGate = new Promise<void>((r) => (releaseAct = r));
  let releaseSecond: () => void = () => undefined;
  const secondGate = new Promise<void>((r) => (releaseSecond = r));
  let acted = false;
  let listsAfterAct = 0;
  const innerAct = base.act!.bind(base);
  const innerList = base.find.bind(base);
  const db: DataAdapter = {
    ...base,
    act: async (e, id, a, req) => {
      await actGate;
      const out = await innerAct(e, id, a, req);
      acted = true;
      return out;
    },
    find: async (...args: Parameters<DataAdapter["find"]>) => {
      if (acted) {
        listsAfterAct += 1;
        if (slowSecondReload && listsAfterAct > 1) await secondGate; // a later reload lands after the first restore succeeded
      }
      return innerList(...args);
    },
  };
  render(<DashboardRenderer dashboard={dashboard} documents={{ entities: new Map([["doc", entity]]), views: new Map([["rows", table]]) }} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
  await waitFor(() => expect(document.querySelector("[data-testid='action-pin']")).not.toBeNull());
  const press = document.querySelector("[data-testid='action-pin']") as HTMLButtonElement;
  return { press, releaseAct, releaseSecond };
}

describe("focus return on a dashboard whose sibling widgets reload after the action", () => {
  for (const slow of [false, true]) {
    test(`focus ends on the same record's swapped action (second reload ${slow ? "late" : "immediate"})`, async () => {
      const { press, releaseAct, releaseSecond } = await setup(slow);
      press.focus();
      fireEvent.click(press);
      await waitFor(() => expect(press.disabled).toBe(true));
      drop(press);
      releaseAct();
      await waitFor(() => expect(document.querySelector("[data-testid='action-unpin']")).not.toBeNull());
      await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe("action-unpin"));
      releaseSecond();
      await new Promise((r) => setTimeout(r, 100));
      const unpin = document.querySelector("[data-testid='action-unpin']") as HTMLButtonElement;
      expect(unpin.closest("tr")?.textContent).toContain("1");
      expect(document.activeElement).toBe(unpin);
    });
  }

  test("a viewer who moved focus during the second reload keeps it", async () => {
    const { press, releaseAct, releaseSecond } = await setup(true);
    press.focus();
    fireEvent.click(press);
    await waitFor(() => expect(press.disabled).toBe(true));
    drop(press);
    releaseAct();
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe("action-unpin"));
    const other = document.querySelectorAll("[data-testid='action-pin']")[0] as HTMLButtonElement;
    other.focus();
    releaseSecond();
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(other);
  });
});

// The reload a host starts from `onChanged` can land after the restore already succeeded, and rebuild the
// control again (here: the first read after the write is still stale, the second shows the new state, so
// the Pin button is swapped for Unpin only after focus was returned to Pin and had survived a render).
describe("a second reload after the first restore", () => {
  async function lateHost(): Promise<{ press: HTMLButtonElement; releaseAct: () => void }> {
    const base = createMemoryAdapter({ actions: { "doc.pin": () => ({ values: { pinned: true } }) } });
    await base.create("doc", { n: 1, pinned: false }, { entityRevision: 1 });
    await base.create("doc", { n: 2, pinned: false }, { entityRevision: 1 });
    let releaseAct: () => void = () => undefined;
    const actGate = new Promise<void>((r) => (releaseAct = r));
    let acted = false;
    let reads = 0;
    const innerAct = base.act!.bind(base);
    const innerFind = base.find.bind(base);
    const db: DataAdapter = {
      ...base,
      act: async (e, id, a, req) => {
        await actGate;
        const out = await innerAct(e, id, a, req);
        acted = true;
        return out;
      },
      find: async (...args: Parameters<DataAdapter["find"]>) => {
        const page = await innerFind(...args);
        if (!acted) return page;
        reads += 1;
        return reads === 1 ? { ...page, items: page.items.map((r) => ({ ...r, values: { ...r.values, pinned: false } })) } : page; // the first read after the write is stale
      },
    };
    function Host() {
      const [key, setKey] = useState(0);
      return <TableRenderer entity={entity} view={table} registry={mockRegistry} dataSources={new Map([["default", db]])} reloadKey={key} onChanged={() => setTimeout(() => setKey((k) => k + 1), 60)} />;
    }
    render(<Host />);
    await waitFor(() => expect(document.querySelector("[data-testid='action-pin']")).not.toBeNull());
    return { press: document.querySelector("[data-testid='action-pin']") as HTMLButtonElement, releaseAct };
  }

  test("focus follows the control through a late rebuild", async () => {
    const { press, releaseAct } = await lateHost();
    press.focus();
    fireEvent.click(press);
    await waitFor(() => expect(press.disabled).toBe(true));
    drop(press);
    releaseAct();
    await waitFor(() => expect(document.querySelector("[data-testid='action-unpin']")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(document.querySelector("[data-testid='action-unpin']"));
  });

  test("a viewer who moved on before the late rebuild keeps their focus", async () => {
    const { press, releaseAct } = await lateHost();
    press.focus();
    fireEvent.click(press);
    await waitFor(() => expect(press.disabled).toBe(true));
    drop(press);
    releaseAct();
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe("action-pin"));
    const other = document.querySelectorAll("[data-testid='action-pin']")[1] as HTMLButtonElement;
    other.focus();
    await new Promise((r) => setTimeout(r, 150));
    expect(document.activeElement).toBe(other);
  });
});
