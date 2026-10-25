import { jsonPointer, optionValue, sectionItems } from "@yadad/core";
import type {
  BoardView,
  CalendarView,
  Condition,
  DashboardTab,
  DashboardView,
  DataRecord,
  Document,
  DocumentError,
  GridItem,
  ResolvedViewer,
  RowAction,
  TableColumn,
  TableView,
  ViewDocument,
  ViewerCondition,
  ViewerDocument,
  ViewerFact,
  ViewerFactValue,
} from "@yadad/core";
import { evaluateViewerCondition } from "./condition.js";

/** The viewer document of a set (a valid set has at most one; the first wins). */
export function findViewerDocument(documents: Iterable<Document>): ViewerDocument | undefined {
  for (const document of documents) if (document.kind === "viewer") return document;
  return undefined;
}

const isRecordLike = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Builds the viewer a renderer takes (RFC 0006): every fact the document
 * declares, once, in declaration order. A fact takes the host's value when it
 * is valid and the declared default otherwise. Never throws; `issues` lists
 * what was ignored, with JSON Pointers into `input`. With no document the
 * viewer has no facts.
 */
export function resolveViewer(
  document: ViewerDocument | undefined,
  input?: readonly ViewerFactValue[],
): { viewer: ResolvedViewer; issues: DocumentError[] } {
  const declared: readonly ViewerFact[] = document?.facts ?? [];
  const declaredIds = declared.map((f) => f.id);
  const issues: DocumentError[] = [];
  const chosen = new Map<string, string | boolean>();
  const seen = new Set<string>();
  const entries: readonly unknown[] = Array.isArray(input) ? input : [];

  entries.forEach((entry, i) => {
    if (!isRecordLike(entry)) {
      issues.push({ path: jsonPointer([i]), code: "type", message: "A viewer fact value must be an object.", hint: 'Pass { fact: "<id>", value: <value> }.' });
      return;
    }
    const factId = entry["fact"];
    const fact = typeof factId === "string" ? declared.find((f) => f.id === factId) : undefined;
    if (typeof factId !== "string" || !fact) {
      issues.push({
        path: jsonPointer([i, "fact"]),
        code: "unknown-reference",
        message: typeof factId === "string" ? `The viewer document does not declare a fact "${factId}".` : "The fact must be the id of a declared viewer fact.",
        hint: declaredIds.length > 0 ? `Use one of the declared fact ids: ${declaredIds.join(", ")}.` : "The set has no viewer document, so there are no facts to set.",
        allowed: declaredIds,
      });
      return;
    }
    if (seen.has(fact.id)) {
      issues.push({
        path: jsonPointer([i, "fact"]),
        code: "invalid-value",
        message: `The fact "${fact.id}" was already given earlier in the list.`,
        hint: "Give each fact once; the first entry is used.",
      });
      return;
    }
    seen.add(fact.id);
    const value = entry["value"];
    if (fact.type === "boolean") {
      if (typeof value !== "boolean") {
        issues.push({ path: jsonPointer([i, "value"]), code: "type", message: `The fact "${fact.id}" takes true or false.`, hint: "Pass a boolean; the default is used instead." });
        return;
      }
      chosen.set(fact.id, value);
      return;
    }
    if (typeof value !== "string") {
      issues.push({ path: jsonPointer([i, "value"]), code: "type", message: `The fact "${fact.id}" takes one of its listed values.`, hint: "Pass a string; the default is used instead.", allowed: fact.options.values.map(optionValue) }); // RFC 0008: card 47a
      return;
    }
    if (!fact.options.values.some((o) => optionValue(o) === value)) { // RFC 0008: card 47a
      issues.push({
        path: jsonPointer([i, "value"]),
        code: "invalid-value",
        message: `"${value}" is not a value of the fact "${fact.id}".`,
        hint: `Use one of: ${fact.options.values.map(optionValue).join(", ")}. The default is used instead.`,
        allowed: fact.options.values.map(optionValue),
      });
      return;
    }
    chosen.set(fact.id, value);
  });

  return { viewer: { facts: declared.map((f) => ({ fact: f.id, value: chosen.get(f.id) ?? f.default })) }, issues };
}

/** The columns this viewer may see, in order. */
export function visibleColumns(view: TableView, viewer: ResolvedViewer): TableColumn[] {
  return view.columns.filter((c) => c.visibleWhen === undefined || evaluateViewerCondition(c.visibleWhen, viewer));
}

/** Whether a column is edited in place for this viewer: `editable` and, when set, `editableWhen`. */
export function columnEditable(column: TableColumn, viewer: ResolvedViewer): boolean {
  return column.editable === true && (column.editableWhen === undefined || evaluateViewerCondition(column.editableWhen, viewer));
}

/** Whether a calendar or board offers moving for this viewer: `editable` and, when set, `editableWhen`. */
export function viewEditable(view: CalendarView | BoardView, viewer: ResolvedViewer): boolean {
  return view.editable === true && (view.editableWhen === undefined || evaluateViewerCondition(view.editableWhen, viewer));
}

