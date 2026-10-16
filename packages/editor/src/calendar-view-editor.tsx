import type { CalendarMode, CalendarView, DocumentError, EntityDocument, FieldValue, Registry } from "@yadad/core";
import { CALENDAR_COLOR_FIELD_TYPES, CALENDAR_DETAIL_FIELDS_MAX, CALENDAR_MODES, CALENDAR_TITLE_FIELD_TYPES } from "@yadad/core";
import type { PatchOperation } from "@yadad/runtime";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import type { DropTarget, ReorderableRow } from "./drag.js";
import { flatIndex } from "./drag.js";
import { edit, finish, isDirty, redo, startSession, undo } from "./session.js";
import type { EditSession } from "./session.js";
import { arrowStep, DropIndicator, ReorderGrip, useReorder } from "./reorder.js";
import { builtOf, ConditionBuilder, draftFor } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";
import { asText, choiceField, describeCondition, propertyInput, toolbarStyle } from "./ui.js";
import {
  addCalendarDetailField,
  calendarRowActionTargets,
  dateFieldsOf,
  fieldsNotInCalendarDetails,
  moveCalendarDetailField,
  removeCalendarDetailField,
  setCalendarColorField,
  setCalendarDateField,
  setCalendarDefaultMode,
  setCalendarEditable,
  setCalendarFilter,
  setCalendarRowAction,
  setCalendarSort,
  setCalendarTitle,
  setCalendarTitleField,
  setCalendarWeekStartsOn,
  toggleCalendarMode,
} from "./views.js";
import type { RowActionContext } from "./views.js";

export interface CalendarViewEditorProps {
  readonly view: CalendarView;
  /** The view's entity, for field labels, candidate fields and the fields not shown yet. */
  readonly entity: EntityDocument;
  readonly registry: Registry<ReactNode>;
  /**
   * The other documents in the set (table views and their entities), for the
   * row action: a calendar can open any table. Without it the editor offers
   * no row action, and a calendar's existing one is kept.
   */
  readonly context?: RowActionContext;
  /** Receives the edited calendar with its revision bumped. */
  readonly onSave: (view: CalendarView) => void;
  readonly onCancel: () => void;
}

