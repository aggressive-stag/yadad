import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App";

test("renders the hello form from the fixture documents", () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain("<legend>Hello</legend>");
  expect(html).toContain('data-testid="input-name"');
});

test("a label edited in the JSON shows up with no code changes", () => {
  const entity = JSON.stringify({
    kind: "entity",
    specVersion: 0,
    id: "hello",
    revision: 2,
    fields: [{ id: "name", type: "text", label: "Full name", required: true }],
  });
  expect(renderToStaticMarkup(<App entitySource={entity} />)).toContain("Full name");
});

test("invalid documents show their errors instead of a form", () => {
  const html = renderToStaticMarkup(<App entitySource="{ not json" formSource='{"kind":"form"}' />);
  expect(html).toContain('data-testid="document-errors"');
  expect(html).toContain("Not valid JSON");
  expect(html).toContain("form/specVersion");
  expect(html).not.toContain("<form");
});