/** Whether rows, entries or cards open the row action's target for this viewer. */
export function rowActionVisible(action: RowAction, viewer: ResolvedViewer): boolean {
  return action.visibleWhen === undefined || evaluateViewerCondition(action.visibleWhen, viewer);
}

/** The tabs this viewer may see, in order. */
export function visibleTabs(view: DashboardView, viewer: ResolvedViewer): DashboardTab[] {
  return view.tabs.filter((t) => t.visibleWhen === undefined || evaluateViewerCondition(t.visibleWhen, viewer));
}

/** The grid items of a tab this viewer may see. Hidden items leave their cell empty; the rest keep their positions. */
export function visibleItems(tab: DashboardTab, viewer: ResolvedViewer): GridItem[] {
  return tab.items.filter((i) => i.visibleWhen === undefined || evaluateViewerCondition(i.visibleWhen, viewer));
}

/** Whether the server allows updating this record: only an explicit `can.update: false` says no. */
export function canUpdate(record: DataRecord): boolean {
  return record.can?.update !== false;
}

/**
 * Whether the server allows this viewer to write one field of the record
 * (RFC 0008 item 9): `can.update` still rules, then `can.fields[fieldId]`
 * narrows it. A record without `can.fields` behaves exactly as before —
 * fail-open, the server decides. The view calls this for the fields its
 * controls write: a calendar's `dateField` (drag), a board's grouping field
 * and `doneField` (drag, the completion tick), and every column inline edit
 * offers.
 */
export function canEditField(record: DataRecord, fieldId: string): boolean {
  return canUpdate(record) && record.can?.fields?.[fieldId] !== false;
}

/** Whether a card may be dragged to the column the grouping field names (RFC 0008 item 9). */
export function canMoveColumn(record: DataRecord, groupFieldId: string): boolean {
  return canEditField(record, groupFieldId);
}

/** One `viewerIn` leaf found in a view: the fact and the values it names. */
export interface ViewerLeaf {
  readonly fact: string;
  readonly values: readonly (string | boolean)[];
}

function leavesOf(condition: Condition | ViewerCondition | undefined, into: ViewerLeaf[]): void {
  if (!condition) return;
  switch (condition.op) {
    case "and":
    case "or":
      for (const c of condition.conditions) leavesOf(c, into);
      return;
    case "not":
      leavesOf(condition.condition, into);
      return;
    case "viewerIn":
      into.push({ fact: condition.fact, values: condition.values });
      return;
    default:
      return;
  }
}

/**
 * Every `viewerIn` leaf a view reads, in document order: its own conditions,
 * the views it embeds (dashboard view widgets) and the views its row actions
 * open, each visited once. Filters carry none (the validator rejects them).
 */
export function viewerLeavesRead(view: ViewDocument, documents: Iterable<Document>): ViewerLeaf[] {
  const all = [...documents];
  const leaves: ViewerLeaf[] = [];
  const visited = new Set<string>();
  const visit = (v: ViewDocument): void => {
    if (visited.has(v.id)) return;
    visited.add(v.id);
    const follow = (id: string): void => {
      const target = all.find((d): d is ViewDocument => d.kind !== "entity" && d.kind !== "viewer" && d.id === id);
      if (target) visit(target);
    };
    switch (v.kind) {
      case "form":
        for (const item of v.sections.flatMap(sectionItems)) { // RFC 0008/9: card 47b
          leavesOf(item.visibleWhen, leaves);
          leavesOf(item.requiredWhen, leaves);
        }
        return;
      case "table":
        for (const column of v.columns) {
          leavesOf(column.visibleWhen, leaves);
          leavesOf(column.editableWhen, leaves);
        }
        break;
      case "calendar":
      case "board":
        leavesOf(v.editableWhen, leaves);
        break;
      case "dashboard":
        for (const tab of v.tabs) {
          leavesOf(tab.visibleWhen, leaves);
          for (const item of tab.items) {
            leavesOf(item.visibleWhen, leaves);
            if (item.widget === "view") follow(item.view);
          }
        }
        return;
    }
    if (v.rowAction) {
      leavesOf(v.rowAction.visibleWhen, leaves);
      follow(v.rowAction.open);
    }
  };
  visit(view);
  return leaves;
}

/**
 * The ids of the viewer facts a view reads (see {@link viewerLeavesRead}),
 * each once: declared facts first, in declaration order, then any others in
 * the order they appear. These are the viewer axes of the state grid; facts
 * nothing reads would only multiply states.
 */
export function viewerFactsRead(view: ViewDocument, documents: Iterable<Document>): string[] {
  const all = [...documents];
  const read = new Set(viewerLeavesRead(view, all).map((l) => l.fact));
  const declared = (findViewerDocument(all)?.facts ?? []).map((f) => f.id).filter((id) => read.has(id));
  return [...declared, ...[...read].filter((id) => !declared.includes(id))];
}
