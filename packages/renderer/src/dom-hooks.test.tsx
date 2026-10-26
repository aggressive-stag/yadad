// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import type { EntityDocument, FormView, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry as registry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity", specVersion: 8, id: "item", revision: 1,
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "tags", type: "tags", label: "Tags" },
    { id: "done", type: "boolean", label: "Done" },
    { id: "day", type: "date", label: "Day" },
  ],
};
const dataSources = () => new Map([["default", createMemoryAdapter()]]);

describe("quick-filter hooks", () => {
  test("every quick-filter kind is wrapped in data-yadad-filter-field inside its table scope", () => {
    const mk = (id: string, fields: string[]): TableView => ({ kind: "table", specVersion: 8, id, entity: "item", revision: 1, dataSource: "default", columns: [{ field: "title" }], quickFilters: fields.map((field) => ({ field })) });
    const { container } = render(
      <>
        <TableRenderer entity={entity} view={mk("a", ["title", "tags", "done", "day"])} registry={registry} dataSources={dataSources()} />
        <TableRenderer entity={entity} view={mk("b", ["tags"])} registry={registry} dataSources={dataSources()} />
      </>,
    );
    const a = container.querySelector<HTMLElement>('[data-yadad-table-view="a"]')!;
    const b = container.querySelector<HTMLElement>('[data-yadad-table-view="b"]')!;
    const fields = (el: HTMLElement) => [...el.querySelectorAll("[data-yadad-filter-field]")].map((n) => n.getAttribute("data-yadad-filter-field"));
    expect(fields(a)).toEqual(["title", "tags", "done", "day"]);
    expect(fields(b)).toEqual(["tags"]);
    const tagsA = a.querySelector<HTMLElement>('[data-yadad-filter-field="tags"]')!;
    const tagsB = b.querySelector<HTMLElement>('[data-yadad-filter-field="tags"]')!;
    expect(tagsA).not.toBe(tagsB);
    expect(within(tagsA).getAllByTestId("input-tags")).toHaveLength(1);
    // a range filter keeps both ends under one wrapper
    expect(a.querySelectorAll('[data-yadad-filter-field="day"] input, [data-yadad-filter-field="day"] [data-testid]').length).toBeGreaterThanOrEqual(2);
  });
});

describe("batch composer hooks", () => {
  test("two instances of the same form are each scoped by form id and wrapper", () => {
    const view: FormView = { kind: "form", specVersion: 8, id: "add_item", entity: "item", revision: 1, dataSource: "default", repeat: "batch", sections: [{ id: "main", items: [{ field: "title" }] }] };
    const { container } = render(
      <>
        <div data-yadad-add-form="add_item" data-slot="one"><FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources()} /></div>
        <div data-yadad-add-form="add_item" data-slot="two"><FormRenderer entity={entity} view={view} registry={registry} dataSources={dataSources()} /></div>
      </>,
    );
    expect(container.querySelectorAll('[data-yadad-batch-controls="add_item"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-yadad-batch-count="add_item"]')).toHaveLength(2);
    for (const slot of ["one", "two"]) {
      const scope = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
      expect(scope.querySelectorAll('[data-yadad-batch-controls="add_item"]')).toHaveLength(1);
      expect(scope.querySelector('[data-yadad-batch-count="add_item"]')?.textContent).toBe("1 row");
    }
  });
});
