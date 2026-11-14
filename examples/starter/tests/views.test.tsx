// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { baseRegistry } from "@yadad/components";
import { CalendarRenderer, DashboardRenderer, FormRenderer, TableRenderer, BoardRenderer } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";
import { checkViewStates, problems } from "@yadad/testing/state-checks";
import type { CheckViewStatesOptions } from "@yadad/testing/state-checks";
import { validateDocuments } from "@yadad/core";
import { createSeededAdapter } from "../src/adapter";
import { View } from "../src/App";
import { docSet, documents, entities, views } from "../src/documents";

afterEach(cleanup);

// The same gate as `npm run check`: a document the engine rejects fails the build.
it("every document is valid as one set", () => {
  const result = validateDocuments(documents);
  expect(result.ok ? [] : result.errors.map((e) => `${e.document}${e.path} ${e.message}`)).toEqual([]);
});

// One render test per view, with the stand-in registry: the document draws something and
// the renderer reports no missing registry key.
describe.each(views.map((v) => [v.id, v] as const))("view %s renders", (_id, view) => {
  it("with the mock registry", async () => {
    const dataSources = new Map([["default", await createSeededAdapter()]]);
    const { container } = render(<View view={view} dataSources={dataSources} registry={mockRegistry} />);
    await waitFor(() => expect(container.textContent?.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).not.toMatch(/missing/i);
  });
});

// The edge case: requiredWhen makes Notes required while the status is Blocked.
describe("requiredWhen", () => {
  it("refuses a Blocked task with no notes, with the field's message, and accepts it once explained", async () => {
    const adapter = await createSeededAdapter();
    const form = views.find((v) => v.id === "task_form")!;
    render(<View view={form} dataSources={new Map([["default", adapter]])} registry={baseRegistry} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Ship it" } });
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: "Blocked" } });
    const before = (await adapter.find("task", {})).items.length;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const notes = await screen.findByLabelText(/Notes/);
    await waitFor(() => expect(notes.getAttribute("aria-invalid")).toBe("true"));
    expect(document.body.textContent).toMatch(/is required/i);
    expect((await adapter.find("task", {})).items.length).toBe(before);
    fireEvent.change(notes, { target: { value: "Waiting on legal." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await adapter.find("task", {})).items.length).toBe(before + 1));
  });
});

// card 99: the table's editForm opens a task in the task form, with its checklist, and saves it.
describe("editForm", () => {
  it("opens the task in the form, saves only what changed and keeps the notes the form does not touch", async () => {
    const adapter = await createSeededAdapter();
    const tasks = views.find((v) => v.id === "tasks")!;
    const { container } = render(<View view={tasks} dataSources={new Map([["default", adapter]])} registry={baseRegistry} />);
    const first = (await adapter.find("task", {})).items.find((t) => t.values["title"] === "Write the release notes")!; // the seed gives this task its checklist
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${first.values["title"]}` }));
    expect(await screen.findByText("Draft")).toBeTruthy(); // the checklist hangs off the record being edited
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Renamed in the form" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Renamed in the form");
    const saved = await adapter.findOne("task", first.id);
    expect(saved?.values).toEqual({ ...first.values, title: "Renamed in the form" });
    expect(container.querySelector("[data-yadad-edit-form]")).toBeNull();
  });
});

// card 107: a board card and a calendar entry open in the same form, with the real components.
describe("editForm on the board and the calendar", () => {
  it.each(["board", "calendar"])("the %s opens a task in the task form and saves it", async (id) => {
    const adapter = await createSeededAdapter();
    const view = views.find((v) => v.id === id)!;
    const task = (await adapter.find("task", {})).items.find((t) => t.values["title"] !== undefined && (id === "board" || t.values["due"] !== undefined))!;
    const { container } = render(<View view={view} dataSources={new Map([["default", adapter]])} registry={baseRegistry} />);
    const edit = (await screen.findAllByRole("button", { name: `Edit ${task.values["title"]}` }))[0]!;
    fireEvent.click(edit);
    fireEvent.change(await screen.findByLabelText(/Title/), { target: { value: "Renamed from a " + id } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await adapter.findOne("task", task.id))?.values["title"]).toBe("Renamed from a " + id));
    await waitFor(() => expect(container.querySelector("[data-yadad-edit-form]")).toBeNull());
  });
});

// The state grid: every view in every data and source state, with the real registry.
const now = new Date(2026, 9, 17);
const draw: CheckViewStatesOptions["render"] = (state, { view, entity, registry, dataSources, drafts }) => {
  const shared = { registry, dataSources, entities, documents: docSet };
  switch (view.kind) {
    case "form": return <FormRenderer entity={entity!} view={view} {...shared} {...(drafts ? { drafts } : {})} />;
    case "table": return <TableRenderer entity={entity!} view={view} {...shared} {...((state.render as { savedFilter?: string }).savedFilter ? { savedFilter: (state.render as { savedFilter: string }).savedFilter } : {})} />;
    case "board": return <BoardRenderer entity={entity!} view={view} {...shared} initialGroupBy={(state.render as { groupBy: string }).groupBy} />;
    case "calendar":
      return <CalendarRenderer entity={entity!} view={view} {...shared} initialMode={(state.render as { mode: "month" | "week" }).mode} initialAnchor={(state.render as { anchor: string }).anchor} />;
    case "dashboard": return <DashboardRenderer dashboard={view} documents={docSet} registry={registry} dataSources={dataSources} />;
  }
};
describe("checkViewStates", () => {
  it.each(views.map((v) => v.id))("%s, in every state", async (id) => {
    const results = await checkViewStates({ view: id, documents, registry: baseRegistry, now, render: draw });
    expect(results.length).toBeGreaterThan(0);
    expect(problems(results)).toEqual([]);
  }, 180_000);
});
