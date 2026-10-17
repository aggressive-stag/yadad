import type { BoardView, DocumentError, EntityDocument, FieldValue, Registry } from "@yadad/core";
import { BOARD_CARD_FIELDS_MAX, BOARD_GROUP_BY_MAX } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { flatIndex } from "./drag.js";
import type { DropTarget, ReorderableRow } from "./drag.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { arrowStep, DropIndicator, ReorderGrip, useReorder } from "./reorder.js";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asText, choiceField, describeCondition, propertyInput, toolbarStyle } from "./ui.js";
import {
  addBoardCardField,
  addBoardGroupBy,
  boardRowActionTargets,
  boardTitleFieldsOf,
  effectiveBoardTitleField,
  fieldsNotInBoardCards,
  fieldsNotInBoardGroupBy,
  groupableFieldsOf,
  moveBoardCardField,
  moveBoardGroupBy,
  removeBoardCardField,
  removeBoardGroupBy,
  setBoardEditable,
  setBoardFilter,
  setBoardRowAction,
  setBoardSort,
  setBoardTitle,
  setBoardTitleField,
} from "./views.js";
import type { RowActionContext } from "./views.js";

export interface BoardViewEditorProps {
  readonly view: BoardView;
  /** The view's entity, for field labels and the fields each picker may offer. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /**
   * The other documents in the set (table views and their entities), for the
   * row action: a board can open any table. Without it the editor offers no
   * row action, and a board's existing one is kept.
   */
  readonly context?: RowActionContext;
  /** Receives the edited board with its revision bumped. */
  readonly onSave: (view: BoardView) => void;
  readonly onCancel: () => void;
}

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const NO_SORT = "(none)";
const NO_FIELD = "(default)";
const DIRECTIONS = { Ascending: "asc", Descending: "desc" } as const;
type DirectionLabel = keyof typeof DIRECTIONS;

interface Settings {
  readonly title: string;
  readonly titleField: string | undefined;
  readonly editable: boolean;
  readonly sortField: string | undefined;
  readonly sortDir: "asc" | "desc";
}

const settingsOf = (view: BoardView): Settings => ({
  title: view.title ?? "",
  titleField: view.titleField,
  editable: view.editable === true,
  sortField: view.sort?.[0]?.field,
  sortDir: view.sort?.[0]?.dir ?? "asc",
});

interface ReorderListProps {
  readonly registry: Registry<ReactNode>;
  readonly base: string;
  /** Distinguishes this list's rows in the DOM from the other list's. */
  readonly marker: string;
  readonly caption: string;
  readonly columnLabel: string;
  readonly empty: string;
  readonly noun: string;
  readonly ids: readonly string[];
  readonly label: (fieldId: string) => string;
  /** Extra text after a field's name, e.g. "(default)". */
  readonly note?: (fieldId: string, index: number) => string;
  /** Whether a field can be removed. */
  readonly removable: boolean;
  /** Moves `fieldId` by `by` places. Returns the position it ends at, or a refusal message. */
  readonly onMove: (fieldId: string, by: number) => void;
  readonly onRemove: (fieldId: string) => void;
}

