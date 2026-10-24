// Contract test kit (ARCHITECTURE.md §12), imported as "@yadad/testing/contract-kit"
// so the main entry (the mock registry) stays free of test-runner code. The
// components repo runs it against every registry; engine CI runs it against
// the mock registry. Needs a DOM: call it from a test file with
// `// @vitest-environment jsdom`.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryAdapter } from "@yadad/runtime";
import { FIELD_TYPES, ForbiddenError, SPEC_VERSION } from "@yadad/core";
import type { BoardProps, CalendarDayProps, CalendarProps, DataAdapter, DataRecord, DatetimeField, DiffSegment, DocumentError, EntityDocument, FieldDefinitions, DisplayProps, FieldDisplayExtras, FieldDisplayProps, FieldInputExtras, FieldInputProps, InputProps, FieldType, FieldValueTypes, RecordValues, Registry, RequiredFieldEntries, SeriesGroupProps, SeriesWidgetProps, TableView, TextField } from "@yadad/core";
import axe from "axe-core";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, expect, test } from "vitest";

/** A field definition and a value to drive it with, per field type. */
export interface FieldSample<K extends FieldType> {
  readonly field: FieldDefinitions[K];
  readonly value: FieldValueTypes[K];
  /** Extra props the Input needs (a reference picker's options). */
  readonly inputExtras: FieldInputExtras[K];
  /** Extra props the Display needs (a reference's label). */
  readonly displayExtras: FieldDisplayExtras[K];
  /** Text Display must show for `value`, when it is not the value itself (a reference shows its label). */
  readonly shown?: string;
}

const NONE = {};

/** Props plus a field type's extras, as one object (spreading generic types directly confuses the compiler). */
function withExtras<B extends object, E extends object>(base: B, extras: E): B & E {
  return Object.assign({}, base, extras);
}

/**
 * Renders `component` with `props`. The compiler cannot check JSX on a generic
 * component type, so this calls it as a function inside its own render, which
 * is the same thing for React (the component's hooks belong to this host).
 */
function Host<P>({ component, props }: { readonly component: (props: P) => ReactNode; readonly props: P }): ReactNode {
  return component(props);
}

function displayProps<K extends FieldType>(base: DisplayProps<FieldDefinitions[K], FieldValueTypes[K]>, extras: FieldDisplayExtras[K]): FieldDisplayProps<K> {
  return withExtras(base, extras);
}

function inputProps<K extends FieldType>(base: InputProps<FieldDefinitions[K], FieldValueTypes[K]>, extras: FieldInputExtras[K]): FieldInputProps<K> {
  return withExtras(base, extras);
}

// RFC 0007: later card (testing). `datetime` is an optional registry key and has no
// contract checks yet, so the kit leaves it out until the reference components ship it.
type CheckedFieldType = Exclude<FieldType, "datetime">;
const CHECKED_FIELD_TYPES: readonly CheckedFieldType[] = FIELD_TYPES.filter((t): t is CheckedFieldType => t !== "datetime");

export type FieldSamples = { readonly [K in CheckedFieldType]: FieldSample<K> };

export const defaultSamples: FieldSamples = {
  text: { field: { id: "name", type: "text", label: "Name", required: true }, value: "Ada", inputExtras: NONE, displayExtras: NONE },
  number: { field: { id: "weight", type: "number", label: "Weight", min: 0, step: 2.5, unit: "kg" }, value: 102.5, inputExtras: NONE, displayExtras: NONE },
  boolean: { field: { id: "warmup", type: "boolean", label: "Warm-up set" }, value: true, inputExtras: NONE, displayExtras: NONE },
  select: {
    field: { id: "exercise", type: "select", label: "Exercise", options: { source: "static", values: ["Squat", "Bench"] } },
    value: "Bench",
    inputExtras: NONE,
    displayExtras: NONE,
  },
  date: { field: { id: "day", type: "date", label: "Day" }, value: "2026-10-04", inputExtras: NONE, displayExtras: NONE },
  reference: {
    field: { id: "lift", type: "reference", label: "Lift", entity: "exercise" },
    value: "e2",
    inputExtras: {
      options: {
        status: "ready",
        options: [
          { id: "e1", label: "Squat" },
          { id: "e2", label: "Bench press" },
        ],
        more: false,
      },
    },
    displayExtras: { label: "Bench press", status: "found" },
    shown: "Bench press",
  },
};

/** How to read and drive a control holding values of type V. */
interface Driver<V> {
  readonly jsonType: "string" | "number" | "boolean";
  /** What clearing the control must emit: undefined (no value), or false for a checkbox. */
  readonly cleared: V | undefined;
  read(control: HTMLElement): unknown;
  change(control: HTMLElement, value: V): void;
  clear(control: HTMLElement): void;
  /** Whether Display's text shows the value. */
  shows(text: string, value: V): boolean;
}

const controlValue = (control: HTMLElement): string | undefined =>
  control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    ? control.value
    : undefined;

const typeIn = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const stringDriver: Driver<string> = {
  jsonType: "string",
  cleared: undefined,
  read: controlValue,
  change: typeIn,
  clear: (control) => typeIn(control, ""),
  shows: (text, value) => text.includes(value),
};

const drivers: { readonly [K in CheckedFieldType]: Driver<FieldValueTypes[K]> } = {
  text: stringDriver,
  select: stringDriver,
  date: stringDriver,
  reference: stringDriver,
  number: {
    jsonType: "number",
    cleared: undefined,
    read: (control) => {
      const v = controlValue(control);
      return v === undefined || v === "" ? undefined : Number(v);
    },
    change: (control, value) => typeIn(control, String(value)),
    clear: (control) => typeIn(control, ""),
    shows: (text, value) => text.includes(String(value)),
  },
  boolean: {
    jsonType: "boolean",
    cleared: false,
    read: (control) => (control instanceof HTMLInputElement ? control.checked : control.getAttribute("aria-checked") === "true"),
    change: (control, value) => {
      if (drivers.boolean.read(control) !== value) fireEvent.click(control);
    },
    clear: (control) => {
      if (drivers.boolean.read(control) === true) fireEvent.click(control);
    },
    shows: (text, value) => (value ? /yes|true|✓/i : /no|false|✗/i).test(text),
  },
};

export interface ContractCheck {
  readonly name: string;
  /** Resolves to the problems found; [] means the check passed. */
  run(): Promise<readonly string[]>;
}

const sampleError: DocumentError = {
  path: "/value",
  code: "required",
  message: "This value is required.",
  hint: "Enter a value.",
};

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Every contract check for a registry, without registering tests. Checks
 * render into the shared document and clean up after themselves, so run them
 * one at a time (await each), never concurrently.
 */
export function registryContractChecks(registry: Registry<ReactNode>, samples: FieldSamples = defaultSamples): readonly ContractCheck[] {
  return [
    ...CHECKED_FIELD_TYPES.flatMap((type) => checksFor(type, registry, samples)),
    ...layoutChecks(registry),
    ...calendarChecks(registry),
    ...boardChecks(registry),
    ...seriesChecks(registry),
    ...dialogChecks(registry),
    ...datetimeChecks(registry),
    ...actionButtonChecks(registry),
  ];
}

function checksFor<K extends CheckedFieldType>(type: K, registry: Registry<ReactNode>, samples: FieldSamples): ContractCheck[] {
  const base = fieldChecks(type, registry, samples[type], drivers[type]);
  // RFC 0007: a compare column's word diff is drawn by the text Display. The
  // check runs with the entry, so a component set cannot skip it silently.
  if (type === "text") {
    const TextDisplay = registry.fields.text.Display;
    base.push(
      namedCheck("text: marks a diff's additions and removals with ins and del", (problems) => {
        const diff: readonly DiffSegment[] = [
          { kind: "removed", text: "draft" },
          { kind: "same", text: " then " },
          { kind: "added", text: "live" },
        ];
        render(<Host component={TextDisplay} props={displayProps<"text">({ field: KIT_NOTES_FIELD, value: "live" }, { diff })} />);
        const ins = screen.queryAllByRole("insertion");
        const del = screen.queryAllByRole("deletion");
        if (ins.length === 0 || !ins.some((el) => el.textContent?.includes("live"))) problems.push("An added DiffSegment must be shown in an <ins> containing its text.");
        if (del.length === 0 || !del.some((el) => el.textContent?.includes("draft"))) problems.push("A removed DiffSegment must be shown in a <del> containing its text.");
        if (!(document.body.textContent ?? "").includes(" then ")) problems.push("A same DiffSegment's text must be shown unchanged.");
      }),
    );
  }
  return base;
}

