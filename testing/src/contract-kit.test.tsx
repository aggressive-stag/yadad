// @vitest-environment jsdom
import type { InputProps, Registry, TextField } from "@yadad/core";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { describeRegistryContract, registryContractChecks } from "./contract-kit.js";
import { mockRegistry } from "./mock-registry.js";

// The mock registry must pass its own kit.
describeRegistryContract(mockRegistry);

/** Runs every check and returns the failing check names. */
async function failing(registry: Registry<ReactNode>): Promise<string[]> {
  const failed: string[] = [];
  for (const check of registryContractChecks(registry)) {
    if ((await check.run()).length > 0) failed.push(check.name);
  }
  return failed;
}

const withInput = (Input: (props: InputProps<TextField, string>) => ReactNode): Registry<ReactNode> => ({
  ...mockRegistry,
  fields: { ...mockRegistry.fields, text: { ...mockRegistry.fields.text, Input } },
});

describe("the kit catches broken components", () => {
  test("a board and a calendar that drop the done checkbox", async () => {
    const MockBoard = mockRegistry.layout.Board!;
    const MockCalendar = mockRegistry.layout.Calendar!;
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Board: (props) => <MockBoard {...props} columns={props.columns.map((c) => ({ ...c, cards: c.cards.map(({ done: _done, ...card }) => card) }))} />,
        Calendar: (props) => <MockCalendar {...props} days={props.days.map((d) => ({ ...d, entries: d.entries.map(({ done: _done, ...entry }) => entry) }))} />,
      },
    };
    expect(await failing(registry)).toEqual([
      "layout: Calendar renders a labelled checkbox per entry that has a done toggle and calls toggle once",
      "layout: Board renders a labelled checkbox per card that has a done toggle and calls toggle once",
    ]);
  });

  test("tabs that only work with a mouse", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Tabs: ({ label, tabs, selected, onSelect, panel }) => (
          <div>
            <div role="tablist" aria-label={label}>
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" id={`t-${t.id}`} aria-selected={t.id === selected} onClick={() => onSelect(t.id)}>
                  {t.title}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-labelledby={`t-${selected}`}>
              {panel}
            </div>
          </div>
        ),
      },
    };
    expect(await failing(registry)).toEqual(["layout: Tabs follow the WAI-ARIA tabs pattern"]);
    const check = registryContractChecks(registry).find((c) => c.name.startsWith("layout: Tabs"))!;
    expect(await check.run()).toEqual(expect.arrayContaining(["ArrowRight must select the next tab.", "Only the selected tab may be in the tab order (roving tabindex)."]));
  });

  test("a table without sortable header buttons or header ids", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Table: ({ caption, columns, rows }) => (
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.id}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {r.cells.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      },
    };
    expect(await failing(registry)).toEqual([
      "layout: Table is named by its caption, with sortable headers and rows",
      // makeRows seeds row actions; this fake table renders none of them.
      "actions: buttons are named by their labels, disabled while pending, and fire onPress otherwise",
    ]);
    const problems = await registryContractChecks(registry).find((c) => c.name.startsWith("layout: Table"))!.run();
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('id="kit-col-day"'), expect.stringContaining("button to sort"), expect.stringContaining("empty content")]),
    );
  });

  test("an input that ignores inputId", async () => {
    const registry = withInput(({ value, onChange }) => (
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
    ));
    expect(await failing(registry)).toEqual(
      expect.arrayContaining(["text: renders a control labelled by FieldFrame", "text: passes axe (valid and invalid)"]),
    );
  });

  test("an input that emits an empty string instead of undefined", async () => {
    const registry = withInput(({ inputId, value, onChange, invalid, describedBy, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(["text: emits undefined when cleared"]);
  });

  test("an input that ignores invalid", async () => {
    const registry = withInput(({ inputId, value, onChange, describedBy, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} aria-describedby={describedBy} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(['text: sets aria-invalid="true" when invalid']);
  });

  test("an input that does not link its errors", async () => {
    const registry = withInput(({ inputId, value, onChange, invalid, labelledBy }) => (
      <input id={inputId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} aria-invalid={invalid} aria-labelledby={labelledBy} />
    ));
    expect(await failing(registry)).toEqual(["text: links its errors with aria-describedby"]);
  });

  test("a checkbox that emits undefined instead of false when unticked", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      fields: {
        ...mockRegistry.fields,
        boolean: {
          ...mockRegistry.fields.boolean,
          Input: ({ inputId, value, onChange, invalid, describedBy, labelledBy }) => (
            <input id={inputId} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} aria-invalid={invalid} aria-describedby={describedBy} aria-labelledby={labelledBy} />
          ),
        },
      },
    };
    expect(await failing(registry)).toEqual(["boolean: emits false when cleared"]);
  });

  test("a field frame without a label or errors", async () => {
    const registry: Registry<ReactNode> = { ...mockRegistry, layout: { ...mockRegistry.layout, FieldFrame: ({ children }) => <div>{children}</div> } };
    expect(await failing(registry)).toEqual(
      expect.arrayContaining([
        "text: renders a control labelled by FieldFrame",
        "text: links its errors with aria-describedby",
        "text: passes axe (valid and invalid)",
      ]),
    );
  });
});