/** A list of fields the author can reorder by grip drag, arrow keys or Move buttons; every move is one patch through `onMove`. */
function ReorderList({ registry, base, marker, caption, columnLabel, empty, noun, ids, label, note, removable, onMove, onRemove }: ReorderListProps): ReactNode {
  const { Table, Button } = registry.layout;
  const rowsOf = (): readonly ReorderableRow[] => {
    const rows: ReorderableRow[] = [];
    for (const fieldId of ids) {
      const el = document.querySelector<HTMLElement>(`[data-yadad-${marker}-row="${fieldId}"]`);
      const row = (el?.closest("tr") as HTMLElement | null) ?? el ?? undefined;
      if (row) rows.push({ id: fieldId, sectionId: "", el: row });
    }
    return rows;
  };
  const drop = (fieldId: string, target: DropTarget) => {
    const from = ids.findIndex((id) => id === fieldId);
    if (from < 0 || target.index === from) return; // a no-op drop: no undo step, nothing to say
    onMove(fieldId, target.index - from);
  };
  const drag = useReorder((y, id) => ({ sectionId: "", index: flatIndex(rowsOf(), y, id) }), drop);
  const others = ids.filter((id) => id !== drag.active);
  const before = (fieldId: string): boolean => drag.target !== undefined && others.findIndex((id) => id === fieldId) === drag.target.index;
  const after = drag.target !== undefined && drag.target.index >= others.length;

  const columns = [columnLabel, "Actions"].map((name) => ({ id: name.toLowerCase().replace(/ /g, "_"), headerId: `${base}-${marker}-col-${name}`, label: name, sortable: false }));
  const rows = ids.map((fieldId, i) => {
    const name = label(fieldId);
    return {
      id: fieldId,
      cells: [
        <span key="field" {...{ [`data-yadad-${marker}-row`]: fieldId }} style={{ display: "flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
          {before(fieldId) && <DropIndicator />}
          <ReorderGrip
            label={`Drag the ${noun} ${name}`}
            dragging={drag.active === fieldId}
            onPointerDown={(e) => drag.start(e, fieldId)}
            onPointerMove={drag.move}
            onPointerUp={drag.drop}
            onPointerCancel={drag.cancel}
            onKeyDown={(e) => {
              const step = arrowStep(e);
              if (step === 0) return;
              e.preventDefault();
              onMove(fieldId, step);
            }}
          />
          {name}
          {note?.(fieldId, i) ? ` ${note(fieldId, i)}` : ""}
        </span>,
        <span key="actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button label={`Move ${name} up`} type="button" variant="secondary" disabled={i === 0} onPress={() => onMove(fieldId, -1)} />
          <Button label={`Move ${name} down`} type="button" variant="secondary" disabled={i === ids.length - 1} onPress={() => onMove(fieldId, 1)} />
          <Button label={`Remove ${name}`} type="button" variant="secondary" disabled={!removable} onPress={() => onRemove(fieldId)} />
        </span>,
      ],
    };
  });
  return (
    <>
      <Table caption={caption} columns={columns} rows={rows} onSort={() => {}} empty={empty} />
      {after && <DropIndicator />}
    </>
  );
}

/**
 * Sets up a board: the fields the viewer may group by (the first is the
 * default; only groupable fields are offered), the title field, up to
 * BOARD_CARD_FIELDS_MAX card fields, a fixed filter, the order of cards in a
 * column, whether dragging a card moves it, and the row action. Groupings and
 * card fields can be dragged by a grip (the drag shows where they will land),
 * moved one step with the arrow keys or with the Move buttons; each change
 * is one validated, undoable patch, and where a field lands is announced.
 */
export function BoardViewEditor({ view, entity, registry, context, onSave, onCancel }: BoardViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<BoardView>>(() => startSession(view));
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(view));
  const [addingGroup, setAddingGroup] = useState<string | undefined>(undefined);
  const [addingCard, setAddingCard] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  const { Button, Section, ErrorSummary } = registry.layout;
  const current = session.current;

  const label = (fieldId: string) => entity.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  const byLabel = (ids: readonly string[], v: FieldValue | undefined) => ids.find((id) => label(id) === v);
  const announce = (message: string) => {
    setProblems([]);
    setStatus(message);
  };

  const run = (result: Result, onOk?: () => void) => {
    if (!Array.isArray(result) && !result.ok) return setProblems([result.error]);
    const patch = Array.isArray(result) ? result : result.patch;
    if (patch.length === 0) return onOk?.();
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length === 0) onOk?.();
  };

  /** A move of a field in one of the two lists, applied and announced with its new position. */
  const moveIn = (kind: "groupBy" | "cardFields", fieldId: string, by: number) => {
    const result = kind === "groupBy" ? moveBoardGroupBy(current, fieldId, by) : moveBoardCardField(current, fieldId, by);
    if (!result.ok) return announce(`Not moved: ${result.error.message}`);
    const next = edit(session, result.patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length > 0) return announce(`Not moved: ${next.rejected[0]?.message ?? "invalid board"}.`);
    const ids = kind === "groupBy" ? next.current.groupBy.map((g) => g.field) : (next.current.cardFields ?? []);
    const position = ids.findIndex((id) => id === fieldId) + 1;
    announce(`${label(fieldId)} moved ${by < 0 ? "up" : "down"} to position ${position}${kind === "groupBy" && position === 1 ? ", the default grouping" : ""}.`);
  };

  // Title, editable and sort apply together, as one undoable edit.
  const titleIds = boardTitleFieldsOf(entity);
  // A reference holds a record id, which says nothing about order, so it is not offered as a sort key.
  const sortIds = entity.fields.filter((f) => f.type !== "reference").map((f) => f.id);
  const entityIds = sortIds;
  const applySettings = () =>
    run(
      [
        ...setBoardTitle(current, settings.title),
        ...setBoardTitleField(current, entity, settings.titleField),
        ...setBoardEditable(current, settings.editable),
        ...setBoardSort(current, settings.sortField ? { field: settings.sortField, dir: settings.sortDir } : undefined),
      ],
      () => announce("Board settings applied."),
    );

  const sortPicker = choiceField("sort_field", "Order within a column", [NO_SORT, ...sortIds.map(label)]);
  const dirPicker = choiceField("sort_dir", "Direction", Object.keys(DIRECTIONS));
  const dirLabel = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => DIRECTIONS[k] === settings.sortDir);

  const groupIds = current.groupBy.map((g) => g.field);
  const missingGroups = fieldsNotInBoardGroupBy(entity, current);
  const groupChoice = addingGroup && missingGroups.includes(addingGroup) ? addingGroup : missingGroups[0];
  const cardIds = current.cardFields ?? [];
  const missingCards = fieldsNotInBoardCards(entity, current);
  const cardChoice = addingCard && missingCards.includes(addingCard) ? addingCard : missingCards[0];
  const titleName = effectiveBoardTitleField(entity, current);

  // The fixed filter ("cards always match"), edited in place with the condition builder.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<ConditionDraft | undefined>(undefined);
  const openFilter = () => {
    setFilterOpen(true);
    setFilterDraft(draftFor(entity, current.filter));
  };
  const sameFilter = JSON.stringify(builtOf(filterDraft)) === JSON.stringify(current.filter);
  const applyFilter = () => {
    const built = builtOf(filterDraft);
    if (sameFilter) return;
    run(setBoardFilter(current, built), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce(built === undefined ? "Cards always match: cleared." : `Cards always match: ${describeCondition(built, label)}.`);
    });
  };
  const removeFilter = () => {
    run(setBoardFilter(current, undefined), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce("Cards always match: cleared.");
    });
  };

  // The row action ("activate a card to open a table, scoped to it").
  const targets = context ? boardRowActionTargets(context) : [];
  const targetLabel = (t: (typeof targets)[number]) => (t.title ? `${t.title} (${t.id})` : t.id);
  const targetEntity = (t: (typeof targets)[number] | undefined) => context?.entities.find((e) => e.id === t?.entity);
  const [rowTarget, setRowTarget] = useState<string | undefined>(undefined);
  const [rowFrom, setRowFrom] = useState<string | undefined>(undefined);
  const [rowTo, setRowTo] = useState<string | undefined>(undefined);
  const pickedTarget = targets.find((t) => t.id === rowTarget) ?? targets[0];
  const pickedFrom = entity.fields.find((f) => f.id === rowFrom) ?? entity.fields[0];
  const sameKind = (a: typeof pickedFrom, b: (typeof entity.fields)[number]): boolean => a?.type === b.type && (a.type !== "reference" || (b.type === "reference" && a.entity === b.entity));
  const toFields = targetEntity(pickedTarget)?.fields.filter((f) => sameKind(pickedFrom, f)) ?? [];
  const pickedTo = toFields.find((f) => f.id === rowTo) ?? toFields[0];
  const action = current.rowAction;
  const describeAction = (): string => {
    if (!action) return "";
    const t = context?.tables.find((x) => x.id === action.open);
    const te = targetEntity(t);
    const pairs = action.bind.map((b) => `${label(b.field)} to ${te?.fields.find((f) => f.id === b.to)?.label ?? b.to}`);
    return `Activating a card opens ${t ? targetLabel(t) : action.open}, matching ${pairs.join(", ")}.`;
  };
  const applyRowAction = () => {
    if (!pickedTarget || !pickedFrom || !pickedTo) return;
    run(setBoardRowAction(current, entity, context ?? { tables: [], entities: [] }, { open: pickedTarget.id, bind: [{ field: pickedFrom.id, to: pickedTo.id }], mode: "replace" }), () =>
      announce(`Row action set: opens ${targetLabel(pickedTarget)}.`),
    );
  };

  return (
    <div data-yadad-board-editor={view.id}>
      <p id={`${base}-help`}>
        Drag a field by its grip to reorder it; with the keyboard, focus a grip and use the arrow keys (Up back, Down forward). Esc cancels a drag. The Move buttons step one place.
      </p>
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save board" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      <Section id={`${base}-settings`} title="Board settings">
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-title`, { id: "title", type: "text", label: "Title" }, settings.title, (v) => setSettings((s) => ({ ...s, title: asText(v) })))}
          {propertyInput(registry, `${base}-titlefield`, choiceField("title_field", "Title field", [NO_FIELD, ...titleIds.map(label)]), settings.titleField ? label(settings.titleField) : NO_FIELD, (v) =>
            setSettings((s) => ({ ...s, titleField: byLabel(titleIds, v) })),
          )}
          {propertyInput(registry, `${base}-editable`, { id: "editable", type: "boolean", label: "Dragging a card to another column moves it" }, settings.editable, (v) =>
            setSettings((s) => ({ ...s, editable: v === true })),
          )}
          {propertyInput(registry, `${base}-sort`, sortPicker, settings.sortField ? label(settings.sortField) : NO_SORT, (v) => setSettings((s) => ({ ...s, sortField: byLabel(sortIds, v) })))}
          {settings.sortField &&
            propertyInput(registry, `${base}-dir`, dirPicker, dirLabel, (v) => {
              const key = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => k === v);
              setSettings((s) => ({ ...s, sortDir: key ? DIRECTIONS[key] : "asc" }));
            })}
          <Button label="Apply settings" type="button" variant="secondary" disabled={false} onPress={applySettings} />
        </div>
        {current.filter ? (
          <p>
            Cards always match: {describeCondition(current.filter, label)}.
            <Button label="Edit cards always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        ) : (
          <p>
            Cards always match: none.
            <Button label="Set cards always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        )}
        {filterOpen && (
          <div data-yadad-filter-builder="" style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <ConditionBuilder
              id={`${base}-filter`}
              label="cards always match"
              registry={registry}
              entity={entity}
              draft={filterDraft}
              onChange={setFilterDraft}
              current={current.filter}
              onReplace={() => setFilterDraft(draftFor(entity, undefined))}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
              <Button label="Apply cards always match" type="button" variant="primary" disabled={builtOf(filterDraft) === undefined || sameFilter} onPress={applyFilter} />
              {current.filter !== undefined && <Button label="Remove cards always match" type="button" variant="secondary" disabled={false} onPress={removeFilter} />}
              <Button label="Cancel cards always match" type="button" variant="secondary" disabled={false} onPress={() => setFilterOpen(false)} />
            </div>
          </div>
        )}
      </Section>
      <Section id={`${base}-groupby`} title="Group by">
        <p>
          The fields the viewer can group the board by, up to {BOARD_GROUP_BY_MAX}; the first is the default.
          {groupableFieldsOf(entity).length === 0 ? ` ${entity.id} has no select, boolean or reference field to group by.` : ""}
        </p>
        {missingGroups.length > 0 && groupIds.length < BOARD_GROUP_BY_MAX && (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            {propertyInput(registry, `${base}-addgroup`, choiceField("add_group", "Grouping to add", missingGroups.map(label)), groupChoice ? label(groupChoice) : undefined, (v) => setAddingGroup(byLabel(missingGroups, v)))}
            <Button
              label="Add grouping"
              type="button"
              variant="primary"
              disabled={!groupChoice}
              onPress={() => groupChoice && run(addBoardGroupBy(current, entity, groupChoice), () => (setAddingGroup(undefined), announce(`${label(groupChoice)} added to the groupings.`)))}
            />
          </div>
        )}
        <ReorderList
          registry={registry}
          base={base}
          marker="group"
          caption={`Groupings of ${current.title ?? current.id}`}
          columnLabel="Grouping"
          empty="No groupings."
          noun="grouping"
          ids={groupIds}
          label={label}
          note={(_, i) => (i === 0 ? "(default)" : "")}
          removable={groupIds.length > 1}
          onMove={(id, by) => moveIn("groupBy", id, by)}
          onRemove={(id) => run(removeBoardGroupBy(current, id), () => announce(`${label(id)} removed from the groupings.`))}
        />
      </Section>
      <Section id={`${base}-cards`} title="Card fields">
        <p>
          Up to {BOARD_CARD_FIELDS_MAX} fields shown small under a card's title{titleName ? ` (${label(titleName)})` : ""}.
        </p>
        {missingCards.length > 0 && cardIds.length < BOARD_CARD_FIELDS_MAX && (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            {propertyInput(registry, `${base}-addcard`, choiceField("add_card_field", "Card field to add", missingCards.map(label)), cardChoice ? label(cardChoice) : undefined, (v) => setAddingCard(byLabel(missingCards, v)))}
            <Button
              label="Add card field"
              type="button"
              variant="primary"
              disabled={!cardChoice}
              onPress={() => cardChoice && run(addBoardCardField(current, entity, cardChoice), () => (setAddingCard(undefined), announce(`${label(cardChoice)} added to the card fields.`)))}
            />
          </div>
        )}
        <ReorderList
          registry={registry}
          base={base}
          marker="card"
          caption={`Card fields of ${current.title ?? current.id}`}
          columnLabel="Card field"
          empty="No card fields."
          noun="card field"
          ids={cardIds}
          label={label}
          removable
          onMove={(id, by) => moveIn("cardFields", id, by)}
          onRemove={(id) => run(removeBoardCardField(current, id), () => announce(`${label(id)} removed from the card fields.`))}
        />
      </Section>
      {context && (
        <Section id={`${base}-row-action`} title="Row action">
          {action ? <p>{describeAction()}</p> : <p>Activating a card does nothing.</p>}
          {targets.length === 0 ? (
            <p>There is no table view to open.</p>
          ) : (
            <div data-yadad-editor-toolbar="" style={toolbarStyle}>
              {propertyInput(registry, `${base}-ra-open`, choiceField("row_action_open", "Open table", targets.map(targetLabel)), pickedTarget ? targetLabel(pickedTarget) : undefined, (v) => {
                setRowTarget(targets.find((t) => targetLabel(t) === v)?.id);
                setRowTo(undefined);
              })}
              {propertyInput(registry, `${base}-ra-from`, choiceField("row_action_from", "Match this field", entityIds.map(label)), pickedFrom ? label(pickedFrom.id) : undefined, (v) => {
                setRowFrom(byLabel(entityIds, v));
                setRowTo(undefined);
              })}
              {toFields.length === 0 ? (
                <p>{`${pickedTarget ? targetLabel(pickedTarget) : "The target"} has no ${pickedFrom?.type ?? "matching"} field to match.`}</p>
              ) : (
                propertyInput(registry, `${base}-ra-to`, choiceField("row_action_to", "With this field of the target", toFields.map((f) => f.label)), pickedTo?.label, (v) => setRowTo(toFields.find((f) => f.label === v)?.id))
              )}
              <Button label="Set row action" type="button" variant="secondary" disabled={!pickedTarget || !pickedFrom || !pickedTo} onPress={applyRowAction} />
              {action && <Button label="Remove row action" type="button" variant="secondary" disabled={false} onPress={() => run(setBoardRowAction(current, entity, context, undefined), () => announce("Row action removed."))} />}
            </div>
          )}
        </Section>
      )}
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
    </div>
  );
}
