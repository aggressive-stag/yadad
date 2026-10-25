// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DataAdapter, EntityDocument, SubRecordSection } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { SubRecordChecklist } from "./sub-records.js";

afterEach(cleanup);

// RFC 0009 item 3: a checklist is an entity with a declared sub-record section.
// A task has steps; each step is its own record (id, version, can) of `step`,
// pointing back at the task through `via: "task"`.
const task: EntityDocument = {
  kind: "entity", specVersion: 8, id: "task", revision: 1,
  fields: [{ id: "title", type: "text", label: "Title", required: true }],
};

const step: EntityDocument = {
  kind: "entity", specVersion: 8, id: "step", revision: 1,
  fields: [
    { id: "task", type: "reference", label: "Task", entity: "task" },
    { id: "title", type: "text", label: "Step" },
    { id: "done", type: "boolean", label: "Done" },
    { id: "ord", type: "number", label: "Order" },
  ],
};

const sub: SubRecordSection = { entity: "step", via: "task", titleField: "title", doneField: "done", orderField: "ord" };

const parent = { id: "t1", entityId: "task", entityRevision: 1, version: "v1", values: { title: "Ship it" } };
const entities = new Map([[step.id, step]]);

async function setup(overrides: { sub?: typeof sub; parent?: typeof parent; noParent?: boolean; db?: DataAdapter; entities?: ReadonlyMap<string, EntityDocument> } = {}): Promise<DataAdapter> {
  const db = overrides.db ?? createMemoryAdapter();
  render(
    <SubRecordChecklist
      entity={task}
      sub={overrides.sub ?? sub}
      registry={mockRegistry}
      adapter={db}
      entities={overrides.entities ?? entities}
      {...(overrides.noParent === true ? {} : { parent: overrides.parent ?? parent })}
    />,
  );
  return db;
}

const stepRows = () => screen.getAllByRole("row").slice(1);

describe("SubRecordChecklist (RFC 0009 item 3)", () => {
  test("lists the child records whose via names the parent, in orderField order", async () => {
    const db = createMemoryAdapter();
    await db.create("step", { task: "t1", title: "Write", done: false, ord: 2 }, { entityRevision: 1 });
    await db.create("step", { task: "t1", title: "Review", done: false, ord: 1 }, { entityRevision: 1 });
    await db.create("step", { task: "t2", title: "Not mine", done: false, ord: 3 }, { entityRevision: 1 });
    await setup({ db });
    await screen.findByTestId("row-1");
    expect(stepRows().map((r) => within(r).getByText(/Write|Review|Not mine/).textContent)).toEqual(["Review", "Write"]);
    expect(screen.queryByText("Not mine")).toBeNull(); // the back-reference scopes the rows
  });

  test("the add control creates a child record through the adapter, focused for editing", async () => {
    const db = await setup();
    const input = screen.getByTestId("sub-record-input-step") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    const row = await screen.findByTestId("row-1");
    expect(within(row).getByRole("textbox", { name: "Step" })).toBeTruthy(); // lands focused in edit mode
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole("textbox", { name: "Step" })));
    const saved = (await db.find("step", {})).items[0]!;
    expect(saved.values).toMatchObject({ title: "Draft", task: "t1" }); // via is filled by the renderer
    expect(screen.getByText("Added Draft.")).toBeTruthy();
  });

  test("Enter in the add input adds a row (quick-add)", async () => {
    const db = await setup();
    const input = screen.getByTestId("sub-record-input-step") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Fast" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByTestId("row-1");
    expect((await db.find("step", {})).items).toHaveLength(1);
  });

  test("the checkbox ticks the step through the adapter with baseVersion", async () => {
    const db = createMemoryAdapter();
    const created = await db.create("step", { task: "t1", title: "Write", done: false }, { entityRevision: 1 });
    let seenVersion: string | undefined;
    const spy: DataAdapter = {
      ...db,
      async update(entity, id, patch, meta) {
        seenVersion = meta.baseVersion;
        return db.update(entity, id, patch, meta);
      },
    };
    await setup({ db: spy });
    const box = await screen.findByRole("checkbox", { name: "Done" });
    fireEvent.click(box);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    expect((await db.find("step", {})).items[0]!.values["done"]).toBe(true);
    expect(seenVersion).toBe(created.version); // optimistic concurrency rides the normal update path
    expect(screen.getByText("Write: done.")).toBeTruthy();
  });

  test("editing a title: click the text, type, Save writes one field under the version", async () => {
    const db = createMemoryAdapter();
    await db.create("step", { task: "t1", title: "Write", done: false }, { entityRevision: 1 });
    await setup({ db });
    const row = await screen.findByTestId("row-1");
    fireEvent.click(within(row).getByRole("button", { name: "Write" }));
    const input = within(row).getByRole("textbox", { name: "Step" }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input)); // focus on the row being typed
    fireEvent.change(input, { target: { value: "Write tests" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(row).queryByRole("textbox")).toBeNull());
    expect(within(row).getByText("Write tests")).toBeTruthy();
    expect((await db.find("step", {})).items[0]!.values["title"]).toBe("Write tests");
  });

  test("Remove deletes the child record", async () => {
    const db = createMemoryAdapter();
    await db.create("step", { task: "t1", title: "Drop", done: false }, { entityRevision: 1 });
    await setup({ db });
    const row = await screen.findByTestId("row-1");
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByTestId("row-1")).toBeNull());
    expect((await db.find("step", {})).items).toHaveLength(0);
    expect(screen.getByText("Removed Drop.")).toBeTruthy();
  });

  test("can.fields locks the title: it shows as text, no edit button, no remove", async () => {
    const db = createMemoryAdapter();
    await db.create("step", { task: "t1", title: "Locked", done: false }, { entityRevision: 1 });
    const locked: DataAdapter = {
      ...db,
      async find(entity, query) {
        const page = await db.find(entity, query);
        return { ...page, items: page.items.map((r) => ({ ...r, can: { update: true, fields: { title: false } } })) };
      },
    };
    await setup({ db: locked });
    const row = await screen.findByTestId("row-1");
    expect(within(row).getByText("Locked")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Locked" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("a new parent with no record yet: the section waits instead of writing orphans", async () => {
    await setup({ noParent: true });
    expect(screen.getByText("Save the task first, then add its rows.")).toBeTruthy();
    expect(screen.queryByTestId("sub-record-input-step")).toBeNull();
  });

  test("a bad declaration names the problem instead of rendering a broken checklist", async () => {
    const db = createMemoryAdapter();
    await setup({ db, sub: { ...sub, doneField: "title" as "done" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain('not a boolean field');
  });
});
