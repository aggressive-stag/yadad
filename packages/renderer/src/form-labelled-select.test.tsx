// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DataRecord, EntityDocument, FormView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "ticket",
  revision: 1,
  fields: [
    {
      id: "status",
      type: "select",
      label: "Status",
      required: true,
      options: { source: "static", values: [{ value: "open", label: "Open" }, { value: "done", label: "Done" }] },
    },
  ],
};

const view: FormView = {
  kind: "form",
  specVersion: 0,
  id: "ticket_form",
  entity: "ticket",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "s", items: [{ field: "status" }] }],
};

test("a form over a labelled select saves the option's value", async () => {
  const saved: DataRecord[] = [];
  render(
    <FormRenderer
      entity={entity}
      view={view}
      registry={mockRegistry}
      dataSources={new Map([["default", createMemoryAdapter()]])}
      onSaved={(r) => saved.push(r)}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Status/), { target: { value: "open" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.values.status).toBe("open");
});
