// The focus contract kit, imported as "@yadad/testing/focus-kit" (subpath only,
// exactly like contract-kit: it imports vitest at module scope, so it stays out
// of the main entry). The action scenarios (contract-kit) prove what a press
// DOES; this kit proves where focus LANDS after it — the property the
// showcase never covered and three real hosts hit one by one (todo-app's F18
// round closed six focus findings over six renderer versions, every one found
// by hand reading `document.activeElement`). Like the action scenarios, the
// kit never imports a renderer: the host injects `mount` and the kit only
// presses DOM controls and reads `document.activeElement`. Needs a DOM: call
// it from a test file with `// @vitest-environment jsdom`.
//
// jsdom truth this kit is built around: `fireEvent.click` does NOT focus the
// target, and jsdom does not drop focus when a focused control is disabled or
// removed (a real browser does both). Every press here therefore calls
// `control.focus()` first — without it the harness would produce the very
// body-focus failure it is testing for. The browser drop-to-body half of the
// property needs the host's removeChild shim (see testing/README.md and the
// renderer's focus-contract test).

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryAdapter } from "@yadad/runtime";
import type { ActionHandler } from "@yadad/runtime";
import type { DataAdapter, DataRecord, EntityDocument, Registry, TableView } from "@yadad/core";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, test } from "vitest";
import type { ContractCheck, ActionScenarioContext } from "./contract-kit.js";

/** The attribute a component marks a record's title with, so a rebuilt record is found again (renderer-reserved). */
const RECORD_ATTR = "data-yadad-record";
/** The attribute beside it: one value per view instance, so a record shown twice is found in the pressing view. */
const VIEW_ATTR = "data-yadad-record-view";
/** The attribute a component shares between a panel's trigger and the panel itself: focus returns to the trigger. */
const TRIGGER_ATTR = "data-yadad-focus-return";
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How late the slow reload lands in the timing pair — past any fixed watch window a vendor could ship. */
const SLOW_RELOAD_MS = 2500;

/**
 * A browser drops focus to `<body>` the moment the focused node leaves the
 * document; jsdom keeps `activeElement` on the detached node. The kit's
 * negative control (a host that drops focus on rebuild) and every honest
 * "focus was lost" assertion depend on browser-accurate removal, so the kit
 * installs the shim itself while its checks run (`withJsdomRemovalShim`), and
 * the host test file never has to know the difference.
 */
export function withJsdomRemovalShim<T>(fn: () => Promise<T>): Promise<T> {
  const original = Node.prototype.removeChild;
  Node.prototype.removeChild = function <N extends Node>(this: Node, child: N): N {
    const active = document.activeElement;
    const result = original.call(this, child) as N;
    if (active !== null && active !== document.body && !active.isConnected) (document.body as HTMLElement).focus();
    return result;
  } as typeof Node.prototype.removeChild;
  const restore = (): void => {
    Node.prototype.removeChild = original;
  };
  return fn().finally(restore);
}

/** A press helper does not trust the event to focus anything: focus the control, then press it. */
export function focusAndPress(control: HTMLElement): void {
  control.focus();
  fireEvent.click(control);
}

/** What `document.activeElement` is right now, as a short description for a problem line. */
function activeDescription(): string {
  const active = document.activeElement;
  if (active === null || active === document.body) return "<body>";
  const el = active instanceof HTMLElement ? active : active.parentElement;
  const attrs = ["data-testid", "aria-label", TRIGGER_ATTR, RECORD_ATTR].map((a) => el?.getAttribute(a)).filter((v): v is string => typeof v === "string" && v !== "");
  const text = (el?.textContent ?? "").trim().slice(0, 40);
  return `<${el?.tagName.toLowerCase() ?? "?"}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}>${text === "" ? "" : ` "${text}"`}`;
}

function textOf(el: Element | null | undefined): string {
  return el?.textContent ?? "";
}

