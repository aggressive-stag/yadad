// @vitest-environment jsdom
// The focus contract kit, run by its first host: the table renderer over the
// mock registry (everyday DOM), over two stub registries that exercise the
// capability gates, and over an inert host that never restores focus — the
// negative control. Like the action scenarios, the kit never imports a
// renderer; this file is the one line of host wiring.
import { mockRegistry } from "@yadad/testing";
import { focusContractChecks } from "@yadad/testing/focus-kit";
import type { FocusContractContext } from "@yadad/testing/focus-kit";
import type { Registry, RecordActionItem, RecordValues, TableProps, ButtonProps, ErrorSummaryProps } from "@yadad/core";
import { describe, expect, test } from "vitest";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { TableRenderer } from "./table-renderer.js";

// (The jsdom drop-to-body shim lives in the kit itself — focusContractChecks
// runs every check under withJsdomRemovalShim; the host file must not need it.)

/** The one line of host wiring: mount the view. Every record mounted twice (two views), which is also what shape 4 needs. */
const mountTable = (registry: Registry<ReactNode>) => (context: FocusContractContext): ReactNode => (
  <>
    <TableRenderer entity={context.entity} view={context.view} registry={registry} dataSources={new Map([["default", context.adapter]])} />
    <TableRenderer entity={context.entity} view={context.view} registry={registry} dataSources={new Map([["default", context.adapter]])} />
  </>
);

// ---------------------------------------------------------------------------
// Stub registries: the two capability shapes the mock registry cannot show.
// Deliberately partial — the focus contract only ever presses table controls,
// so the fields/widgets keys are empty and cast whole (a full registry is
// mockRegistry's job).
// ---------------------------------------------------------------------------

interface StubRow {
  readonly id: string;
  readonly cells: readonly ReactNode[];
  readonly actions?: readonly RecordActionItem[];
  /** Same actions, marked as pressed from inside the closing panel (the PanelHost uses these). */
  readonly panelActions?: readonly RecordActionItem[];
  /** Set by the consumer only: this row's press must remove its control (the negative control's inert host). */
  readonly inert?: boolean;
}

