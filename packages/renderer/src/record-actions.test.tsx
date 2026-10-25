// @vitest-environment jsdom
import { ForbiddenError, RecordConflictError, RecordValidationError } from "@yadad/core";
import type { EntityDocument, Registry, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import { mockRegistry } from "@yadad/testing";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TableRenderer } from "./table-renderer.js";

afterEach(cleanup);

// publish runs on press; archive asks for a reason and has a danger confirm — both go through the dialog (35g).
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
    {
      id: "archive",
      label: "Archive",
      confirm: { title: "Archive this", message: "Archive this record?", confirmLabel: "Reject", tone: "danger" },
      input: [{ id: "reason", type: "text", label: "Reason", required: true }],
    },
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
const summary = () => [...document.querySelectorAll("[data-testid='error-summary']")].find((el) => el.closest("[data-testid='dialog']") === null) ?? null;
const dialog = () => document.querySelector("[data-testid='dialog']");
const statusText = () => document.querySelector('[role="status"]')?.textContent;
const press = (id: string) => fireEvent.click(document.querySelector(`[data-testid='action-${id}']`) as HTMLElement);
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;
const reasonInput = () => document.querySelector("[data-testid='input-reason']") as HTMLInputElement;
const typeReason = (v: string) => fireEvent.change(reasonInput(), { target: { value: v } });