/** Every record marker in the DOM ([data-yadad-record][data-yadad-record-view]). */
function allMarks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${RECORD_ATTR}][${VIEW_ATTR}]`)];
}

/** The marker element's record scope: its nearest ancestor that holds this record and no other. */
function recordScopeOf(mark: HTMLElement): HTMLElement | null {
  if (mark.parentElement === null) return null;
  let scope: HTMLElement | null = mark.parentElement;
  while (scope !== null && scope !== document.body) {
    const records = scope.querySelectorAll(`[${RECORD_ATTR}]`);
    if (records.length === 1) return scope;
    scope = scope.parentElement;
  }
  return null;
}

/** The scope that holds `el` as its only record (walking up from the element itself). */
function enclosingRecordScope(el: Element): HTMLElement | null {
  let cur: Element | null = el;
  while (cur !== null && cur !== document.body) {
    if (cur instanceof HTMLElement) {
      if (cur.hasAttribute(RECORD_ATTR)) return cur;
      const marks = cur.querySelectorAll(`[${RECORD_ATTR}]`);
      if (marks.length === 1) return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** The structural path of a control: its tag and child index, and its ancestors' up to <body>. */
function positionChain(el: HTMLElement): readonly { tag: string; index: number }[] {
  const chain: { tag: string; index: number }[] = [];
  let cur: HTMLElement | null = el;
  while (cur !== null && cur !== document.body) {
    const parent: HTMLElement | null = cur.parentElement;
    const index = parent === null ? 0 : Array.prototype.indexOf.call(parent.children, cur);
    chain.push({ tag: cur.tagName, index });
    cur = parent;
  }
  return chain;
}

function samePosition(chain: readonly { tag: string; index: number }[], el: HTMLElement): boolean {
  const now = positionChain(el);
  return now.length === chain.length && now.every((step, i) => step.tag === chain[i]!.tag && step.index === chain[i]!.index);
}

/** What `mount` receives. Reuses the action scenarios' context shape (same entity, view, registry, seeded adapter, records). */
export interface FocusContractContext extends ActionScenarioContext {
  /** As passed to the run: the kit calls it before the press; the adapter's next reads answer that late. */
  readonly delayReload?: (ms: number) => void;
}

export interface FocusContractOptions {
  /** Mounts the view — the one line of host wiring, exactly as in `describeActionScenarios`. */
  readonly mount: (context: FocusContractContext) => ReactNode;
  /** Passed to `mount` as `context.registry`; every registry must pass the contract. */
  readonly registry: Registry<ReactNode>;
  /** Optional host adapter for the seeded document; without it the kit seeds its own memory adapter. */
  readonly adapter?: DataAdapter;
  /**
   * When given, the kit calls it once per timing check with {@link SLOW_RELOAD_MS} before the
   * press, so the focus return must survive a reload slower than any fixed window (D53,
   * armed-until-data-lands). A host whose adapter honours delayed reads gets the true property;
   * an adapter that ignores the hook (the memory adapter) is slowed by the kit wrapping its
   * `find`/`findOne` itself, so the timing pair tests the renderer's arming, not the host's clock.
   */
  readonly delayReload?: (ms: number) => void;
  /**
   * Capability overrides, for a host whose panels/dialogs only appear under a document the kit
   * cannot synthesise. Omit them and the kit probes the registry itself (render once, read the
   * reserved attributes). Pass `false` to state a capability the probe cannot see is absent — a
   * host without an Actions… panel gets ZERO panel checks, not a false failure.
   */
  readonly capabilities?: FocusCapabilities;
}

export interface FocusCapabilities {
  /** The registry puts actions inside a closing panel marked with the shared trigger token. */
  readonly panel?: boolean;
  /** The registry has `layout.Dialog` (needed by the dialog-from-panel shape). */
  readonly dialog?: boolean;
  /** The host can re-key a record through the kit's action handler (the id-changing move). Defaults to true. */
  readonly idChangingMove?: boolean;
}

/** The kit's document: Publish mutates in place; Archive confirms (danger) and asks for a required Reason. */
const FOCUS_ENTITY: EntityDocument = {
  kind: "entity",
  specVersion: 1,
  id: "kitfocus",
  revision: 1,
  fields: [
    { id: "tag", type: "text", label: "Tag" },
    { id: "pos", type: "number", label: "Order" },
  ],
  actions: [
    { id: "publish", label: "Publish" },
    {
      id: "archive",
      label: "Archive",
      confirm: { title: "Archive this", message: "Archive this record?", confirmLabel: "Confirm", tone: "danger", subjectField: "tag" },
      input: [{ id: "reason", type: "text", label: "Reason", required: true }],
    },
  ],
};

const FOCUS_VIEW: TableView = {
  kind: "table",
  specVersion: 1,
  id: "kit_focus",
  entity: "kitfocus",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "tag" }],
  recordActions: ["publish", "archive"],
};

/** Seed the two records every check starts from. `act` replaces both handlers (the id-changing move drives it). */
async function focusSetup(adapter: DataAdapter | undefined, act?: ActionHandler): Promise<{ adapter: DataAdapter; records: readonly DataRecord[] }> {
  const handlers: Record<string, ActionHandler> = {
    "kitfocus.publish": (record) => act?.(record, {}) ?? { values: { tag: "published" } },
    "kitfocus.archive": (record, input) => act?.(record, input) ?? { values: { tag: "archived" } },
  };
  const source = adapter ?? createMemoryAdapter({ actions: handlers });
  const first = await source.create("kitfocus", { tag: "first", pos: 1 }, { entityRevision: 1 });
  const second = await source.create("kitfocus", { tag: "second", pos: 2 }, { entityRevision: 1 });
  return { adapter: source, records: [first, second] };
}

/**
 * Wrap an adapter so a record whose `tag` starts with `moved:` is shown to the renderer under a
 * DERIVED id (the consumer shape: the occurrence id contains the day). The store keeps the record
 * under its original id; every id the renderer can see (find/findOne results, act responses) is
 * rewritten, and incoming ids are mapped back. This is what makes shape 5 real in jsdom: following
 * focus by the old id alone silently tests nothing, exactly as F18 found.
 */
function renamingAdapter(adapter: DataAdapter): DataAdapter {
  const derivedId = (record: DataRecord): string => `${String(record.values["tag"] ?? "")}@${String(record.values["pos"] ?? 0)}`;
  const isVisible = (record: DataRecord): boolean => typeof record.values["tag"] === "string" && String(record.values["tag"]).startsWith("moved:");
  const show = (record: DataRecord): DataRecord => (isVisible(record) ? { ...record, id: derivedId(record) } : record);
  const realId = (id: string): string => {
    const [tag, pos] = [id.slice(0, id.lastIndexOf("@")), id.slice(id.lastIndexOf("@") + 1)];
    return /^\d+$/.test(pos) && tag.startsWith("moved:") ? pos : id; // derived "<tag>@<pos>" ⇄ store id = pos
  };
  return {
    ...adapter,
    find: async (entity, query) => {
      const page = await adapter.find(entity, query);
      return { ...page, items: page.items.map(show) };
    },
    findOne: async (entity, id) => {
      const record = await adapter.findOne(entity, realId(id));
      return record === null ? null : show(record);
    },
    update: async (entity, id, patch, meta) => {
      const saved = await adapter.update(entity, realId(id), patch, meta);
      return show(saved);
    },
    ...(adapter.act === undefined
      ? {}
      : {
          act: async (entity: string, id: string, action: string, request: Parameters<NonNullable<DataAdapter["act"]>>[3]) => {
            const saved = await adapter.act!(entity, realId(id), action, request);
            return saved === null ? null : show(saved);
          },
        }),
  };
}

/** Wrap an adapter so its reads answer `ms()` late (the delayed-reload path, used when the host hook is a no-op). */
function delayedReads(adapter: DataAdapter, ms: () => number): DataAdapter {
  const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms()));
  return {
    ...adapter,
    find: async (...args: Parameters<DataAdapter["find"]>) => {
      await wait();
      return adapter.find(...args);
    },
    findOne: async (...args: Parameters<DataAdapter["findOne"]>) => {
      await wait();
      return adapter.findOne(...args);
    },
  };
}

interface RunContext {
  readonly container: HTMLElement;
  readonly records: readonly DataRecord[];
  readonly registry: Registry<ReactNode>;
  readonly rows: () => HTMLElement[];
  readonly rowFor: (tag: string) => HTMLElement | undefined;
  readonly buttonIn: (row: HTMLElement, name: string) => HTMLButtonElement | undefined;
  /** Arm the delayed reload BEFORE the press (timing pair): reads answer `ms` late from here on. */
  readonly delayReload: (ms: number) => void;
}

/** Run one check body against a fresh mount. Problems the body throws OR pushes land in the check's own `problems` array — the check result is the caller's array, never a local copy (the negative control caught an earlier version that returned a fresh array and threw the body's failures away, which made every shape vacuously green). */
async function runFocus(options: FocusContractOptions, setup: { act?: ActionHandler; slowMs?: number; rename?: boolean }, body: (ctx: RunContext) => Promise<void>, problems: string[]): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  try {
    const seeded = await focusSetup(options.adapter, setup.act);
    const adapter = setup.rename === true ? renamingAdapter(seeded.adapter) : seeded.adapter;
    const { records } = seeded;
    // The window opens only when a check ARMS it (the timing pair calls `delayReload`
    // right before the press). An always-on delay would slow the seed load itself and
    // every check would die on "the seeded rows never appeared".
    let delayMs = 0;
    const delayReload = (ms: number): void => {
      delayMs = ms;
      options.delayReload?.(ms);
    };
    // The timing property must not depend on whether the host adapter honours `delayReload`:
    // the kit's own read delay guarantees the reload lands late either way.
    const source = setup.slowMs === undefined ? adapter : delayedReads(adapter, () => delayMs);
    const context: FocusContractContext = { entity: FOCUS_ENTITY, view: FOCUS_VIEW, registry: options.registry, adapter: source, records, ...(options.delayReload === undefined ? {} : { delayReload }) };
    render(<div>{options.mount(context)}</div>, { container });
    const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid^="row-"]:not([data-testid^="row-actions-"])')];
    const rowFor = (tag: string) => rows().find((r) => textOf(r).includes(tag));
    const buttonIn = (row: HTMLElement, name: string) => [...row.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === name);
    await waitFor(() => {
      if (!rows().some((r) => textOf(r).includes("first")) || !rows().some((r) => textOf(r).includes("second"))) {
        throw new Error("the seeded rows never appeared");
      }
    });
    await body({ container, records, registry: options.registry, rows, rowFor, buttonIn, delayReload });
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  } finally {
    cleanup();
    container.remove();
  }
}

function focusCheck(name: string, inspect: (problems: string[]) => Promise<void>): ContractCheck {
  return {
    name,
    async run() {
      const problems: string[] = [];
      try {
        await withJsdomRemovalShim(async () => {
          await inspect(problems);
        });
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  };
}

/** Press the record's trigger, wait for its panel, hand the check the panel's Publish/Archive control. */
async function openPanelAndPress(options: FocusContractOptions, setup: Parameters<typeof runFocus>[1], actionName: string, problems: string[], after: (scope: HTMLElement, token: string) => Promise<void>): Promise<void> {
  await runFocus(options, setup, async ({ rowFor }) => {
    const row = rowFor("first");
    if (row === undefined) return;
    const trigger = row.querySelector<HTMLElement>(`[${TRIGGER_ATTR}]:not([disabled])`);
    if (trigger === null) {
      problems.push("The record shows no trigger marked with [data-yadad-focus-return] even though the registry is panel-capable.");
      return;
    }
    const token = trigger.getAttribute(TRIGGER_ATTR) ?? "";
    focusAndPress(trigger);
    const panel = await waitForPanel(token);
    if (panel === null) {
      problems.push(`Pressing the [${TRIGGER_ATTR}="${token}"] trigger must open a panel marked with the same token.`);
      return;
    }
    const action = [...panel.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === actionName);
    if (action === undefined) {
      problems.push(`The actions panel must offer the record action "${actionName}".`);
      return;
    }
    const scope = recordScopeOf(trigger) ?? enclosingRecordScope(trigger) ?? row;
    focusAndPress(action); // the press closes the panel
    await after(scope, token);
  }, problems);
}

async function waitForPanel(token: string): Promise<HTMLElement | null> {
  try {
    return await waitFor(() => {
      const candidates = [...document.querySelectorAll<HTMLElement>(`[${TRIGGER_ATTR}="${CSS.escape(token)}"]`)].filter((el) => el !== document.activeElement && el.tagName !== "BUTTON");
      const panel = candidates.find((el) => el.querySelectorAll("button").length > 0);
      if (panel === undefined) throw new Error("no panel marked with the trigger's token yet");
      return panel;
    });
  } catch {
    return null;
  }
}

function expectTrigger(problems: string[], scope: HTMLElement, token: string, what: string): void {
  const active = document.activeElement;
  const triggers = [...scope.querySelectorAll<HTMLElement>(`[${TRIGGER_ATTR}="${CSS.escape(token)}"]:not([disabled])`)];
  if (triggers.length === 0) {
    problems.push(`${what}: the record's scope lost its [${TRIGGER_ATTR}="${token}"] trigger, so focus has nowhere to return (found ${activeDescription()}).`);
    return;
  }
  if (!triggers.some((t) => t === active)) {
    problems.push(`${what}: focus must return to the record's [${TRIGGER_ATTR}="${token}"] trigger, found ${activeDescription()}.`);
  }
}