type Result = PatchOperation[] | { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const NO_SORT = "(none)";
const NO_FIELD = "(default)";
const NO_COLOR = "(none)";
const DIRECTIONS = { Ascending: "asc", Descending: "desc" } as const;
type DirectionLabel = keyof typeof DIRECTIONS;

interface Settings {
  readonly title: string;
  readonly dateField: string;
  readonly titleField: string | undefined;
  readonly colorField: string | undefined;
  readonly weekStartsOn: number | undefined;
  readonly editable: boolean;
  readonly sortField: string | undefined;
  readonly sortDir: "asc" | "desc";
}

const settingsOf = (view: CalendarView): Settings => ({
  title: view.title ?? "",
  dateField: view.dateField,
  titleField: view.titleField,
  colorField: view.colorField,
  weekStartsOn: view.weekStartsOn,
  editable: view.editable === true,
  sortField: view.sort?.[0]?.field,
  sortDir: view.sort?.[0]?.dir ?? "asc",
});

/**
 * Sets up a calendar: the date field entries are placed by, the title and
 * colour fields, up to CALENDAR_DETAIL_FIELDS_MAX detail fields shown under
 * the title, the periods the viewer can switch between and which is the
 * default, the first day of the week, whether dragging an entry to another
 * day moves it, a fixed filter, the order of entries within a day, and the
 * row action. A detail field can be dragged by its grip — the drag shows
 * where it will land — or moved one step with the arrow keys; each move is
 * one undoable patch, and where it lands is announced.
 */
export function CalendarViewEditor({ view, entity, registry, context, onSave, onCancel }: CalendarViewEditorProps): ReactNode {
  const base = useId();
  const [session, setSession] = useState<EditSession<CalendarView>>(() => startSession(view));
  const [problems, setProblems] = useState<readonly DocumentError[]>([]);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(view));
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  const { Table, Button, Section, ErrorSummary } = registry.layout;
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

  /** Applies a patch through the session and reports it in the status line. */
  const applyAndAnnounce = (patch: PatchOperation[], message: (doc: CalendarView) => string): void => {
    const next = edit(session, patch);
    setSession(next);
    setProblems(next.rejected);
    if (next.rejected.length > 0) return announce(`Not moved: ${next.rejected[0]?.message ?? "invalid calendar"}.`);
    announce(message(next.current));
  };

  /** A one-step move of a detail field from the keyboard, announced. */
  const keyMoveDetail = (fieldId: string, step: -1 | 1) => {
    const result = moveCalendarDetailField(current, fieldId, step);
    if (!result.ok) return announce(`Not moved: ${result.error.message}`);
    applyAndAnnounce(result.patch, (doc) => `${label(fieldId)} moved ${step < 0 ? "up" : "down"} to position ${(doc.detailFields ?? []).findIndex((id) => id === fieldId) + 1}.`);
  };

  // Drag geometry over the laid-out DOM: the detail fields are a flat list
  // of rows in the editor's table; a row's element is the closest <tr> of
  // its first cell's marker.
  const detailRows = (): readonly ReorderableRow[] => {
    const rows: ReorderableRow[] = [];
    for (const fieldId of current.detailFields ?? []) {
      const marker = document.querySelector<HTMLElement>(`[data-yadad-detail-row="${fieldId}"]`);
      const el = (marker?.closest("tr") as HTMLElement | null) ?? marker ?? undefined;
      if (el) rows.push({ id: fieldId, sectionId: "", el });
    }
    return rows;
  };
  const dropDetail = (fieldId: string, target: DropTarget) => {
    const detail = current.detailFields ?? [];
    const from = detail.findIndex((id) => id === fieldId);
    if (from < 0 || target.index === from) return; // a no-op drop: no undo step, nothing to say
    const step = target.index > from ? 1 : -1;
    const result = moveCalendarDetailField(current, fieldId, step);
    if (!result.ok) return announce(`Not moved: ${result.error.message}`);
    applyAndAnnounce(result.patch, (doc) => `${label(fieldId)} moved to position ${(doc.detailFields ?? []).findIndex((id) => id === fieldId) + 1}.`);
  };
  const detailDrag = useReorder((y, id) => ({ sectionId: "", index: flatIndex(detailRows(), y, id) }), dropDetail);
  const detailOthers = (current.detailFields ?? []).filter((id) => id !== detailDrag.active);
  const detailIndicatorBefore = (fieldId: string): boolean => detailDrag.target !== undefined && detailOthers.findIndex((id) => id === fieldId) === detailDrag.target.index;
  const detailIndicatorAfterTable = detailDrag.target !== undefined && detailDrag.target.index >= detailOthers.length;

  // Date, title, colour, week start, editable and sort apply together, as one undoable edit.
  const dateIds = dateFieldsOf(entity);
  const titleIds = entity.fields.filter((f) => CALENDAR_TITLE_FIELD_TYPES.includes(f.type)).map((f) => f.id);
  const colorIds = entity.fields.filter((f) => CALENDAR_COLOR_FIELD_TYPES.includes(f.type)).map((f) => f.id);
  // A reference holds a record id, which says nothing about order, so it is not offered as a sort key.
  const entityIds = entity.fields.filter((f) => f.type !== "reference").map((f) => f.id);
  const applySettings = () =>
    run([
      ...setCalendarTitle(current, settings.title),
      ...setCalendarDateField(current, settings.dateField),
      ...setCalendarTitleField(current, settings.titleField),
      ...setCalendarColorField(current, settings.colorField),
      ...setCalendarWeekStartsOn(current, settings.weekStartsOn),
      ...setCalendarEditable(current, settings.editable),
      ...setCalendarSort(current, settings.sortField ? { field: settings.sortField, dir: settings.sortDir } : undefined),
    ]);

  const missing = fieldsNotInCalendarDetails(entity, current);
  const addChoice = adding && missing.includes(adding) ? adding : missing[0];
  const detailFields = current.detailFields ?? [];

  const columns = ["Detail field", "Actions"].map((name) => ({ id: name.toLowerCase().replace(/ /g, "_"), headerId: `${base}-col-${name}`, label: name, sortable: false }));
  const rows = detailFields.map((fieldId, i) => {
    const name = label(fieldId);
    return {
      id: fieldId,
      cells: [
        <span key="field" data-yadad-detail-row={fieldId} style={{ display: "flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
          {detailIndicatorBefore(fieldId) && <DropIndicator />}
          <ReorderGrip
            label={`Drag the detail field ${name}`}
            dragging={detailDrag.active === fieldId}
            onPointerDown={(e) => detailDrag.start(e, fieldId)}
            onPointerMove={detailDrag.move}
            onPointerUp={detailDrag.drop}
            onPointerCancel={detailDrag.cancel}
            onKeyDown={(e) => {
              const step = arrowStep(e);
              if (step === 0) return;
              e.preventDefault();
              keyMoveDetail(fieldId, step);
            }}
          />
          {name}
        </span>,
        <span key="actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)" }}>
          <Button label={`Move ${name} up`} type="button" variant="secondary" disabled={i === 0} onPress={() => run(moveCalendarDetailField(current, fieldId, -1))} />
          <Button label={`Move ${name} down`} type="button" variant="secondary" disabled={i === detailFields.length - 1} onPress={() => run(moveCalendarDetailField(current, fieldId, 1))} />
          <Button label={`Remove ${name}`} type="button" variant="secondary" disabled={false} onPress={() => run(removeCalendarDetailField(current, fieldId))} />
        </span>,
      ],
    };
  });

  const sortPicker = choiceField("sort_field", "Order within a day", [NO_SORT, ...entityIds.map(label)]);
  const dirPicker = choiceField("sort_dir", "Direction", Object.keys(DIRECTIONS));
  const dirLabel = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => DIRECTIONS[k] === settings.sortDir);

  // The fixed filter ("entries always match"), edited in place with the
  // condition builder; any field of the entity may appear in it. Deeper
  // conditions stay intact in words and are replaced, never edited half-way.
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
    run(setCalendarFilter(current, built), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce(built === undefined ? "Entries always match: cleared." : `Entries always match: ${describeCondition(built, label)}.`);
    });
  };
  const removeFilter = () => {
    run(setCalendarFilter(current, undefined), () => {
      setFilterOpen(false);
      setFilterDraft(undefined);
      announce("Entries always match: cleared.");
    });
  };

  // Modes: a non-empty subset of CALENDAR_MODES, in order; the first is the default.
  const modes = current.modes ?? CALENDAR_MODES;
  const toggleMode = (mode: CalendarMode) => run(toggleCalendarMode(current, mode, !modes.includes(mode)), () => announce(`${mode} ${modes.includes(mode) ? "turned off" : "turned on"}.`));
  const makeDefaultMode = (mode: CalendarMode) => run(setCalendarDefaultMode(current, mode), () => announce(`${mode} is now the default period.`));

  // The row action ("activate an entry to open a table, scoped to it"): one
  // target table and one pair of same-typed fields, checked by the validator.
  const targets = context ? calendarRowActionTargets(context) : [];
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
    return `Activating an entry opens ${t ? targetLabel(t) : action.open}, matching ${pairs.join(", ")}.`;
  };
  const applyRowAction = () => {
    if (!pickedTarget || !pickedFrom || !pickedTo) return;
    run(setCalendarRowAction(current, entity, context ?? { tables: [], entities: [] }, { open: pickedTarget.id, bind: [{ field: pickedFrom.id, to: pickedTo.id }], mode: "replace" }), () =>
      announce(`Row action set: opens ${targetLabel(pickedTarget)}.`),
    );
  };

  return (
    <div data-yadad-calendar-editor={view.id}>
      <p id={`${base}-help`}>
        Drag a detail field by its grip to reorder it; with the keyboard, focus a grip and use the arrow keys (Up back, Down forward). Esc cancels a drag. The Move buttons step one place.
      </p>
      <div data-yadad-editor-toolbar="" style={toolbarStyle}>
        <Button label="Undo" type="button" variant="secondary" disabled={session.applied.length === 0} onPress={() => setSession(undo(session))} />
        <Button label="Redo" type="button" variant="secondary" disabled={session.undone.length === 0} onPress={() => setSession(redo(session))} />
        <Button label="Save calendar" type="button" variant="primary" disabled={!isDirty(session)} onPress={() => onSave(finish(session))} />
        <Button label="Cancel" type="button" variant="secondary" disabled={false} onPress={onCancel} />
      </div>
      {problems.length > 0 && <ErrorSummary errors={problems} />}
      <Section id={`${base}-settings`} title="Calendar settings">
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {propertyInput(registry, `${base}-title`, { id: "title", type: "text", label: "Title" }, settings.title, (v) => setSettings((s) => ({ ...s, title: asText(v) })))}
          {propertyInput(registry, `${base}-date`, choiceField("date_field", "Date field", dateIds.map(label)), label(settings.dateField), (v) =>
            setSettings((s) => ({ ...s, dateField: byLabel(dateIds, v) ?? s.dateField })),
          )}
          {propertyInput(registry, `${base}-titlefield`, choiceField("title_field", "Title field", [NO_FIELD, ...titleIds.map(label)]), settings.titleField ? label(settings.titleField) : NO_FIELD, (v) =>
            setSettings((s) => ({ ...s, titleField: byLabel(titleIds, v) })),
          )}
          {propertyInput(registry, `${base}-colorfield`, choiceField("color_field", "Colour field", [NO_COLOR, ...colorIds.map(label)]), settings.colorField ? label(settings.colorField) : NO_COLOR, (v) =>
            setSettings((s) => ({ ...s, colorField: byLabel(colorIds, v) })),
          )}
          {propertyInput(registry, `${base}-week`, { id: "week_starts_on", type: "number", label: "Week starts on (0 Sunday – 6 Saturday)", min: 0, max: 6, step: 1 }, settings.weekStartsOn, (v) =>
            setSettings((s) => ({ ...s, weekStartsOn: typeof v === "number" ? v : undefined })),
          )}
          {propertyInput(registry, `${base}-editable`, { id: "editable", type: "boolean", label: "Dragging an entry to another day moves it" }, settings.editable, (v) =>
            setSettings((s) => ({ ...s, editable: v === true })),
          )}
          {propertyInput(registry, `${base}-sort`, sortPicker, settings.sortField ? label(settings.sortField) : NO_SORT, (v) => setSettings((s) => ({ ...s, sortField: byLabel(entityIds, v) })))}
          {settings.sortField &&
            propertyInput(registry, `${base}-dir`, dirPicker, dirLabel, (v) => {
              const key = (Object.keys(DIRECTIONS) as DirectionLabel[]).find((k) => k === v);
              setSettings((s) => ({ ...s, sortDir: key ? DIRECTIONS[key] : "asc" }));
            })}
          <Button label="Apply settings" type="button" variant="secondary" disabled={false} onPress={applySettings} />
        </div>
        {current.filter ? (
          <p>
            Entries always match: {describeCondition(current.filter, label)}.
            <Button label="Edit entries always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        ) : (
          <p>
            Entries always match: none.
            <Button label="Set entries always match" type="button" variant="secondary" disabled={false} onPress={openFilter} />
          </p>
        )}
        {filterOpen && (
          <div data-yadad-filter-builder="" style={{ marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
            <ConditionBuilder
              id={`${base}-filter`}
              label="entries always match"
              registry={registry}
              entity={entity}
              draft={filterDraft}
              onChange={setFilterDraft}
              current={current.filter}
              onReplace={() => setFilterDraft(draftFor(entity, undefined))}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--yadad-toolbar-gap, 0.5rem)", marginBlockStart: "var(--yadad-toolbar-gap, 0.5rem)" }}>
              <Button label="Apply entries always match" type="button" variant="primary" disabled={builtOf(filterDraft) === undefined || sameFilter} onPress={applyFilter} />
              {current.filter !== undefined && <Button label="Remove entries always match" type="button" variant="secondary" disabled={false} onPress={removeFilter} />}
              <Button label="Cancel entries always match" type="button" variant="secondary" disabled={false} onPress={() => setFilterOpen(false)} />
            </div>
          </div>
        )}
      </Section>
      <Section id={`${base}-modes`} title="Modes">
        <p>The periods the viewer can switch between; {modes[0]} is the default.</p>
        <div data-yadad-editor-toolbar="" style={toolbarStyle}>
          {CALENDAR_MODES.map((mode) => {
            const on = modes.includes(mode);
            return (
              <span key={mode} style={{ display: "inline-flex", alignItems: "center", gap: "var(--yadad-space-1, 0.25rem)" }}>
                {propertyInput(registry, `${base}-mode-${mode}`, { id: `mode_${mode}`, type: "boolean", label: mode }, on, () => toggleMode(mode))}
                {on && modes[0] !== mode && <Button label={`Make ${mode} the default`} type="button" variant="secondary" disabled={false} onPress={() => makeDefaultMode(mode)} />}
              </span>
            );
          })}
        </div>
      </Section>
      {context && (
        <Section id={`${base}-row-action`} title="Row action">
          {action ? <p>{describeAction()}</p> : <p>Activating an entry does nothing.</p>}
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
              {action && <Button label="Remove row action" type="button" variant="secondary" disabled={false} onPress={() => run(setCalendarRowAction(current, entity, context, undefined), () => announce("Row action removed."))} />}
            </div>
          )}
        </Section>
      )}
      <Section id={`${base}-details`} title="Detail fields">
        <p>Up to {CALENDAR_DETAIL_FIELDS_MAX} fields shown small under an entry's title.</p>
        {missing.length > 0 && detailFields.length < CALENDAR_DETAIL_FIELDS_MAX && (
          <div data-yadad-editor-toolbar="" style={toolbarStyle}>
            <p>Not shown yet: {missing.map(label).join(", ")}.</p>
            {propertyInput(registry, `${base}-add`, choiceField("add_detail", "Detail field to add", missing.map(label)), addChoice ? label(addChoice) : undefined, (v) => setAdding(byLabel(missing, v)))}
            <Button label="Add detail field" type="button" variant="primary" disabled={!addChoice} onPress={() => addChoice && run(addCalendarDetailField(current, addChoice), () => setAdding(undefined))} />
          </div>
        )}
        <Table caption={`Detail fields of ${current.title ?? current.id}`} columns={columns} rows={rows} onSort={() => {}} empty="No detail fields." />
        {detailIndicatorAfterTable && <DropIndicator />}
      </Section>
      <p aria-live="polite" data-yadad-editor-status="">
        {status}
      </p>
    </div>
  );
}
