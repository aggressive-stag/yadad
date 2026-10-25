// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DataAdapter, EntityDocument, FormView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry as registry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";

afterEach(cleanup);

// RFC 0009 item 4: `repeat: "batch"` on a create form is a queued composer —
// rows are drafts until one flush, the flush is one `batch create`, "+ another"
// never persists, and a validation error stays on the row it belongs to.
const entity: EntityDocument = {
  kind: "entity", specVersion: 8, id: "step", revision: 1,
  fields: [
    { id: "title", type: "text", label: "Step", required: true },
    { id: "ord", type: "number", label: "Order", min: 1 },
  ],
};

const view: FormView = {
  kind: "form", specVersion: 8, id: "step_form", entity: "step", revision: 1, dataSource: "default",
  repeat: "batch",
  sections: [{ id: "main", items: [{ field: "title" }, { field: "ord" }] }],
};

function setup(db: DataAdapter = createMemoryAdapter()): { db: DataAdapter } {
  render(<FormRenderer entity={entity} view={view} registry={registry} dataSources={new Map([["default", db]])} />);
  return { db };
}

const titleInputs = () => screen.getAllByTestId("input-title") as HTMLInputElement[];

describe("batch composer (RFC 0009 item 4)", () => {
  test("renders one row with the composer affordances", async () => {
    setup();
    expect(titleInputs()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "+ another" })).toBeTruthy();
    expect(screen.getByText("1 row")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  test('"another" queues a row without persisting; one Add flushes everything', async () => {
    const { db } = setup();
    fireEvent.change(titleInputs()[0]!, { target: { value: "One" } });
    fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    expect(titleInputs()).toHaveLength(2);
    expect((await db.find("step", {})).items).toHaveLength(0); // nothing persisted while queued
    fireEvent.change(titleInputs()[1]!, { target: { value: "Two" } });
    fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    fireEvent.change(titleInputs()[2]!, { target: { value: "Three" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect((await db.find("step", {})).items).toHaveLength(3));
    expect(titleInputs()).toHaveLength(1); // the composer resets to a single empty row
    expect(screen.getByText("Added 3 steps.")).toBeTruthy();
  });

  test("one row's validation error stays on that row, other rows keep their values", async () => {
    const { db } = setup();
    fireEvent.change(titleInputs()[0]!, { target: { value: "One" } });
    fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    fireEvent.change(titleInputs()[1]!, { target: { value: "" } }); // required, left blank
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent!.includes("required"))).toBe(true);
    expect((await db.find("step", {})).items).toHaveLength(0); // nothing saved — all or nothing
    expect(titleInputs()[0]!.value).toBe("One"); // the good row kept its value
    expect(titleInputs()[1]!.value).toBe("");
    expect((titleInputs()[0]! as HTMLInputElement).getAttribute("aria-invalid")).not.toBe("true");
    expect(titleInputs()[1]!.getAttribute("aria-invalid")).toBe("true");
  });

  test("an adapter that reports a row failure saves nothing (one transaction)", async () => {
    const db = createMemoryAdapter();
    let calls = 0;
    const flaky: DataAdapter = {
      ...db,
      async batch(entityId, rows, meta) {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return db.batch(entityId, rows, meta);
      },
    };
    setup(flaky);
    fireEvent.change(titleInputs()[0]!, { target: { value: "One" } });
    fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    fireEvent.change(titleInputs()[1]!, { target: { value: "Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/connection reset/i);
    expect((await db.find("step", {})).items).toHaveLength(0);
    expect(calls).toBe(1); // a row-level failure is one call, never a create loop
  });

  test("a number field that fails its min keeps the row and names the field", async () => {
    setup();
    fireEvent.change(titleInputs()[0]!, { target: { value: "One" } });
    fireEvent.change(screen.getByTestId("input-ord") as HTMLInputElement, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("at least 1");
  });

  test("removing a queued row never touches the adapter", async () => {
    const { db } = setup();
    fireEvent.change(titleInputs()[0]!, { target: { value: "Keep" } });
    fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    fireEvent.change(titleInputs()[1]!, { target: { value: "Drop" } });
    // the composer's rows carry a remove control from the second row on; removing
    // the second queued row leaves the first intact, adapter untouched.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove row" })[0]!);
    expect(titleInputs()).toHaveLength(1);
    expect(titleInputs()[0]!.value).toBe("Keep");
    expect((await db.find("step", {})).items).toHaveLength(0);
  });

  test("the flush is ONE adapter batch call for N rows — never a create loop", async () => {
    const inner = createMemoryAdapter();
    let batchCalls = 0;
    let createCalls = 0;
    const counting: DataAdapter = {
      ...inner,
      async batch(e, rows, meta) {
        batchCalls += 1;
        return inner.batch(e, rows, meta);
      },
      async create(e, values, meta) {
        createCalls += 1;
        return inner.create(e, values, meta);
      },
    };
    setup(counting);
    for (const title of ["A", "B", "C", "D"]) {
      fireEvent.change(titleInputs()[titleInputs().length - 1]!, { target: { value: title } });
      if (title !== "D") fireEvent.click(screen.getByRole("button", { name: "+ another" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect((await inner.find("step", {})).items).toHaveLength(4));
    expect(batchCalls).toBe(1); // one atomic write for the whole composer
    expect(createCalls).toBe(0); // no per-row create loop
  });

  test("drafts do not apply: rows live in component state only", async () => {
    setup();
    fireEvent.change(titleInputs()[0]!, { target: { value: "Typed" } });
    expect(localStorage.length).toBe(0); // no draft storage touched for a batch composer
  });
});
