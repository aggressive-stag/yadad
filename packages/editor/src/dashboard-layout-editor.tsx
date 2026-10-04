import type { DashboardView, GridItem, Registry } from "@yadad/core";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { moveItem, resizeItem } from "./layout";
import { edit, finish, isDirty, redo, startSession, undo } from "./session";
import type { EditSession } from "./session";

export interface DashboardLayoutEditorProps {
  readonly dashboard: DashboardView;
  readonly registry: Registry<ReactNode>;
  /** Receives the edited dashboard with its revision bumped. */
  readonly onSave: (dashboard: DashboardView) => void;
  readonly onCancel: () => void;
  /** A readable name for a view widget's view, e.g. its title. Defaults to the view id. */
  readonly describeView?: (viewId: string) => string;
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
const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * Rearranges a dashboard's grid. Drag a card to move it, drag its corner to
 * resize it, or use the keyboard: arrow keys move the focused card, Shift
 * with arrow keys resizes it. Overlapping or out-of-bounds layouts are
 * rejected by document validation, with the reason announced.
 */
export function DashboardLayoutEditor({ dashboard, registry, onSave, onCancel, describeView = (id) => id }: DashboardLayoutEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<DashboardView>>(() => startSession(dashboard));
  const [selected, setSelected] = useState(dashboard.tabs[0]?.id ?? "");
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [status, setStatus] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const { Tabs, Panel, Button, ErrorSummary } = registry.layout;

  const current = session.current;
  const tab = current.tabs.find((t) => t.id === selected) ?? current.tabs[0];
  if (!tab) return null;
  const columns = tab.columns ?? DEFAULT_COLUMNS;

  const name = (item: GridItem) => (item.widget === "count" ? `Count: ${item.label}` : describeView(item.view));
  const where = (b: Box) => `column ${b.x + 1}, row ${b.y + 1}, ${b.w} wide, ${b.h} tall`;

  /** Applies a move or resize; says what happened or why it was refused. */
  const apply = (item: GridItem, to: Box) => {
    if (to.x === item.x && to.y === item.y && to.w === item.w && to.h === item.h) return;
    const patch = to.w !== item.w || to.h !== item.h ? resizeItem(current, tab.id, item.id, to.w, to.h) : moveItem(current, tab.id, item.id, to.x, to.y);
    const next = edit(session, patch);
    setSession(next);
    setStatus(next.rejected.length > 0 ? `Not moved: ${next.rejected[0]?.message ?? "invalid layout"}` : `${name(item)} is now at ${where(to)}.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: GridItem) => {
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
      <p id={helpId}>Drag a card to move it, or its corner to resize it. With the keyboard: arrow keys move the focused card, Shift and arrow keys resize it.</p>
      <div data-yadad-editor-toolbar="">
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save layout" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {session.rejected.length > 0 && <ErrorSummary errors={session.rejected} />}
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
      <Tabs label={`Edit ${dashboard.title ?? dashboard.id}`} tabs={current.tabs.map((t) => ({ id: t.id, title: t.title }))} selected={tab.id} onSelect={setSelected} panel={grid} />
    </div>
  );
}
