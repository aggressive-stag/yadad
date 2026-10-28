// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoardView, CalendarView, DataAdapter, EntityDocument, Registry, RecordActionItem } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry, waitForRows } from "@yadad/testing";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { BoardRenderer } from "./board-renderer.js";
import { CalendarRenderer } from "./calendar-renderer.js";
import type { DocumentSet } from "./document-set.js";

afterEach(cleanup);

// A component whose actions and move controls live in panels, as the component set's menus do: the trigger
// is replaced by the panel while it is open, a press closes the panel, and the trigger is refocused after
// the close (the set's Menu primitive). The reload that follows rebuilds the whole record.
function Panels({ id, actions, onMove, target, moveLabel }: { id: string; actions: readonly RecordActionItem[] | undefined; onMove: ((id: string, to: string) => void) | undefined; target: string; moveLabel: string }): ReactNode {
  const [panel, setPanel] = useState<"actions" | "move" | undefined>(undefined);
  const refocus = useRef<"actions" | "move" | undefined>(undefined);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const moveTrigger = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    refocus.current = panel;
    setPanel(undefined);
  };
  useEffect(() => {
    if (panel !== undefined || refocus.current === undefined) return;
    (refocus.current === "actions" ? actionsTrigger : moveTrigger).current?.focus();
    refocus.current = undefined;
  });
  const key = (e: { key: string }): void => {
    if (e.key === "Escape" && panel !== undefined) close();
  };
  const trigger = (ref: RefObject<HTMLButtonElement | null>, which: "actions" | "move", label: string): ReactNode =>
    panel === which ? null : (
      <button ref={ref} type="button" data-yadad-focus-return={which} data-testid={`${which}-trigger-${id}`} onClick={() => setPanel(which)}>
        {label}
      </button>
    );
  return (
    <div onKeyDown={key}>
      {actions !== undefined && actions.length > 1 && trigger(actionsTrigger, "actions", "Actions…")}
      {panel === "actions" && (
        <div role="menu" data-yadad-focus-return="actions" data-testid={`actions-panel-${id}`}>
          {actions?.map((a) => (
            <button key={a.id} type="button" onClick={() => { a.onPress(); close(); }}>{a.label}</button>
          ))}
          <button type="button" onClick={close}>Cancel</button>
        </div>
      )}
      {onMove !== undefined && trigger(moveTrigger, "move", moveLabel)}
      {panel === "move" && (
        <div data-yadad-focus-return="move" data-testid={`move-panel-${id}`}>
          <button type="button" onClick={() => { onMove?.(id, target); close(); }}>Move</button>
          <button type="button" onClick={close}>Cancel</button>
        </div>
      )}
    </div>
  );
}

const registry: Registry<ReactNode> = {
  ...mockRegistry,
  layout: {
    ...mockRegistry.layout,
    Board: (props) => (
      <section role="group" aria-label={props.label} aria-busy={props.loading}>
        <div role="status" data-testid="board-status">{props.announcement?.text}</div>
        {props.columns.map((col) => (
          <div key={col.id} data-testid={`column-${col.id}`}>
            {col.cards.map((card) => (
              <article key={card.id} data-testid={`card-${card.id}`}>
                <div>{card.content}</div>
                <Panels id={card.id} actions={card.actions} onMove={card.movable ? props.onMove : undefined} target={col.id === "v:Home" ? "v:Work" : "v:Home"} moveLabel="Move to…" />
              </article>
            ))}
          </div>
        ))}
      </section>
    ),
    Calendar: (props) => (
      <section role="group" aria-label={props.label} aria-busy={props.loading}>
        <div role="status" data-testid="calendar-status">{props.announcement?.text}</div>
        {props.days.slice(0, 31).map((day) => (
          <div key={day.date} data-date={day.date}>
            {day.entries.map((entry) => (
              <article key={entry.id} data-testid={`entry-${entry.id}`}>
                <div>{entry.content}</div>
                <Panels id={entry.id} actions={entry.actions} onMove={entry.movable ? props.onMove : undefined} target="2026-10-20" moveLabel="Move to day…" />
              </article>
            ))}
          </div>
        ))}
      </section>
    ),
  },
};

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 4,
  id: "task",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "list", type: "select", label: "List", options: { source: "static", values: ["Home", "Work"] } },
    { id: "due", type: "date", label: "Due" },
    { id: "notes", type: "text", label: "Notes" },
  ],
  actions: [{ id: "publish", label: "Publish" }, { id: "flag", label: "Flag" }],
};
const board: BoardView = { kind: "board", specVersion: 4, id: "b", title: "Tasks", entity: "task", revision: 1, dataSource: "default", groupBy: [{ field: "list" }], titleField: "title", editable: true, recordActions: ["publish", "flag"] };
const calendar: CalendarView = { kind: "calendar", specVersion: 4, id: "c", title: "Plan", entity: "task", revision: 1, dataSource: "default", dateField: "due", editable: true, recordActions: ["publish", "flag"] };
const documents: DocumentSet = { entities: new Map([[entity.id, entity]]), views: new Map() };

async function seed() {
  const db = createMemoryAdapter({ actions: { "task.flag": () => ({ values: { notes: "flagged" } }), "task.publish": () => ({ values: { notes: "published" } }) } });
  const ids: Record<string, string> = {};
  for (const values of [
    { title: "Book flights", list: "Home", due: "2026-10-15" },
    { title: "Pay rent", list: "Home", due: "2026-10-15" },
    { title: "Call Ada", list: "Work", due: "2026-10-16" },
  ]) ids[values.title] = (await db.create("task", values, { entityRevision: 1 })).id;
  return { db, ids };
}

