// @vitest-environment jsdom
import type { EntityDocument, FieldValue, TableView } from "@yadad/core";
import { createMemoryAdapter, formatDateTime } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderInput } from "./fields.js";
import type { ReferenceSupport } from "./references.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const INSTANT = "2026-10-17T09:30:00.000Z";

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "meet",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "when", type: "datetime", label: "When" },
  ],
};

const table = (extra: Partial<TableView> = {}): TableView => ({
  kind: "table",
  specVersion: 1,
  id: "meets",
  entity: "meet",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "title" }, { field: "when" }],
  ...extra,
});

async function seeded(): Promise<ReturnType<typeof createMemoryAdapter>> {
  const db = createMemoryAdapter();
  await db.create("meet", { title: "Stand-up", when: INSTANT }, { entityRevision: 1 });
  return db;
}

const cellTexts = () => screen.getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("[data-testid='display-when']")].map((n) => n.textContent));

describe("datetime display", () => {
  test("formats in the given zone and locale, and keeps the stored instant in dateTime", async () => {
    const db = await seeded();
    render(<TableRenderer entity={entity} view={table()} registry={mockRegistry} dataSources={new Map([["default", db]])} formatting={{ locale: "en-US", timeZone: "UTC" }} />);
    await waitFor(() => expect(cellTexts()).toEqual([["Oct 17, 2026, 9:30 AM"]]));
    const time = screen.getByTestId("display-when");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("datetime")).toBe(INSTANT);
    expect(time.textContent).toBe(formatDateTime(INSTANT, { locale: "en-US", timeZone: "UTC" }));
  });

  test("the same instant reads differently in America/New_York", async () => {
    const db = await seeded();
    render(<TableRenderer entity={entity} view={table()} registry={mockRegistry} dataSources={new Map([["default", db]])} formatting={{ locale: "en-US", timeZone: "America/New_York" }} />);
    await waitFor(() => expect(cellTexts()).toEqual([["Oct 17, 2026, 5:30 AM"]]));
    expect(screen.getByTestId("display-when").getAttribute("datetime")).toBe(INSTANT);
  });

  test("a registry without fields.datetime shows an ErrorSummary naming the key", async () => {
    const db = await seeded(); // one row, so the Display is reached
    const { datetime: _dropped, ...withoutDatetime } = mockRegistry.fields;
    const registry = { ...mockRegistry, fields: withoutDatetime };
    render(<TableRenderer entity={entity} view={table()} registry={registry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getByTestId("error-summary")).toBeTruthy());
    expect(screen.getByTestId("error-summary").textContent).toContain("no fields.datetime component");
    expect(screen.getByTestId("error-summary").textContent).toContain("datetime field when cannot be shown");
  });
});

describe("datetime input", () => {
  const field = entity.fields[1]!;
  const noRefs: ReferenceSupport = {
    input: () => ({ options: { status: "ready", options: [], more: false } }),
    display: () => ({ label: "", status: "found" }),
  };
  type InputEl = ReactElement<{ value?: string; onChange: (v: FieldValue | undefined) => void }>;
  const inputEl = (value: string | undefined, onChange: (v: FieldValue | undefined) => void, timeZone?: string): InputEl =>
    renderInput(mockRegistry, field, value, { inputId: "f-when", invalid: false }, onChange, noRefs, timeZone === undefined ? undefined : { timeZone }) as InputEl;

  test("the picker shows the local wall time in the given zone", () => {
    expect(inputEl(INSTANT, () => {}, "America/New_York").props.value).toBe("2026-10-17T05:30");
    expect(inputEl(INSTANT, () => {}, "UTC").props.value).toBe("2026-10-17T09:30");
  });

  test("a round trip across the fall DST change stores the earlier instant (the RFC rule)", () => {
    // 2026-11-01T01:30 in America/New_York occurs twice (clocks fall back at 02:00). The earlier reading is EDT: 05:30Z.
    const stored: (FieldValue | undefined)[] = [];
    const el = inputEl(undefined, (v) => stored.push(v), "America/New_York");
    el.props.onChange("2026-11-01T01:30");
    expect(stored).toEqual(["2026-11-01T05:30:00.000Z"]);
    // and the picker shows what was chosen
    expect(inputEl("2026-11-01T05:30:00.000Z", () => {}, "America/New_York").props.value).toBe("2026-11-01T01:30");
  });

  test("a spring-gap time is DST-safe: it stores an instant whose wall time is one hour before the typed one", () => {
    // 2026-03-08T02:30 does not exist in America/New_York (clocks jump 02:00 -> 03:00).
    const stored: (FieldValue | undefined)[] = [];
    inputEl(undefined, (v) => stored.push(v), "America/New_York").props.onChange("2026-03-08T02:30");
    expect(stored).toHaveLength(1);
    const instant = stored[0] as string;
    expect(inputEl(instant, () => {}, "America/New_York").props.value).toBe("2026-03-08T01:30");
  });

  test("clearing the picker clears the value; an empty document value shows an empty picker", () => {
    const stored: (FieldValue | undefined)[] = [];
    inputEl(INSTANT, (v) => stored.push(v), "UTC").props.onChange("");
    expect(stored).toEqual([undefined]);
    expect(inputEl(undefined, () => {}, "UTC").props.value).toBe("");
  });
});
