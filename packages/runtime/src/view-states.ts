import { isIsoDate, isRelativeDate, jsonPointer } from "@yadad/core";
import type {
  BoardView,
  CalendarMode,
  CalendarView,
  Condition,
  DashboardView,
  DataRecord,
  Document,
  EntityDocument,
  Field,
  FieldValue,
  FormView,
  RecordValues,
  Scalar,
  TableView,
  ViewDocument,
} from "@yadad/core";
import { BOARD_MAX_CARDS, boardGroupChoices } from "./board.js";
import { CALENDAR_MAX_RECORDS, calendarToday, visibleDays, visibleRange } from "./calendar.js";
import type { DateRange } from "./calendar.js";
import { combineAxes } from "./combine-axes.js";
import type { AxisSelection } from "./combine-axes.js";
import { dateFromToday, evaluateCondition } from "./condition.js";
import { validateRecord } from "./record.js";

/** The most states `viewStates` returns when `limit` is not given. */
export const VIEW_STATES_DEFAULT_LIMIT = 24;
/** The most states per embedded view when a dashboard combines them, when `embeddedLimit` is not given. */
export const VIEW_STATES_DEFAULT_EMBEDDED_LIMIT = 3;
/** Rows per page of a table view that sets no `pageSize`. */
export const TABLE_DEFAULT_PAGE_SIZE = 25;

/** What an axis varies. New kinds are added to this union as new axes appear. */
export type StateAxisKind = "field" | "fill" | "records" | "mode" | "group" | "tab" | "widget";

export interface StateAxisValue {
  /** Stable within its axis. */
  readonly id: string;
  /** Readable, e.g. "due yesterday". */
  readonly label: string;
}

/**
 * One dimension a view varies along, as data: a stable id, a label and the
 * values it takes. A state picks one value id per axis (`ViewState.values`).
 * Field axes are called "field:<fieldId>", embedded dashboard views
 * "widget:<gridItemId>"; the others are "fill", "records", "mode", "group"
 * and "tab".
 */
export interface StateAxis {
  readonly id: string;
  readonly label: string;
  readonly kind: StateAxisKind;
  readonly values: readonly StateAxisValue[];
}

export interface FormStateRender {
  readonly kind: "form";
  readonly view: string;
  /** The form's current values. They are a draft: they may break the entity's rules (an empty required field). */
  readonly values: RecordValues;
  readonly now: Date;
}

interface CollectionRenderBase {
  readonly view: string;
  /** What the data source holds for the view's entity. Every record validates against the entity. */
  readonly records: readonly DataRecord[];
  /** Ids of the records that pass the view's `filter` (all of them when it has none). */
  readonly matching: readonly string[];
  readonly now: Date;
}

export interface TableStateRender extends CollectionRenderBase {
  readonly kind: "table";
  readonly pageSize: number;
}

export interface CalendarStateRender extends CollectionRenderBase {
  readonly kind: "calendar";
  readonly mode: CalendarMode;
  /** The date the calendar is anchored on: today, as "YYYY-MM-DD". */
  readonly anchor: string;
  /** The first and last visible days in `mode`. */
  readonly range: DateRange;
}

export interface BoardStateRender extends CollectionRenderBase {
  readonly kind: "board";
  /** The `groupBy` field the board is grouped by. */
  readonly groupBy: string;
}

export interface DashboardStateRender {
  readonly kind: "dashboard";
  readonly view: string;
  /** The tab shown. */
  readonly tab: string;
  /** One entry per embedded view widget on that tab, each in one of that view's states. */
  readonly widgets: readonly { readonly item: string; readonly view: string; readonly state: ViewState }[];
  readonly now: Date;
}

/** What to render for a state, discriminated on `kind`. */
export type ViewStateRender = FormStateRender | TableStateRender | CalendarStateRender | BoardStateRender | DashboardStateRender;

export interface ViewState {
  /** Stable: built from the axis and value ids, so the same document and `now` give the same id. */
  readonly id: string;
  /** Readable, e.g. "status = done · due yesterday · 1 record". */
  readonly label: string;
  /** The chosen value id per axis id. An axis that does not apply to this state is absent. */
  readonly values: Readonly<Record<string, string>>;
  readonly render: ViewStateRender;
}

