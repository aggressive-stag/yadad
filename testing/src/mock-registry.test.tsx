// @vitest-environment jsdom
import type { BoardProps, CalendarProps, DiffSegment, RecordActionItem, TableColumnHeader, TextField } from "@yadad/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import type { ReactNode } from "react";
import { mockRegistry } from "./mock-registry.js";

const field: TextField = { id: "name", type: "text", label: "Name", required: true };
const { Input, Display } = mockRegistry.fields.text;
const { FieldFrame, Table } = mockRegistry.layout;
const Dialog = mockRegistry.layout.Dialog!;
const Board = mockRegistry.layout.Board!;
const Calendar = mockRegistry.layout.Calendar!
const { Input: DatetimeInput, Display: DatetimeDisplay } = mockRegistry.fields.datetime!;

afterEach(cleanup);

test("text input renders a placeholder only when it is given one", () => {
  expect(renderToStaticMarkup(<Input inputId="f-name" field={field} value="" onChange={() => {}} invalid={false} placeholder="Search names" />)).toContain('placeholder="Search names"');
  expect(renderToStaticMarkup(<Input inputId="f-name" field={field} value="" onChange={() => {}} invalid={false} />)).not.toContain("placeholder");
});

test("text input exposes a test id and the current value", () => {
  const html = renderToStaticMarkup(<Input inputId="f-name" field={field} value="Ada" onChange={() => {}} invalid={false} />);
  expect(html).toContain('id="f-name"');
  expect(html).toContain('data-testid="input-name"');
  expect(html).toContain('value="Ada"');
});

test("display renders the value", () => {
  expect(renderToStaticMarkup(<Display field={field} value="Ada" />)).toBe('<span data-testid="display-name">Ada</span>');
});

test("field frame shows label, required marker and errors", () => {
  const html = renderToStaticMarkup(
    <FieldFrame
      inputId="f-name"
      errorId="f-name-errors"
      label="Name"
      required
      errors={[{ path: "/name", code: "required", message: '"Name" is required.', hint: "Enter a value." }]}
    >
      <input id="f-name" />
    </FieldFrame>,
  );
  expect(html).toContain('<label for="f-name">Name<span aria-hidden="true"> *</span></label>');
  expect(html).toContain('data-testid="field-error" data-code="required"');
});

// --- RFC 0007 (card 35a) -------------------------------------------------------------------------

const datetimeField = { id: "when", type: "datetime", label: "When", required: false } as const;

test("datetime input is a datetime-local control holding the instant", () => {
  const html = renderToStaticMarkup(
    <DatetimeInput inputId="f-when" field={datetimeField} value="2026-10-20T09:30:00Z" onChange={() => {}} invalid={false} />,
  );
  expect(html).toContain('type="datetime-local"');
  expect(html).toContain('data-testid="input-when"');
  expect(html).toContain('value="2026-10-20T09:30:00Z"');
});

test("datetime display is a time element carrying the instant", () => {
  const html = renderToStaticMarkup(<DatetimeDisplay field={datetimeField} value="2026-10-20T09:30:00Z" />);
  expect(html).toContain("<time");
  expect(html).toContain('dateTime="2026-10-20T09:30:00Z"');
  expect(html).toContain('data-testid="display-when"');
  expect(html).toContain(">2026-10-20T09:30:00Z</time>");
});

test("text display with diff marks additions and removals without colour", () => {
  const diff: readonly DiffSegment[] = [
    { kind: "same", text: "hello " },
    { kind: "added", text: "world" },
    { kind: "removed", text: "there" },
  ];
  const html = renderToStaticMarkup(<Display field={field} value="hello world" diff={diff} />);
  expect(html).toContain("<ins>");
  expect(html).toContain("<del>");
  expect(html).toContain("added:");
  expect(html).toContain("removed:");
  expect(html).toContain("hello ");
  expect(html).toContain("world");
  expect(html).toContain("there");
});

const column: TableColumnHeader = { id: "name", headerId: "h-name", label: "Name", sortable: false };
const action = (id: string, pending = false): RecordActionItem => ({ id, label: `Do ${id}`, tone: id === "delete" ? "danger" : "neutral", pending, onPress: () => {} });