/** A panel host shaped like the component set's menus: a trigger that shares a token with its panel; the press closes the panel; with `restore` the trigger is refocused after the close. */
function PanelHost({ row, token, restore }: { row: StubRow; token: string; restore: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  });
  const close = (): void => {
    refocus.current = restore;
    setOpen(false);
  };
  return (
    <>
      <button ref={trigger} type="button" data-yadad-focus-return={token} onClick={() => setOpen(true)}>
        Actions…
      </button>
      {open && (
        <div role="menu" data-yadad-focus-return={token}>
          {(row.panelActions ?? row.actions)?.map((a) => (
            <button key={a.id} type="button" disabled={a.pending} onClick={() => { a.onPress(); close(); }}>
              {a.label}
            </button>
          ))}
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

function stubTable(props: TableProps<ReactNode>, opts: { panel: boolean; restore: boolean }): ReactNode {
  const rows = props.rows as unknown as readonly StubRow[];
  return (
    <table>
      <caption>{props.caption}</caption>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td>{props.empty}</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              <td>
                <span hidden data-yadad-record={row.id} data-yadad-record-view={props.caption} />
                {row.cells.map((cell, i) => (
                  <span key={i}>{cell}</span>
                ))}
              </td>
              <td>
                {opts.panel ? (
                  row.actions !== undefined && row.actions.length > 0 ? (
                    <>
                      {/* A host may offer both: quick actions inline (shapes 1/4/5/timing press
                          these) and the same actions in a closing panel (shapes 2/3 press those). */}
                      {row.actions.map((a) => (
                        <button key={a.id} type="button" disabled={a.pending} onClick={a.onPress}>
                          {a.label}
                        </button>
                      ))}
                      <PanelHost row={row} token={`${props.caption}:${row.id}`} restore={opts.restore} />
                    </>
                  ) : null
                ) : (
                  row.inert === true && row.actions !== undefined && row.actions.length > 0 ? (
                    <InertRow cells={row.cells} actions={row.actions} />
                  ) : (
                    row.actions?.map((a) => (
                      <button key={a.id} type="button" disabled={a.pending} onClick={a.onPress}>
                        {a.label}
                      </button>
                    ))
                  )
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const stubRegistry = (opts: { panel: boolean; restore: boolean }): Registry<ReactNode> => {
  const layout: Registry<ReactNode>["layout"] = {
    FieldFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Section: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Button: ({ label, onPress, disabled }: ButtonProps) => <button type="button" disabled={disabled} onClick={onPress}>{label}</button>,
    Table: (props: TableProps<ReactNode>) => stubTable(props, opts),
    ErrorSummary: ({ errors }: ErrorSummaryProps) => <div role="alert">{errors.map((e) => e.message).join("; ")}</div>,
    Tabs: () => null,
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    // No Dialog key: the stub hosts cannot open the confirm dialog, so the dialog shape must gate to zero checks, not fail.
  };
  // TableRenderer renders every cell through registry.fields[type].Display — an
  // empty fields map crashes the mount (the error boundary then draws its
  // fallback and the seeded rows never appear). Text + number are all the kit's
  // document uses (tag, pos); anything else is a loud stub.
  const TextDisplay = ({ value }: { field: unknown; value: string | undefined }) => <>{value ?? ""}</>;
  const NumberDisplay = ({ value }: { field: unknown; value: number | undefined }) => <>{value === undefined ? "" : String(value)}</>;
  const fields = {
    text: { Display: TextDisplay, Input: () => null },
    number: { Display: NumberDisplay, Input: () => null },
  } as unknown as Registry<ReactNode>["fields"];
  return { fields, layout, widgets: { count: () => null } } as unknown as Registry<ReactNode>;
};

/** The inert host's row: the press removes the focused control synchronously (what a rebuild does in the browser), and nothing restores focus. Under the removeChild shim that is the drop-to-body; a host that merely does nothing keeps focus by jsdom grace and must NOT count as a failure. */
function InertRow({ cells, actions }: { cells: readonly ReactNode[]; actions: readonly RecordActionItem[] }): ReactNode {
  return (
    <>
      {cells.map((cell, i) => (
        <span key={i}>{cell}</span>
      ))}
      {actions.map((a) => (
        <button key={a.id} type="button" onClick={(e) => { a.onPress(); e.currentTarget.remove(); }}>
          {a.label}
        </button>
      ))}
    </>
  );
}

/**
 * The stub hosts' Table mount: rendered straight from the registry (no TableRenderer — the
 * renderer refuses a dialog-less host whose action needs a dialog, by design). This is a
 * minimal honest consumer: it holds the records in state, runs presses through the kit's
 * adapter, redraws, and (when `restore`) puts focus back on the pressing record's control
 * after a rebuild — which is exactly the property the contract checks, so a restoring host
 * must pass and an inert one (no restore, removal drops focus) must fail.
 */
function StubConsumer({ registry, context, caption, restore, inert, panel }: { registry: Registry<ReactNode>; context: FocusContractContext; caption: string; restore: boolean; inert: boolean; panel: boolean }): ReactNode {
  const [records, setRecords] = useState(context.records);
  const lastPress = useRef<{ recordId: string; label: string; fromPanel: boolean } | null>(null);
  const redraw = async (): Promise<void> => {
    const page = await context.adapter.find(FOCUS_ENTITY_ID, {});
    setRecords(page.items);
  };
  useEffect(() => {
    if (lastPress.current !== null) {
      const { label, fromPanel } = lastPress.current;
      lastPress.current = null;
      // A press from inside the panel belongs to the PanelHost (it refocuses the
      // trigger) — the consumer must not race it. A DIRECT press is the consumer's
      // own responsibility, panel host or not.
      if (restore && (!panel || !fromPanel)) {
        // Focus back on the pressing record's control with the same label, wherever it now lives.
        const scope = document.querySelector<HTMLElement>(`[data-yadad-record-view="${CSS.escape(caption)}"]`)?.closest("table") ?? null;
        const buttons = scope === null ? [] : [...scope.querySelectorAll<HTMLButtonElement>("button")];
        const again = buttons.find((b) => (b.textContent ?? "").trim() === label);
        (again ?? buttons[0])?.focus();
      }
    }
  });
  const actions = (r: (typeof records)[number]): RecordActionItem[] => {
    const run = (action: "publish" | "archive", label: string, fromPanel: boolean, input?: RecordValues): void => {
      lastPress.current = { recordId: r.id, label, fromPanel };
      const fresh = records.find((x) => x.id === r.id) ?? r;
      const meta = { entityRevision: fresh.entityRevision, baseVersion: fresh.version };
      void context.adapter.act!(FOCUS_ENTITY_ID, r.id, action, input === undefined ? { meta } : { input, meta }).then(redraw);
    };
    const pair = (fromPanel: boolean): RecordActionItem[] => [
      { id: "publish", label: "Publish", tone: "neutral", pending: false, onPress: () => run("publish", "Publish", fromPanel) },
      { id: "archive", label: "Archive", tone: "danger", pending: false, onPress: () => run("archive", "Archive", fromPanel, { reason: "kit" }) },
    ];
    return pair(false);
  };
  const panelActions = (r: (typeof records)[number]): RecordActionItem[] => {
    const run = (action: "publish" | "archive", label: string): void => {
      lastPress.current = { recordId: r.id, label, fromPanel: true };
      const fresh = records.find((x) => x.id === r.id) ?? r;
      const meta = { entityRevision: fresh.entityRevision, baseVersion: fresh.version };
      void context.adapter.act!(FOCUS_ENTITY_ID, r.id, action, action === "archive" ? { input: { reason: "kit" }, meta } : { meta }).then(redraw);
    };
    return [
      { id: "publish", label: "Publish", tone: "neutral", pending: false, onPress: () => run("publish", "Publish") },
      { id: "archive", label: "Archive", tone: "danger", pending: false, onPress: () => run("archive", "Archive") },
    ];
  };
  const tables = (): ReactElement =>
    registry.layout.Table({
      caption,
      columns: [{ id: "tag", headerId: "stub-tag", label: "Tag", sortable: false }],
      rows: records.map((r) => ({ id: r.id, cells: [String(r.values["tag"] ?? "")] as ReactNode[], actions: actions(r), panelActions: panelActions(r), inert })),
      onSort: () => undefined,
      empty: "",
      actionsLabel: "Actions",
    }) as ReactElement;
  return <div>{tables()}</div>;
}

const FOCUS_ENTITY_ID = "kitfocus";

const stubMount = (registry: Registry<ReactNode>, opts: { inert: boolean; restore?: boolean; panel?: boolean }) => (context: FocusContractContext): ReactNode => (
  <div>
    <StubConsumer key="stub-a" registry={registry} context={context} caption="stub-a" restore={opts.restore ?? true} inert={opts.inert} panel={opts.panel ?? false} />
    <StubConsumer key="stub-b" registry={registry} context={context} caption="stub-b" restore={opts.restore ?? true} inert={opts.inert} panel={opts.panel ?? false} />
  </div>
);

// ---------------------------------------------------------------------------
// The contract, per host. Registered via focusContractChecks (not
// describeFocusContract) so the describe block carries which host it is —
// three hosts run the same checks and a bare name cannot tell them apart.
// ---------------------------------------------------------------------------

function describeHost(label: string, registry: Registry<ReactNode>, mount?: (context: FocusContractContext) => ReactNode): void {
  const hostMount = mount ?? mountTable(registry);
  describe(`${label} — yadad record-action focus contract`, () => {
    for (const check of focusContractChecks({ registry, mount: hostMount })) {
      test(check.name, async () => expect(await check.run()).toEqual([]), 30_000);
    }
  });
}

describeHost("mock", mockRegistry);
describeHost("stub-nopanel", stubRegistry({ panel: false, restore: true }), stubMount(stubRegistry({ panel: false, restore: true }), { inert: false }));
describeHost("stub-panel", stubRegistry({ panel: true, restore: true }), stubMount(stubRegistry({ panel: true, restore: true }), { inert: false, panel: true }));

// ---------------------------------------------------------------------------
// Capability gates (Do step 4): a stripped registry yields ZERO panel/dialog
// checks, never a false failure; a full one yields them.
// ---------------------------------------------------------------------------

describe("focus contract capability gates", () => {
  test("a registry with no panel and no Dialog gets zero panel and zero dialog checks", () => {
    const checks = focusContractChecks({ registry: stubRegistry({ panel: false, restore: true }), mount: stubMount(stubRegistry({ panel: false, restore: true }), { inert: false }) });
    expect(checks.filter((c) => c.name.includes("panel"))).toEqual([]);
    expect(checks.filter((c) => c.name.includes("dialog"))).toEqual([]);
    expect(checks.length).toBe(6); // self-test, direct, view-scoped, id-changing move, timing pair
  });

  test("a panel host gets the panel shape", () => {
    const checks = focusContractChecks({ registry: stubRegistry({ panel: true, restore: true }), mount: stubMount(stubRegistry({ panel: true, restore: true }), { inert: false, panel: true }) });
    expect(checks.filter((c) => c.name.includes("panel action")).length).toBe(1);
    expect(checks.length).toBe(7);
  });

  test("capabilities overrides replace the probe: a panel-capable registry can state panel:false and lose the checks", () => {
    const checks = focusContractChecks({ registry: stubRegistry({ panel: true, restore: true }), mount: stubMount(stubRegistry({ panel: true, restore: true }), { inert: false, panel: true }), capabilities: { panel: false } });
    expect(checks.filter((c) => c.name.includes("panel"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Negative control: with the focus return removed (the inert host never
// restores focus), the checks MUST go red — the harness detects the bug it
// exists to catch, instead of only ever seeing passing hosts.
// ---------------------------------------------------------------------------

describe("focus contract negative control (inert host)", () => {
  const inert = stubRegistry({ panel: false, restore: false });
  const panelInert = stubRegistry({ panel: true, restore: false });

  test("every shape check reports problems against a host that never restores focus, except the harness self-test", async () => {
    const checks = focusContractChecks({ registry: inert, mount: stubMount(inert, { inert: true, restore: false }) });
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      const problems = await check.run();
      if (check.name.includes("focus harness")) {
        expect(problems, `${check.name}: the self-test must pass — it tests the kit itself`).toEqual([]);
      } else if (check.name.includes("no-steal")) {
        // A host that never restores focus also never STEALS it: no-steal is
        // unfailable by an inert host by construction (only a restoring host
        // can pull focus back). Asserting a failure here would demand the
        // inert host do something — which is the opposite of inert.
        expect(problems, `${check.name}: the inert host cannot steal focus it never manages`).toEqual([]);
      } else {
        expect(problems.length, `${check.name}: the inert host must fail this check`).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  test("an inert panel host fails the panel shape (the kit reads the trigger, not luck)", async () => {
    const checks = focusContractChecks({ registry: panelInert, mount: stubMount(panelInert, { inert: true, restore: false, panel: true }) });
    const panel = checks.find((c) => c.name.includes("panel action"));
    expect(panel).toBeDefined();
    expect((await panel!.run()).length).toBeGreaterThan(0);
  }, 30_000);
});
