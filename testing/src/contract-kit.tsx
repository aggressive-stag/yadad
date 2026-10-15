// Contract test kit (ARCHITECTURE.md §12), imported as "@yadad/testing/contract-kit"
// so the main entry (the mock registry) stays free of test-runner code. The
// components repo runs it against every registry; engine CI runs it against
// the mock registry. Needs a DOM: call it from a test file with
// `// @vitest-environment jsdom`.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FIELD_TYPES } from "@yadad/core";
import type { CalendarDayProps, CalendarProps, DocumentError, FieldDefinitions, DisplayProps, FieldDisplayExtras, FieldDisplayProps, FieldInputExtras, FieldInputProps, InputProps, FieldType, FieldValueTypes, Registry } from "@yadad/core";
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

export type FieldSamples = { readonly [K in FieldType]: FieldSample<K> };

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

const drivers: { readonly [K in FieldType]: Driver<FieldValueTypes[K]> } = {
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
  return [...FIELD_TYPES.flatMap((type) => checksFor(type, registry, samples)), ...layoutChecks(registry), ...calendarChecks(registry)];
}

function checksFor<K extends FieldType>(type: K, registry: Registry<ReactNode>, samples: FieldSamples): ContractCheck[] {
  return fieldChecks(type, registry, samples[type], drivers[type]);
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

function fieldChecks<K extends FieldType>(
  type: K,
  registry: Registry<ReactNode>,
  sample: FieldSample<K>,
  driver: Driver<FieldValueTypes[K]>,
): ContractCheck[] {
  const entry = registry.fields[type];
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