/** A state or axis value that could not be built, and why. */
export interface SkippedState {
  readonly id: string;
  readonly reason: string;
}

export interface ViewStatesOptions {
  /** The moment relative dates and "today" resolve against. Required, so the result is a pure function of its input. */
  readonly now: Date;
  /** The most states to return. Defaults to VIEW_STATES_DEFAULT_LIMIT (24). */
  readonly limit?: number;
  /** A dashboard takes at most this many states of each embedded view. Defaults to VIEW_STATES_DEFAULT_EMBEDDED_LIMIT (3). */
  readonly embeddedLimit?: number;
  /** Records in the "many records" state of a table, calendar or board. Defaults to one more than a table's page size, or than the calendar's or board's cap (so the load is truncated). */
  readonly manyRecords?: number;
}

export interface ViewStatesResult {
  readonly view: string;
  readonly axes: readonly StateAxis[];
  readonly states: readonly ViewState[];
  readonly skipped: readonly SkippedState[];
  /** "full": every combination of the axes. "pairwise": every pair of values from two axes appears in some state. */
  readonly strategy: "full" | "pairwise";
  /** False when `limit` cut the full product or the pairwise cover short. */
  readonly complete: boolean;
}

// --- values ---

interface Candidate {
  readonly id: string;
  readonly label: string;
  /** null means empty. */
  readonly value: FieldValue;
}

const EMPTY_ID = "empty";
const SAMPLE_TEXT = "Sample text";
const SAMPLE_REFERENCE = "ref-1";
const LONG_TEXT = `${"A long line of text that keeps going and wraps onto further lines. ".repeat(4)}${"Unbroken".repeat(10)}`;

function problemOf(field: Field, value: FieldValue): string | undefined {
  const entity: EntityDocument = { kind: "entity", specVersion: 4, id: "check", revision: 1, fields: [field] };
  const path = jsonPointer([field.id]);
  return validateRecord(entity, { [field.id]: value }).find((e) => e.path === path)?.message;
}

const validFor = (field: Field, value: FieldValue): boolean => problemOf(field, value) === undefined;

/** The first of `candidates` that is valid for the field, else null. */
function firstValid(field: Field, candidates: readonly FieldValue[]): FieldValue {
  for (const value of candidates) if (validFor(field, value)) return value;
  return null;
}

/** A plain, valid value for a field, or null when none could be found. */
function typicalValue(field: Field, today: string): FieldValue {
  switch (field.type) {
    case "text":
      return SAMPLE_TEXT;
    case "number": {
      const lowStep = field.min !== undefined && field.step !== undefined ? field.min + field.step : undefined;
      return firstValid(field, [field.min, lowStep, 1, 0, field.max].filter((v): v is number => v !== undefined));
    }
    case "boolean":
      return true;
    case "select":
      return field.options.values[0] ?? null;
    case "date":
      return firstValid(field, [today, field.min, field.max].filter((v): v is string => v !== undefined));
    case "reference":
      return SAMPLE_REFERENCE;
  }
}

/** The value of the i-th record of a "many records" load: varied, so every select option, both booleans and several references appear. */
function variedValue(field: Field, index: number, today: string): FieldValue {
  const base = typicalValue(field, today);
  switch (field.type) {
    case "text":
      return `${SAMPLE_TEXT} ${index + 1}`;
    case "boolean":
      return validFor(field, index % 2 === 0) ? index % 2 === 0 : base;
    case "select":
      return field.options.values[index % Math.max(1, field.options.values.length)] ?? base;
    case "reference":
      return `ref-${(index % 3) + 1}`;
    default:
      return base;
  }
}

function longValue(field: Field, today: string): FieldValue {
  if (field.type === "text") return LONG_TEXT;
  if (field.type === "select") return [...field.options.values].sort((a, b) => b.length - a.length)[0] ?? typicalValue(field, today);
  return typicalValue(field, today);
}

// --- date helpers (calendar dates as "YYYY-MM-DD", via UTC so nothing shifts) ---

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + days);
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function dayWord(date: string, today: string): string | undefined {
  if (date === shiftDate(today, -1)) return "yesterday";
  if (date === today) return "today";
  if (date === shiftDate(today, 1)) return "tomorrow";
  return undefined;
}