/** A find that waits for the test after an action or move was written, so the loading render always happens. */
function gated(db: DataAdapter): { adapter: DataAdapter; release: () => void } {
  let closed = false;
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => (open = resolve));
  const arm = (): void => void (closed = true);
  return {
    release: () => open(),
    adapter: {
      ...db,
      act: async (...args: Parameters<NonNullable<DataAdapter["act"]>>) => {
        const out = await db.act!(...args);
        arm();
        return out;
      },
      find: async (...args: Parameters<DataAdapter["find"]>) => {
        if (closed) await wait;
        return db.find(...args);
      },
    },
  };
}

const busy = (): string | null => screen.getByRole("group").getAttribute("aria-busy");

describe("focus after an action run from a panel (card 57c)", () => {
  async function openBoard(adapter?: DataAdapter) {
    const { db, ids } = await seed();
    render(<BoardRenderer entity={entity} view={board} registry={registry} dataSources={new Map([["default", adapter ?? db]])} entities={documents.entities} documents={documents} />);
    await waitForRows(document.body);
    return { db, ids };
  }

  test("a board card's panel action leaves focus on that card's Actions… trigger after the reload", async () => {
    const { db, ids } = await seed();
    const g = gated(db);
    render(<BoardRenderer entity={entity} view={board} registry={registry} dataSources={new Map([["default", g.adapter]])} entities={documents.entities} documents={documents} />);
    await waitForRows(document.body);
    fireEvent.click(screen.getByTestId(`actions-trigger-${ids["Pay rent"]}`));
    const flag = within(screen.getByTestId(`actions-panel-${ids["Pay rent"]}`)).getByRole("button", { name: "Flag" });
    flag.focus();
    fireEvent.click(flag);
    await waitFor(() => expect(busy()).toBe("true")); // reloading: the cards are gone
    g.release();
    await waitFor(() => expect(busy()).toBe("false"));
    await waitFor(() => expect(screen.getByTestId(`card-${ids["Pay rent"]}`).textContent).toContain("Actions"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(`actions-trigger-${ids["Pay rent"]}`)));
  });

  test("Escape and Cancel still return focus to the trigger", async () => {
    const { ids } = await openBoard();
    const trigger = (): HTMLElement => screen.getByTestId(`actions-trigger-${ids["Pay rent"]}`);
    fireEvent.click(trigger());
    screen.getByRole("button", { name: "Cancel" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(trigger());
  });

  test("a viewer who moved focus elsewhere during the reload keeps it (no steal)", async () => {
    const { db, ids } = await seed();
    const g = gated(db);
    render(<BoardRenderer entity={entity} view={board} registry={registry} dataSources={new Map([["default", g.adapter]])} entities={documents.entities} documents={documents} />);
    await waitForRows(document.body);
    fireEvent.click(screen.getByTestId(`actions-trigger-${ids["Pay rent"]}`));
    const flag = within(screen.getByTestId(`actions-panel-${ids["Pay rent"]}`)).getByRole("button", { name: "Flag" });
    flag.focus();
    fireEvent.click(flag);
    await waitFor(() => expect(busy()).toBe("true"));
    g.release();
    await waitFor(() => expect(busy()).toBe("false"));
    const other = screen.getByTestId(`move-trigger-${ids["Call Ada"]}`);
    other.focus();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(other);
  });

  test("a board 'Move to…' leaves focus on the moved card's trigger in its new column", async () => {
    const { ids } = await openBoard();
    fireEvent.click(screen.getByTestId(`move-trigger-${ids["Pay rent"]}`));
    const move = within(screen.getByTestId(`move-panel-${ids["Pay rent"]}`)).getByRole("button", { name: "Move" });
    move.focus();
    fireEvent.click(move);
    await waitFor(() => expect(screen.getByTestId("board-status").textContent).toBe("Moved Pay rent to Work"));
    await waitFor(() => expect(within(screen.getByTestId("column-v:Work")).getByTestId(`card-${ids["Pay rent"]}`)).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe(`move-trigger-${ids["Pay rent"]}`));
  });
});

describe("focus after a move from a panel, on a calendar (card 57c)", () => {
  test("'Move to day…' leaves focus on the entry's trigger on its new day", async () => {
    const { db, ids } = await seed();
    render(<CalendarRenderer entity={entity} view={calendar} registry={registry} dataSources={new Map([["default", db]])} documents={documents} now={new Date(2026, 9, 15, 10, 0, 0)} />);
    await waitForRows(document.body);
    fireEvent.click(screen.getByTestId(`move-trigger-${ids["Pay rent"]}`));
    const move = within(screen.getByTestId(`move-panel-${ids["Pay rent"]}`)).getByRole("button", { name: "Move" });
    move.focus();
    fireEvent.click(move);
    await waitFor(() => expect(screen.getByTestId("calendar-status").textContent).toMatch(/^Moved Pay rent/));
    await waitFor(() => expect(document.querySelector(`[data-date="2026-10-20"] [data-testid="entry-${ids["Pay rent"]}"]`)).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.getAttribute("data-testid")).toBe(`move-trigger-${ids["Pay rent"]}`));
  });
});
