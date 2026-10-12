import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { DropTarget } from "./drag.js";

/**
 * Shared drag machinery for the view editors, hand-written over pointer
 * events like the dashboard editor. `drag.ts` has the pointer math; this
 * has the drag state, the grip, and the drop indicator. The editors keep
 * their Move buttons: the drag is the fast path, the buttons stay the
 * fallback for touch and assistive technology.
 */

/**
 * Where a drag of `id` would land when the pointer is at `y`: a pure
 * function over the laid-out rows, e.g. `insertIndex` for rows inside
 * sections or `flatIndex` for flat lists.
 */
export type DropResolver = (y: number, id: string) => DropTarget;

export interface UseReorder {
  /** The id being dragged, if a drag is in progress. */
  readonly active: string | undefined;
  /** The drop the drag currently previews; undefined between drags. */
  readonly target: DropTarget | undefined;
  /** Starts a drag of `id`; attach to the grip's onPointerDown. */
  readonly start: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  /** Moves the preview; attach to the grip's onPointerMove. */
  readonly move: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Applies the drop the preview showed; attach to the grip's onPointerUp. */
  readonly drop: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Ends the drag without applying anything; attach to the grip's onPointerCancel. */
  readonly cancel: () => void;
}

/**
 * Pointer drag over an ordered set of rows. `resolve` maps the pointer's
 * `y` to the drop it previews, from the laid-out elements; the editors
 * pass it through `drag.ts`. While dragging, `target` is the drop the
 * pointer previews; the editor renders the indicator where it says and
 * applies the move when `drop` fires. Esc or a pointer cancel ends the
 * drag without applying anything. `onDrop` sees the previewed target, so
 * the patch the editor applies is exactly the move the user was shown.
 */
export function useReorder(resolve: DropResolver, onDrop: (id: string, target: DropTarget) => void): UseReorder {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const activeRef = useRef<string | undefined>(undefined);
  const targetRef = useRef<DropTarget | undefined>(undefined);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<DropTarget | undefined>(undefined);

  const start = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    // Capture on the grip, so the moves and the release reach it even when
    // the pointer is far away; touch-action: none on the grip keeps the
    // page scrollable when the user is not dragging.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activeRef.current = id;
    targetRef.current = resolveRef.current(event.clientY, id);
    setTarget(targetRef.current);
    setActive(id);
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const id = activeRef.current;
    if (!id) return;
    targetRef.current = resolveRef.current(event.clientY, id);
    setTarget(targetRef.current);
  };

  const drop = (event: ReactPointerEvent<HTMLElement>) => {
    const id = activeRef.current;
    const t = targetRef.current;
    if (!id) return;
    event.preventDefault();
    activeRef.current = undefined;
    targetRef.current = undefined;
    setTarget(undefined);
    setActive(undefined);
    if (t) onDropRef.current(id, t);
  };

  const cancel = () => {
    activeRef.current = undefined;
    targetRef.current = undefined;
    setTarget(undefined);
    setActive(undefined);
  };

  // Esc cancels the drag while it is in progress.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return { active, target, start, move, drop, cancel };
}

/**
 * The step an arrow key means for a focused grip: -1 for Up and Left,
 * +1 for Down and Right, 0 for anything else. Same convention as the
 * dashboard editor's KEY_STEPS (arrows step the focused item).
 */
export function arrowStep(event: KeyboardEvent<HTMLElement>): -1 | 1 | 0 {
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") return 1;
  return 0;
}

const gripStyle: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  margin: 0,
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
  color: "var(--yadad-color-text-muted, #5c5c5c)",
  lineHeight: 1,
};

const draggingGripStyle: CSSProperties = { ...gripStyle, cursor: "grabbing", opacity: 0.4 };

interface ReorderGripProps {
  /** Accessible name, e.g. "Drag the field Title". */
  readonly label: string;
  readonly dragging: boolean;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: () => void;
  /** Alt with the arrow keys moves one step; the grip takes focus for it. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * The grip in front of a row or section. Drag it to move the row; with the
 * grip focused, Alt with the arrow keys moves it one step (Up and Left
 * back, Down and Right forward), the same convention as the dashboard
 * editor's keyboard moves.
 */
export function ReorderGrip({ label, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown }: ReorderGripProps): ReactNode {
  return (
    <button
      type="button"
      data-yadad-drag-grip=""
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      style={dragging ? draggingGripStyle : gripStyle}
    >
      ⠿
    </button>
  );
}

/** The line where the drop will land; the editors render one per cell so it spans the row. */
export function DropIndicator(): ReactNode {
  return <div data-yadad-drop-indicator="" aria-hidden="true" style={{ height: 2, borderRadius: "var(--yadad-radius-sm, 0.25rem)", background: "var(--yadad-color-accent, #2459c7)" }} />;
}
