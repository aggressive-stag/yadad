// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Condition, DataAdapter, EntityDocument, FormView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";

afterEach(cleanup);

// A consumer found that tabbing into a date input inside a conditionally shown section leaves the
// input as document.activeElement while :focus-visible never matches, and blamed the form renderer
// recreating the focused input on a value-set render (unstable keys). These tests pin the renderer's
// side of that: a value change must never replace the focused input's DOM node.

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "event",
  revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["Meeting", "Workshop", "Social"] } },
    { id: "date", type: "date", label: "Date" },
  ],
};

// The date field lives in its own section and is shown only while the select names one of two kinds.
const kindShowsDate: Condition = { op: "in", field: "kind", values: ["Workshop", "Social"] };

const view: FormView = {
  kind: "form",
  specVersion: 0,
  id: "event_form",
  entity: "event",
  revision: 1,
  dataSource: "default",
  sections: [
    { id: "basics", title: "Basics", items: [{ field: "title" }, { field: "kind" }] },
    { id: "when", title: "When", items: [{ field: "date", visibleWhen: kindShowsDate }] },
  ],
};

const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

function dateInput(): HTMLInputElement {
  return screen.getByLabelText("Date") as HTMLInputElement;
}

function kindSelect(): HTMLSelectElement {
  return screen.getByLabelText("Kind") as HTMLSelectElement;
}

describe("form focus stability", () => {
  test("a value change in another field keeps the focused date input the same DOM node", () => {
    render(<FormRenderer entity={entity} view={view} registry={mockRegistry} dataSources={dataSources} />);
    fireEvent.change(kindSelect(), { target: { value: "Workshop" } }); // reveals the conditional section
    const input = dateInput();
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(screen.getByLabelText(/^Title/) as HTMLInputElement, { target: { value: "Stand-up" } });

    // The value-set render really happened (the controlled input updated), and focus survived it.
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Stand-up");
    expect(document.activeElement).toBe(input); // the same node, not a replacement
    expect(dateInput()).toBe(input);
  });

  test("changing the condition's own field, while the section stays shown, keeps the focused node", () => {
    render(<FormRenderer entity={entity} view={view} registry={mockRegistry} dataSources={dataSources} />);
    fireEvent.change(kindSelect(), { target: { value: "Workshop" } });
    const input = dateInput();
    input.focus();

    // The condition's own field changes and the item stays visible (Workshop -> Social are both in).
    fireEvent.change(kindSelect(), { target: { value: "Social" } });

    expect(document.activeElement).toBe(input);
    expect(dateInput()).toBe(input);
  });

  test("typing in the focused date input itself keeps the node through the value-set render", () => {
    render(<FormRenderer entity={entity} view={view} registry={mockRegistry} dataSources={dataSources} />);
    fireEvent.change(kindSelect(), { target: { value: "Workshop" } });
    const input = dateInput();
    input.focus();

    fireEvent.change(input, { target: { value: "2026-11-02" } });

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("2026-11-02");
    expect(dateInput()).toBe(input);
  });
});
