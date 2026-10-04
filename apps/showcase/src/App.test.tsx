import { mockRegistry } from "@yadad/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App, defaultViews } from "./App";

const hello = defaultViews[2]!;

test("renders the fixture forms", () => {
  const html = renderToStaticMarkup(<App registry={mockRegistry} />);
  expect(html).toContain("<legend>Log a set</legend>");
  expect(html).toContain('type="date"');
  expect(html).toContain("<option value=\"Deadlift\">Deadlift</option>");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("<legend>Hello</legend>");
  expect(html).toContain('data-testid="input-name"');
  expect(html).toContain("<caption>Logged sets</caption>");
});

test("a label edited in the JSON shows up with no code changes", () => {
  const entity = JSON.stringify({
    kind: "entity",
    specVersion: 0,
    id: "hello",
    revision: 2,
    fields: [{ id: "name", type: "text", label: "Full name", required: true }],
  });
  expect(renderToStaticMarkup(<App registry={mockRegistry} views={[{ ...hello, entity }]} />)).toContain("Full name");
});

test("invalid documents show their errors instead of a form", () => {
  const html = renderToStaticMarkup(<App registry={mockRegistry} views={[{ entity: "{ not json", view: '{"kind":"form"}' }]} />);
  expect(html).toContain('data-testid="document-errors"');
  expect(html).toContain("Not valid JSON");
  expect(html).toContain("view/specVersion");
  expect(html).not.toContain("<form");
});
