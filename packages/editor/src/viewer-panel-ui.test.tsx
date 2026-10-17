// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SPEC_VERSION } from "@yadad/core";
import type { Document, TableView, ViewerDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ViewerPanel } from "./viewer-panel.js";

afterEach(cleanup);

const viewer: ViewerDocument = {
  kind: "viewer",
  specVersion: SPEC_VERSION,
  id: "viewer",
  revision: 3,
  facts: [
    { id: "role", label: "Role", type: "select", options: { source: "static", values: ["viewer", "editor", "owner"] }, default: "viewer" },
    { id: "beta", label: "Beta", type: "boolean", default: false },
  ],
};
const entity: Document = { kind: "entity", specVersion: SPEC_VERSION, id: "task", revision: 1, fields: [{ id: "title", type: "text", label: "Title" }] };
const table: TableView = { kind: "table", specVersion: SPEC_VERSION, id: "t", entity: "task", revision: 1, dataSource: "default", columns: [{ field: "title", visibleWhen: { op: "viewerIn", fact: "role", values: ["owner"] } }] };

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ViewerPanel", () => {
  test("adds a fact and a value, saves with a bumped revision, and undo reverts", () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    render(<ViewerPanel viewer={viewer} registry={mockRegistry} onSave={onSave} onChange={onChange} onCancel={() => {}} />);
    type("New fact name", "Plan");
    press("Add fact");
    expect(screen.getByText("Fact: Plan")).toBeTruthy();
    type("New value of plan", "pro");
    press("Add value to plan");
    expect(screen.getByRole("list", { name: "Values of plan" }).textContent).toContain("pro");
    expect(onChange).toHaveBeenCalled();
    press("Undo");
    expect(screen.getByRole("list", { name: "Values of plan" }).textContent).not.toContain("pro");
    press("Redo");
    press("Save viewer facts");
    const saved = onSave.mock.calls[0]?.[0] as ViewerDocument;
    expect(saved.revision).toBe(4);
    expect(saved.facts.map((f) => f.id)).toEqual(["role", "beta", "plan"]);
  });

  test("removing a value a column still reads is refused and lists where", () => {
    render(<ViewerPanel viewer={viewer} registry={mockRegistry} documents={[entity, table]} onSave={() => {}} onCancel={() => {}} />);
    press("Remove owner from role");
    expect(screen.getByRole("alert").textContent).toContain("t/columns/0/visibleWhen/values/0");
    expect(screen.getByRole("list", { name: "Values of role" }).textContent).toContain("owner");
    expect(screen.getByRole("button", { name: "Save viewer facts" }).hasAttribute("disabled")).toBe(true);
    press("Remove editor from role");
    expect(screen.getByRole("list", { name: "Values of role" }).textContent).not.toContain("editor");
  });

  test("the default value is shown and cannot be removed", () => {
    render(<ViewerPanel viewer={viewer} registry={mockRegistry} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("list", { name: "Values of role" }).textContent).toContain("viewer (default)");
    press("Remove viewer from role");
    expect(screen.getByRole("alert").textContent).toContain("default");
  });
});