describe("the kit's calendar checks", () => {
  const calendarChecks = () => registryContractChecks(mockRegistry).filter((c) => c.name.startsWith("layout: Calendar"));
  const run = async (registry: Registry<ReactNode>, name: string) => (await registryContractChecks(registry).find((c) => c.name.startsWith(name))!.run());

  test("a registry without a calendar has no calendar checks", () => {
    const { Calendar: _calendar, ...layout } = mockRegistry.layout;
    expect(registryContractChecks({ ...mockRegistry, layout }).filter((c) => c.name.startsWith("layout: Calendar"))).toEqual([]);
    expect(calendarChecks().length).toBeGreaterThan(0);
  });

  test("a calendar whose days are not named by their date", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: { ...mockRegistry.layout, Calendar: (props) => <div>{props.days.map((d) => <div key={d.date}>{d.dayOfMonth}</div>)}</div> },
    };
    expect(await run(registry, "layout: Calendar is a named grid")).toEqual(expect.arrayContaining([expect.stringContaining('role="grid"'), expect.stringContaining("gridcell")]));
  });

  test("a calendar that never offers Move to day…", async () => {
    const Calendar = mockRegistry.layout.Calendar!;
    const registry: Registry<ReactNode> = { ...mockRegistry, layout: { ...mockRegistry.layout, Calendar: ({ onMove: _onMove, ...props }) => Calendar(props) } };
    expect(await run(registry, "layout: Calendar offers Move to day")).toEqual(expect.arrayContaining([expect.stringContaining("Move to day")]));
  });
});

describe("the kit's board checks find the board by role and name", () => {
  const run = async (registry: Registry<ReactNode>) => (await registryContractChecks(registry).find((c) => c.name.startsWith("layout: Board is a group"))!.run());
  const Board = mockRegistry.layout.Board!;
  const withBoard = (Replacement: NonNullable<Registry<ReactNode>["layout"]["Board"]>): Registry<ReactNode> => ({ ...mockRegistry, layout: { ...mockRegistry.layout, Board: Replacement } });

  test("a board with no test ids passes, whether its columns are groups or regions", async () => {
    const stripped = (Tag: "div" | "section", role?: "group") =>
      withBoard((props) => (
        <div role="group" aria-label={props.label}>
          {props.columns.map((c) => (
            <Tag key={c.id} role={role} aria-label={`${c.label}, ${c.count} cards`}>
              <ul>{c.cards.map((card) => <li key={card.id}>{card.content}</li>)}</ul>
            </Tag>
          ))}
        </div>
      ));
    expect(await run(stripped("div", "group"))).toEqual([]);
    expect(await run(stripped("section"))).toEqual([]);
  });

  test("a board with the test ids but unnamed columns fails", async () => {
    const problems = await run(
      withBoard((props) => (
        <div role="group" aria-label={props.label} data-testid="board">
          {props.columns.map((c) => (
            <div key={c.id} data-testid={`column-${c.id}`}>
              <ul>{c.cards.map((card) => <li key={card.id}>{card.content}</li>)}</ul>
            </div>
          ))}
        </div>
      )),
    );
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('"Home, 1 cards"')]));
  });

  test("a board that is not named by its label fails", async () => {
    const problems = await run(withBoard((props) => <div data-testid="board">{Board(props)}</div>));
    expect(problems).toEqual([]);
    const unnamed = await run(withBoard((props) => <div>{props.columns.map((c) => <section key={c.id} aria-label={`${c.label}, ${c.count} cards`} />)}</div>));
    expect(unnamed).toEqual(expect.arrayContaining([expect.stringContaining("named by its label")]));
  });
});

