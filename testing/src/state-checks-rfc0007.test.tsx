// @vitest-environment jsdom
// RFC 0007: the action and compare problems of checkViewStates. The checks
// watch the PROPS the registry's components were given (the registry is
// wrapped in state-checks), never the DOM, so a fake table that draws the
// wrong buttons or hands its Display the wrong props is reported.
import type { DataRecord, DiffSegment, Document, EntityDocument, RecordActionItem, Registry, TableColumnHeader, TableView } from "@yadad/core";
import { availableActions, compareCells } from "@yadad/runtime";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { checkViewStates, problems } from "./state-checks.js";
import type { SourceViewState } from "./source-states.js";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const actionEntity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "release",
  revision: 1,
  fields: [
    { id: "name", type: "text", label: "Name", required: true },
    { id: "stage", type: "select", label: "Stage", options: { source: "static", values: ["draft", "shipped"] } },
  ],
  actions: [
    { id: "publish", label: "Publish" },
    { id: "retract", label: "Retract", visibleWhen: { op: "eq", field: "stage", value: "shipped" } },
  ],
};
const changeEntity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "memo",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "body", type: "text", label: "Body" },
  ],
};
const base = { specVersion: 4 as const, revision: 1, dataSource: "default" };
const actionsTable: TableView = { ...base, kind: "table", id: "release_table", entity: "release", columns: [{ field: "name" }], recordActions: ["publish", "retract"] };
const changesTable: TableView = { ...base, kind: "table", id: "memo_table", entity: "memo", columns: [{ field: "title" }, { field: "body", compare: { to: "previousRow" } }] };
const documents: Document[] = [actionEntity, changeEntity, actionsTable, changesTable];

const item = (id: string): RecordActionItem => ({ id, label: id, tone: "neutral", pending: false, onPress: () => undefined });

const bodyField = { id: "body", type: "text", label: "Body" } as const;

/** A table that draws rows with chosen action ids and chosen `diff` props. The registry is the one the checks wrapped — the props must flow through it. */
function fakeTable(state: SourceViewState, registry: Registry<ReactNode>, columns: readonly TableColumnHeader[], actionsOf: (r: DataRecord) => readonly string[], diffOn: "correct" | "never" | "always"): ReactNode {
  if (state.render.kind !== "table") return null;
  const rows = state.render.records;
  const { Table } = registry.layout;
  const { text } = registry.fields;
  // The passing mode mirrors the renderer: compareCells is the formula, so
  // only `never` and `always` lie about who got a diff.
  const diffs = diffOn === "correct" ? compareCells(rows, { field: "body", compare: { to: "previousRow" } }) : undefined;
  return (
    <Table
      caption="rows"
      columns={[...columns]}
      onSort={() => undefined}
      empty="none"
      rows={rows.map((record, index) => {
        const diff: readonly DiffSegment[] | undefined =
          diffOn === "never" ? undefined : diffOn === "always" ? [{ kind: "same", text: (record.values.body as string | undefined) ?? "" }] : diffs?.[index];
        const actionIds = actionsOf(record);
        return {
          id: record.id,
          cells: columns.map((c) =>
            c.id === "body" ? (
              <text.Display key={c.id} field={bodyField} value={record.values.body as string | undefined} {...(diff !== undefined ? { diff } : {})} />
            ) : (
              <text.Display key={c.id} field={{ id: c.id, type: "text", label: c.label }} value={record.values[c.id] as string | undefined} />
            ),
          ),
          ...(actionIds.length > 0 ? { actions: actionIds.map(item) } : {}),
        };
      })}
    />
  );
}

// The fake table never renders the source's failure message — that DOM check
// belongs to the real renderers (packages/renderer/src/state-checks.test.tsx).
const check = (view: TableView, render: (state: SourceViewState, context: { registry: Registry<ReactNode> }) => ReactNode) => checkViewStates({ view, documents, now: NOW, render, skip: ["error-message"] });
const checkNames = (results: Awaited<ReturnType<typeof check>>): Set<string> => new Set(results.flatMap((r) => r.problems.map((p) => p.check)));
const messages = (results: Awaited<ReturnType<typeof check>>): string[] => results.flatMap((r) => r.problems.map((p) => p.message));

describe("checkViewStates action problems (RFC 0007)", () => {
  test("a table that offers exactly availableActions passes in every state", async () => {
    const results = await check(actionsTable, (state, context) =>
      fakeTable(state, context.registry, [{ id: "name", headerId: "r-name", label: "Name", sortable: false }], (r) => (state.render.kind === "table" ? availableActions(actionEntity, { recordActions: ["publish", "retract"] }, r, state.viewer).map((a) => a.id) : []), "never"),
    );
    expect(results.length).toBeGreaterThan(3);
    expect(problems(results)).toEqual([]);
  });

  test("an action offered where it is withheld or hidden is reported", async () => {
    // retract is hidden on a draft record and withheld when can.actions says no;
    // this fake table offers it on every record regardless.
    const results = await check(actionsTable, (state, context) => fakeTable(state, context.registry, [{ id: "name", headerId: "r-name", label: "Name", sortable: false }], () => ["publish", "retract"], "never"));
    expect(checkNames(results)).toEqual(new Set(["action-offered"]));
    const message = messages(results).find((m) => m.includes('"retract"'));
    expect(message).toContain("withheld or its visibleWhen is false");
    expect(message).toContain("release_table");
  });

  test("an action withheld where the state allows it is reported", async () => {
    const results = await check(actionsTable, (state, context) => fakeTable(state, context.registry, [{ id: "name", headerId: "r-name", label: "Name", sortable: false }], () => [], "never"));
    expect(checkNames(results)).toEqual(new Set(["action-missing"]));
    expect(messages(results).some((m) => m.includes('"publish"') && m.includes("although this state allows it"))).toBe(true);
  });
});

describe("checkViewStates compare problems (RFC 0007)", () => {
  test("a compare column whose Display gets compareCells' diff passes in every state", async () => {
    const results = await check(changesTable, (state, context) => fakeTable(state, context.registry, [{ id: "title", headerId: "t-title", label: "Title", sortable: false }, { id: "body", headerId: "t-body", label: "Body", sortable: false }], () => [], "correct"));
    expect(results.length).toBeGreaterThan(3);
    expect(problems(results)).toEqual([]);
  });

  test("a neighbour with no diff handed to the Display is reported", async () => {
    const results = await check(changesTable, (state, context) => fakeTable(state, context.registry, [{ id: "title", headerId: "t-title", label: "Title", sortable: false }, { id: "body", headerId: "t-body", label: "Body", sortable: false }], () => [], "never"));
    // Every multi-record state has a neighbour (row 2 against row 1); a
    // single-row page has none, so its states stay clean.
    expect([...checkNames(results)]).toEqual(["diff-missing"]);
    expect(messages(results)[0]).toContain('column "body"');
  });

  test("a diff handed to the Display with no neighbour is reported", async () => {
    const results = await check(changesTable, (state, context) => fakeTable(state, context.registry, [{ id: "title", headerId: "t-title", label: "Title", sortable: false }, { id: "body", headerId: "t-body", label: "Body", sortable: false }], () => [], "always"));
    expect([...checkNames(results)]).toEqual(["diff-offered"]);
    expect(messages(results)[0]).toContain("against nothing");
  });
});