/** Cheap, honest capability probe: render the registry's Table once with actions; a panel host marks its trigger. */
function probePanel(registry: Registry<ReactNode>): boolean {
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  let found: boolean;
  try {
    const item = { id: "probe", label: "Probe", tone: "neutral" as const, pending: false, onPress: () => undefined };
    const el = createElementSafe(registry, [{ id: "probe-row", cells: ["probe"], actions: [item] }]);
    if (el === null) return false;
    render(el, { container: probe });
    found = probe.querySelectorAll(`[${TRIGGER_ATTR}]`).length > 0;
  } catch {
    found = false;
  } finally {
    cleanup();
    probe.remove();
  }
  return found;
}

function createElementSafe(registry: Registry<ReactNode>, rows: readonly { id: string; cells: readonly string[]; actions?: { id: string; label: string; tone: "neutral"; pending: boolean; onPress: () => void }[] }[]): ReactElement | null {
  const Table = registry.layout.Table;
  return Table({
    caption: "probe",
    columns: [{ id: "tag", headerId: "probe-tag", label: "Tag", sortable: false }],
    rows,
    onSort: () => undefined,
    empty: "",
    actionsLabel: "Actions",
  }) as ReactElement | null;
}

/**
 * The focus contract checks for one host mount, WITHOUT registering tests
 * (the two-layer split of `actionScenarioChecks` / `describeActionScenarios`).
 * Run the checks one at a time — like the contract checks, they share `document`.
 *
 * Every group is gated on an optional capability (the way `pagerChecks` gates
 * on an optional registry key): a host whose registry draws no panel yields
 * ZERO panel checks, not a false failure; no Dialog key means zero dialog
 * checks. Both directions are asserted by the kit's own tests (a stripped
 * registry produces zero checks; a full one produces them all).
 */