describe("the kit's RFC 0007 checks (dialog, datetime, diff, row actions)", () => {
  const run = async (registry: Registry<ReactNode>, name: string) => (await registryContractChecks(registry).find((c) => c.name.startsWith(name))!.run());

  test("a registry without datetime or Dialog has no checks for them", () => {
    const { datetime: _datetime, ...fields } = mockRegistry.fields;
    const { Dialog: _dialog, ...layout } = mockRegistry.layout;
    const stripped: Registry<ReactNode> = { ...mockRegistry, fields, layout };
    expect(registryContractChecks(stripped).filter((c) => c.name.startsWith("datetime:"))).toEqual([]);
    expect(registryContractChecks(stripped).filter((c) => c.name.startsWith("layout: Dialog"))).toEqual([]);
    expect(registryContractChecks(mockRegistry).filter((c) => c.name.startsWith("datetime:")).length).toBeGreaterThan(0);
    expect(registryContractChecks(mockRegistry).filter((c) => c.name.startsWith("layout: Dialog")).length).toBeGreaterThan(0);
    // The mock passes all of them (describeRegistryContract registers the pass case).
    expect(registryContractChecks(mockRegistry).filter((c) => c.name.startsWith("actions:")).length).toBe(1);
  });

  test("a datetime Display that shows the raw instant fails", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      fields: { ...mockRegistry.fields, datetime: { type: "datetime", Input: mockRegistry.fields.datetime!.Input, Display: ({ value }) => <time>{value ?? ""}</time> } },
    };
    const found = await run(registry, "datetime:");
    // A <time> without the machine-readable attribute, showing the raw instant instead of the text prop.
    expect(found).toEqual(expect.arrayContaining([expect.stringContaining("formatted text prop"), expect.stringContaining("dateTime")]));
  });

  test("a Dialog that never takes or returns focus fails", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: { ...mockRegistry.layout, Dialog: ({ label, children }) => <div role="dialog" aria-modal="true" aria-label={label}>{children}</div> },
    };
    const found = await run(registry, "layout: Dialog");
    expect(found).toEqual(expect.arrayContaining([expect.stringContaining("move focus into the dialog"), expect.stringContaining("Escape must call onClose")]));
  });

  test("a text Display that flattens the diff fails", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      fields: { ...mockRegistry.fields, text: { ...mockRegistry.fields.text, Display: ({ value }) => <span>{value ?? ""}</span> } },
    };
    const found = await run(registry, "text: marks a diff");
    expect(found).toEqual(expect.arrayContaining([expect.stringContaining("<ins>"), expect.stringContaining("<del>")]));
  });

  test("row action buttons that ignore pending fail", async () => {
    const registry: Registry<ReactNode> = {
      ...mockRegistry,
      layout: {
        ...mockRegistry.layout,
        Table: ({ caption, columns, rows }) => (
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.id} id={c.headerId}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {r.cells.map((cell, i) => (<td key={i}>{cell}</td>))}
                  {(r.actions ?? []).map((a) => (
                    <td key={a.id}>
                      <button type="button" onClick={a.onPress}>{a.label}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ),
      },
    };
    const found = await run(registry, "actions:");
    expect(found).toEqual(
      expect.arrayContaining([expect.stringContaining("disabled"), expect.stringContaining("must not fire onPress"), expect.stringContaining("actionsLabel")]),
    );
  });
});

describe("the kit's series checks", () => {
  const run = async (registry: Registry<ReactNode>, name: string) => (await registryContractChecks(registry).find((c) => c.name.startsWith(name))!.run());
  const withSeries = (Replacement: NonNullable<Registry<ReactNode>["widgets"]["series"]>): Registry<ReactNode> => ({ ...mockRegistry, widgets: { ...mockRegistry.widgets, series: Replacement } });

  test("a registry without a series has no series checks", () => {
    const { series: _series, ...widgets } = mockRegistry.widgets;
    expect(registryContractChecks({ ...mockRegistry, widgets }).filter((c) => c.name.includes("series widget"))).toEqual([]);
    expect(registryContractChecks(mockRegistry).filter((c) => c.name.includes("series widget")).length).toBeGreaterThan(0);
  });

  test("a chart of bars with no text fails every series check", async () => {
    // An SVG-only chart: nothing in the accessible tree names it, no group label
    // or value is text. This is the failure mode the checks exist to catch.
    const registry = withSeries(({ groups }) => (
      <svg data-testid="series" role="img">
        {groups.map((g) => (
          <rect key={g.key} width={g.value ?? 0} height={10} />
        ))}
      </svg>
    ));
    expect(await run(registry, "layout: series widget renders its label")).toEqual(expect.arrayContaining([expect.stringContaining("accessible name")]));
    const missing = await run(registry, "layout: series widget shows every group");
    expect(missing).toEqual(expect.arrayContaining([expect.stringContaining("Thursday 1 October"), expect.stringContaining("Sum of sets")]));
    expect(missing).toEqual(expect.arrayContaining([expect.stringContaining("12"), expect.stringContaining("3.5")]));
  });

  test("a series that unmounts itself when there is nothing to draw fails", async () => {
    const registry = withSeries(({ groups }) => (groups.length === 0 ? null : <div role="group" aria-label="x">{groups.map((g) => <span key={g.key}>{g.label} {g.text}</span>)}</div>));
    expect(await run(registry, "layout: series widget survives empty groups")).toEqual([expect.stringContaining("not unmount itself")]);
  });
});
