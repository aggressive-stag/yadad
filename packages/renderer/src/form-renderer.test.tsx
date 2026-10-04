import type { DataAdapter, EntityDocument, FormView, Registry } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer";

// Inline stub: renderer may not import @yadad/testing (dependency rules).
const registry: Registry<ReactNode> = {
  fields: {
    text: {
      type: "text",
      Input: ({ inputId, value, invalid }) => <input id={inputId} data-stub="text" defaultValue={value} aria-invalid={invalid} />,
      Display: ({ value }) => <span>{value}</span>,
    },
  },
  layout: {
    FieldFrame: ({ inputId, label, required, children }) => (
      <div data-stub="frame">
        <label htmlFor={inputId}>
          {label}
          {required ? " *" : ""}
        </label>
        {children}
      </div>
    ),
  },
};

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "hello",
  revision: 1,
  fields: [{ id: "name", type: "text", label: "Name", required: true }],
};

const view: FormView = {
  kind: "form",
  specVersion: 0,
  id: "hello_form",
  entity: "hello",
  revision: 1,
  dataSource: "default",
  sections: [{ id: "main", title: "Hello", items: [{ field: "name" }] }],
};

const dataSources: ReadonlyMap<string, DataAdapter> = new Map([["default", createMemoryAdapter()]]);

function render(props: { entity?: EntityDocument; view?: FormView; dataSources?: ReadonlyMap<string, DataAdapter> } = {}): string {
  return renderToStaticMarkup(
    <FormRenderer
      entity={props.entity ?? entity}
      view={props.view ?? view}
      registry={registry}
      dataSources={props.dataSources ?? dataSources}
    />,
  );
}

describe("FormRenderer", () => {
  test("renders sections and fields through the registry", () => {
    const html = render();
    expect(html).toContain("<legend>Hello</legend>");
    expect(html).toMatch(/<label for="([^"]+)">Name \*<\/label><input id="\1" data-stub="text"/);
    expect(html).toContain('<button type="submit">Save</button>');
  });

  test("changing the label in the document changes the page", () => {
    const relabeled = { ...entity, fields: [{ ...entity.fields[0]!, label: "Your name" }] };
    expect(render({ entity: relabeled })).toContain(">Your name *</label>");
  });

  test("reports setup problems instead of rendering", () => {
    const html = render({
      view: { ...view, sections: [{ id: "main", items: [{ field: "missing" }] }] },
      dataSources: new Map(),
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-path="/dataSource"');
    expect(html).toContain('data-path="/sections/0/items/0/field"');
    expect(html).not.toContain("<form");
  });

  test("reports an entity the view was not written for", () => {
    expect(render({ entity: { ...entity, id: "other" } })).toContain('data-path="/entity"');
  });
});
