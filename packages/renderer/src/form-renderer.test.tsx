import type { DataAdapter, EntityDocument, FormView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry as registry } from "@yadad/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FormRenderer } from "./form-renderer.js";

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
    expect(html).toContain('<fieldset data-testid="section-main"><legend>Hello</legend>');
    expect(html).toMatch(/<label for="([^"]+)">Name<span aria-hidden="true"> \*<\/span><\/label><input id="\1" data-testid="input-name"/);
    expect(html).toContain('<button type="submit" data-variant="primary">Save</button>');
  });

  test("each field type goes to its own registry entry", () => {
    const all: EntityDocument = {
      ...entity,
      fields: [
        { id: "name", type: "text", label: "Name" },
        { id: "weight", type: "number", label: "Weight" },
        { id: "warmup", type: "boolean", label: "Warm-up" },
        { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat"] } },
        { id: "day", type: "date", label: "Day" },
      ],
    };
    const form: FormView = { ...view, sections: [{ id: "main", items: all.fields.map((f) => ({ field: f.id })) }] };
    const html = render({ entity: all, view: form });
    for (const type of ["text", "number", "checkbox", "date"]) expect(html).toContain(`type="${type}"`);
    expect(html).toContain("<select");
  });

  test("changing the label in the document changes the page", () => {
    const relabeled = { ...entity, fields: [{ ...entity.fields[0]!, label: "Your name" }] };
    expect(render({ entity: relabeled })).toContain(">Your name<span");
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