describe("record actions on tables (RFC 0007)", () => {
  test("pressing an action runs it, announces it and reloads the page", async () => {
    const db = await seeded({ actions: { "doc.publish": () => ({ values: { tag: "live" } }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBe("live")); // the page reloaded with the new value
    expect(tagOf(2)).toBe("draft"); // only the pressed record changed
    expect(dialog()).toBeNull(); // publish has no confirm and no input: no dialog
  });

  test("a protocol 400 from a direct press keeps each entry's own message and hint, with no reload advice", async () => {
    // The server located the refusal in its own errors[]: the summary shows
    // those, not a generic line telling the viewer to reload what reloading
    // cannot fix. A /values/<field> path marks the field (pinned in the form
    // tests); here the record's fields are the columns, shown via tag.
    const db = await seeded({
      actions: {
        "doc.publish": () => {
          throw new RecordValidationError("The server rejected the request.", [
            { path: "/values/tag", code: "invalid-value", message: "only drafts may publish", hint: "unpublish it first" },
          ]);
        },
      },
    });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(summary()?.textContent).toContain("only drafts may publish"));
    expect(summary()?.textContent).toContain("unpublish it first"); // the server's own hint
    expect(summary()?.textContent).not.toContain("Reload and try again.");
    expect(summary()?.querySelector("[data-path='/tag']")).toBeTruthy(); // the field the server located
    expect(tagOf(1)).toBe("draft"); // the record was untouched
  });

  test("a plain Error from a direct press keeps the generic hint", async () => {
    const db = await seeded({ actions: { "doc.publish": () => { throw new Error("The server fell over."); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    press("publish");
    await waitFor(() => expect(summary()?.textContent).toContain("The server fell over."));
    expect(summary()?.textContent).toContain("Reload and try again.");
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

describe("the action dialog (RFC 0007)", () => {
  test("press opens the dialog with its message; Confirm with a valid reason runs act", async () => {
    let acts = 0;
    const db = await seeded({
      actions: {
        "doc.archive": (record, input) => {
          acts++;
          expect(input?.reason).toBe("obsolete");
          return { values: { tag: `archived:${String(record.values.n)}` } };
        },
      },
    });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    expect(dialog()?.getAttribute("aria-label")).toBe("Archive this"); // confirm title, not the label
    expect(dialog()?.textContent).toContain("Archive this record?"); // the message
    // Confirm carries confirmLabel and the danger tone, Cancel is a plain secondary.
    expect(button("Reject").getAttribute("data-variant")).toBe("primary");
    expect(button("Reject").getAttribute("data-tone")).toBe("danger");
    expect(button("Cancel").getAttribute("data-variant")).toBe("secondary");
    typeReason("obsolete");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(statusText()).toBe("Archive done"));
    expect(acts).toBe(1);
    await waitFor(() => expect(tagOf(1)).toBe("archived:1"));
    expect(dialog()).toBeNull();
  });

  test("Confirm validates the input first: a missing required reason never reaches act", async () => {
    let acts = 0;
    const db = await seeded({ actions: { "doc.archive": () => { acts++; return { remove: true }; } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    fireEvent.click(button("Reject"));
    expect(acts).toBe(0); // the document rules rejected it before the server saw it
    expect(dialog()).not.toBeNull(); // stays open
    expect(reasonInput().getAttribute("aria-invalid")).toBe("true");
    // fixing it lets it through
    typeReason("why not");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(acts).toBe(1));
  });

  test("a 400 keeps the dialog open and puts the /input/<id> issue on its field", async () => {
    const db = await seeded({
      actions: {
        "doc.archive": () => {
          throw new RecordValidationError("No.", [{ path: "/input/reason", code: "invalid-value", message: "Reason too short.", hint: "Say more." }]);
        },
      },
    });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("x");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(dialog()?.textContent).toContain("Reason too short.")); // the issue stays in the dialog, on the field
    expect(summary()).toBeNull(); // no view ErrorSummary: the viewer fixes it
    expect(reasonInput().getAttribute("aria-invalid")).toBe("true");
  });

  test("a 403 from Confirm closes the dialog, shows the ErrorSummary and reloads", async () => {
    const db = await seeded({ actions: { "doc.archive": () => { throw new ForbiddenError("Archiving is for moderators."); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("done with it");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(summary()?.textContent).toContain("Archiving is for moderators."));
    expect(dialog()).toBeNull(); // closed, nothing kept, nothing retried
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
  });

  test("a 409 from Confirm closes like a 403", async () => {
    const db = await seeded({ actions: { "doc.archive": () => { throw new RecordConflictError("It changed while you were deciding.", null); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("done");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(summary()?.textContent).toContain("It changed while you were deciding."));
    expect(dialog()).toBeNull();
  });

  test("any other failure keeps the dialog open with the message so the viewer can retry", async () => {
    let calls = 0;
    const db = await seeded({ actions: { "doc.archive": () => { calls++; throw new Error("The server fell over."); } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("again");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(dialog()?.textContent).toContain("The server fell over."));
    expect(dialog()).not.toBeNull(); // open, message shown, Confirm live again for a retry
    expect(button("Reject").disabled).toBe(false);
    expect(summary()).toBeNull(); // the message belongs to the dialog, not the view
    expect(calls).toBe(1); // nothing auto-retried
  });

  test("Confirm shows pending: Working... announced, Confirm disabled while act runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = await seeded({ actions: { "doc.archive": () => ({ values: { tag: "archived" } }) } });
    const inner = base.act!.bind(base);
    // ActionHandler is synchronous; hold act open with a wrapper adapter instead.
    const db = { ...base, act: async (entity: string, id: string, action: string, request: Parameters<NonNullable<typeof inner>>[3]) => { await gate; return inner(entity, id, action, request); } };
    render(<TableRenderer entity={entity} view={view} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("slow");
    fireEvent.click(button("Reject"));
    await waitFor(() => expect(statusText()).toBe("Working..."));
    expect(button("Reject").disabled).toBe(true); // Confirm waits for the server
    expect(dialog()).not.toBeNull();
    release();
    await waitFor(() => expect(statusText()).toBe("Archive done"));
    expect(dialog()).toBeNull();
  });

  test("Cancel never calls act and returns focus to the pressed button", async () => {
    let acts = 0;
    const db = await seeded({ actions: { "doc.archive": () => { acts++; return { remove: true }; } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    const opener = document.querySelector("[data-testid='action-archive']") as HTMLButtonElement;
    opener.focus();
    fireEvent.click(opener);
    expect(dialog()).not.toBeNull();
    fireEvent.click(button("Cancel"));
    expect(dialog()).toBeNull();
    expect(acts).toBe(0);
    expect(document.activeElement).toBe(opener); // the modal gives focus back to who opened it
  });

  test("Escape closes without calling act", async () => {
    let acts = 0;
    const db = await seeded({ actions: { "doc.archive": () => { acts++; return { remove: true }; } } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    fireEvent.keyDown(dialog() as HTMLElement, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(acts).toBe(0);
  });

  test("a fresh press starts the dialog empty", async () => {
    const db = await seeded({ actions: { "doc.archive": () => ({ remove: true }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-archive']")).not.toBeNull());
    press("archive");
    typeReason("typed");
    fireEvent.click(button("Cancel"));
    press("archive");
    expect(reasonInput().value).toBe("");
  });

  // Focus return after a direct press (todo-app F9:227, F11 row 7): a real browser takes
  // focus away the moment `pending` disables the pressed button and the reload never gives
  // it back, so Tab restarts from the nav. jsdom keeps focus on a disabled button (measured:
  // it drops on neither `disabled` nor `blur()` while disabled), so the helper drives it to
  // the state the browser reaches — focus on BODY while the button stays disabled.
  async function gated(options: Parameters<typeof createMemoryAdapter>[0]): Promise<{ db: ReturnType<typeof createMemoryAdapter>; release: () => void }> {
    const base = await seeded(options);
    const inner = base.act!.bind(base);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = { ...base, act: async (entity: string, id: string, action: string, request: Parameters<NonNullable<typeof inner>>[3]) => { await gate; return inner(entity, id, action, request); } };
    return { db, release };
  }

  function dropFocusLikeABrowser(btn: HTMLButtonElement): void {
    expect(document.activeElement).toBe(btn);
    btn.disabled = false; // jsdom refuses to blur a disabled element; the browser already dropped it
    btn.blur();
    btn.disabled = true;
    expect(document.activeElement).toBe(document.body);
  }

  test("a direct press returns focus to the pressed button after the reload", async () => {
    const { db, release } = await gated({ actions: { "doc.publish": () => ({ values: { tag: "live" } }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    const btn = document.querySelector("[data-testid='action-publish']") as HTMLButtonElement;
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    dropFocusLikeABrowser(btn);
    release();
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBe("live")); // the reload landed first
    await waitFor(() => expect(document.activeElement).toBe(btn)); // and focus came back to the row
  });

  test("the focus return never steals focus from a viewer who moved on", async () => {
    const { db, release } = await gated({ actions: { "doc.publish": () => ({ values: { tag: "live" } }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    const [first, second] = document.querySelectorAll("[data-testid='action-publish']") as NodeListOf<HTMLButtonElement>;
    first!.focus();
    fireEvent.click(first!);
    await waitFor(() => expect(first!.disabled).toBe(true));
    dropFocusLikeABrowser(first!);
    second!.focus(); // the viewer tabbed away while the action was in flight
    release();
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBe("live"));
    expect(document.activeElement).toBe(second); // the flight ended; the viewer's focus stays put
  });

  // todo-app F14 part B (2026-10-24): the 46a restore holds the pressed NODE, but the
  // completed row's action set changes on reload (Complete unmounts, Reopen mounts in its
  // place — measured in Chromium: the button node is removed ~90ms into the press, the row
  // survives). `held.element.isConnected` is false, so the press-time restore silently
  // no-ops and focus stays on body. The press must return focus to the row's live control.
  const swappingEntity: EntityDocument = {
    kind: "entity",
    specVersion: 1,
    id: "doc",
    revision: 1,
    fields: [
      { id: "n", type: "number", label: "N" },
      { id: "tag", type: "text", label: "Tag" },
    ],
    actions: [
      { id: "publish", label: "Publish", visibleWhen: { op: "eq", field: "tag", value: "draft" } },
      { id: "archive", label: "Archive", visibleWhen: { op: "eq", field: "tag", value: "live" } },
    ],
  };
  const swappingView: TableView = { ...view, recordActions: ["publish", "archive"] };

  test("when the pressed button is replaced on reload, focus returns to the row's live button", async () => {
    const base = await seeded({ actions: { "doc.publish": () => ({ values: { tag: "live" } }) } });
    const inner = base.act!.bind(base);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = { ...base, act: async (e: string, id: string, a: string, request: Parameters<NonNullable<typeof inner>>[3]) => { await gate; return inner(e, id, a, request); } };
    render(<TableRenderer entity={swappingEntity} view={swappingView} registry={mockRegistry} dataSources={new Map([["default", db]])} />);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    const btn = document.querySelector("[data-testid='action-publish']") as HTMLButtonElement;
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    dropFocusLikeABrowser(btn);
    release();
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBe("live")); // the reload landed: the row now offers Archive
    const replacement = document.querySelector("[data-testid='action-archive']") as HTMLButtonElement;
    expect(btn.isConnected).toBe(false); // the pressed node is gone — the exact live-browser state
    await waitFor(() => expect(document.activeElement).toBe(replacement)); // focus went back to the row's live control
  });

  test("a removed record has nothing to return to, and focus is left alone", async () => {
    const { db, release } = await gated({ actions: { "doc.publish": () => ({ remove: true }) } });
    show(db);
    await waitFor(() => expect(document.querySelector("[data-testid='action-publish']")).not.toBeNull());
    const btn = document.querySelector("[data-testid='action-publish']") as HTMLButtonElement;
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    dropFocusLikeABrowser(btn);
    release();
    await waitFor(() => expect(statusText()).toBe("Publish done"));
    await waitFor(() => expect(tagOf(1)).toBeUndefined()); // the row is gone
    expect(btn.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body); // no phantom focus target
  });
});
