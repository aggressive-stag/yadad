// @vitest-environment jsdom
// RFC 0008/0009: the saved-filter and doneField axes of the state grid, and the
// checks that tell a component set which drops the surface from one which keeps
// it. The fakes stand in for what a host's renderer + component set draws.
import type { BoardProps, BoardView, Document, EntityDocument, Registry, TableView } from "@yadad/core";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });
import { checkViewStatesReport, problems } from "./state-checks.js";
import { mockRegistry } from "./mock-registry.js";
import type { SourceViewState } from "./source-states.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "chore",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["home", "work"] } },
    { id: "done", type: "boolean", label: "Done" },
  ],
};
const base = { specVersion: 4 as const, revision: 1, dataSource: "default" };
const board: BoardView = { ...base, kind: "board", id: "chore_board", entity: "chore", titleField: "title", groupBy: [{ field: "list" }], editable: true, doneField: "done" };
const table: TableView = {
  ...base,
  kind: "table",
  id: "chore_table",
  entity: "chore",
  columns: [{ field: "title" }],
  filters: [
    { id: "open", name: "Open", condition: { op: "eq", field: "done", value: false } },
    { id: "finished", name: "Finished", condition: { op: "eq", field: "done", value: true } },
  ],
};
const documents: Document[] = [entity, board, table];

type DoneMode = "faithful" | "no-props" | "no-checkbox";

function fakeBoard(state: SourceViewState, registry: Registry<ReactNode>, mode: DoneMode): ReactNode {
  if (state.render.kind !== "board") return null;
  const render = state.render;
  const Board = registry.layout.Board!;
  const cards = render.records.map((r) => ({
    id: r.id,
    content: String(r.values.title),
    label: String(r.values.title),
    movable: r.can?.update !== false,
    pending: false,
    ...(mode === "no-props" ? {} : { done: { checked: r.values.done === true, disabled: r.can?.update === false, toggle: () => undefined } }),
  }));
  const props: BoardProps<ReactNode> = {
    label: "Chores",
    groupChoices: [{ field: "list", label: "List" }],
    groupField: render.groupBy,
    columns: [{ id: "all", label: "All", count: cards.length, droppable: true, cards }],
    loading: false,
    onGroupBy: () => undefined,
    onMove: () => undefined,
  };
  return <Board {...props} />;
}

// A component set that takes `done` and draws nothing for it.
const droppingRegistry: Registry<ReactNode> = {
  ...mockRegistry,
  layout: { ...mockRegistry.layout, Board: (p: BoardProps<ReactNode>): ReactNode => <div role="group" aria-label={p.label}>{p.columns.flatMap((c) => c.cards.map((card) => <p key={card.id}>{card.label}</p>))}</div> },
};

const checkBoard = (mode: DoneMode) =>
  checkViewStatesReport({ view: board, documents, now: NOW, skip: ["error-message"], registry: mode === "no-checkbox" ? droppingRegistry : mockRegistry, render: (state, ctx) => fakeBoard(state, ctx.registry, mode) });

describe("the doneField axis and its checks (RFC 0008 item 3)", () => {
  test("a board whose cards carry the done toggle passes in every state, and the grid has done and permission axes", async () => {
    const report = await checkBoard("faithful");
    expect(report.axes).toEqual(expect.arrayContaining(["done", "permission"]));
    expect(problems(report.results)).toEqual([]);
  });

  test("cards with no done prop are reported as done-missing", async () => {
    const report = await checkBoard("no-props");
    const names = new Set(report.results.flatMap((r) => r.problems.map((p) => p.check)));
    expect(names).toEqual(new Set(["done-missing"]));
  });

  test("a component set that drops the checkbox is reported even though the toggle props arrive", async () => {
    const report = await checkBoard("no-checkbox");
    const messages = report.results.flatMap((r) => r.problems.filter((p) => p.check === "done-missing").map((p) => p.message));
    expect(messages.some((m) => m.includes("drops the completion checkbox"))).toBe(true);
  });

  test("the locked-record state disables the toggle; the others leave it enabled", async () => {
    const report = await checkBoard("faithful");
    expect(report.results.some((r) => r.id.includes("permission=record-locked"))).toBe(true);
  });
});

function fakeTable(state: SourceViewState, registry: Registry<ReactNode>, litFromState: boolean, sortable = true): ReactNode {
  if (state.render.kind !== "table") return null;
  const lit = litFromState ? state.render.savedFilter : undefined;
  const { Table } = registry.layout;
  return (
    <div>
      <nav aria-label="Saved filters">
        {(table.filters ?? []).map((f) => (
          <button key={f.id} type="button" aria-pressed={lit === f.id}>
            {f.name}
          </button>
        ))}
      </nav>
      <Table caption="rows" columns={[{ id: "title", headerId: "h-title", label: "Title", sortable }]} onSort={() => undefined} empty="none" rows={[]} />
    </div>
  );
}

const checkTable = (litFromState: boolean) =>
  checkViewStatesReport({ view: table, documents, now: NOW, skip: ["error-message", "notice-missing"], render: (state, ctx) => fakeTable(state, ctx.registry, litFromState) });

describe("sorting that is not offered (RFC 0010 item 6)", () => {
  test("a header that is sortable by the document but drawn plain is sort-missing; an unsortable column drawn sortable is sort-offered", async () => {
    const plain = await checkViewStatesReport({ view: table, documents, now: NOW, skip: ["error-message", "notice-missing"], render: (state, ctx) => fakeTable(state, ctx.registry, true, false) });
    expect(new Set(plain.results.flatMap((r) => r.problems.map((p) => p.check)))).toEqual(new Set(["sort-missing"]));
    const unsortable: TableView = { ...table, id: "chore_table_fixed", sortable: false };
    const offered = await checkViewStatesReport({ view: unsortable, documents: [...documents, unsortable], now: NOW, skip: ["error-message", "notice-missing"], render: (state, ctx) => fakeTable(state, ctx.registry, true, true) });
    expect(new Set(offered.results.flatMap((r) => r.problems.map((p) => p.check)))).toEqual(new Set(["sort-offered"]));
  });
});

describe("the saved filter axis (RFC 0009 item 5)", () => {
  test("a table that lights the state's chip passes in every state", async () => {
    const report = await checkTable(true);
    expect(report.axes).toContain("filter");
    expect(problems(report.results)).toEqual([]);
  });

  test("a host that never passes savedFilter is reported on every lit state", async () => {
    const report = await checkTable(false);
    const bad = report.results.filter((r) => r.problems.some((p) => p.check === "saved-filter"));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((r) => r.id.includes("filter=filter:"))).toBe(true);
  });
});
