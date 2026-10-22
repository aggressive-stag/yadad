import { MEASURE_FIELD_TYPES, MEASURE_OPS } from "@yadad/core";
import type { DashboardView, EntityDocument, GridItem, Measure, MeasureOp, Registry, ViewDocument, ViewerCondition, ViewerDocument } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { addTab, addWidget, moveItem, removeTab, removeWidget, renameTab, resizeItem, uniqueItemId } from "./layout.js";
import type { NewWidget } from "./layout.js";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asText, choiceField, describeCondition, idFromTitle, propertyInput, toolbarStyle, warningList } from "./ui.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { useReportChange } from "./report-change.js";
import { measureFor, setCountWidgetFilter, setItemVisibleWhen, setStatMeasure, setTabVisibleWhen } from "./views.js";
import { ViewerRule } from "./viewer-rule.js";

export interface DashboardLayoutEditorProps {
  readonly dashboard: DashboardView;
  readonly registry: Registry<ReactNode>;
  /** Receives the edited dashboard with its revision bumped. */
  readonly onSave: (dashboard: DashboardView) => void;
  /** Receives the in-progress dashboard on each edit, undo or redo — the live preview and unsaved-JSON panel feed on this. */
  readonly onChange?: (dashboard: DashboardView) => void;
  readonly onCancel: () => void;
  /** A readable name for a view widget's view, e.g. its title. Defaults to the view id. */
  readonly describeView?: (viewId: string) => string;
  /** Views that can be added as widgets: forms and tables embed, tables can also be counted and summarised as a stat. */
  readonly views?: readonly ViewDocument[];
  /** The documents' entities, so a count widget's filter can be edited against its table's entity. */
  readonly entities?: ReadonlyMap<string, EntityDocument>;
  /** The set's viewer document: with it, each tab and widget can be shown only to some viewers (RFC 0006). */
  readonly viewer?: ViewerDocument;
}

/** One entry of the add-widget list, with the size it starts at. */
interface PaletteEntry {
  readonly label: string;
  readonly base: string;
  readonly widget: NewWidget;
  readonly w: number;
  readonly h: number;
}

function palette(views: readonly ViewDocument[], describeView: (viewId: string) => string, entities: ReadonlyMap<string, EntityDocument> | undefined): PaletteEntry[] {
  return views.flatMap((v): PaletteEntry[] => {
    if (v.kind === "form" || v.kind === "calendar" || v.kind === "board") return [{ label: describeView(v.id), base: v.id, widget: { widget: "view", view: v.id }, w: 6, h: 5 }];
    if (v.kind === "table") {
      return [
        { label: describeView(v.id), base: v.id, widget: { widget: "view", view: v.id }, w: 6, h: 5 },
        { label: `Count of ${describeView(v.id)}`, base: `${v.id}_count`, widget: { widget: "count", label: v.title ?? v.id, view: v.id }, w: 3, h: 2 },
        // A stat starts as the total of the first number field (or a count); the card's controls change it.
        {
          label: `Stat of ${describeView(v.id)}`,
          base: `${v.id}_stat`,
          widget: { widget: "stat", label: v.title ?? v.id, view: v.id, measure: (entities?.get(v.entity) && measureFor(entities.get(v.entity)!, "sum")) || { op: "count" } },
          w: 3,
          h: 2,
        },
      ];
    }
    return [];
  });
}

type Box = Pick<GridItem, "x" | "y" | "w" | "h">;

interface Drag {
  readonly itemId: string;
  readonly mode: "move" | "resize";
  readonly startX: number;
  readonly startY: number;
  /** One column (or row) step in pixels, gap included. */
  readonly cellW: number;
  readonly cellH: number;
  readonly from: Box;
  readonly preview: Box;
}

const DEFAULT_COLUMNS = 12;
const NO_SECOND_FIELD = "(none)";
const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function describeMeasure(m: Measure, label: (fieldId: string) => string): string {
  if (m.op === "count") return "the number of records";
  return "product" in m ? `${m.op} of ${label(m.product[0])} times ${label(m.product[1])}` : `${m.op} of ${label(m.field)}`;
}

/**
 * Rearranges a dashboard's grid. Drag a card to move it, drag its corner to
 * resize it, or use the keyboard: arrow keys move the focused card, Shift
 * with arrow keys resizes it. Overlapping or out-of-bounds layouts are
 * rejected by document validation, with the reason announced.
 */