export function focusContractChecks(options: FocusContractOptions): readonly ContractCheck[] {
  const registry = options.registry;
  const caps = options.capabilities ?? {};
  const hasPanel = caps.panel ?? probePanel(registry);
  const hasDialog = caps.dialog ?? registry.layout.Dialog !== undefined;
  const hasIdMove = caps.idChangingMove ?? true;

  const checks: ContractCheck[] = [];

  // -- Self-test (Do step 3): the harness reads the right activeElement. --
  checks.push(
    focusCheck("focus harness: press() focuses the control it clicks, so the harness never invents a body-focus failure", async (problems) => {
      // A trivial always-restore stub — and deliberately NOT runFocus: the
      // seed-wait there needs real rows, and this check is about the press/
      // read pair itself. If focusAndPress ever loses its focus() call, this
      // goes red before any shape check can blame the renderer.
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      try {
        render(<button type="button" onClick={() => undefined}>Stub</button>, { container: probe });
        const stub = probe.querySelector<HTMLButtonElement>("button");
        if (stub === null) {
          problems.push("the stub harness mounted no control.");
          return;
        }
        focusAndPress(stub);
        if (document.activeElement !== stub) problems.push(`the harness's press() must leave focus on the control it pressed, found ${activeDescription()}.`);
      } finally {
        cleanup();
        probe.remove();
      }
    }),
  );

  // -- Shape 1: direct action. --
  checks.push(
    focusCheck("focus shape 1 (direct action): a press that mutates the record in place returns focus to the pressed control", async (problems) => {
      await runFocus(options, {}, async ({ rowFor, buttonIn }) => {
        const row = rowFor("first");
        const control = row === undefined ? undefined : buttonIn(row, "Publish");
        if (control === undefined || row === undefined) {
          problems.push('The row must offer a button named "Publish".');
          return;
        }
        focusAndPress(control);
        await waitFor(() => {
          if (document.activeElement !== control) throw new Error(`focus must return to the pressed control, found ${activeDescription()}`);
        });
      }, problems);
    }),
  );

  // -- Shape 2: panel action (only for a panel host). --
  if (hasPanel) {
    checks.push(
      focusCheck("focus shape 2 (panel action): an action pressed inside the closing panel returns focus to the record's trigger", async (problems) => {
        await openPanelAndPress(options, {}, "Publish", problems, async (scope, token) => {
          await waitFor(() => {
            expectTrigger(problems, scope, token, "after a panel press");
          });
        });
      }),
    );
  }

  // -- Shape 3: dialog-from-panel action (panel AND Dialog). --
  if (hasPanel && hasDialog) {
    checks.push(
      focusCheck("focus shape 3 (dialog from panel): confirming a dialog opened from the closing panel returns focus to the trigger, not the dead panel button", async (problems) => {
        await openPanelAndPress(options, {}, "Archive", problems, async (scope, token) => {
          const dialog = await waitFor(() => {
            const d = document.querySelector<HTMLElement>('[role="dialog"]');
            if (d === null) throw new Error("the action's confirm dialog never opened");
            return d;
          });
          const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => /^(Confirm|Archive)$/.test((b.textContent ?? "").trim()));
          if (confirm === undefined) {
            problems.push("The dialog must offer a confirm button.");
            return;
          }
          focusAndPress(confirm);
          await waitFor(() => {
            if (document.querySelector('[role="dialog"]') !== null) throw new Error("the dialog stayed open after confirm");
            expectTrigger(problems, scope, token, "after a dialog action from the panel");
          });
        });
      }),
    );
  }

  // -- Shape 4: view-scoped lookup — the same record mounted twice, the pressing view keeps focus. --
  checks.push(
    focusCheck("focus shape 4 (view-scoped lookup): with every record mounted twice, focus returns inside the pressing view, never the other copy", async (problems) => {
      await runFocus(options, {}, async ({ rows }) => {
        const drawn = rows();
        if (drawn.length !== 4) {
          problems.push(`expected 4 rows (2 records × 2 views), found ${drawn.length}.`);
          return;
        }
        const marks = allMarks();
        if (marks.length < 4) {
          problems.push(`expected every record mounted in two views (2 records × 2 view markers = 4), found ${marks.length}.`);
          return;
        }
        // DOM order: view A rows 0,1; view B rows 2,3. Press in view B, first record.
        const pressingRow = drawn[2]!;
        const control = [...pressingRow.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === "Publish");
        if (control === undefined) {
          problems.push('the pressing row must offer a button named "Publish".');
          return;
        }
        focusAndPress(control);
        await waitFor(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) throw new Error(`focus must return inside the pressing view, found ${activeDescription()}`);
          const scope = enclosingRecordScope(active);
          if (scope === null) throw new Error(`the focused control is not inside a record (found ${activeDescription()})`);
          if (!pressingRow.contains(scope)) throw new Error(`focus left the pressing view's copy of the record (found ${activeDescription()})`);
        });
      }, problems);
    }),
  );

  // -- Shape 5: id-changing move — follow the position marker, not the stale id. --
  if (hasIdMove) {
    checks.push(
      focusCheck("focus shape 5 (id-changing move): a save that answers with a new id keeps focus on the record's control at the pressed position", async (problems) => {
        let renamed = false;
        await runFocus(
          options,
          {
            rename: true, // the host's Table re-keys `moved:` records to derived ids (the consumer shape)
            act: (record) => {
              if (renamed) return { values: {} }; // empty patch: the documented no-op, so a re-press cannot rename twice
              renamed = true;
              // The consumer's shape: the occurrence id contains the day. The kit's handler cannot
              // re-key the memory adapter (it merges values under the same id), so the row is
              // rebuilt under a derived id by the host's Table wrapper, which re-keys by tag —
              // `moved:<day>` is the host's derived id, read from the row's test id below.
              return { values: { tag: `moved:2026-10-05#${String(record.values["pos"] ?? 0)}` } };
            },
          },
          async ({ container, records, rowFor, buttonIn }) => {
            const row = rowFor("first");
            const control = row === undefined ? undefined : buttonIn(row, "Publish");
            if (control === undefined || row === undefined) {
              problems.push('The row must offer a button named "Publish".');
              return;
            }
            const chain = positionChain(control);
            const oldId = records[0]!.id;
            // Scope to the pressing view's own row list: the second copy on the page
            // reloads on its own clock, and its stale id is not this record's failure.
            const rowList = row.parentElement ?? container;
            focusAndPress(control);
            await waitFor(() => {
              if (rowList.querySelectorAll(`[data-testid="row-${CSS.escape(oldId)}"]`).length > 0) throw new Error(`the save must move the record to a new id (the old row-${oldId} is still drawn)`);
              const active = document.activeElement;
              if (!(active instanceof HTMLElement) || active === document.body) throw new Error(`focus must follow the record across the id change, found ${activeDescription()}`);
              const scope = enclosingRecordScope(active);
              if (scope === null) throw new Error(`the focused control is not inside a record (found ${activeDescription()})`);
              // The position marker: same structural path, and inside the row the host re-keyed
              // for the moved record — in the PRESSING view's own row list.
              const movedRow = [...rowList.querySelectorAll<HTMLElement>('[data-testid^="row-"]')].find((r) => textOf(r).includes("moved:2026-10-05#1"));
              if (movedRow === undefined) throw new Error("the moved record never appeared under its derived id");
              if (!movedRow.contains(active)) throw new Error(`focus must sit on the moved record's new row (position marker), found ${activeDescription()}`);
              if (!samePosition(chain, active) && active !== movedRow.querySelector(FOCUSABLE)) {
                throw new Error(`focus must sit at the pressed record's position (or its first control), found ${activeDescription()}`);
              }
            });
          },
          problems,
        );
      }),
    );
  }

  // -- Shape 6: the timing pair (D53). --
  checks.push(
    focusCheck("focus timing (armed-until-data-lands): the focus return survives a reload slower than any fixed window", async (problems) => {
      await runFocus(
        options,
        { slowMs: SLOW_RELOAD_MS },
        async ({ rowFor, buttonIn, delayReload }) => {
          const row = rowFor("first");
          const control = row === undefined ? undefined : buttonIn(row, "Publish");
          if (control === undefined) {
            problems.push('The row must offer a button named "Publish".');
            return;
          }
          delayReload(SLOW_RELOAD_MS); // arm the slow reload BEFORE the press
          focusAndPress(control);
          await waitFor(
            () => {
              if (document.activeElement !== control) throw new Error(`focus must survive the slow reload on the pressed control, found ${activeDescription()}`);
            },
            { timeout: SLOW_RELOAD_MS + 10_000 },
          );
        },
        problems,
      );
    }),
    focusCheck("focus timing (no-steal): focus the viewer moved during a slow reload is never pulled back", async (problems) => {
      await runFocus(
        options,
        { slowMs: SLOW_RELOAD_MS },
        async ({ rowFor, buttonIn, rows, delayReload }) => {
          const row = rowFor("first");
          const control = row === undefined ? undefined : buttonIn(row, "Publish");
          if (control === undefined) {
            problems.push('The row must offer a button named "Publish".');
            return;
          }
          delayReload(SLOW_RELOAD_MS); // arm the slow reload BEFORE the press
          focusAndPress(control);
          const other = rows()
            .flatMap((r) => [...r.querySelectorAll<HTMLButtonElement>("button")])
            .find((b) => b !== control && (b.textContent ?? "").trim() === "Publish");
          if (other === undefined) {
            problems.push("the second record must offer its own Publish control so the viewer can Tab to it.");
            return;
          }
          other.focus(); // the viewer moved on while the reload is still in flight
          await waitFor(
            () => {
              if (document.activeElement !== other) throw new Error(`the slow reload stole focus away from where the viewer put it (found ${activeDescription()})`);
            },
            { timeout: SLOW_RELOAD_MS + 10_000 },
          );
        },
        problems,
      );
    }),
  );

  return checks;
}