function decimals(n: number): number {
  const text = String(n);
  const dot = text.indexOf(".");
  return dot < 0 || text.includes("e") ? 0 : text.length - dot - 1;
}

const roundTo = (n: number): number => Number(n.toFixed(10));

// --- walking conditions ---

interface Probes {
  /** Values compared with eq, neq, gt, gte, lt, lte: boundaries around each. */
  readonly thresholds: Scalar[];
  /** Values that match exactly (in). */
  readonly members: Scalar[];
  /** Substrings (contains). */
  readonly contains: string[];
}

/** Collects, per compared field and in order of first appearance, what the conditions compare it with. Relative dates resolve against `now`. */
function collectProbes(conditions: readonly Condition[], now: Date, into: Map<string, Probes> = new Map()): Map<string, Probes> {
  const probesOf = (field: string): Probes => {
    let probes = into.get(field);
    if (!probes) {
      probes = { thresholds: [], members: [], contains: [] };
      into.set(field, probes);
    }
    return probes;
  };
  const walk = (condition: Condition): void => {
    switch (condition.op) {
      case "and":
      case "or":
        condition.conditions.forEach(walk);
        return;
      case "not":
        walk(condition.condition);
        return;
      case "empty":
      case "notEmpty":
        probesOf(condition.field);
        return;
      case "in":
        probesOf(condition.field).members.push(...condition.values);
        return;
      case "contains":
        probesOf(condition.field).contains.push(condition.value);
        return;
      default:
        probesOf(condition.field).thresholds.push(isRelativeDate(condition.value) ? dateFromToday(condition.value.daysFromToday, now) : condition.value);
    }
  };
  conditions.forEach(walk);
  return into;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

interface CandidateContext {
  readonly today: string;
  /** Form values may be incomplete or out of range (a draft); record values must validate. */
  readonly draft: boolean;
}

interface FieldCandidates {
  readonly candidates: Candidate[];
  readonly skipped: SkippedState[];
}

/** The boundary values to try for one field, by type. See the README for the rules. */
function fieldCandidates(field: Field, probes: Probes, ctx: CandidateContext): FieldCandidates {
  const name = field.id;
  const all: Candidate[] = [];
  const emptyCandidate: Candidate = { id: EMPTY_ID, label: `${name} empty`, value: null };
  const valued = (value: FieldValue, label?: string): Candidate => ({ id: `v:${String(value)}`, label: label ?? `${name} = ${String(value)}`, value });
  const numbers = (list: readonly Scalar[]): number[] => list.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const strings = (list: readonly Scalar[]): string[] => list.filter((v): v is string => typeof v === "string");

  switch (field.type) {
    case "select":
      all.push(emptyCandidate, ...field.options.values.map((v) => valued(v)));
      break;
    case "boolean":
      all.push(emptyCandidate, valued(false), valued(true));
      break;
    case "number": {
      const values: number[] = [];
      for (const v of numbers(probes.thresholds)) {
        const delta = field.step ?? (Number.isInteger(v) ? 1 : 10 ** -decimals(v));
        values.push(roundTo(v - delta), v, roundTo(v + delta));
      }
      const members = numbers(probes.members);
      values.push(...members);
      if (probes.thresholds.length === 0 && members.length > 0) {
        values.push(roundTo(Math.max(...members) + (field.step ?? 1)));
      }
      if (values.length === 0) {
        const typical = typicalValue(field, ctx.today);
        if (typeof typical === "number") values.push(typical);
      }
      all.push(emptyCandidate, ...unique(values).sort((a, b) => a - b).map((v) => valued(v)));
      break;
    }
    case "date": {
      const values: string[] = [];
      for (const v of strings(probes.thresholds).filter(isIsoDate)) values.push(shiftDate(v, -1), v, shiftDate(v, 1));
      values.push(...strings(probes.members).filter(isIsoDate));
      if (values.length === 0) {
        const typical = typicalValue(field, ctx.today);
        if (typeof typical === "string") values.push(typical);
      }
      const dateCandidate = (v: string): Candidate => {
        const word = dayWord(v, ctx.today);
        return valued(v, word ? `${name} ${word}` : `${name} ${v}`);
      };
      all.push(emptyCandidate, ...unique(values).sort().map(dateCandidate));
      break;
    }
    case "text": {
      const compared = unique([...strings(probes.thresholds), ...strings(probes.members), ...probes.contains].filter((v) => v.trim() !== ""));
      all.push(emptyCandidate, { id: "filled", label: `${name} filled`, value: SAMPLE_TEXT });
      for (const v of compared) if (v !== SAMPLE_TEXT) all.push(valued(v, `${name} = ${v.length > 24 ? `${v.slice(0, 24)}…` : v}`));
      break;
    }
    case "reference": {
      const compared = unique([...strings(probes.thresholds), ...strings(probes.members)].filter((v) => v.trim() !== "" && v !== SAMPLE_REFERENCE));
      all.push(emptyCandidate, { id: "set", label: `${name} set`, value: SAMPLE_REFERENCE }, ...compared.map((v) => valued(v)));
      break;
    }
  }

  if (ctx.draft) return { candidates: all, skipped: [] };
  const candidates: Candidate[] = [];
  const skipped: SkippedState[] = [];
  for (const candidate of all) {
    const problem = problemOf(field, candidate.value);
    if (problem === undefined) candidates.push(candidate);
    // An empty value for a required field is simply not a record: leave it out without a note.
    else if (candidate.value !== null) skipped.push({ id: `field:${name}=${candidate.id}`, reason: problem });
  }
  return { candidates, skipped };
}

// --- plans: the axes of a view, and how to build a state from a selection ---

type Built = { readonly ok: true; readonly render: ViewStateRender } | { readonly ok: false; readonly reason: string };

interface Plan {
  readonly axes: StateAxis[];
  readonly skipped: SkippedState[];
  build(selection: AxisSelection): Built;
}

interface Context {
  readonly documents: readonly Document[];
  readonly now: Date;
  readonly today: string;
  readonly options: ViewStatesOptions;
}

const FIELD_AXIS = "field:";

function findEntity(ctx: Context, id: string): EntityDocument | undefined {
  return ctx.documents.find((d): d is EntityDocument => d.kind === "entity" && d.id === id);
}

function findView(ctx: Context, id: string): ViewDocument | undefined {
  return ctx.documents.find((d): d is ViewDocument => d.kind !== "entity" && d.id === id);
}

interface FieldAxes {
  readonly axes: StateAxis[];
  readonly skipped: SkippedState[];
  /** Candidates by field axis id. */
  readonly byAxis: Map<string, readonly Candidate[]>;
}

function buildFieldAxes(entity: EntityDocument, probes: ReadonlyMap<string, Probes>, ctx: CandidateContext): FieldAxes {
  const axes: StateAxis[] = [];
  const skipped: SkippedState[] = [];
  const byAxis = new Map<string, readonly Candidate[]>();
  for (const [fieldId, fieldProbes] of probes) {
    const field = entity.fields.find((f) => f.id === fieldId);
    if (!field) continue;
    const found = fieldCandidates(field, fieldProbes, ctx);
    skipped.push(...found.skipped);
    if (found.candidates.length === 0) continue;
    const id = `${FIELD_AXIS}${fieldId}`;
    byAxis.set(id, found.candidates);
    axes.push({ id, label: field.label, kind: "field", values: found.candidates.map((c) => ({ id: c.id, label: c.label })) });
  }
  return { axes, skipped, byAxis };
}

/** The values the selection sets on field axes. */
function selectedValues(byAxis: ReadonlyMap<string, readonly Candidate[]>, selection: AxisSelection): Map<string, FieldValue> {
  const out = new Map<string, FieldValue>();
  for (const [axisId, candidates] of byAxis) {
    const chosen = selection[axisId];
    const candidate = candidates.find((c) => c.id === chosen);
    if (candidate) out.set(axisId.slice(FIELD_AXIS.length), candidate.value);
  }
  return out;
}

function formItems(view: FormView) {
  return view.sections.flatMap((s) => s.items);
}

function planForm(view: FormView, ctx: Context): Plan {
  const entity = findEntity(ctx, view.entity);
  if (!entity) return missing(`entity "${view.entity}" is not among the documents`);
  const conditions = formItems(view).flatMap((i) => [i.visibleWhen, i.requiredWhen].filter((c): c is Condition => c !== undefined));
  const found = buildFieldAxes(entity, collectProbes(conditions, ctx.now), { today: ctx.today, draft: true });
  const fill: StateAxis = {
    id: "fill",
    label: "Other fields",
    kind: "fill",
    values: [
      { id: "empty", label: "other fields empty" },
      { id: "filled", label: "other fields filled" },
    ],
  };
  const formFields = formItems(view).flatMap((i) => entity.fields.filter((f) => f.id === i.field));
  return {
    axes: [...found.axes, fill],
    skipped: found.skipped,
    build(selection) {
      const values: Record<string, FieldValue> = {};
      if (selection["fill"] === "filled") {
        for (const field of formFields) {
          const value = typicalValue(field, ctx.today);
          if (value !== null) values[field.id] = value;
        }
      }
      for (const [fieldId, value] of selectedValues(found.byAxis, selection)) {
        if (value === null) delete values[fieldId];
        else values[fieldId] = value;
      }
      return { ok: true, render: { kind: "form", view: view.id, values, now: ctx.now } };
    },
  };
}

function missing(reason: string): Plan {
  return { axes: [], skipped: [{ id: "view", reason }], build: () => ({ ok: false, reason }) };
}

type CollectionView = TableView | CalendarView | BoardView;
type RecordsChoice = "none" | "one" | "empty" | "long" | "edges" | "many";

function recordsAxis(view: CollectionView, manyCount: number): StateAxis {
  const values: StateAxisValue[] = [
    { id: "none", label: "no records" },
    { id: "one", label: "1 record" },
    { id: "empty", label: "1 record, optional values empty" },
    { id: "long", label: "1 record, long text" },
  ];
  if (view.kind === "calendar") values.push({ id: "edges", label: "records on the first and last visible day" });
  values.push({ id: "many", label: `${manyCount} records` });
  return { id: "records", label: "Records", kind: "records", values };
}

function planCollection(view: CollectionView, ctx: Context): Plan {
  const entity = findEntity(ctx, view.entity);
  if (!entity) return missing(`entity "${view.entity}" is not among the documents`);

  const probes = collectProbes(view.filter ? [view.filter] : [], ctx.now);
  // A row action copies a field of the clicked row into the target's filter: both an empty and a set value matter.
  for (const binding of view.rowAction?.bind ?? []) if (!probes.has(binding.field)) probes.set(binding.field, { thresholds: [], members: [], contains: [] });
  const found = buildFieldAxes(entity, probes, { today: ctx.today, draft: false });

  const defaultMany = view.kind === "table" ? (view.pageSize ?? TABLE_DEFAULT_PAGE_SIZE) + 1 : (view.kind === "calendar" ? CALENDAR_MAX_RECORDS : BOARD_MAX_CARDS) + 1;
  const manyCount = Math.max(2, ctx.options.manyRecords ?? defaultMany);
  const axes: StateAxis[] = [...found.axes, recordsAxis(view, manyCount)];

  let modes: readonly CalendarMode[] = [];
  let groupFields: readonly string[] = [];
  if (view.kind === "calendar") {
    modes = view.modes ?? ["month", "week"];
    axes.push({ id: "mode", label: "Mode", kind: "mode", values: modes.map((m) => ({ id: m, label: `${m} view` })) });
  } else if (view.kind === "board") {
    const choices = boardGroupChoices(view, entity);
    groupFields = choices.map((c) => c.field);
    axes.push({ id: "group", label: "Group by", kind: "group", values: choices.map((c) => ({ id: c.field, label: `grouped by ${c.field}` })) });
  }

  const dateFieldId = view.kind === "calendar" ? view.dateField : undefined;

  return {
    axes,
    skipped: found.skipped,
    build(selection) {
      const mode: CalendarMode = view.kind === "calendar" ? (modes.find((m) => m === selection["mode"]) ?? modes[0] ?? "month") : "month";
      const weekStartsOn = view.kind === "calendar" ? (view.weekStartsOn ?? 1) : 1;
      const range = visibleRange(ctx.today, mode, weekStartsOn);
      const days = view.kind === "calendar" ? visibleDays(ctx.today, mode, weekStartsOn, ctx.today).map((d) => d.date) : [];
      const fromAxes = selectedValues(found.byAxis, selection);
      const choice = (selection["records"] ?? "none") as RecordsChoice;

      const subject = (shape: "typical" | "empty" | "long"): RecordValues => {
        const values: Record<string, FieldValue> = {};
        for (const field of entity.fields) {
          values[field.id] =
            shape === "empty" ? (field.required === true ? typicalValue(field, ctx.today) : null) : shape === "long" ? longValue(field, ctx.today) : typicalValue(field, ctx.today);
        }
        for (const [fieldId, value] of fromAxes) values[fieldId] = value;
        return values;
      };
      const varied = (index: number): RecordValues => {
        const values: Record<string, FieldValue> = {};
        for (const field of entity.fields) values[field.id] = variedValue(field, index, ctx.today);
        if (dateFieldId !== undefined && days.length > 0) values[dateFieldId] = days[index % days.length] ?? ctx.today;
        return values;
      };

      let valueList: RecordValues[] = [];
      if (choice === "one") valueList = [subject("typical")];
      else if (choice === "empty") valueList = [subject("empty")];
      else if (choice === "long") valueList = [subject("long")];
      else if (choice === "edges" && dateFieldId !== undefined) {
        valueList = [{ ...subject("typical"), [dateFieldId]: range.first }, { ...subject("typical"), [dateFieldId]: range.last }];
      } else if (choice === "many") {
        valueList = [subject("typical")];
        for (let i = 1; i < manyCount; i++) valueList.push(varied(i));
      }

      const records: DataRecord[] = valueList.map((values, i) => ({ id: `rec-${i + 1}`, entityId: entity.id, entityRevision: entity.revision, version: "1", values }));
      for (const record of records) {
        const problem = validateRecord(entity, record.values)[0];
        if (problem) return { ok: false, reason: `generated record ${record.id} is not valid: ${problem.message}` };
      }
      const filter = view.filter;
      const matching = records.filter((r) => filter === undefined || evaluateCondition(filter, r.values, ctx.now)).map((r) => r.id);
      const base = { view: view.id, records, matching, now: ctx.now };
      if (view.kind === "table") return { ok: true, render: { kind: "table", ...base, pageSize: view.pageSize ?? TABLE_DEFAULT_PAGE_SIZE } };
      if (view.kind === "calendar") return { ok: true, render: { kind: "calendar", ...base, mode, anchor: ctx.today, range } };
      const groupBy = groupFields.find((f) => f === selection["group"]) ?? groupFields[0] ?? "";
      return { ok: true, render: { kind: "board", ...base, groupBy } };
    },
  };
}

// --- assembling states ---

const stateId = (axes: readonly StateAxis[], selection: AxisSelection): string => {
  const parts = axes.filter((a) => selection[a.id] !== undefined).map((a) => `${a.id}=${selection[a.id]}`);
  return parts.length === 0 ? "default" : parts.join(";");
};

const stateLabel = (axes: readonly StateAxis[], selection: AxisSelection): string => {
  const parts = axes.flatMap((a) => {
    const value = a.values.find((v) => v.id === selection[a.id]);
    return value ? [value.label] : [];
  });
  return parts.length === 0 ? "default" : parts.join(" · ");
};

function assemble(view: ViewDocument, plan: Plan, limit: number): ViewStatesResult {
  const combined = combineAxes(plan.axes, limit);
  const states: ViewState[] = [];
  const skipped = [...plan.skipped];
  for (const selection of combined.selections) {
    const id = stateId(plan.axes, selection);
    const built = plan.build(selection);
    if (built.ok) states.push({ id, label: stateLabel(plan.axes, selection), values: selection, render: built.render });
    else if (!skipped.some((s) => s.id === "view")) skipped.push({ id, reason: built.reason });
  }
  return { view: view.id, axes: plan.axes, states, skipped, strategy: combined.strategy, complete: combined.complete };
}

function dashboardStates(view: DashboardView, ctx: Context, limit: number): ViewStatesResult {
  const embeddedLimit = ctx.options.embeddedLimit ?? VIEW_STATES_DEFAULT_EMBEDDED_LIMIT;
  const skipped: SkippedState[] = [];
  const cache = new Map<string, ViewStatesResult | undefined>();
  const embedded = (id: string): ViewStatesResult | undefined => {
    if (!cache.has(id)) {
      const target = findView(ctx, id);
      if (!target) skipped.push({ id: `view:${id}`, reason: `view "${id}" is not among the documents` });
      else if (target.kind === "dashboard") skipped.push({ id: `view:${id}`, reason: `dashboard "${id}" cannot be embedded in a dashboard` });
      cache.set(id, target && target.kind !== "dashboard" ? viewStatesIn(target, ctx, embeddedLimit) : undefined);
    }
    return cache.get(id);
  };

  const axes: StateAxis[] = [{ id: "tab", label: "Tab", kind: "tab", values: view.tabs.map((t) => ({ id: t.id, label: `tab ${t.title}` })) }];
  const widgetAxes = new Map<string, StateAxis>();
  const tabWidgets = view.tabs.map((tab) =>
    tab.items.flatMap((item) => {
      if (item.widget !== "view") return [];
      const result = embedded(item.view);
      if (!result || result.states.length === 0) return [];
      const axis: StateAxis = {
        id: `widget:${item.id}`,
        label: `${item.id} (${item.view})`,
        kind: "widget",
        values: result.states.map((s) => ({ id: s.id, label: `${item.view}: ${s.label}` })),
      };
      widgetAxes.set(axis.id, axis);
      axes.push(axis);
      return [{ item: item.id, view: item.view, axis, result }];
    }),
  );
  for (const result of cache.values()) skipped.push(...(result?.skipped.map((s) => ({ id: `${result.view}/${s.id}`, reason: s.reason })) ?? []));

  const states: ViewState[] = [];
  let complete = view.tabs.length <= limit;
  let strategy: "full" | "pairwise" = "full";
  let remaining = limit;
  const tabs = view.tabs.slice(0, limit);
  tabs.forEach((tab, index) => {
    const widgets = tabWidgets[index] ?? [];
    const allot = Math.max(1, Math.floor(remaining / (tabs.length - index)));
    const combined = combineAxes(widgets.map((w) => w.axis), allot);
    if (!combined.complete) complete = false;
    if (combined.strategy === "pairwise") strategy = "pairwise";
    for (const picked of combined.selections) {
      const selection: Record<string, string> = { tab: tab.id, ...picked };
      const widgetStates = widgets.flatMap((w) => {
        const state = w.result.states.find((s) => s.id === picked[w.axis.id]);
        return state ? [{ item: w.item, view: w.view, state }] : [];
      });
      states.push({
        id: stateId(axes, selection),
        label: stateLabel(axes, selection),
        values: selection,
        render: { kind: "dashboard", view: view.id, tab: tab.id, widgets: widgetStates, now: ctx.now },
      });
    }
    remaining -= combined.selections.length;
  });
  for (const result of cache.values()) if (result && !result.complete) complete = false;
  return { view: view.id, axes, states, skipped, strategy, complete };
}

function viewStatesIn(view: ViewDocument, ctx: Context, limit: number): ViewStatesResult {
  if (view.kind === "dashboard") return dashboardStates(view, ctx, limit);
  const plan = view.kind === "form" ? planForm(view, ctx) : planCollection(view, ctx);
  return assemble(view, plan, limit);
}

/**
 * Lists the states a view can be in, read from its documents: a pure
 * function of the view, the documents it needs and `options.now`.
 *
 * - Every condition the view uses (form `visibleWhen` and `requiredWhen`, the
 *   `filter` of a table, calendar or board, row-action bindings) becomes
 *   field axes with boundary values by type (see the README).
 * - The view kind adds axes: forms a `fill` axis; tables, calendars and boards
 *   a `records` axis (none, one, one with optional values empty, one with long
 *   text, many) plus a calendar's `mode` and a board's `group`; dashboards a
 *   `tab` axis and one axis per embedded view.
 * - Axes are combined into at most `limit` states: all combinations when they
 *   fit, else a deterministic pairwise cover (`combineAxes`).
 * - A state or value that cannot be built is left out and listed in `skipped`.
 *
 * `documents` are the entities and views the view needs (embedded views of a
 * dashboard included). The same input always gives the same states in the
 * same order.
 */
export function viewStates(view: ViewDocument, documents: readonly Document[], options: ViewStatesOptions): ViewStatesResult {
  const limit = options.limit ?? VIEW_STATES_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer, got ${limit}`);
  const ctx: Context = { documents, now: options.now, today: calendarToday(options.now), options };
  return viewStatesIn(view, ctx, limit);
}