const KIT_NOTES_FIELD: TextField = { id: "notes", type: "text", label: "Notes" };

/**
 * Checks for the optional `fields.datetime` key (RFC 0007): a registry without
 * one has no datetime checks; one with it must show the formatted `text` the
 * renderer produced on the element whose `dateTime` is the stored instant. The
 * reference component uses a `<time>` element, which carries role `time`;
 * role and attribute are the requirements, the tag the convention.
 */
function datetimeChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const entry = registry.fields.datetime;
  if (entry === undefined) return [];
  const DatetimeDisplay = entry.Display;
  const field: DatetimeField = { id: "due", type: "datetime", label: "Due" };
  const value = "2026-10-15T14:30:00.000Z";
  const text = "15 Oct 2026, 15:30";
  return [
    namedCheck("datetime: shows the given text on an element carrying the stored instant", (problems) => {
      render(<Host component={DatetimeDisplay} props={displayProps<"datetime">({ field, value }, { text })} />);
      const el = screen.queryByRole("time");
      if (!el) {
        problems.push('The datetime Display must show the value in an element with role="time" (a <time> element).');
      } else {
        if (el.textContent !== text) problems.push(`The element must show the formatted text prop "${text}", got "${el.textContent}".`);
        if (el.getAttribute("datetime") !== value) problems.push(`The element's dateTime must be the stored instant "${value}", got "${el.getAttribute("datetime")}".`);
      }
      cleanup();
      render(<Host component={DatetimeDisplay} props={displayProps<"datetime">({ field, value: undefined }, {})} />);
      if (screen.queryByText(value)) problems.push("An undefined value must not render the stored instant as text.");
    }),
  ];
}

/**
 * Buttons for `TableRow.actions` (RFC 0007): the Table draws each row's
 * actions with its own controls, so the check drives them through a Table.
 */
function actionButtonChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const { Table } = registry.layout;
  const columns = [{ id: "a", headerId: "kit-act-col", label: "A", sortable: false }];
  const pressed: string[] = [];
  const rows = [
    { id: "r1", cells: ["first"], actions: [{ id: "publish", label: "Publish", tone: "neutral" as const, pending: false, onPress: () => pressed.push("publish") }] },
    { id: "r2", cells: ["second"], actions: [{ id: "archive", label: "Archive", tone: "danger" as const, pending: true, onPress: () => pressed.push("archive") }] },
  ];
  return [
    namedCheck("actions: buttons are named by their labels, disabled while pending, and fire onPress otherwise", async (problems) => {
      const { container } = render(<Table caption="Kit actions" columns={columns} rows={rows} onSort={() => {}} empty="none" actionsLabel="Actions" />);
      const publish = screen.queryByRole("button", { name: "Publish" });
      if (!publish) {
        problems.push('A row action must render a button named by its label ("Publish").');
      } else {
        if (publish.hasAttribute("disabled") || publish.getAttribute("aria-disabled") === "true") problems.push("A row action button must not be disabled while its record has nothing in flight.");
        fireEvent.click(publish);
        if (pressed.join() !== "publish") problems.push("Pressing a row action button must call its onPress.");
      }
      const archive = screen.queryByRole("button", { name: "Archive" });
      if (!archive) {
        problems.push('A pending row action must still render its button ("Archive").');
      } else {
        if (!archive.hasAttribute("disabled") && archive.getAttribute("aria-disabled") !== "true") problems.push("While a record has an action in flight (pending: true) its buttons must be disabled.");
        const before = pressed.length;
        fireEvent.click(archive);
        if (pressed.length !== before) problems.push("A disabled button must not fire onPress.");
      }
      if (!screen.queryByText("Actions")) problems.push('The actions column must be headed by actionsLabel ("Actions").');
      problems.push(...(await axeProblems(container, "row actions")));
    }),
  ];
}

/**
 * `layout.Dialog` must provide the modal behaviour RFC 0007 asks for; the
 * renderer owns the content, so the check builds its own. Skipped when the
 * registry has no Dialog key (optional until a component set ships one).
 */
function dialogChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const maybeDialog = registry.layout.Dialog;
  const { Button } = registry.layout;
  if (maybeDialog === undefined) return [];
  const Dialog: NonNullable<Registry<ReactNode>["layout"]["Dialog"]> = maybeDialog;
  return [
    namedCheck("layout: Dialog is named by its label, takes focus, closes on Escape and gives focus back", async (problems) => {
      let closeCalls = 0;
      function Harness(): ReactNode {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <Button label="Open archive" type="button" variant="primary" disabled={false} onPress={() => setOpen(true)} />
            {open ? (
              <Dialog
                label="Archive this"
                onClose={() => {
                  closeCalls += 1;
                  setOpen(false);
                }}
              >
                <p>Archive this record?</p>
              </Dialog>
            ) : null}
          </div>
        );
      }
      render(<Harness />);
      const opener = screen.getByRole("button", { name: "Open archive" });
      opener.focus(); // fireEvent.click does not focus in jsdom; the dialog captures the opener at render
      fireEvent.click(opener);
      const dialog = screen.queryByRole("dialog");
      if (!dialog) {
        problems.push('Dialog must render role="dialog" when open.');
        return;
      }
      if (dialog.getAttribute("aria-modal") !== "true") problems.push('Dialog must set aria-modal="true".');
      const name = dialog.getAttribute("aria-label") ?? (dialog.getAttribute("aria-labelledby") ? (document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent ?? "") : "");
      if (name.trim() !== "Archive this") problems.push(`Dialog must be named by its label prop ("Archive this"), got "${name}".`);
      if (!dialog.contains(document.activeElement)) problems.push("Opening must move focus into the dialog.");
      problems.push(...(await axeProblems(dialog, "dialog")));
      fireEvent.keyDown(dialog, { key: "Escape" });
      if (closeCalls === 0) problems.push("Escape must call onClose.");
      if (screen.queryByRole("dialog")) problems.push("After onClose the dialog must be removed.");
      if (document.activeElement !== opener) problems.push("After close, focus must return to the button that opened the dialog.");
    }),
  ];
}

