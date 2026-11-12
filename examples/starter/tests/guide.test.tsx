// @vitest-environment jsdom
// docs/guide.md quotes this starter. The guide and the starter must stay in step:
// every quoted file equals the file, every excerpt is in the file, each step builds a valid set,
// and the two files the guide adds (a viewer and a changed tasks table) work.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDocuments } from "@yadad/core";
import type { Document } from "@yadad/core";
import { TableRenderer } from "@yadad/renderer";
import { createHttpAdapter, findViewerDocument, resolveViewer } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { createSeededAdapter } from "../src/adapter";
import { documents as starterDocuments, entities } from "../src/documents";
import { captureExchanges, format } from "./exchanges";

afterEach(cleanup);

const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "..", path), "utf8").trimEnd();
const guide = readFileSync(resolve(import.meta.dirname, "../../../docs/guide.md"), "utf8");

interface Block {
  readonly kind: "step" | "excerpt" | "new" | "changed" | "output";
  readonly step?: number;
  readonly path: string;
  readonly text: string;
}

/** Every fenced block of the guide that follows a `<!-- kind: path -->` marker. */
function blocks(): Block[] {
  const out: Block[] = [];
  for (const m of guide.matchAll(/<!-- (step (\d+)|excerpt|new|changed|output): ?(.*?) -->\n```\w*\n([\s\S]*?)\n```/g)) {
    const kind = (m[2] ? "step" : m[1]) as Block["kind"];
    out.push({ kind, ...(m[2] ? { step: Number(m[2]) } : {}), path: m[3] ?? "", text: (m[4] ?? "").trimEnd() });
  }
  return out;
}

const all = blocks();

describe("docs/guide.md", () => {
  it("has quoted blocks", () => {
    expect(all.filter((b) => b.kind === "step").length).toBeGreaterThanOrEqual(10);
  });

  it("quotes every starter document exactly, and no file is quoted that does not exist", () => {
    for (const b of all.filter((x) => x.kind === "step")) expect(b.text, `${b.path} in step ${b.step}`).toBe(read(b.path));
  });

  it("quotes every document of the starter somewhere", () => {
    const quoted = new Set(all.filter((b) => b.kind === "step").map((b) => b.path));
    for (const file of ["person", "task", "person_form", "subtask", "task_form", "tasks", "person_tasks", "people", "board", "calendar", "overview"]) {
      expect(quoted.has(`documents/${file}.json`), `documents/${file}.json is not in the guide`).toBe(true);
    }
  });

  it("only quotes excerpts that are in the file", () => {
    for (const b of all.filter((x) => x.kind === "excerpt")) expect(read(b.path), `excerpt of ${b.path}`).toContain(b.text);
  });

  it("builds a valid set after every step", () => {
    const set = new Map<string, unknown>();
    for (const step of [1, 2, 3, 4, 5]) {
      for (const b of all.filter((x) => x.kind === "step" && x.step === step)) set.set(b.path, JSON.parse(b.text));
      const result = validateDocuments([...set.values()]);
      expect(result.ok ? [] : result.errors.map((e) => `step ${step}: ${e.document}${e.path} ${e.message}`)).toEqual([]);
    }
  });

  it("builds a valid set with the viewer and the changed tasks table", () => {
    const set = new Map<string, unknown>();
    for (const b of all.filter((x) => x.kind === "step")) set.set(b.path, JSON.parse(b.text));
    for (const b of all.filter((x) => x.kind === "new" || x.kind === "changed")) set.set(b.path, JSON.parse(b.text));
    const result = validateDocuments([...set.values()]);
    expect(result.ok ? [] : result.errors.map((e) => `${e.document}${e.path} ${e.message}`)).toEqual([]);
  });

  it("shows the error the check prints for a misspelled column, from the same validator", () => {
    const tasks = JSON.parse(read("documents/tasks.json")) as { columns: { field: string }[] };
    tasks.columns[0]!.field = "titel";
    const docs = ["person", "task", "subtask", "person_form", "task_form", "people", "person_tasks"].map((f) => JSON.parse(read(`documents/${f}.json`)) as unknown);
    const result = validateDocuments([...docs, tasks]);
    expect(result.ok).toBe(false);
    const lines = result.ok ? [] : result.errors.map((e) => `documents/tasks.json ${e.path} [${e.code}] ${e.message}`);
    const shown = all.find((b) => b.kind === "output")!.text;
    expect(lines).toEqual([shown]);
  });
});

describe("step 6: the Notes column is for leads", () => {
  const viewerDoc = JSON.parse(all.find((b) => b.kind === "new")!.text) as Document;
  const tasksView = JSON.parse(all.find((b) => b.kind === "changed")!.text) as Parameters<typeof TableRenderer>[0]["view"];
  const documents = [...starterDocuments, viewerDoc];

  async function headers(role: string | undefined): Promise<string[]> {
    const adapter = await createSeededAdapter();
    const { viewer } = resolveViewer(findViewerDocument(documents), role === undefined ? [] : [{ fact: "role", value: role }]);
    render(<TableRenderer entity={entities.get("task")!} view={tasksView} registry={mockRegistry} dataSources={new Map([["default", adapter]])} entities={entities} viewer={viewer} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    return screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
  }

  it("hides Notes from the default viewer and shows it to a lead", async () => {
    expect((await headers(undefined)).join("|")).not.toContain("Notes");
    cleanup();
    expect((await headers("lead")).join("|")).toContain("Notes");
  });
});

// Part 2 shows real HTTP traffic. The starter's server and yadad's HTTP adapter produce it here.
describe("guide part 2: the HTTP exchanges", () => {
  const shown = new Map([...guide.matchAll(/<!-- exchange: ([\w-]+) -->\n```http\n([\s\S]*?)\n```/g)].map((m) => [m[1]!, m[2]!]));

  it("shows every exchange exactly as the adapter and the server produce it", async () => {
    const real = await captureExchanges();
    expect([...shown.keys()].sort()).toEqual(real.map((e) => e.name).sort());
    for (const e of real) expect(shown.get(e.name), `exchange ${e.name}`).toBe(format(e));
  }, 60_000);

  it("shows a record with can as the adapter reads it", async () => {
    const m = /<!-- record-with-can -->\n```json\n([\s\S]*?)\n```/.exec(guide);
    const record = JSON.parse(m![1]!) as { id: string };
    const adapter = createHttpAdapter({
      baseUrl: "/api/records",
      fetch: async () => ({ status: 200, json: async () => record }),
    });
    expect(await adapter.findOne("task", record.id)).toEqual(record);
  });
});
