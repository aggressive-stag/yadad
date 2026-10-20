// @vitest-environment jsdom
import { ForbiddenError, RecordConflictError } from "@yadad/core";
import type { EntityDocument, Registry, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

// publish runs on press; archive has a confirm, so 35g must build its dialog before it is offered.
const entity: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "doc",
  revision: 1,
  fields: [
    { id: "n", type: "number", label: "N" },
    { id: "tag", type: "text", label: "Tag" },
  ],
  actions: [
    { id: "publish", label: "Publish" },
    { id: "archive", label: "Archive", confirm: { message: "Archive this?", tone: "danger" } },
  ],
};

const view: TableView = {
  kind: "table",
  specVersion: 1,
  id: "rows",
  entity: "doc",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "n" }, { field: "tag" }],
  recordActions: ["publish", "archive"],
};

async function seeded(options: Parameters<typeof createMemoryAdapter>[0] = {}): Promise<ReturnType<typeof createMemoryAdapter>> {
  const db = createMemoryAdapter(options);
  await db.create("doc", { n: 1, tag: "draft" }, { entityRevision: 1 });
  await db.create("doc", { n: 2, tag: "draft" }, { entityRevision: 1 });
  return db;
}

const show = (db: ReturnType<typeof createMemoryAdapter>, registry: Registry<ReactNode> = mockRegistry) =>
  render(<TableRenderer entity={entity} view={view} registry={registry} dataSources={new Map([["default", db]])} />);

/** Cell text of the row whose n column shows `n`, for the given field. */
function tagOf(n: number): string | undefined {
  const row = screen.getAllByRole("row").find((r) => r.querySelector("[data-testid='display-n']")?.textContent === String(n));
  return row?.querySelector("[data-testid='display-tag']")?.textContent ?? undefined;
}
const summary = () => document.querySelector("[data-testid='error-summary']");
const statusText = () => document.querySelector('[role="status"]')?.textContent;
const press = (id: string) => fireEvent.click(document.querySelector(`[data-testid='action-${id}']`) as HTMLElement);

describe("record actions on tables (RFC 0007)", () => {
  test("pressing an action runs it, announces it and reloads the page", async () => {
    const db = await seeded({ actions: { "doc.publish": () => ({ values: { tag: "live" } }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBe("live")); // the page reloaded with the new value
    expect(tagOf(2)).toBe("draft"); // only the pressed record changed
  });

  test("a 403 shows the ErrorSummary and reloads", async () => {
    const db = await seeded({ actions: { "doc.publish": () => { throw new ForbiddenError("Only editors may publish."); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(summary()?.textContent).toContain("Only editors may publish."));
    await waitFor(() => expect(tagOf(1)).toBe("draft")); // the refusal reloaded; the record was untouched
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
  });

  test("a 409 shows the conflict with its reload hint", async () => {
    const db = await seeded({ actions: { "doc.publish": () => { throw new RecordConflictError("The record changed since you loaded it.", null); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(summary()?.textContent).toContain("changed since you loaded it"));
    expect(summary()?.textContent).toContain("Reload to see the latest version");
  });

  test("an adapter without act: an ErrorSummary instead of the table", async () => {
    const db = await seeded(); // no handlers: the adapter does not advertise act at all
    show(db);
    await waitFor(() => expect(summary()).not.toBeNull());
    expect(summary()?.textContent).toContain("The data source of view rows cannot run actions.");
    expect(summary()?.querySelector("li")?.getAttribute("data-path")).toBe("/dataSource");
    expect(summary()?.querySelector("li")?.getAttribute("data-code")).toBe("required");
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("an action that needs a dialog in a registry without one: an ErrorSummary", async () => {
    const db = await seeded({ actions: { "doc.publish": () => ({ values: { tag: "live" } }), "doc.archive": () => ({ remove: true }) } });
    const { Dialog, ...layout } = mockRegistry.layout;
    void Dialog;
    const noDialog: Registry<ReactNode> = { ...mockRegistry, layout };
    show(db, noDialog);
    await waitFor(() => expect(summary()).not.toBeNull());
    expect(summary()?.textContent).toContain("needs a dialog, which this registry does not provide");
    expect(summary()?.querySelector("li")?.getAttribute("data-path")).toBe("/layout/Dialog");
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("a confirm-only action is not offered yet (35g builds its dialog)", async () => {
    const db = await seeded({ actions: { "doc.publish": () => ({ values: { tag: "live" } }), "doc.archive": () => ({ remove: true }) } });
    show(db); // mockRegistry HAS a Dialog: the exclusion is 35g's gate, not a missing component
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    expect(document.querySelector("[data-testid='action-archive']")).toBeNull(); // never runs without its confirmation
    expect(tagOf(1)).toBe("draft");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy(); // the column exists for publish alone
  });

  test("a view with no recordActions gets no actions column and no errors", async () => {
    const db = await seeded();
    const { recordActions, ...plain } = view;
    void recordActions;
    render(<TableRenderer entity={entity} view={plain} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(summary()).toBeNull();
  });
});