/** Registers one Vitest test per contract check. */
export function describeRegistryContract(registry: Registry<ReactNode>, samples: FieldSamples = defaultSamples): void {
  describe("yadad registry contract", () => {
    for (const check of registryContractChecks(registry, samples)) {
      test(check.name, async () => {
        expect(await check.run()).toEqual([]);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Action scenarios (RFC 0007). Dialog flows are not state-grid axes — a state
// is a rendering and these need a press (RFC 0007 line 285) — so they live
// here, driven through a real renderer and the memory adapter. Like
// `state-checks`, this never imports a renderer: the host passes `mount`.
// Everything is found by role and accessible name, never by test id.
// ---------------------------------------------------------------------------

/** What `mount` receives: the documents, the seeded adapter and the registry. */
export interface ActionScenarioContext {
  readonly entity: EntityDocument;
  readonly view: TableView;
  readonly registry: Registry<ReactNode>;
  /** The seeded adapter, registered by the host under the view's `dataSource` key. */
  readonly adapter: DataAdapter;
  /** The two records every scenario starts with (ids assigned by the adapter). */
  readonly records: readonly DataRecord[];
}

export interface ActionScenarioOptions {
  /** Mounts the view — this is the one line of host wiring, like state-checks' `render`. */
  readonly mount: (context: ActionScenarioContext) => ReactNode;
  /** Passed to `mount` as `context.registry`: every registry must pass the scenarios. */
  readonly registry: Registry<ReactNode>;
}

/** The kit's action documents: Publish runs on press; Archive confirms (danger) and asks for a required Reason. */
const SCENARIO_ENTITY: EntityDocument = {
  kind: "entity",
  specVersion: SPEC_VERSION,
  id: "kitdoc",
  revision: 1,
  fields: [{ id: "tag", type: "text", label: "Tag" }],
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

const SCENARIO_VIEW: TableView = {
  kind: "table",
  specVersion: SPEC_VERSION,
  id: "kit_rows",
  entity: "kitdoc",
  revision: 1,
  dataSource: "default",
  columns: [{ field: "tag" }],
  recordActions: ["publish", "archive"],
};

/** One call the handler saw: which record, what input. */
interface HandlerCall {
  readonly recordId: string;
  readonly input: RecordValues;
}

/** Everything a scenario run shares: the seeded adapter and the handler call log. */
async function scenarioSetup(handlers: Readonly<Record<string, (call: HandlerCall) => void | { values?: RecordValues }>>): Promise<{ adapter: DataAdapter; calls: HandlerCall[]; records: DataRecord[] }> {
  const calls: HandlerCall[] = [];
  const wrapped: Record<string, (record: DataRecord, input: RecordValues) => { values?: RecordValues }> = {};
  for (const [key, handler] of Object.entries(handlers)) {
    wrapped[key] = (record, input) => {
      // Logged before the handler runs: a handler that throws (403, 409) must
      // still show that act reached the source.
      calls.push({ recordId: record.id, input });
      const outcome = handler({ recordId: record.id, input });
      return outcome ?? { values: { tag: "done" } };
    };
  }
  // The memory adapter answers like a working source; handlers log the call
  // and return what the scenario says.
  const adapter = createMemoryAdapter({ actions: wrapped });
  const first = await adapter.create("kitdoc", { tag: "first" }, { entityRevision: 1 });
  const second = await adapter.create("kitdoc", { tag: "second" }, { entityRevision: 1 });
  return { adapter, calls, records: [first, second] };
}

const text = (el: Element | null): string => el?.textContent ?? "";

/** Waits for a scenario condition; a timeout becomes a thrown problem, caught by runScenario. */
async function settle(check: () => boolean, what: string): Promise<void> {
  await waitFor(() => {
    if (!check()) throw new Error(`timeout: ${what}`);
  });
}

/** The scenario checks for one mount wiring (see `ActionScenarioOptions`). */
export function actionScenarioChecks(options: ActionScenarioOptions): readonly ContractCheck[] {
  const registry = options.registry;
  const runScenario = async (
    handlers: Readonly<Record<string, (call: HandlerCall) => void | { values?: RecordValues }>>,
    body: (ctx: { readonly calls: HandlerCall[]; readonly adapter: DataAdapter; readonly records: readonly DataRecord[]; readonly rows: () => HTMLElement[]; readonly rowFor: (tag: string) => HTMLElement | undefined; readonly buttonIn: (row: HTMLElement, name: string) => HTMLButtonElement | undefined; readonly status: () => string; readonly alerts: () => HTMLElement[]; readonly dialog: () => HTMLElement | null }) => Promise<void>,
  ): Promise<readonly string[]> => {
    const problems: string[] = [];
    try {
      const { adapter, calls, records } = await scenarioSetup(handlers);
      const context: ActionScenarioContext = { entity: SCENARIO_ENTITY, view: SCENARIO_VIEW, registry, adapter, records };
      render(options.mount(context));
      const rows = () => screen.queryAllByRole("row");
      const rowFor = (tag: string) => rows().find((r) => text(r).includes(tag));
      const buttonIn = (row: HTMLElement, name: string) => within(row).queryAllByRole("button").find((b) => text(b) === name) as HTMLButtonElement | undefined;
      const status = () => text(document.querySelector('[role="status"]'));
      const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')) as HTMLElement[];
      const dialog = () => screen.queryByRole("dialog");
      await waitFor(() => {
        if (!rows().some((r) => text(r).includes("first") && text(r).includes("second"))) throw new Error("the seeded rows never appeared");
      });
      await body({ calls, adapter, records, rows, rowFor, buttonIn, status, alerts, dialog });
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    } finally {
      cleanup();
    }
    return problems;
  };

  return [
    namedCheck("scenarios: pressing an action runs it, announces it and reloads the row", async (problems) => {
      await runScenario({ "kitdoc.publish": () => ({ values: { tag: "live" } }) }, async ({ calls, rowFor, buttonIn, status, dialog }) => {
        const row = rowFor("first");
        if (!row) return;
        const publish = buttonIn(row, "Publish");
        if (!publish) {
          problems.push('The row must offer a button named "Publish".');
          return;
        }
        fireEvent.click(publish);
        await settle(() => calls.length === 1, "the handler was never reached");
        await settle(() => status().includes("Publish done"), '"Publish done" was never announced');
        await settle(() => text(rowFor("live") ?? document.createElement("i")).includes("live"), "the row never showed the new value");
        if (dialog() !== null) problems.push("An action with no confirm and no input must not open a dialog.");
        const untouched = rowFor("second");
        if (untouched && !text(untouched).includes("second")) problems.push("Only the pressed record may change.");
      });
    }),

    namedCheck("scenarios: a confirm is asked before the action runs; Cancel answers it without running", async (problems) => {
      await runScenario({ "kitdoc.archive": () => ({ values: { tag: "archived" } }) }, async ({ calls, rowFor, buttonIn, dialog }) => {
        const row = rowFor("first");
        if (!row) return;
        const archive = buttonIn(row, "Archive");
        if (!archive) {
          problems.push('The row must offer a button named "Archive".');
          return;
        }
        fireEvent.click(archive);
        const open = dialog();
        if (!open) {
          problems.push("An action with a confirm must open a dialog on press, before running.");
          return;
        }
        if (calls.length > 0) problems.push("The action must not run before the dialog is confirmed.");
        if (!text(open).includes("Archive this record?")) problems.push("The dialog must show the confirm message.");
        const cancel = within(open).queryAllByRole("button").find((b) => text(b) === "Cancel");
        if (!cancel) {
          problems.push('The dialog must offer a "Cancel" button.');
          return;
        }
        fireEvent.click(cancel);
        if (dialog() !== null) problems.push("Cancel must close the dialog.");
        if (calls.length > 0) problems.push("Cancel must not run the action.");
      });
    }),

    namedCheck("scenarios: the dialog validates its input, then answers the action with it", async (problems) => {
      await runScenario({ "kitdoc.archive": (call) => (call.input.reason === "cleanup" ? { values: { tag: "archived" } } : { values: { tag: "wrong" } }) }, async ({ calls, rowFor, buttonIn, status, alerts, dialog }) => {
        const row = rowFor("first");
        if (!row) return;
        const archive = buttonIn(row, "Archive");
        if (!archive) {
          problems.push('The row must offer a button named "Archive".');
          return;
        }
        fireEvent.click(archive);
        let open = dialog();
        if (!open) {
          problems.push("The Archive action must open a dialog.");
          return;
        }
        // Submit without the required Reason: validation must stop it at the dialog.
        const confirm = within(open).queryAllByRole("button").find((b) => text(b) === "Reject");
        if (!confirm) {
          problems.push('The dialog\'s confirm button must be named by confirmLabel ("Reject").');
          return;
        }
        fireEvent.click(confirm);
        if (calls.length > 0) problems.push("A missing required input must be caught before act is called.");
        open = dialog();
        if (!open) {
          problems.push("Invalid input must keep the dialog open for correction.");
          return;
        }
        if (alerts().filter((a) => open?.contains(a)).length === 0) problems.push("The dialog must show what is wrong with the input (a role=\"alert\" inside it).");
        // Answer the input and confirm.
        const reason = within(open).queryByLabelText(/Reason/) as HTMLInputElement | null;
        if (!reason) {
          problems.push('The dialog must ask for the input field labelled "Reason".');
          return;
        }
        fireEvent.change(reason, { target: { value: "cleanup" } });
        fireEvent.click(within(open).queryAllByRole("button").find((b) => text(b) === "Reject") ?? confirm);
        await settle(() => calls.length === 1, "the handler was never reached");
        if (calls[0] && calls[0].input.reason !== "cleanup") problems.push(`act must receive the typed input, got ${JSON.stringify(calls[0]?.input)}.`);
        await settle(() => dialog() === null, "the dialog stayed open");
        await settle(() => status().includes("Archive done"), '"Archive done" was never announced');
        await settle(() => text(rowFor("archived") ?? document.createElement("i")).includes("archived"), "the row never showed the new value");
      });
    }),

    namedCheck("scenarios: a refused action (403) closes the dialog and reports through the view", async (problems) => {
      await runScenario({ "kitdoc.publish": () => {
        throw new ForbiddenError("You may not publish that.");
      } }, async ({ calls, rowFor, buttonIn, status, alerts, dialog }) => {
        const row = rowFor("first");
        if (!row) return;
        const publish = buttonIn(row, "Publish");
        if (!publish) {
          problems.push('The row must offer a button named "Publish".');
          return;
        }
        fireEvent.click(publish);
        await settle(() => calls.length === 1, "the handler was never reached");
        await settle(() => alerts().some((a) => text(a).includes("You may not publish that.")), "the refusal never reached an alert");
        if (dialog() !== null) problems.push("A refusal must not leave a dialog open.");
        await settle(() => {
          const still = rowFor("first");
          return still !== undefined && text(still).includes("first");
        }, "the row did not survive the reload");
        if (status().includes("done")) problems.push("A refused action must not be announced as done.");
      });
    }),

    namedCheck("scenarios: acting on a stale record (409) reports the conflict and reloads", async (problems) => {
      // The record changes behind the client's back: its version moves, so the
      // client's last-read version is stale and act must be refused as a conflict.
      await runScenario({ "kitdoc.archive": () => ({ values: { tag: "archived" } }) }, async ({ calls, adapter, records, rowFor, buttonIn, alerts, dialog }) => {
        await adapter.update("kitdoc", records[0]!.id, { tag: "edited-elsewhere" }, { entityRevision: 1 });
        // The table still shows the stale copy until the reload; press on it anyway.
        const row = rowFor("first");
        if (!row) return;
        const archive = buttonIn(row, "Archive");
        if (!archive) {
          problems.push('The row must offer a button named "Archive".');
          return;
        }
        fireEvent.click(archive);
        const open = dialog();
        if (!open) {
          problems.push("The Archive action must open a dialog.");
          return;
        }
        const reason = within(open).queryByLabelText(/Reason/) as HTMLInputElement | null;
        if (!reason) {
          problems.push('The dialog must ask for the input field labelled "Reason".');
          return;
        }
        fireEvent.change(reason, { target: { value: "stale" } });
        const confirm = within(open).queryAllByRole("button").find((b) => text(b) === "Reject");
        if (!confirm) {
          problems.push('The dialog\'s confirm button must be named by confirmLabel ("Reject").');
          return;
        }
        fireEvent.click(confirm);
        await settle(() => alerts().some((a) => text(a).toLowerCase().includes("changed")), "the conflict never reached an alert");
        if (calls.length > 0) problems.push("A stale act must be refused before the handler runs.");
        await settle(() => dialog() === null, "the dialog stayed open");
      });
    }),
  ];
}

/** Registers one Vitest test per action scenario (RFC 0007 dialog flows). */
export function describeActionScenarios(options: ActionScenarioOptions): void {
  describe("yadad record-action scenarios", () => {
    for (const check of actionScenarioChecks(options)) {
      test(check.name, async () => {
        expect(await check.run()).toEqual([]);
      }, 20_000);
    }
  });
}

function fieldChecks<K extends CheckedFieldType>(
  type: K,
  registry: Registry<ReactNode>,
  sample: FieldSample<K>,
  driver: Driver<FieldValueTypes[K]>,
): ContractCheck[] {
  const entries: RequiredFieldEntries<ReactNode> = registry.fields;
  const entry = entries[type];
  const { Input, Display } = entry;
  const { FieldFrame } = registry.layout;
  const inputId = `yadad-contract-${sample.field.id}`;
  const errorId = `${inputId}-errors`;

  const renderField = (props: {
    value?: FieldValueTypes[K];
    errors?: readonly DocumentError[];
    onChange?: (value: FieldValueTypes[K] | undefined) => void;
  }) => {
    const errors = props.errors ?? [];
    return render(
      <FieldFrame inputId={inputId} errorId={errorId} label={sample.field.label} required={sample.field.required === true} errors={errors}>
        <Host
          component={Input}
          props={inputProps<K>(
            {
              inputId,
              field: sample.field,
              value: props.value,
              onChange: props.onChange ?? (() => {}),
              invalid: errors.length > 0,
              ...(errors.length > 0 ? { describedBy: errorId } : {}),
            },
            sample.inputExtras,
          )}
        />
      </FieldFrame>,
    );
  };

  /** Renders, runs `inspect`, and always cleans up the DOM. */
  const check = (name: string, inspect: (problems: string[]) => void | Promise<void>): ContractCheck => ({
    name: `${type}: ${name}`,
    async run() {
      const problems: string[] = [];
      try {
        await inspect(problems);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  });

  const control = (problems: string[]): HTMLElement | null => {
    const el = document.getElementById(inputId);
    if (!el) problems.push(`Input must render an element with id="${inputId}" (its inputId prop).`);
    return el;
  };

  return [
    check("registry key matches entry.type", (problems) => {
      if (entry.type !== type) problems.push(`registry.fields.${type}.type is "${entry.type}".`);
    }),

    check("renders a control labelled by FieldFrame", (problems) => {
      renderField({});
      const el = control(problems);
      if (!el) return;
      const labelled = screen.queryAllByLabelText(sample.field.label, { exact: false });
      if (!labelled.includes(el)) {
        problems.push(`FieldFrame's label "${sample.field.label}" must point at the Input (label for="${inputId}").`);
      }
    }),

    check("shows the value it is given", (problems) => {
      renderField({ value: sample.value });
      const el = control(problems);
      if (el && driver.read(el) !== sample.value) {
        problems.push(`Input given ${JSON.stringify(sample.value)} shows ${JSON.stringify(driver.read(el))}.`);
      }
    }),

    check(`emits a JSON ${driver.jsonType} on change`, (problems) => {
      const emitted: unknown[] = [];
      renderField({ onChange: (v) => emitted.push(v) });
      const el = control(problems);
      if (!el) return;
      driver.change(el, sample.value);
      const last = emitted.at(-1);
      if (emitted.length === 0) problems.push("Input did not call onChange.");
      else if (typeof last !== driver.jsonType || last !== sample.value) {
        problems.push(`onChange got ${JSON.stringify(last)} (${typeof last}); expected the ${driver.jsonType} ${JSON.stringify(sample.value)}.`);
      }
    }),

    check(`emits ${JSON.stringify(driver.cleared) ?? "undefined"} when cleared`, (problems) => {
      const emitted: unknown[] = [];
      renderField({ value: sample.value, onChange: (v) => emitted.push(v) });
      const el = control(problems);
      if (!el) return;
      driver.clear(el);
      if (emitted.length === 0) problems.push("Input did not call onChange when cleared.");
      else if (emitted.at(-1) !== driver.cleared) {
        problems.push(`Clearing must emit ${JSON.stringify(driver.cleared) ?? "undefined"}, got ${JSON.stringify(emitted.at(-1))}.`);
      }
    }),

    check('sets aria-invalid="true" when invalid', (problems) => {
      renderField({ errors: [sampleError] });
      const el = control(problems);
      if (el && el.getAttribute("aria-invalid") !== "true") problems.push('Input with invalid=true must set aria-invalid="true".');
    }),

    check("links its errors with aria-describedby", (problems) => {
      renderField({ errors: [sampleError] });
      const el = control(problems);
      if (!el) return;
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/);
      if (!ids.includes(errorId)) problems.push(`Input must set aria-describedby to its describedBy prop ("${errorId}").`);
      const errorsEl = document.getElementById(errorId);
      if (!errorsEl) problems.push(`FieldFrame must put id="${errorId}" (its errorId prop) on the element holding the errors.`);
      else if (!errorsEl.textContent.includes(sampleError.message)) problems.push(`The element with id="${errorId}" must contain the error message.`);
    }),

    check("is named by labelledBy when given (e.g. a table column header)", (problems) => {
      const labelId = `${inputId}-external-label`;
      render(
        <div>
          <span id={labelId}>{sample.field.label}</span>
          <Host component={Input} props={inputProps<K>({ inputId, field: sample.field, value: undefined, onChange: () => {}, invalid: false, labelledBy: labelId }, sample.inputExtras)} />
        </div>,
      );
      const el = control(problems);
      if (el && !(el.getAttribute("aria-labelledby") ?? "").split(/\s+/).includes(labelId)) {
        problems.push(`Input must set aria-labelledby to its labelledBy prop ("${labelId}").`);
      }
    }),

    check("Display shows the value", (problems) => {
      const { container } = render(<Host component={Display} props={displayProps<K>({ field: sample.field, value: sample.value }, sample.displayExtras)} />);
      if (sample.shown !== undefined ? !container.textContent.includes(sample.shown) : !driver.shows(container.textContent, sample.value)) {
        problems.push(`Display did not show ${JSON.stringify(sample.shown ?? sample.value)}.`);
      }
    }),

    check("passes axe (valid and invalid)", async (problems) => {
      for (const invalid of [false, true]) {
        const { container } = renderField({ value: sample.value, errors: invalid ? [sampleError] : [] });
        const results = await axe.run(container, { runOnly: { type: "tag", values: AXE_TAGS } });
        for (const v of results.violations) problems.push(`axe ${v.id} (${invalid ? "invalid" : "valid"}): ${v.help}`);
        cleanup();
      }
    }),
  ];
}

/** Renders, runs `inspect`, and always cleans up the DOM. */
function layoutCheck(name: string, inspect: (problems: string[]) => void | Promise<void>): ContractCheck {
  return {
    name: `layout: ${name}`,
    async run() {
      const problems: string[] = [];
      try {
        await inspect(problems);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  };
}

/** A check under an explicit prefix (field-key and scenario checks besides the layout ones). */
function namedCheck(name: string, inspect: (problems: string[]) => void | Promise<void>): ContractCheck {
  return {
    name,
    async run() {
      const problems: string[] = [];
      try {
        await inspect(problems);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      } finally {
        cleanup();
      }
      return problems;
    },
  };
}

async function axeProblems(container: Element, what: string): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: "tag", values: AXE_TAGS } });
  return results.violations.map((v) => `axe ${v.id} (${what}): ${v.help}`);
}

function layoutChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const { Section, Button, Table, ErrorSummary, Tabs, Panel } = registry.layout;
  const Count = registry.widgets.count;

  const columns = [
    { id: "day", headerId: "kit-col-day", label: "Day", sortable: true, sort: "desc" as const },
    { id: "weight", headerId: "kit-col-weight", label: "Weight", sortable: true },
    { id: "actions", headerId: "kit-col-actions", label: "Actions", sortable: false },
  ];
  const rows = [
    { id: "1", cells: ["2026-10-04", "100 kg", "—"] },
    { id: "2", cells: ["2026-10-03", "95 kg", "—"] },
  ];

  const problemsToShow = [
    { path: "/weight", code: "invalid-value" as const, message: "Weight must be a multiple of 2.5.", hint: "Use 100 or 102.5." },
    { path: "/day", code: "required" as const, message: "Day is required.", hint: "Pick a day." },
  ];

  const kitTabs = [
    { id: "log", title: "Log" },
    { id: "history", title: "History" },
    { id: "stats", title: "Stats" },
  ];
  function TabsHarness() {
    const [selected, setSelected] = useState("log");
    return <Tabs label="Training" tabs={kitTabs} selected={selected} onSelect={setSelected} panel={<p>{`panel ${selected}`}</p>} />;
  }
  const selectedTab = () => screen.queryAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");

  return [
    layoutCheck("Tabs follow the WAI-ARIA tabs pattern", async (problems) => {
      const { container } = render(<TabsHarness />);
      if (!screen.queryByRole("tablist", { name: "Training" })) problems.push('Tabs must render role="tablist" named by its label.');
      const tabs = screen.queryAllByRole("tab");
      if (tabs.length !== kitTabs.length) problems.push(`Tabs must render one role="tab" per tab (expected ${kitTabs.length}).`);
      if (selectedTab()?.textContent !== "Log") problems.push('The selected tab must set aria-selected="true".');
      const panel = screen.queryByRole("tabpanel", { name: "Log" });
      if (!panel) problems.push('The panel must be role="tabpanel", labelled by the selected tab (aria-labelledby).');
      else if (!panel.textContent.includes("panel log")) problems.push("The tabpanel must show the panel content.");
      const history = tabs.find((t) => t.textContent === "History");
      if (history) fireEvent.click(history);
      if (!screen.queryByText("panel history")) problems.push("Clicking a tab must call onSelect with its id.");
      const current = selectedTab();
      if (current) {
        current.focus();
        fireEvent.keyDown(current, { key: "ArrowRight" });
        if (selectedTab()?.textContent !== "Stats") problems.push("ArrowRight must select the next tab.");
        else if (document.activeElement !== selectedTab()) problems.push("Keyboard selection must move focus to the new tab.");
        fireEvent.keyDown(selectedTab()!, { key: "ArrowRight" });
        if (selectedTab()?.textContent !== "Log") problems.push("ArrowRight on the last tab must wrap to the first.");
        fireEvent.keyDown(selectedTab()!, { key: "End" });
        if (selectedTab()?.textContent !== "Stats") problems.push("End must select the last tab.");
      }
      if (tabs.filter((t) => t.tabIndex === 0).length > 1) problems.push("Only the selected tab may be in the tab order (roving tabindex).");
      problems.push(...(await axeProblems(container, "tabs")));
    }),

    layoutCheck("Panel shows its title and content", async (problems) => {
      const { container } = render(
        <Panel title="Total sets">
          <span>widget body</span>
        </Panel>,
      );
      if (!screen.queryByText("Total sets")) problems.push("Panel must show its title.");
      if (!screen.queryByText("widget body")) problems.push("Panel must show its children.");
      problems.push(...(await axeProblems(container, "panel")));
    }),

    layoutCheck("count widget shows its label and value", async (problems) => {
      const { container } = render(<Count label="Squat sets" value={42} />);
      if (!container.textContent.includes("Squat sets") || !container.textContent.includes("42")) problems.push("The count widget must show its label and value.");
      problems.push(...(await axeProblems(container, "count")));
      cleanup();
      render(<Count label="Squat sets" value={undefined} />);
      if (!screen.queryByText(/Squat sets/)) problems.push("While loading (value undefined) the count widget must still show its label.");
    }),

    layoutCheck("count widget shows preformatted text instead of the value when given", async (problems) => {
      const { container } = render(<Count label="Volume" value={12345.6789} text="12,345.68" />);
      if (!container.textContent.includes("12,345.68")) problems.push("The count widget must show `text` when it is given (stat widgets pass formatted numbers and a dash this way).");
    }),

    layoutCheck("ErrorSummary announces every message and hint", async (problems) => {
      const { container } = render(<ErrorSummary id="kit-errors" errors={problemsToShow} />);
      const alert = screen.queryByRole("alert");
      if (!alert) problems.push('ErrorSummary must render role="alert" so screen readers announce it.');
      else {
        if (alert.id !== "kit-errors" && !alert.querySelector("#kit-errors") && document.getElementById("kit-errors")?.contains(alert) !== true) {
          problems.push('ErrorSummary must put its id ("kit-errors") on the alert, so inputs can be described by it.');
        }
        for (const e of problemsToShow) {
          if (!alert.textContent.includes(e.message)) problems.push(`ErrorSummary must show "${e.message}".`);
          if (!alert.textContent.includes(e.hint)) problems.push(`ErrorSummary must show the hint "${e.hint}".`);
        }
      }
      problems.push(...(await axeProblems(container, "error summary")));
    }),

    layoutCheck("Section is a group named by its title", async (problems) => {
      const { container } = render(
        <Section id="details" title="Details">
          <span>inside</span>
        </Section>,
      );
      const group = screen.queryByRole("group", { name: "Details" });
      if (!group) problems.push('Section with title "Details" must render a group (e.g. fieldset/legend) named "Details".');
      else if (!group.textContent.includes("inside")) problems.push("Section must render its children inside the group.");
      problems.push(...(await axeProblems(container, "section")));
      cleanup();
      render(
        <Section id="plain">
          <span>untitled</span>
        </Section>,
      );
      if (!screen.queryByText("untitled")) problems.push("Section without a title must still render its children.");
    }),

    layoutCheck("Button renders a button with its label, type and state", async (problems) => {
      let pressed = 0;
      const { container } = render(
        <>
          <Button label="Save" type="submit" variant="primary" disabled={false} />
          <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={() => pressed++} />
          <Button label="Busy" type="button" variant="secondary" disabled onPress={() => pressed++} />
        </>,
      );
      const save = screen.queryByRole("button", { name: "Save" });
      if (!save) problems.push('Button must render role="button" named by its label.');
      else if (save.getAttribute("type") !== "submit") problems.push('Button with type="submit" must submit its form (type="submit").');
      const cancel = screen.queryByRole("button", { name: "Cancel" });
      if (cancel) fireEvent.click(cancel);
      if (pressed !== 1) problems.push("Clicking a button must call onPress once.");
      const busy = screen.queryByRole("button", { name: "Busy" });
      if (busy) fireEvent.click(busy);
      if (busy && !(busy as HTMLButtonElement).disabled && busy.getAttribute("aria-disabled") !== "true") problems.push("A disabled Button must be disabled.");
      if (pressed !== 1) problems.push("A disabled Button must not call onPress.");
      problems.push(...(await axeProblems(container, "buttons")));
    }),

    layoutCheck("Table is named by its caption, with sortable headers and rows", async (problems) => {
      const sorted: string[] = [];
      const { container } = render(<Table caption="Sets" columns={columns} rows={rows} onSort={(id) => sorted.push(id)} empty="No sets" />);
      if (!screen.queryByRole("table", { name: "Sets" })) problems.push('Table must render role="table" named by its caption.');
      for (const c of columns) {
        const th = document.getElementById(c.headerId);
        if (!th) problems.push(`The "${c.label}" header must have id="${c.headerId}" (its headerId) so editors can be labelled by it.`);
        else if (!th.textContent.includes(c.label)) problems.push(`Header ${c.headerId} must show "${c.label}".`);
      }
      const day = document.getElementById("kit-col-day");
      if (day && day.getAttribute("aria-sort") !== "descending") problems.push('The sorted column header must set aria-sort="descending".');
      const sortButton = day ? Array.from(day.querySelectorAll("button")).at(0) : undefined;
      if (!sortButton) problems.push("Sortable headers must contain a button to sort by them.");
      else fireEvent.click(sortButton);
      if (sorted.join() !== "day") problems.push(`Activating the Day header must call onSort("day"), got [${sorted.join(", ")}].`);
      const actions = document.getElementById("kit-col-actions");
      if (actions?.querySelector("button")) problems.push("Headers that are not sortable must not offer a sort button.");
      if (screen.queryAllByRole("row").length !== rows.length + 1) problems.push("Table must render one row per entry plus the header row.");
      if (!screen.queryByText("95 kg")) problems.push("Table must render every cell.");
      problems.push(...(await axeProblems(container, "table")));
      cleanup();
      render(<Table caption="Sets" columns={columns} rows={[]} onSort={() => {}} empty="No sets" />);
      if (!screen.queryByText("No sets")) problems.push("An empty Table must show its empty content.");
    }),
  ];
}

const kitWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((short, i) => ({ short, long: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i] ?? short }));
const KIT_LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `count` consecutive days from 2026-09-28 (a Monday); 2026-10-15 is today, September's are out of the month. */
function kitDays(count: number, entries: Readonly<Record<string, CalendarDayProps<ReactNode>["entries"]>> = {}): CalendarDayProps<ReactNode>[] {
  return Array.from({ length: count }, (_, i) => {
    const t = new Date(Date.UTC(2026, 8, 28 + i));
    const date = t.toISOString().slice(0, 10);
    const label = `${KIT_LONG_DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${t.toLocaleString("en", { month: "long", timeZone: "UTC" })} ${t.getUTCFullYear()}`;
    return { date, dayOfMonth: t.getUTCDate(), weekday: t.getUTCDay(), label, inMonth: t.getUTCMonth() === 9, isToday: date === "2026-10-15", entries: entries[date] ?? [] };
  });
}

const kitEntry = (id: string, title: string, over: Partial<CalendarDayProps<ReactNode>["entries"][number]> = {}): CalendarDayProps<ReactNode>["entries"][number] => ({
  id,
  content: <span>{title}</span>,
  label: title,
  movable: false,
  pending: false,
  ...over,
});

/**
 * Checks for `layout.Calendar` (RFC 0004). The key is optional, so a registry
 * without a calendar has no calendar checks; one with a calendar must pass all.
 */
function calendarChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const { Calendar } = registry.layout;
  if (!Calendar) return [];

  const none = () => {};
  const base: CalendarProps<ReactNode> = {
    label: "Tasks",
    title: "October 2026",
    mode: "month",
    modes: [
      { mode: "month", label: "Month" },
      { mode: "week", label: "Week" },
    ],
    weekdays: kitWeekdays,
    days: kitDays(42),
    legend: [],
    loading: false,
    onModeChange: none,
    onPrevious: none,
    onNext: none,
    onToday: none,
  };
  const withEntries = kitDays(42, {
    "2026-10-15": [kitEntry("a", "Pay rent", { color: { slot: 3, label: "Home" }, movable: true }), kitEntry("p", "Book flights", { pending: true })],
    "2026-10-16": [kitEntry("b", "Call Ada", { movable: true })],
  });
  const cells = () => screen.queryAllByRole("gridcell");
  const button = (name: RegExp | string) => screen.queryByRole("button", { name });

  return [
    layoutCheck("Calendar is a named grid of days named by their full date", async (problems) => {
      const { container } = render(<Calendar {...base} />);
      if (!screen.queryByRole("grid")) problems.push('Calendar must render role="grid" for the days.');
      if (!screen.queryByText("October 2026")) problems.push("Calendar must show its period title.");
      if (!screen.queryByLabelText("Tasks") && !screen.queryByRole("region", { name: "Tasks" }) && !screen.queryByRole("grid", { name: /Tasks|October 2026/ })) problems.push("Calendar must be named by its label.");
      if (screen.queryAllByRole("columnheader").length !== 7) problems.push("Calendar must render seven column headers, one per weekday.");
      if (cells().length !== 42) problems.push(`Calendar must render one gridcell per day (expected 42, got ${cells().length}).`);
      for (const d of [base.days[0], base.days[17], base.days[41]]) {
        if (d && !screen.queryByRole("gridcell", { name: d.label })) problems.push(`The day ${d.date} must be a gridcell named "${d.label}", including days outside the month.`);
      }
      const today = cells().find((c) => c.getAttribute("aria-current") === "date");
      if (!today) problems.push('Today must set aria-current="date".');
      else {
        if (today.getAttribute("aria-label") !== "Thursday 15 October 2026") problems.push("The cell with aria-current=date must be today (2026-10-15).");
        if (!/today/i.test(today.textContent)) problems.push("Today must also show the text \"Today\", not only a colour.");
      }
      problems.push(...(await axeProblems(container, "calendar month grid")));
    }),

    layoutCheck("Calendar shows a week of seven days", async (problems) => {
      const { container } = render(<Calendar {...base} mode="week" days={kitDays(7)} title="28 September to 4 October 2026" />);
      if (cells().length !== 7) problems.push(`A week must render seven gridcells, got ${cells().length}.`);
      problems.push(...(await axeProblems(container, "calendar week")));
    }),

    layoutCheck("Calendar navigation and mode switcher call their callbacks", async (problems) => {
      const calls: string[] = [];
      render(<Calendar {...base} onPrevious={() => calls.push("previous")} onNext={() => calls.push("next")} onToday={() => calls.push("today")} onModeChange={(m) => calls.push(`mode:${m}`)} />);
      for (const [name, call] of [[/^previous/i, "previous"], [/^next/i, "next"], [/^today$/i, "today"]] as const) {
        const b = button(name);
        if (!b) problems.push(`Calendar must offer a "${call}" button (Previous, Next and Today).`);
        else fireEvent.click(b);
      }
      if (calls.join() !== "previous,next,today") problems.push(`Previous, Next and Today must call onPrevious, onNext and onToday, got [${calls.join(", ")}].`);
      if (!button(/previous month/i) || !button(/next month/i)) problems.push('In month mode the buttons must be named "Previous month" and "Next month".');
      const week = button(/^week$/i);
      if (!week) problems.push("With more than one mode, Calendar must offer a button per mode, named by its label.");
      else {
        fireEvent.click(week);
        if (!calls.includes("mode:week")) problems.push('Choosing "Week" must call onModeChange("week").');
      }
      if (button(/^month$/i)?.getAttribute("aria-pressed") !== "true") problems.push("The current mode's button must set aria-pressed=\"true\".");
      cleanup();
      render(<Calendar {...base} modes={[{ mode: "month", label: "Month" }]} />);
      if (button(/^(month|week)$/i)) problems.push("With one mode there must be no mode switcher.");
    }),

    layoutCheck("Calendar entries are named by their label and open on activation", async (problems) => {
      const opened: string[] = [];
      const { container } = render(<Calendar {...base} days={withEntries} legend={[{ slot: 3, label: "Home" }]} onOpenEntry={(id) => opened.push(id)} />);
      const entry = button("Pay rent");
      if (!entry) problems.push("With onOpenEntry set, each entry must be a button (or link) named by its label.");
      else fireEvent.click(entry);
      if (opened.join() !== "a") problems.push(`Activating an entry must call onOpenEntry with its id, got [${opened.join(", ")}].`);
      if (!screen.queryByText("Call Ada")) problems.push("Calendar must show every entry's content on its day.");
      const day = screen.queryByRole("gridcell", { name: "Thursday 15 October 2026" });
      if (day && !day.textContent.includes("Pay rent")) problems.push("An entry must be inside the cell of its day.");
      if (!screen.queryByText("Home")) problems.push("Calendar must show the legend, so colour is never the only signal.");
      problems.push(...(await axeProblems(container, "calendar entries")));
      cleanup();
      render(<Calendar {...base} days={withEntries} />);
      if (button("Pay rent")) problems.push("Without onOpenEntry, entries must not be buttons.");
    }),

    layoutCheck("Calendar offers Move to day… for every movable entry and calls onMove once", async (problems) => {
      const moves: string[] = [];
      const { container } = render(<Calendar {...base} days={withEntries} onMove={(id, date) => moves.push(`${id}@${date}`)} />);
      const triggers = screen.queryAllByRole("button", { name: /move to day/i });
      if (triggers.length !== 2) problems.push(`Every movable entry (and only those) must have a "Move to day…" button; expected 2, got ${triggers.length}. Pending entries are not movable.`);
      const first = triggers[0];
      if (first) {
        if ((first as HTMLButtonElement).disabled || first.tabIndex < 0) problems.push('"Move to day…" must be focusable, not hidden until hover.');
        fireEvent.click(first);
        const input = container.querySelector<HTMLInputElement>('input[type="date"]');
        if (!input) problems.push('"Move to day…" must open a date input.');
        else {
          if (input.value !== "2026-10-15") problems.push("The date input must default to the entry's current day.");
          const name = `${input.getAttribute("aria-label") ?? ""} ${Array.from(input.labels ?? []).map((l) => l.textContent).join(" ")}`;
          if (!name.includes("Pay rent")) problems.push("The date input must be labelled, and the label must name the entry.");
          problems.push(...(await axeProblems(container, "move to day")));
          fireEvent.change(input, { target: { value: "2026-11-03" } });
          const confirm = screen.queryByRole("button", { name: /^(move|confirm|ok|save)$/i });
          if (!confirm) problems.push("The date input must have a confirm button.");
          else fireEvent.click(confirm);
        }
      }
      if (moves.join() !== "a@2026-11-03") problems.push(`Confirming must call onMove(id, date) exactly once with any real date, got [${moves.join(", ")}].`);
      cleanup();
      moves.length = 0;
      render(<Calendar {...base} days={withEntries} onMove={(id, date) => moves.push(`${id}@${date}`)} />);
      const again = screen.queryAllByRole("button", { name: /move to day/i })[0];
      if (again) {
        fireEvent.click(again);
        const input = document.querySelector<HTMLInputElement>('input[type="date"]');
        if (input) {
          fireEvent.change(input, { target: { value: "2026-11-03" } });
          fireEvent.keyDown(input, { key: "Escape" });
        }
        await new Promise((resolve) => setTimeout(resolve, 0)); // focus may be restored in an effect or a microtask
        if (document.querySelector('input[type="date"]')) problems.push("Escape must close the date input.");
        if (moves.length > 0) problems.push("Escape must cancel without calling onMove.");
        if (document.activeElement === document.body) problems.push("After Escape, focus must return to the entry, not be lost.");
      }
      cleanup();
      render(<Calendar {...base} days={withEntries} />);
      if (screen.queryByRole("button", { name: /move to day/i })) problems.push('Without onMove there must be no "Move to day…" control.');
    }),

    layoutCheck("Calendar announces through a live region and reports loading", async (problems) => {
      const { container, rerender } = render(<Calendar {...base} loading announcement={{ seq: 1, text: "Moved Pay rent to Friday 16 October 2026" }} notice={<p>Showing the first 2,000 of 2,431 entries.</p>} />);
      const status = screen.queryByRole("status");
      if (!status) problems.push('Calendar must keep a role="status" live region mounted.');
      else {
        if (status.getAttribute("aria-live") !== "polite" && status.getAttribute("aria-live") !== null) problems.push('The live region must be polite (aria-live="polite").');
        if (!status.textContent.includes("Moved Pay rent to Friday 16 October 2026")) problems.push("The live region must show announcement.text.");
      }
      if (container.querySelector('[aria-busy="true"]') === null) problems.push('While loading, the grid (or the calendar) must set aria-busy="true".');
      if (!screen.queryByText(/Showing the first 2,000 of 2,431 entries/)) problems.push("Calendar must show the notice above the grid.");
      problems.push(...(await axeProblems(container, "calendar loading")));
      rerender(<Calendar {...base} announcement={{ seq: 2, text: "Could not move Pay rent: Forbidden" }} />);
      if (!screen.queryByRole("status")?.textContent.includes("Could not move Pay rent: Forbidden")) problems.push("The live region must show a newer announcement.");
      if (container.querySelector('[aria-busy="true"]') !== null) problems.push("When not loading, nothing may be aria-busy.");
    }),
  ];
}

/**
 * Checks for `layout.Board` (RFC 0005). The key is optional, so a registry
 * without a board has no board checks; one with a board must pass all.
 */
function boardChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const { Board } = registry.layout;
  if (!Board) return [];

  const none = () => {};
  const base: BoardProps<ReactNode> = {
    label: "Tasks",
    groupChoices: [
      { field: "list", label: "List" },
      { field: "assignee", label: "Assignee" },
    ],
    groupField: "list",
    columns: [
      {
        id: "v:Home",
        label: "Home",
        count: 1,
        droppable: true,
        cards: [{ id: "a", content: "Pay rent", label: "Pay rent", movable: true, pending: false }],
      },
      {
        id: "v:Work",
        label: "Work",
        count: 1,
        droppable: true,
        cards: [{ id: "b", content: "Call Ada", label: "Call Ada", movable: true, pending: false }],
      },
      {
        id: "empty",
        label: "No List",
        count: 0,
        droppable: true,
        cards: [],
      },
      { id: "other", label: "Other", count: 0, droppable: false, cards: [] },
    ],
    loading: false,
    onGroupBy: none,
  };
  const [home, work, empty] = base.columns;
  const withMovable: BoardProps<ReactNode> = {
    ...base,
    columns: [
      ...(home ? [home] : []),
      ...(work ? [{ ...work, cards: [...work.cards, { id: "p", content: "Book flights", label: "Book flights", movable: false, pending: true }] }] : []),
      ...(empty ? [empty] : []),
    ],
  };

  return [
    layoutCheck("Board is a group named by its label and names its columns by label and count", async (problems) => {
      const { container } = render(<Board {...base} />);
      // RFC 0005 "Semantics": the board is a group named by its label; each column is
      // a group (or region) named "<column label>, <count> cards". The contract names
      // no test ids and no role beyond group/region, so find both by role and name.
      // The separator is not checked: a name computed from a heading ("Home 1 card") is as good.
      const named = (name: string | RegExp) => [...screen.queryAllByRole("group", { name }), ...screen.queryAllByRole("region", { name })];
      if (named("Tasks").length === 0) problems.push("Board must render a group (role=group or a labelled section) named by its label.");
      for (const column of base.columns) {
        const escaped = column.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const found = named(new RegExp(`^${escaped}\\W*${column.count}(?!\\d)`));
        if (found.length !== 1) problems.push(`Board must render one group (or region) per column, named by its label and card count ("${column.label}, ${column.count} cards"); found ${found.length} (groups and regions on the page: ${[...screen.queryAllByRole("group"), ...screen.queryAllByRole("region")].map((e) => `"${e.getAttribute("aria-label") ?? e.textContent?.slice(0, 30) ?? ""}"`).join(", ")}).`);
        for (const card of column.cards) {
          const inside = found[0] && within(found[0]).queryAllByRole("listitem").some((li) => li.textContent.includes(String(card.label)));
          if (found[0] && !inside) problems.push(`The card "${card.label}" must be a list item inside its column "${column.label}".`);
        }
      }
      const cards = screen.queryAllByRole("listitem");
      if (!cards.some((c) => c.textContent?.includes("Pay rent"))) problems.push("Board must show every card's content in its column.");
      problems.push(...(await axeProblems(container, "board columns")));
    }),

    layoutCheck("Board offers a group-by select when there is more than one grouping and calls onGroupBy", async (problems) => {
      const calls: string[] = [];
      const { container } = render(<Board {...base} onGroupBy={(f) => calls.push(f)} />);
      const select = container.querySelector<HTMLSelectElement>('select');
      if (!select) problems.push("With more than one groupChoice, Board must offer a group-by control (a labelled select).");
      else {
        const options = Array.from(select.options).map((o) => o.value);
        if (options.join() !== "list,assignee") problems.push(`The group-by select must offer every groupChoice (${base.groupChoices.map((c: { label: string }) => c.label).join(", ")}), got [${options.join(", ")}].`);
        if (select.value !== "list") problems.push("The select must show the field in use (groupField).");
        const name = `${select.getAttribute("aria-label") ?? ""} ${Array.from(select.labels ?? []).map((l) => l.textContent).join(" ")}`;
        if (!/group by/i.test(name)) problems.push("The group-by control must be named \"Group by\".");
        fireEvent.change(select, { target: { value: "assignee" } });
      }
      if (calls.join() !== "assignee") problems.push(`Choosing a field must call onGroupBy with its id, got [${calls.join(", ")}].`);
      cleanup();
      render(<Board {...base} groupChoices={base.groupChoices.slice(0, 1)} groupField="list" />);
      if (document.querySelector("select")) problems.push("With one groupChoice there must be no group-by switcher.");
    }),

    layoutCheck("Board cards open on activation when onOpenCard is set", async (problems) => {
      const opened: string[] = [];
      render(<Board {...base} onOpenCard={(id) => opened.push(id)} />);
      const card = screen.queryByRole("button", { name: "Pay rent" });
      if (!card) problems.push("With onOpenCard set, each card must be a button (or link) named by its label.");
      else fireEvent.click(card);
      if (opened.join() !== "a") problems.push(`Activating a card must call onOpenCard with its id, got [${opened.join(", ")}].`);
      cleanup();
      render(<Board {...base} />);
      if (screen.queryByRole("button", { name: "Pay rent" })) problems.push("Without onOpenCard, cards must not be buttons.");
    }),

    layoutCheck("Board offers Move to… for every movable card and calls onMove once with a column id", async (problems) => {
      const moves: string[] = [];
      const { container } = render(<Board {...withMovable} onMove={(id, columnId) => moves.push(`${id}@${columnId}`)} />);
      const triggers = screen.queryAllByRole("button", { name: /move to…|move to/i });
      if (triggers.length !== 2) problems.push(`Every movable card (and only those) must have a "Move to…" button; expected 2, got ${triggers.length}. Pending cards are not movable.`);
      const first = triggers[0];
      if (first) {
        if ((first as HTMLButtonElement).disabled || first.tabIndex < 0) problems.push('"Move to…" must be focusable, not hidden until hover.');
        fireEvent.click(first);
        const select = container.querySelector<HTMLSelectElement>('form select');
        if (!select) problems.push('"Move to…" must open a labelled list (menu) of the droppable columns other than the card\'s own.');
        else {
          const options = Array.from(select.options).filter((o) => o.value !== "").map((o) => o.value);
          if (options.includes("v:Home")) problems.push("The list must not offer the card's own column.");
          if (options.includes("other")) problems.push("The list must not offer the \"other\" column (it is not droppable).");
          if (!options.includes("v:Work") || !options.includes("empty")) problems.push(`The list must offer the droppable columns ("Work", "No List"), got [${options.join(", ")}].`);
          problems.push(...(await axeProblems(container, "board move to")));
          fireEvent.change(select, { target: { value: "empty" } });
          const confirm = screen.queryByRole("button", { name: /^(move|confirm|ok|save)$/i });
          if (!confirm) problems.push("The move list must have a confirm button.");
          else fireEvent.click(confirm);
        }
      }
      if (moves.join() !== "a@empty") problems.push(`Confirming must call onMove(id, columnId) exactly once with a column id, got [${moves.join(", ")}].`);
      cleanup();
      moves.length = 0;
      render(<Board {...withMovable} onMove={(id, columnId) => moves.push(`${id}@${columnId}`)} />);
      const again = screen.queryAllByRole("button", { name: /move to…|move to/i })[0];
      if (again) {
        fireEvent.click(again);
        const select = document.querySelector<HTMLSelectElement>("form select");
        if (select) {
          fireEvent.change(select, { target: { value: "v:Work" } });
          fireEvent.keyDown(select, { key: "Escape" });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (document.querySelector("form select")) problems.push("Escape must close the move list.");
        if (moves.length > 0) problems.push("Escape must cancel without calling onMove.");
        if (document.activeElement === document.body) problems.push("After Escape, focus must return to the card, not be lost.");
      }
      cleanup();
      render(<Board {...withMovable} />);
      if (screen.queryAllByRole("button", { name: /move to…|move to/i }).length > 0) problems.push('Without onMove there must be no "Move to…" control.');
    }),

    layoutCheck("Board announces through a live region, reports loading and shows the notice", async (problems) => {
      const { container } = render(<Board {...base} loading announcement={{ seq: 1, text: "Moved Pay rent to Work" }} notice={<p>Showing the first 1,000 of 1,412 cards.</p>} />);
      const status = screen.queryByRole("status");
      if (!status) problems.push("Board must keep a role=\"status\" live region mounted.");
      else {
        if (status.getAttribute("aria-live") !== "polite" && status.getAttribute("aria-live") !== null) problems.push("The live region must be polite (aria-live=\"polite\").");
        if (!status.textContent.includes("Moved Pay rent to Work")) problems.push("The live region must show announcement.text.");
      }
      if (container.querySelector('[aria-busy="true"]') === null) problems.push('While loading, the board must set aria-busy="true".');
      if (!screen.queryByText(/Showing the first 1,000 of 1,412 cards/)) problems.push("Board must show the notice above the columns.");
      problems.push(...(await axeProblems(container, "board loading")));
    }),
  ];
}

/**
 * Checks for `widgets.series` (RFC 0001 slice 2). The key is optional, so a
 * registry without a series has no series checks; one with a series must pass
 * all. A chart is only real if its numbers are in the accessible tree: an SVG
 * full of bars is decoration, and the groups are data only as text.
 */
function seriesChecks(registry: Registry<ReactNode>): ContractCheck[] {
  const Series = registry.widgets.series;
  if (!Series) return [];

  const base: Pick<SeriesWidgetProps, "label" | "display" | "loading" | "measureLabel" | "aggregation"> = {
    label: "Sets per day",
    display: "bar",
    loading: false,
    measureLabel: "Sum of sets",
    aggregation: "sum",
  };
  const groups: SeriesGroupProps[] = [
    { key: "2026-10-01", label: "Thursday 1 October", value: 12, text: "12" },
    { key: "2026-10-02", label: "Friday 2 October", value: undefined, text: "—" },
    { key: "2026-10-03", label: "Saturday 3 October", value: 3.5, text: "3.5" },
  ];
  const namedBy = (name: string): boolean =>
    ["group", "region", "img", "figure", "table"].some((role) => screen.queryByRole(role as Parameters<typeof screen.queryByRole>[0], { name }) !== null);

  return [
    layoutCheck("series widget renders its label as its accessible name", async (problems) => {
      const { container } = render(<Series {...base} groups={groups} skipped={0} />);
      if (!namedBy(base.label)) problems.push('The series widget must be reachable by its label as an accessible name (role="group", "region", "img", "figure" or a named table).');
      problems.push(...(await axeProblems(container, "series")));
    }),

    layoutCheck("series widget shows every group's label and text in the accessible tree", async (problems) => {
      const { container } = render(<Series {...base} groups={groups} skipped={1} partial={{ read: 3, total: 9 }} />);
      const text = container.textContent ?? "";
      for (const g of groups) {
        if (!text.includes(g.label)) problems.push(`Group "${g.key}" must show its label "${g.label}" as text — a chart of bars alone is decoration, not data.`);
        if (!text.includes(g.text)) problems.push(`Group "${g.key}" must show its formatted text "${g.text}" as text (the dash for a gap bucket counts).`);
      }
      if (!text.includes(base.measureLabel)) problems.push(`The series widget must show its measureLabel ("${base.measureLabel}") so a number can be read.`);
      problems.push(...(await axeProblems(container, "series with data")));
    }),

    layoutCheck("series widget survives empty groups and a value-less group", async (problems) => {
      // Two separate documents: one body holding both would let the second
      // render hide the first one's disappearance.
      cleanup();
      const { container } = render(<Series {...base} groups={[]} skipped={0} />);
      if (container.childElementCount === 0) {
        problems.push("With no groups the series widget must still render something (its label, or an empty-state), not unmount itself.");
      }
      cleanup();
      render(<Series {...base} groups={[{ key: "k", label: "Empty", value: undefined, text: "—" }]} skipped={4} />);
      const text = document.body.textContent ?? "";
      if (!text.includes("Empty") || !text.includes("—")) problems.push("A group whose value is undefined must still render its label and its dash text.");
    }),
  ];
}