test("table adds an actions column only when a row has actions", () => {
  const { container, rerender } = render(
    <Table
      caption="People"
      columns={[column]}
      rows={[{ id: "r1", cells: ["Ada"] }, { id: "r2", cells: ["Bob"] }]}
      onSort={() => {}}
      empty="No records."
      actionsLabel="Actions"
    />,
  );
  expect(container.querySelectorAll("th")).toHaveLength(1);
  rerender(
    <Table
      caption="People"
      columns={[column]}
      rows={[{ id: "r1", cells: ["Ada"], actions: [action("archive"), action("delete", true)] }, { id: "r2", cells: ["Bob"] }]}
      onSort={() => {}}
      empty="No records."
      actionsLabel="Actions"
    />,
  );
  const headers = [...container.querySelectorAll("th")].map((th) => th.textContent);
  expect(headers).toEqual(["Name", "Actions"]);
  const archive = screen.getByTestId("action-archive") as HTMLButtonElement;
  expect(archive.textContent).toBe("Do archive");
  expect(archive.disabled).toBe(false);
  const del = screen.getByTestId("action-delete") as HTMLButtonElement;
  expect(del.disabled).toBe(true);
  expect(del.getAttribute("data-tone")).toBe("danger");
  // a row without actions gets an empty cell, not stray buttons
  expect(container.querySelectorAll('[data-testid="row-actions-r2"] button')).toHaveLength(0);
});

test("table actions column disappears when actionsLabel is absent", () => {
  const { container } = render(
    <Table
      caption="People"
      columns={[column]}
      rows={[{ id: "r1", cells: ["Ada"], actions: [action("archive")] }]}
      onSort={() => {}}
      empty="No records."
    />,
  );
  expect(container.querySelectorAll("th")).toHaveLength(1);
  expect(container.querySelector('[data-testid="row-actions-r1"]')).toBeNull();
});

test("board cards carry action buttons", () => {
  const props: BoardProps<ReactNode> = {
    label: "Board",
    groupChoices: [{ field: "status", label: "Status" }],
    groupField: "status",
    columns: [
      {
        id: "v:todo",
        label: "Todo",
        count: 1,
        droppable: true,
        cards: [{ id: "c1", content: "Card", label: "Card", movable: false, pending: false, actions: [action("publish"), action("delete", true)] }],
      },
    ],
    loading: false,
    onGroupBy: () => {},
  };
  const { container } = render(<Board {...props} />);
  const buttons = [...container.querySelectorAll('[data-testid="card-c1"] button')].map((b) => b.textContent);
  expect(buttons).toContain("Do publish");
  expect((screen.getByTestId("action-delete") as HTMLButtonElement).disabled).toBe(true);
  let pressedId = "";
  const pressProps: BoardProps<ReactNode> = {
    ...props,
    columns: [
      {
        ...props.columns[0]!,
        cards: [{ id: "c1", content: "Card", label: "Card", movable: false, pending: false, actions: [{ ...action("publish"), onPress: () => (pressedId = "publish") }] }],
      },
    ],
  };
  render(<Board {...pressProps} />);
  fireEvent.click(screen.getAllByTestId("action-publish")[1]!);
  expect(pressedId).toBe("publish");
});

test("calendar entries carry action buttons", () => {
  const props: CalendarProps<ReactNode> = {
    label: "Calendar",
    title: "October 2026",
    mode: "month",
    modes: [{ mode: "month", label: "Month" }],
    weekdays: Array.from({ length: 7 }, (_, i) => ({ short: `w${i}`, long: `weekday${i}` })),
    days: Array.from({ length: 42 }, (_, i) => ({
      date: `2026-10-${String((i % 31) + 1).padStart(2, "0")}`,
      dayOfMonth: (i % 31) + 1,
      weekday: i % 7,
      label: "day",
      inMonth: i < 31,
      isToday: false,
      entries: i === 0 ? [{ id: "e1", content: "Entry", label: "Entry", movable: false, pending: false, actions: [action("publish")] }] : [],
    })),
    legend: [],
    loading: false,
    onModeChange: () => {},
    onPrevious: () => {},
    onNext: () => {},
    onToday: () => {},
  };
  render(<Calendar {...props} />);
  const button = screen.getByTestId("action-publish");
  expect(button.textContent).toBe("Do publish");
  expect(button.closest('[data-testid="entry-e1"]')).not.toBeNull();
});

test("dialog is modal, focuses on open, Escape closes, and focus returns to the opener", () => {
  const closed: number[] = [];
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {open && (
          <Dialog
            label="Delete record?"
            onClose={() => {
              closed.push(1);
              setOpen(false);
            }}
          >
            <p>Are you sure?</p>
          </Dialog>
        )}
      </>
    );
  }
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Delete record?" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(dialog); // focus moved in
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(closed).toEqual([1]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener); // focus returned to the opener
});