export function DashboardLayoutEditor({ dashboard, registry, onSave, onChange, onCancel, describeView = (id) => id, views = [], entities, viewer }: DashboardLayoutEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<DashboardView>>(() => startSession(dashboard));
  useReportChange(session.current, onChange);
  const [selected, setSelected] = useState(dashboard.tabs[0]?.id ?? "");
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const [tabTitle, setTabTitle] = useState("");
  const [newTab, setNewTab] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const { Tabs, Panel, Button, ErrorSummary } = registry.layout;

  const current = session.current;
  const tab = current.tabs.find((t) => t.id === selected) ?? current.tabs[0];
  if (!tab) return null;
  const columns = tab.columns ?? DEFAULT_COLUMNS;
  const entries = palette(views, describeView, entities);
  const entry = entries.find((e) => e.label === choice) ?? entries[0];

  const name = (item: GridItem) => (item.widget === "count" ? `Count: ${item.label}` : item.widget === "stat" ? `Stat: ${item.label}` : describeView(item.view));
  const noun = (item: GridItem) => (item.widget === "stat" ? "stat" : "count");
  const Noun = (item: GridItem) => (item.widget === "stat" ? "Stat" : "Count");
  const where = (b: Box) => `column ${b.x + 1}, row ${b.y + 1}, ${b.w} wide, ${b.h} tall`;

  /** Applies a move or resize; says what happened or why it was refused. */
  const apply = (item: GridItem, to: Box) => {
    if (to.x === item.x && to.y === item.y && to.w === item.w && to.h === item.h) return;
    const patch = to.w !== item.w || to.h !== item.h ? resizeItem(current, tab.id, item.id, to.w, to.h) : moveItem(current, tab.id, item.id, to.x, to.y);
    const next = edit(session, patch);
    setSession(next);
    setStatus(next.rejected.length > 0 ? `Not moved: ${next.rejected[0]?.message ?? "invalid layout"}` : `${name(item)} is now at ${where(to)}.`);
  };

  /** Applies a tab or widget change and announces it, or why it was refused. */
  const change = (patch: PatchOperation[], done: string, onOk?: () => void): boolean => {
    const next = edit(session, patch);
    setSession(next);
    setStatus(next.rejected.length > 0 ? `Not changed: ${next.rejected[0]?.message ?? "invalid dashboard"}` : done);
    if (next.rejected.length === 0) onOk?.();
    return next.rejected.length === 0;
  };

  /** Sets a tab's or widget's viewer rule, saying what happened. */
  const setRule = (result: { ok: true; patch: PatchOperation[] } | { ok: false; error: { message: string } }, done: string): boolean => {
    if (!result.ok) return setStatus(`Not changed: ${result.error.message}`), false;
    return result.patch.length === 0 ? true : change(result.patch, done);
  };

  const remove = (item: GridItem) => change(removeWidget(current, tab.id, item.id), `Removed ${name(item)}.`);

  // A count widget's own filter: it narrows the widget's count without
  // touching the table it counts. Edited against the table's entity.
  // Item ids are unique per tab only, so the open filter also remembers its tab.
  const [rawCountFilter, setCountFilter] = useState<{ readonly tabId: string; readonly id: string; readonly draft: ConditionDraft | undefined } | undefined>(undefined);
  const countFilter = rawCountFilter?.tabId === tab.id ? rawCountFilter : undefined;
  const countEntityOf = (item: GridItem): EntityDocument | undefined => {
    if (item.widget !== "count" && item.widget !== "stat") return undefined;
    const view = views.find((v) => v.id === item.view);
    return view && view.kind === "table" ? entities?.get(view.entity) : undefined;
  };
  const openCountFilter = (item: GridItem) => {
    if (item.widget !== "count" && item.widget !== "stat") return;
    const entity = countEntityOf(item);
    if (!entity) return;
    setCountFilter((open) => (open && open.tabId === tab.id && open.id === item.id ? undefined : { tabId: tab.id, id: item.id, draft: draftFor(entity, item.filter) }));
  };
  const applyCountFilter = (item: GridItem) => {
    if ((item.widget !== "count" && item.widget !== "stat") || !countFilter || countFilter.id !== item.id) return;
    const entity = countEntityOf(item);
    if (!entity) return;
    const built = builtOf(countFilter.draft);
    if (JSON.stringify(built) === JSON.stringify(item.filter)) return;
    const result = setCountWidgetFilter(current, tab.id, item.id, built);
    if (!Array.isArray(result) && !result.ok) return;
    const patch = Array.isArray(result) ? result : result.patch;
    change(patch, built === undefined ? `${Noun(item)} filter cleared.` : `${Noun(item)} now matches: ${describeCondition(built, labelOf(entity))}.`, () => setCountFilter(undefined));
  };
  const removeCountFilter = (item: GridItem) => {
    if (item.widget !== "count" && item.widget !== "stat") return;
    const result = setCountWidgetFilter(current, tab.id, item.id, undefined);
    if (!Array.isArray(result) && !result.ok) return;
    const patch = Array.isArray(result) ? result : result.patch;
    change(patch, `${Noun(item)} filter cleared.`, () => setCountFilter(undefined));
  };
  const labelOf = (entity: EntityDocument) => (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;

  /** Op, field and (for sum and avg) a second field to multiply by. Each change patches the stat's measure. */
  const measureControls = (item: GridItem, entity: EntityDocument): ReactNode => {
    if (item.widget !== "stat") return null;
    const m = item.measure;
    const field = m.op === "count" ? undefined : "product" in m ? m.product[0] : m.field;
    const times = m.op !== "count" && "product" in m ? m.product[1] : undefined;
    const set = (op: MeasureOp, f: string | undefined, t: string | undefined) => {
      const next: Measure | undefined = measureFor(entity, op, f, t);
      if (!next) return setStatus(`Not changed: ${entity.id} has no ${MEASURE_FIELD_TYPES[op].join(" or ")} field for "${op}".`);
      const result = setStatMeasure(current, tab.id, item.id, next);
      if (!result.ok) return setStatus(`Not changed: ${result.error.message}`);
      change(result.patch, `${name(item)} now shows ${describeMeasure(next, labelOf(entity))}.`);
    };
    const pick = (id: string, label: string, choices: readonly string[], value: string | undefined, onChange: (v: string | undefined) => void) => (
      <span style={{ display: "block" }}>{propertyInput(registry, `${base}-${item.id}-${id}`, choiceField(`${base}-${item.id}-${id}`, label, choices), value, (v) => onChange(asText(v)))}</span>
    );
    const accepted = m.op === "count" ? [] : entity.fields.filter((f) => MEASURE_FIELD_TYPES[m.op].includes(f.type)).map((f) => f.id);
    const numbers = entity.fields.filter((f) => f.type === "number").map((f) => f.id);
    return (
      <>
        {pick("op", `Measure of ${item.label}`, MEASURE_OPS, m.op, (v) => v !== undefined && set(v as MeasureOp, field, times))}
        {m.op !== "count" && pick("field", `Field of ${item.label}`, accepted, field, (v) => set(m.op, v, times))}
        {(m.op === "sum" || m.op === "avg") && pick("times", `Times (optional) of ${item.label}`, [NO_SECOND_FIELD, ...numbers.filter((id) => id !== field)], times ?? NO_SECOND_FIELD, (v) => set(m.op, field, v === NO_SECOND_FIELD ? undefined : v))}
      </>
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: GridItem) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      return remove(item);
    }
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const [dx, dy] = step;
    apply(
      item,
      event.shiftKey
        ? { x: item.x, y: item.y, w: Math.max(1, Math.min(columns - item.x, item.w + dx)), h: Math.max(1, item.h + dy) }
        : { x: Math.max(0, Math.min(columns - item.w, item.x + dx)), y: Math.max(0, item.y + dy), w: item.w, h: item.h },
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, item: GridItem, mode: Drag["mode"]) => {
    const card = (event.currentTarget.closest("[data-yadad-editor-item]") as HTMLElement | null) ?? event.currentTarget;
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    card.setPointerCapture?.(event.pointerId);
    const style = getComputedStyle(grid);
    const rect = card.getBoundingClientRect();
    const colGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const from = { x: item.x, y: item.y, w: item.w, h: item.h };
    setDrag({
      itemId: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      cellW: (rect.width + colGap) / item.w,
      cellH: (rect.height + rowGap) / item.h,
      from,
      preview: from,
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dc = Math.round((event.clientX - drag.startX) / drag.cellW);
    const dr = Math.round((event.clientY - drag.startY) / drag.cellH);
    const f = drag.from;
    const preview =
      drag.mode === "move"
        ? { ...f, x: Math.max(0, Math.min(columns - f.w, f.x + dc)), y: Math.max(0, f.y + dr) }
        : { ...f, w: Math.max(1, Math.min(columns - f.x, f.w + dc)), h: Math.max(1, f.h + dr) };
    setDrag({ ...drag, preview });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const item = tab.items.find((i) => i.id === drag.itemId);
    setDrag(undefined);
    if (item) apply(item, drag.preview);
  };

  const helpId = `${base}-help`;
  const grid = (
    <div
      ref={gridRef}
      data-yadad-editor-grid={tab.id}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(undefined)}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: "var(--yadad-grid-row-height, 4rem)",
        gap: "var(--yadad-grid-gap, 1rem)",
        touchAction: "none",
      }}
    >
      {tab.items.map((item) => {
        const box = drag?.itemId === item.id ? drag.preview : item;
        return (
          <div
            key={item.id}
            data-yadad-editor-item={item.id}
            role="group"
            aria-label={`${name(item)}, ${where(item)}`}
            aria-describedby={helpId}
            tabIndex={0}
            onKeyDown={(e) => onKeyDown(e, item)}
            onPointerDown={(e) => onPointerDown(e, item, "move")}
            style={{
              gridColumn: `${box.x + 1} / span ${box.w}`,
              gridRow: `${box.y + 1} / span ${box.h}`,
              position: "relative",
              minWidth: 0,
              cursor: drag?.itemId === item.id ? "grabbing" : "grab",
              opacity: drag?.itemId === item.id ? 0.8 : 1,
              userSelect: "none",
            }}
          >
            <Panel title={name(item)}>
              <span data-yadad-editor-position="">{where(box)}</span>
              {/* Keep the button's press from starting a drag of the card. */}
              <span onPointerDown={(e) => e.stopPropagation()} style={{ display: "block", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  <Button label={`Remove ${name(item)}`} type="button" variant="secondary" disabled={false} onPress={() => remove(item)} />
                  {(item.widget === "count" || item.widget === "stat") && countEntityOf(item) !== undefined && (
                    <Button
                      label={item.filter !== undefined ? `Edit the ${noun(item)} filter of ${name(item)}` : `Filter the ${noun(item)} of ${name(item)}`}
                      type="button"
                      variant="secondary"
                      disabled={false}
                      onPress={() => openCountFilter(item)}
                    />
                  )}
                  {(item.widget === "count" || item.widget === "stat") && item.filter !== undefined && (
                    <Button label={`Remove the ${noun(item)} filter of ${name(item)}`} type="button" variant="secondary" disabled={false} onPress={() => removeCountFilter(item)} />
                  )}
                </span>
              </span>
              {viewer && (
                <span onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-yadad-item-viewer-rule="" style={{ display: "block", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  <ViewerRule
                    registry={registry}
                    viewer={viewer}
                    rule="Show"
                    target={name(item)}
                    condition={item.visibleWhen}
                    otherwise="Shown to everyone (hidden, the cell stays empty)"
                    onSet={(c: ViewerCondition | undefined) => setRule(setItemVisibleWhen(current, tab.id, item.id, c), c === undefined ? `${name(item)} is shown to everyone.` : `${name(item)} is shown by a viewer condition.`)}
                  />
                </span>
              )}
              {item.widget === "stat" && countEntityOf(item) !== undefined && (
                <span onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-yadad-stat-measure="" style={{ display: "block", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  {measureControls(item, countEntityOf(item)!)}
                </span>
              )}
              {(item.widget === "count" || item.widget === "stat") && item.filter !== undefined && countEntityOf(item) !== undefined && (
                <p style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  {Noun(item)} now matches: {describeCondition(item.filter, labelOf(countEntityOf(item)!))}.
                </p>
              )}
              {(item.widget === "count" || item.widget === "stat") && countFilter?.id === item.id && (
                <div data-yadad-count-filter-builder="" style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                  {(() => {
                    const entity = countEntityOf(item);
                    if (!entity) return <p>The table behind this {noun(item)} could not be found; its filter cannot be edited here.</p>;
                    return (
                      <>
                        <ConditionBuilder
                          id={`${base}-count-${item.id}`}
                          label={`the ${noun(item)}`}
                          registry={registry}
                          entity={entity}
                          draft={countFilter.draft}
                          onChange={(draft) => setCountFilter({ tabId: tab.id, id: item.id, draft })}
                          current={item.filter}
                          onReplace={() => setCountFilter({ tabId: tab.id, id: item.id, draft: draftFor(entity, undefined) })}
                        />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
                          <Button
                            label={`Apply the ${noun(item)} filter`}
                            type="button"
                            variant="primary"
                            disabled={builtOf(countFilter.draft) === undefined || JSON.stringify(builtOf(countFilter.draft)) === JSON.stringify(item.filter)}
                            onPress={() => applyCountFilter(item)}
                          />
                          <Button label={`Cancel the ${noun(item)} filter`} type="button" variant="secondary" disabled={false} onPress={() => setCountFilter(undefined)} />
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </Panel>
            <span
              data-yadad-editor-resize=""
              aria-hidden="true"
              onPointerDown={(e) => onPointerDown(e, item, "resize")}
              style={{ position: "absolute", right: 0, bottom: 0, width: "1.25rem", height: "1.25rem", cursor: "nwse-resize" }}
            >
              ◢
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div data-yadad-dashboard-editor={dashboard.id}>
      <p id={helpId}>Drag a card to move it, or its corner to resize it. With the keyboard: arrow keys move the focused card, Shift and arrow keys resize it, Delete removes it.</p>
      <div data-yadad-editor-toolbar="" style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockEnd: "var(--yadad-toolbar-gap, 0.5rem)" }}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save layout" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {session.rejected.length > 0 && <ErrorSummary errors={session.rejected} />}
      {warningList(current)}
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        {entries.length > 0 && (
          <>
            {propertyInput(registry, `${base}-widget`, choiceField("widget", "Widget to add", entries.map((e) => e.label)), entry?.label, (v) => setChoice(asText(v)))}
            <Button
              label={`Add to ${tab.title}`}
              type="button"
              variant="primary"
              disabled={!entry}
              onPress={() => entry && change(addWidget(current, tab.id, uniqueItemId(current, tab.id, entry.base), entry.widget, entry.w, entry.h), `Added ${entry.label} to ${tab.title}.`)}
            />
          </>
        )}
        {propertyInput(registry, `${base}-tab-title`, { id: "tab_title", type: "text", label: "Tab title" }, tabTitle || tab.title, (v) => setTabTitle(asText(v)))}
        <Button
          label="Rename tab"
          type="button"
          variant="secondary"
          disabled={tabTitle.trim() === "" || tabTitle.trim() === tab.title}
          onPress={() => change(renameTab(current, tab.id, tabTitle.trim()), `Renamed the tab to ${tabTitle.trim()}.`, () => setTabTitle(""))}
        />
        <Button label="Remove tab" type="button" variant="secondary" disabled={current.tabs.length === 1} onPress={() => change(removeTab(current, tab.id), `Removed the ${tab.title} tab.`)} />
        {propertyInput(registry, `${base}-new-tab`, { id: "new_tab", type: "text", label: "New tab title" }, newTab, (v) => setNewTab(asText(v)))}
        <Button
          label="Add tab"
          type="button"
          variant="secondary"
          disabled={newTab.trim() === ""}
          onPress={() => {
            const id = idFromTitle(newTab, current.tabs.map((t) => t.id), "tab");
            change(addTab(current, id, newTab.trim()), `Added the ${newTab.trim()} tab.`, () => {
              setNewTab("");
              setSelected(id);
            });
          }}
        />
      </div>
      {viewer && (
        <div data-yadad-tab-viewer-rule="">
          <ViewerRule
            registry={registry}
            viewer={viewer}
            rule="List tab"
            target={tab.title}
            condition={tab.visibleWhen}
            otherwise={`The ${tab.title} tab is listed for everyone`}
            onSet={(c: ViewerCondition | undefined) => setRule(setTabVisibleWhen(current, tab.id, c), c === undefined ? `The ${tab.title} tab is listed for everyone.` : `The ${tab.title} tab is listed by a viewer condition.`)}
          />
        </div>
      )}
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
      <Tabs label={`Edit ${dashboard.title ?? dashboard.id}`} tabs={current.tabs.map((t) => ({ id: t.id, title: t.title }))} selected={tab.id} onSelect={(id) => {
          setSelected(id);
          setTabTitle("");
        }} panel={grid} />
    </div>
  );
}
