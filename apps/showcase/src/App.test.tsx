import { mockRegistry } from "@yadad/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App, defaultSources } from "./App";

test("renders the training dashboard and the hello form", () => {
  const html = renderToStaticMarkup(<App registry={mockRegistry} />);
  expect(html).toContain('role="tablist" aria-label="Training log"');
  expect(html).toContain(">Log</button>");
  expect(html).toContain("<legend>Log a set</legend>");
  expect(html).toContain("Working sets");
  expect(html).toContain("<legend>Hello</legend>");
});

test("a label edited in the JSON shows up with no code changes", () => {
  const entity = JSON.stringify({ kind: "entity", specVersion: 0, id: "hello", revision: 2, fields: [{ id: "name", type: "text", label: "Full name", required: true }] });
  const sources = defaultSources.map((s) => (s.includes('"id": "hello"') && s.includes('"kind": "entity"') ? entity : s));
  expect(renderToStaticMarkup(<App registry={mockRegistry} sources={sources} />)).toContain("Full name");
});

test("invalid documents are reported", () => {
  const html = renderToStaticMarkup(<App registry={mockRegistry} sources={["{ not json", '{"kind":"form","id":"broken"}']} roots={[]} />);
  expect(html).toContain('data-testid="document-errors"');
  expect(html).toContain("Not valid JSON");
  expect(html).toContain("broken/specVersion");
});

test("saved edits are restored, and edits that no longer validate are reported", () => {
  const saved = [
    { kind: "entity", specVersion: 0, id: "hello", revision: 3, fields: [{ id: "name", type: "text", label: "Restored name" }] },
    { kind: "form", id: "broken" },
  ];
  const storage = { getItem: (k: string) => (k === "yadad-showcase:documents" ? JSON.stringify(saved) : null), setItem: () => {} };
  const html = renderToStaticMarkup(<App registry={mockRegistry} storage={storage} onReset={() => {}} />);
  expect(html).toContain("Restored name");
  expect(html).toContain("no longer validate and were ignored: broken");
  expect(html).toContain(">Reset saved data</button>");
});