/**
 * Registers one Vitest test per focus-contract check (see
 * {@link focusContractChecks}). This is the harness F18 asked the vendor for:
 * "render, press, wait, read activeElement" as a contract every host runs.
 *
 * The five interaction shapes it asserts, by name:
 *
 * 1. **Direct action** — a record action pressed directly that mutates or
 *    re-sorts the record in place: focus returns to the pressed control.
 * 2. **Panel action** — an action pressed inside the record's Actions… panel,
 *    which closes with the press: focus returns to the record's panel trigger,
 *    never to the dead panel button.
 * 3. **Dialog-from-panel action** — the panel's action opens a confirm/input
 *    dialog and it is confirmed: focus returns to the pressing record's
 *    trigger (the shape 0.18.5 fixed the wrong branch on).
 * 4. **View-scoped lookup** — the same record mounted twice on one page (two
 *    views): focus returns inside the pressing view's copy, never the other
 *    view's.
 * 5. **Id-changing move** — a save that answers with a new record id (an
 *    occurrence id containing the day): focus follows the record by its
 *    position marker, not the stale id.
 *
 * Plus the timing pair (D53, armed-until-data-lands): with the reload
 * deliberately delayed, the press's focus return survives a reload of ANY
 * length, and focus the viewer moved during the slow reload is never stolen
 * back (no-steal).
 *
 * Desktop/touch neutrality: every shape is proven by `control.focus()` +
 * `fireEvent.click` — the same pointer event a touch produces — and asserts
 * only `document.activeElement`. No shape depends on hover, pointer position,
 * or a mouse-only affordance, so each passes or fails identically for a touch
 * viewer and a keyboard viewer. Checks a registry cannot express (no panel,
 * no dialog, no id-changing handler) produce ZERO checks, never a failure.
 */
export function describeFocusContract(options: FocusContractOptions): void {
  describe("yadad record-action focus contract", () => {
    for (const check of focusContractChecks(options)) {
      test(check.name, async () => {
        expect(await check.run()).toEqual([]);
      }, 30_000);
    }
  });
}
