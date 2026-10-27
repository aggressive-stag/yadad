import { isHhMm, isIsoDate, jsonPointer, optionValue, sectionItems } from "@yadad/core"; // RFC 0008: card 47a (optionValue keeps compiling; 47d reviews)
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
  Page,
  RecordAction,
  RecordValues,
  ResolvedViewer,
  Scalar,
  SeriesBucket,
  TableView,
  ViewDocument,
} from "@yadad/core";
import { AGGREGATE_MAX_RECORDS } from "./aggregate.js";
import { BOARD_MAX_CARDS, boardGroupChoices } from "./board.js";
import { runQuery } from "./memory-adapter.js";
import { CALENDAR_MAX_RECORDS, calendarToday, visibleDays, visibleRange } from "./calendar.js";
import type { DateRange } from "./calendar.js";
import { combineAxes } from "./combine-axes.js";
import type { AxisSelection } from "./combine-axes.js";
import { dateFromToday, evaluateCondition, resolveComparisonValue } from "./condition.js";
import { validateRecord } from "./record.js";
import { findViewerDocument, resolveViewer, viewerLeavesRead, visibleTabs } from "./viewer.js";

/** The most states `viewStates` returns when `limit` is not given. */
export const VIEW_STATES_DEFAULT_LIMIT = 24;
/** The most states per embedded view when a dashboard combines them, when `embeddedLimit` is not given. */
export const VIEW_STATES_DEFAULT_EMBEDDED_LIMIT = 3;
/** Rows per page of a table view that sets no `pageSize`. */
export const TABLE_DEFAULT_PAGE_SIZE = 25;

/** What an axis varies. New kinds are added to this union as new axes appear. */
export type StateAxisKind = "field" | "fill" | "records" | "mode" | "group" | "tab" | "widget" | "viewer" | "permission" | "action" | "paging" | "filter" | "quick" | "rows";

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
 * "widget:<gridItemId>", viewer facts "viewer:<factId>" and record actions
 * "action:<actionId>"; the others are "fill", "records", "mode", "group",
 * "tab" and "permission".
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
  /** For a batch composer (`repeat: "batch"`): how many rows are queued. Pass it to the renderer's `initialRows`. Absent otherwise. */
  readonly rows?: number;
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
  /**
   * The page shape the `paging` axis picked (RFC 0007): `total` counts the
   * matching records for the counting pager; `next` is the opaque token of a
   * cursor server (`null` on the last page, absent when the axis is `total`).
   */
  readonly total?: number;
  readonly next?: string | null;
  /**
   * The id of the named saved filter the `savedFilter` axis lit (RFC 0009
   * item 5); absent when none is. Pass it to the renderer's `savedFilter`
   * prop. `matching` already counts the saved condition.
   */
  readonly savedFilter?: string;
  /**
   * Present when the view has a quick filter with a `default` (RFC 0010 item 4): `applied` is the state a
   * viewer opens on (the renderer seeds the defaults), `cleared` is the state after the viewer cleared every
   * defaulted control. `matching` is unaffected: it counts the view's `filter` and the saved filter only.
   */
  readonly quickDefaults?: "applied" | "cleared";
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

/** One series widget of a dashboard state, with the records its groups were seeded from (RFC 0001 slice 2, card 43g). */
export interface SeriesStateWidget {
  readonly item: string;
  readonly view: string;
  /** The widget's `groupBy` field. */
  readonly groupBy: string;
  /** `"none"`, `"one"` or `"many"` — the value the `groups` axis picked. */
  readonly groups: string;
  /** True when the table holds more records than `records.length`: the groups cover a partial read. */
  readonly partial: boolean;
  /** The seeded records for this widget's entity (also reachable from the table widget's own state). */
  readonly records: readonly DataRecord[];
}

export interface DashboardStateRender {
  readonly kind: "dashboard";
  readonly view: string;
  /** The tab shown. */
  readonly tab: string;
  /** One entry per embedded view widget on that tab, each in one of that view's states. */
  readonly widgets: readonly { readonly item: string; readonly view: string; readonly state: ViewState }[];
  /** One entry per series widget on the tab, in grid order (card 43g). */
  readonly series?: readonly SeriesStateWidget[];
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
  /**
   * The viewer this state renders for: every fact of the set's viewer document
   * at the value the state picks (the declared default for facts the view does
   * not read). `{ facts: [] }` when the set has no viewer document.
   */
  readonly viewer: ResolvedViewer;
  /** True only on the "viewer not provided" state: render it with the `viewer` prop omitted; it must look like the state of all defaults. */
  readonly omitViewer?: true;
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
  /**
   * The zone generated `datetime` values are rendered in (RFC 0007). They are
   * fixed instants relative to `now`; this option picks their printed offset
   * so a snapshot does not drift with the machine's zone. Defaults to "UTC".
   */
  readonly timeZone?: string;
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
  return validateRecord(entity, { [field.id]: value }, { mode: "stored" }).find((e) => e.path === path)?.message;
}

const validFor = (field: Field, value: FieldValue): boolean => problemOf(field, value) === undefined;

/** The first of `candidates` that is valid for the field, else null. */
function firstValid(field: Field, candidates: readonly FieldValue[]): FieldValue {
  for (const value of candidates) if (validFor(field, value)) return value;
  return null;
}

/** The wall-clock date and time of an instant in an IANA zone, as stored-form pieces. */
function zoneStamp(instant: Date, timeZone: string): { date: string; clock: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, clock: `${get("hour")}:${get("minute")}` };
}

/**
 * The generated `datetime` value (RFC 0007): 09:30 on `now`'s day in `timeZone`,
 * as a fixed instant in the one stored form. The zone's offset at 09:30 UTC that
 * day corrects the guess once; the value is pinned to the wall clock.
 */
function typicalDatetime(now: Date, timeZone: string): string {
  const day = zoneStamp(now, timeZone).date;
  const target = Date.parse(`${day}T09:30:00.000Z`); // the wall clock we want, read as if UTC
  let instant = new Date(target);
  for (let i = 0; i < 3; i++) {
    // What the zone shows for the current guess, read back as UTC: the gap to the wall clock we want.
    const stamp = zoneStamp(instant, timeZone);
    const corrected = new Date(instant.getTime() + (target - Date.parse(`${stamp.date}T${stamp.clock}:00.000Z`)));
    if (corrected.getTime() === instant.getTime()) break;
    instant = corrected;
  }
  return instant.toISOString();
}

/** A plain, valid value for a field, or null when none could be found. `datetime` is the instant generated `datetime` fields carry. */
function typicalValue(field: Field, today: string, datetime?: string): FieldValue {
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
      return (field.options.values[0] === undefined ? null : optionValue(field.options.values[0])); // RFC 0008: card 47a
    case "date":
      return firstValid(field, [today, field.min, field.max].filter((v): v is string => v !== undefined));
    case "datetime":
      // RFC 0007: the generated instant (relative to options.now, rendered in options.timeZone); field bounds still win when they exclude it.
      return firstValid(field, [datetime, `${today}T09:30:00.000Z`, field.min, field.max].filter((v): v is string => v !== undefined));
    case "reference":
      return SAMPLE_REFERENCE;
    case "time": // RFC 0008: card 47k
      return firstValid(field, [field.min, "09:30", field.max].filter((v): v is string => v !== undefined));
    case "tags": // RFC 0008: card 47k
      return firstValid(field, [["alpha"], ["beta", "gamma"]]);
  }
}

/** The value of the i-th record of a "many records" load: varied, so every select option, both booleans and several references appear. */
function variedValue(field: Field, index: number, today: string, datetime?: string): FieldValue {
  const base = typicalValue(field, today, datetime);
  switch (field.type) {
    case "text":
      return `${SAMPLE_TEXT} ${index + 1}`;
    case "boolean":
      return validFor(field, index % 2 === 0) ? index % 2 === 0 : base;
    case "select":
      { const vs = field.options.values; const pick = vs[index % Math.max(1, vs.length)]; return pick === undefined ? base : optionValue(pick); } // RFC 0008: card 47a
    case "reference":
      return `ref-${(index % 3) + 1}`;
    case "tags": // RFC 0008: card 47k — both the filled and the varied list appear
      return index % 2 === 0 ? base : ["beta"];
    default:
      return base;
  }
}

function longValue(field: Field, today: string, datetime?: string): FieldValue {
  if (field.type === "text") return LONG_TEXT;
  if (field.type === "select") { const vs = field.options.values.map(optionValue); return vs.sort((a, b) => b.length - a.length)[0] ?? typicalValue(field, today, datetime); } // RFC 0008: card 47a
  return typicalValue(field, today, datetime);
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
function collectProbes(conditions: readonly Condition[], now: Date, into: Map<string, Probes> = new Map(), factValues?: ReadonlyMap<string, readonly Scalar[]>): Map<string, Probes> {
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
      case "viewerIn":
        // A viewer leaf compares no record field, so it adds no probes; its fact becomes a viewer axis (buildViewerPlan).
        return;
      case "fieldEqFact": {
        // RFC 0009 (card 47h): the compared value is the viewer's. The record field still needs an
        // axis: probe it, and seed it with the fact's own values so a state can make the comparison true.
        const compared = probesOf(condition.field);
        for (const value of factValues?.get(condition.field) ?? []) compared.thresholds.push(value);
        return;
      }
      default:
        probesOf(condition.field).thresholds.push(resolveComparisonValue(condition.value, now));
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
  /** The generated `datetime` instant (RFC 0007), from `options.now` and `options.timeZone`. */
  readonly datetime: string;
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
      all.push(emptyCandidate, ...field.options.values.map((v) => valued(optionValue(v)))); // RFC 0008: card 47a
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
        const typical = typicalValue(field, ctx.today, ctx.datetime);
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
        const typical = typicalValue(field, ctx.today, ctx.datetime);
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
    case "time": {
      // RFC 0008: card 47k — a few clocks plus whatever a condition compares against.
      // Card 47h adds the boundary: 23:59, the last minute the `hh:mm` contract admits.
      const values = unique([...strings(probes.thresholds).filter(isHhMm), ...strings(probes.members).filter(isHhMm), "09:30", "17:00", "23:59"]);
      all.push(emptyCandidate, ...values.map((v) => valued(v)));
      break;
    }
    case "tags": {
      // RFC 0008: card 47k — empty, one tag, many; condition values become single-tag lists (evaluation is 47d's).
      const tags = unique([...strings(probes.members), ...strings(probes.contains)].filter((v) => v !== ""));
      // Card 47h: a duplicate-tag list is valid (0008 item 15 tolerates duplicates on read) — the display must survive it.
      all.push(emptyCandidate, valued(["alpha"], `${name} = alpha`), ...tags.map((v) => valued([v], `${name} = ${v}`)), valued(["alpha", "beta"], `${name} = alpha, beta`), valued(["alpha", "alpha"], `${name} = alpha, alpha (duplicate)`));
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
  /** The generated `datetime` instant (RFC 0007): 09:30 on `now`'s day in `options.timeZone`. */
  readonly datetime: string;
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

/**
 * RFC 0009 (card 47h): per record field a `fieldEqFact` leaf compares with a
 * fact, the fact's own possible values (booleans both, selects at most two).
 * `collectProbes` seeds these so the field axis holds a value some viewer
 * state equals — the comparison gets a true state as well as a false one.
 */
function factValuesByField(view: ViewDocument, ctx: Context): Map<string, Scalar[]> {
  const out = new Map<string, Scalar[]>();
  const document = findViewerDocument(ctx.documents);
  for (const leaf of viewerLeavesRead(view, ctx.documents)) {
    if (leaf.field === undefined) continue;
    const fact = document?.facts.find((f) => f.id === leaf.fact);
    if (fact === undefined) continue;
    const values: Scalar[] = fact.type === "boolean" ? [true, false] : fact.options.values.slice(0, 2).map(optionValue);
    out.set(leaf.field, [...(out.get(leaf.field) ?? []), ...values]);
  }
  return out;
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
  return view.sections.flatMap(sectionItems); // RFC 0008/9: card 47b
}

function planForm(view: FormView, ctx: Context): Plan {
  const entity = findEntity(ctx, view.entity);
  if (!entity) return missing(`entity "${view.entity}" is not among the documents`);
  const conditions = formItems(view).flatMap((i) => [i.visibleWhen, i.requiredWhen].filter((c): c is Condition => c !== undefined));
  // A batch composer renders empty rows only (drafts do not apply to it), so fact values seeded
  // into a `fieldEqFact` field axis would ask for a true-comparison state it can never render.
  const factSeed = view.repeat === "batch" ? undefined : factValuesByField(view, ctx);
  const found = buildFieldAxes(entity, collectProbes(conditions, ctx.now, undefined, factSeed), { today: ctx.today, datetime: ctx.datetime, draft: true });
  const fill: StateAxis = {
    id: "fill",
    label: "Other fields",
    kind: "fill",
    values: [
      { id: "empty", label: "other fields empty" },
      { id: "filled", label: "other fields filled" },
    ],
  };
  const rowsAxis: StateAxis = {
    id: "rows",
    label: "Composer rows",
    kind: "rows",
    values: [
      { id: "one", label: "one row" },
      { id: "three", label: "three rows queued" },
    ],
  };
  const isBatch = view.repeat === "batch";
  const formFields = formItems(view).flatMap((i) => entity.fields.filter((f) => f.id === i.field));
  return {
    axes: [...found.axes, fill, ...(isBatch ? [rowsAxis] : [])],
    skipped: found.skipped,
    build(selection) {
      const values: Record<string, FieldValue> = {};
      if (selection["fill"] === "filled") {
        for (const field of formFields) {
          const value = typicalValue(field, ctx.today, ctx.datetime);
          if (value !== null) values[field.id] = value;
        }
      }
      for (const [fieldId, value] of selectedValues(found.byAxis, selection)) {
        if (value === null) delete values[fieldId];
        else values[fieldId] = value;
      }
      return { ok: true, render: { kind: "form", view: view.id, values, ...(isBatch ? { rows: selection["rows"] === "three" ? 3 : 1 } : {}), now: ctx.now } };
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

  const savedFilters = view.kind === "table" ? (view.filters ?? []) : [];
  const probes = collectProbes([...(view.filter ? [view.filter] : []), ...savedFilters.map((f) => f.condition)], ctx.now, undefined, factValuesByField(view, ctx));
  // A row action copies a field of the clicked row into the target's filter: both an empty and a set value matter.
  for (const binding of view.rowAction?.bind ?? []) if (!probes.has(binding.field)) probes.set(binding.field, { thresholds: [], members: [], contains: [] });
  const found = buildFieldAxes(entity, probes, { today: ctx.today, datetime: ctx.datetime, draft: false });

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

  // RFC 0007: one axis per action the view offers, each varying the first record's can.actions.
  const offered = (view.recordActions ?? [])
    .map((id) => entity.actions?.find((a) => a.id === id))
    .filter((a): a is RecordAction => a !== undefined);
  for (const action of offered) {
    axes.push({
      id: `${ACTION_AXIS}${action.id}`,
      label: action.label,
      kind: "action",
      values: [
        { id: "available", label: `${action.id} available` },
        { id: WITHHELD, label: `${action.id} withheld on 1 record` },
      ],
    });
  }
  // RFC 0008 item 12 (card 47h): a calendar or board with a doneField varies the completion toggle both ways.
  const doneFieldId = view.kind === "calendar" || view.kind === "board" ? view.doneField : undefined;
  const doneField = doneFieldId === undefined ? undefined : entity.fields.find((f) => f.id === doneFieldId && f.type === "boolean");
  if (doneField !== undefined)
    axes.push({ id: DONE_AXIS, label: `${doneField.label} toggle`, kind: "field", values: [{ id: "done-true", label: `${doneField.id} done` }, { id: "done-false", label: `${doneField.id} not done` }] });
  // RFC 0008 item 10 (card 47h): a columnsFrom "options" board gains the empty-column state — a
  // target column no card references. The target records ride in the state's record set, so
  // loadBoardTargets really answers with them through the state's adapter.
  const columnsTarget = (() => {
    if (view.kind !== "board" || view.columnsFrom !== "options" || groupFields.length === 0) return undefined;
    const field = entity.fields.find((f) => f.id === groupFields[0]);
    if (field === undefined || field.type !== "reference") return undefined;
    const target = findEntity(ctx, field.entity);
    if (target === undefined) return undefined;
    const display = target.fields.find((f) => f.id === field.display);
    if (display === undefined) return undefined;
    axes.push({
      id: COLUMNS_AXIS,
      label: "Board columns",
      kind: "group",
      values: [
        { id: "covered", label: "every column has cards" },
        { id: "empty-column", label: "a column has no cards" },
      ],
    });
    return { target, displayField: display.id };
  })();
  // RFC 0011 item 3: a table's reference quick filter is a picker over the target entity's records. The target
  // records ride in the state's record set (as a board's columns do), so the picker really loads them through the
  // state's adapter: one per reference value the generated rows carry, plus the filter's default.
  const referenceFilters = (() => {
    if (view.kind !== "table") return [];
    const out: { field: string; target: EntityDocument; displayField: string; defaultId: string | undefined }[] = [];
    for (const q of view.quickFilters ?? []) {
      const field = entity.fields.find((f) => f.id === q.field);
      if (field === undefined || field.type !== "reference") continue;
      const target = findEntity(ctx, field.entity);
      const display = target?.fields.find((f) => f.id === field.display);
      if (target === undefined || display === undefined) continue;
      out.push({ field: field.id, target, displayField: display.id, defaultId: typeof q.default === "string" ? q.default : undefined });
    }
    return out;
  })();
  // RFC 0007: a table also varies how its page is described — counted, a cursor page with more, the last cursor page.
  if (view.kind === "table") {
    axes.push({
      id: PAGING_AXIS,
      label: "Paging",
      kind: "paging",
      values: [
        { id: "total", label: "pages by total" },
        { id: "cursor-more", label: "cursor page, more to come" },
        { id: "cursor-end", label: "cursor page, last" },
      ],
    });
  }

  // RFC 0009 item 5: a table with named saved filters varies which chip is lit — none, then each in document order.
  if (savedFilters.length > 0) {
    axes.push({
      id: SAVED_FILTER_AXIS,
      label: "Saved filter",
      kind: "filter",
      values: [{ id: "none", label: "no saved filter" }, ...savedFilters.map((f) => ({ id: `filter:${f.id}`, label: `saved filter "${f.name}"` }))],
    });
  }

  // RFC 0010 item 4: a table whose quick filters declare a `default` varies whether the viewer still has it.
  const hasQuickDefault = view.kind === "table" && (view.quickFilters ?? []).some((q) => q.default !== undefined);
  if (hasQuickDefault) {
    axes.push({
      id: QUICK_AXIS,
      label: "Quick filter default",
      kind: "quick",
      values: [{ id: "applied", label: "default applied" }, { id: "cleared", label: "default cleared" }],
    });
  }

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
            shape === "empty" ? (field.required === true ? typicalValue(field, ctx.today, ctx.datetime) : null) : shape === "long" ? longValue(field, ctx.today, ctx.datetime) : typicalValue(field, ctx.today, ctx.datetime);
        }
        for (const [fieldId, value] of fromAxes) values[fieldId] = value;
        return values;
      };
      const varied = (index: number): RecordValues => {
        const values: Record<string, FieldValue> = {};
        for (const field of entity.fields) values[field.id] = variedValue(field, index, ctx.today, ctx.datetime);
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

      // RFC 0008 item 12 (card 47h): the doneField axis puts the toggle in every generated record.
      if (doneField !== undefined) {
        const done = selection[DONE_AXIS] !== "done-false";
        valueList = valueList.map((values) => ({ ...values, [doneField.id]: done }));
      }
      const records: DataRecord[] = valueList.map((values, i) => ({ id: `rec-${i + 1}`, entityId: entity.id, entityRevision: entity.revision, version: "1", values }));
      // "withheld" sets can.actions[id] = false on the first generated record, as the permission axis does with update.
      const withheld = offered.filter((a) => selection[`${ACTION_AXIS}${a.id}`] === WITHHELD).map((a) => a.id);
      const marked =
        records.length === 0 || withheld.length === 0
          ? records
          : records.map((r, i) => (i === 0 ? { ...r, can: { ...r.can, actions: { ...r.can?.actions, ...Object.fromEntries(withheld.map((id) => [id, false])) } } } : r));
      for (const record of marked) {
        const problem = validateRecord(entity, record.values, { mode: "stored" })[0];
        if (problem) return { ok: false, reason: `generated record ${record.id} is not valid: ${problem.message}` };
      }
      const litFilter = savedFilters.find((f) => `filter:${f.id}` === selection[SAVED_FILTER_AXIS]);
      const filter: Condition | undefined =
        litFilter === undefined ? view.filter : view.filter === undefined ? litFilter.condition : { op: "and", conditions: [view.filter, litFilter.condition] };
      // Card 45c: the grid's shapes come from runQuery — the same filter/sort/
      // page semantics every in-process adapter has — never from a hand-rolled
      // copy. A filter a real adapter would reject (viewerIn) skips the state
      // with the adapter's own message instead of silently evaluating false.
      const queryBase = {
        ...(filter === undefined ? {} : { filter }),
        ...(view.sort === undefined ? {} : { sort: view.sort }),
      };
      let page: Page<DataRecord>;
      try {
        page = runQuery(marked, { ...queryBase, page: { offset: 0, limit: Number.MAX_SAFE_INTEGER } }, undefined, ctx.now);
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      const matching = page.items.map((r) => r.id);
      let withTargets: readonly DataRecord[] = marked;
      if (view.kind === "table" && referenceFilters.length > 0) {
        const targets = new Map<string, DataRecord>();
        for (const rf of referenceFilters) {
          const ids = new Set<string>(rf.defaultId === undefined ? [] : [rf.defaultId]);
          for (const record of marked) {
            const value = record.values[rf.field];
            if (typeof value === "string" && value !== "") ids.add(value);
          }
          for (const id of ids)
            if (!targets.has(`${rf.target.id}/${id}`)) targets.set(`${rf.target.id}/${id}`, { id, entityId: rf.target.id, entityRevision: rf.target.revision, version: "1", values: { [rf.displayField]: `Option ${id}` } });
        }
        withTargets = [...marked, ...targets.values()];
      }
      const base = { view: view.id, records: withTargets, matching, now: ctx.now };
      if (view.kind === "table") {
        const pageSize = view.pageSize ?? TABLE_DEFAULT_PAGE_SIZE;
        const paging = selection[PAGING_AXIS] ?? "total";
        // The page shape the axis names, produced the way an adapter produces
        // it. `many` is pageSize+1 records by construction (recordsAxis), so a
        // cursor page over the matched set answers "more" honestly.
        const lit = {
          ...(litFilter === undefined ? {} : { savedFilter: litFilter.id }),
          ...(hasQuickDefault ? { quickDefaults: selection[QUICK_AXIS] === "cleared" ? ("cleared" as const) : ("applied" as const) } : {}),
        };
        if (paging === "total") return { ok: true, render: { kind: "table", ...base, ...lit, pageSize, total: matching.length } };
        // `cursor-more` is the first page of pageSize — its `next` is whatever
        // the matched set says (token when a page follows, null when not).
        // `cursor-end` is the last page: it holds the whole matched set, so
        // runQuery can only answer `next: null`. Either way the shape is the
        // adapter's, not a fabricated one.
        const limit = paging === "cursor-more" ? pageSize : matching.length;
        const cursorPage = runQuery(marked, { ...queryBase, page: { offset: 0, limit } }, "cursor", ctx.now);
        // runQuery's cursor branch always answers with `next` (token or null);
        // the `?? null` only satisfies the optional field on Page<T>.
        return { ok: true, render: { kind: "table", ...base, ...lit, pageSize, next: cursorPage.next ?? null } };
      }
      if (view.kind === "calendar") return { ok: true, render: { kind: "calendar", ...base, mode, anchor: ctx.today, range } };
      const groupBy = groupFields.find((f) => f === selection["group"]) ?? groupFields[0] ?? "";
      let boardRecords: readonly DataRecord[] = marked;
      if (columnsTarget !== undefined && groupBy === groupFields[0]) {
        // One target record per reference value the cards carry (the id IS the value, so a card lands
        // in its column), plus — in the empty-column state — one target no card references.
        const seeded = new Map<string, DataRecord>();
        for (const record of marked) {
          const value = record.values[groupBy];
          if (typeof value === "string" && value !== "" && !seeded.has(value))
            seeded.set(value, { id: value, entityId: columnsTarget.target.id, entityRevision: columnsTarget.target.revision, version: "1", values: { [columnsTarget.displayField]: `Column ${value}` } });
        }
        if (selection[COLUMNS_AXIS] === "empty-column")
          seeded.set("ref-uncovered", { id: "ref-uncovered", entityId: columnsTarget.target.id, entityRevision: columnsTarget.target.revision, version: "1", values: { [columnsTarget.displayField]: "No cards" } });
        boardRecords = [...marked, ...seeded.values()];
      }
      return { ok: true, render: { kind: "board", ...base, records: boardRecords, groupBy } };
    },
  };
}

// --- viewer axes ---

const VIEWER_AXIS = "viewer:";
const PERMISSION_AXIS = "permission";
const RECORD_LOCKED = "record-locked";
const ACTION_AXIS = "action:";
const WITHHELD = "withheld";
const DONE_AXIS = "done"; // RFC 0008 item 12 (card 47h): the doneField toggle axis.
const COLUMNS_AXIS = "columns"; // RFC 0008 item 10 (card 47h): the columnsFrom "options" empty-column axis.
const PAGING_AXIS = "paging";
const QUICK_AXIS = "quick"; // RFC 0010 item 4: whether the quick filters' defaults are still applied.
const SAVED_FILTER_AXIS = "filter"; // RFC 0009 item 5: which named saved filter is lit.
/** Id of the extra state that renders with the viewer omitted. */
export const VIEWER_NOT_PROVIDED_STATE = "viewer-not-provided";

interface ViewerPlan {
  /** One axis per viewer fact the view reads, then the permission axis when the view has an edit surface. */
  readonly axes: StateAxis[];
  /** The viewer a selection stands for. */
  viewerFor(selection: AxisSelection): ResolvedViewer;
  /** Per viewer axis, the value id of the fact's default. Undefined when the view reads no fact (no "viewer not provided" state). */
  readonly defaults: AxisSelection | undefined;
}

/** Whether a view lets the viewer change records: an editable table column, calendar or board, or a dashboard embedding one. */
function hasEditSurface(view: ViewDocument, ctx: Context): boolean {
  switch (view.kind) {
    case "form":
      return false;
    case "table":
      return view.columns.some((c) => c.editable === true);
    case "calendar":
    case "board":
      // A doneField toggle is a write too: it needs a record the viewer may not update to show the disabled state.
      return view.editable === true || view.doneField !== undefined;
    case "dashboard":
      return view.tabs.some((tab) =>
        tab.items.some((item) => {
          if (item.widget !== "view") return false;
          const target = findView(ctx, item.view);
          return target !== undefined && target.kind !== "dashboard" && hasEditSurface(target, ctx);
        }),
      );
  }
}

function buildViewerPlan(view: ViewDocument, ctx: Context): ViewerPlan {
  const document = findViewerDocument(ctx.documents);
  const leaves = viewerLeavesRead(view, ctx.documents);
  const axes: StateAxis[] = [];
  const valueIds = new Map<string, Map<string, string | boolean>>();
  const defaults: Record<string, string> = {};
  for (const fact of document?.facts ?? []) {
    const factLeaves = leaves.filter((l) => l.fact === fact.id);
    const named = factLeaves.flatMap((l) => l.values);
    if (named.length === 0 && !factLeaves.some((l) => l.field !== undefined)) continue; // card 47h: a fieldEqFact leaf names no value but still reads the fact
    const choices: (string | boolean)[] = [];
    if (fact.type === "boolean") {
      choices.push(true, false);
    } else if (named.length === 0) {
      choices.push(fact.default, fact.options.values.map(optionValue).find((v) => v !== fact.default) ?? fact.default); // card 47h: the compared-fact pair
    } else {
      // Values a leaf names, plus one that none names (the "everyone else" class): the default when unnamed, else the first unnamed.
      const factValues = fact.options.values.map(optionValue); // RFC 0008: card 47a
      const everyoneElse = named.includes(fact.default) ? factValues.find((v) => !named.includes(v)) : fact.default;
      choices.push(...factValues.filter((v) => named.includes(v) || v === everyoneElse));
    }
    if (choices.length < 2) continue;
    const id = `${VIEWER_AXIS}${fact.id}`;
    valueIds.set(id, new Map(choices.map((c) => [String(c), c])));
    defaults[id] = String(fact.default);
    axes.push({ id, label: fact.label, kind: "viewer", values: choices.map((c) => ({ id: String(c), label: `${fact.id} = ${String(c)}` })) });
  }
  const reads = axes.length > 0;
  if (hasEditSurface(view, ctx)) {
    axes.push({
      id: PERMISSION_AXIS,
      label: "Permissions",
      kind: "permission",
      values: [
        { id: "unrestricted", label: "records open" },
        { id: RECORD_LOCKED, label: "1 record locked" },
      ],
    });
  }
  return {
    axes,
    defaults: reads ? defaults : undefined,
    viewerFor(selection) {
      const facts = (document?.facts ?? []).map((fact) => {
        const picked = valueIds.get(`${VIEWER_AXIS}${fact.id}`)?.get(selection[`${VIEWER_AXIS}${fact.id}`] ?? "");
        return { fact: fact.id, value: picked ?? fact.default };
      });
      return { facts };
    },
  };
}

/** True when the selection marks a record: locked or withheld states are impossible next to "no records". */
const needsRecord = (selection: AxisSelection): boolean =>
  selection[PERMISSION_AXIS] === RECORD_LOCKED ||
  Object.entries(selection).some(([axisId, value]) => axisId.startsWith(ACTION_AXIS) && value === WITHHELD);

/** True when a render has a record to lock: "1 record locked" is impossible next to "no records". */
function hasRecordToLock(render: ViewStateRender): boolean {
  return (render.kind === "table" || render.kind === "calendar" || render.kind === "board") && render.records.length > 0;
}

/** In the record-locked state the first record of a table, calendar or board cannot be updated. */
function lockRecords(render: ViewStateRender, selection: AxisSelection): ViewStateRender {
  if (selection[PERMISSION_AXIS] !== RECORD_LOCKED) return render;
  if (render.kind !== "table" && render.kind !== "calendar" && render.kind !== "board") return render;
  const [first, ...rest] = render.records;
  if (!first) return render;
  return { ...render, records: [{ ...first, can: { ...first.can, update: false } }, ...rest] };
}

// --- assembling states ---

/** RFC 0001 slice 2 (card 43g): how many groups the `many` state draws, when the field can show them. */
const SERIES_MANY_GROUPS = 3;
type SeriesChoice = "none" | "one" | "many" | "partial";
const SERIES_CHOICES: readonly SeriesChoice[] = ["none", "one", "many", "partial"];
const SERIES_CHOICE_LABEL: Record<SeriesChoice, string> = { none: "no groups", one: "1 group", many: `${SERIES_MANY_GROUPS} groups`, partial: `${SERIES_MANY_GROUPS} groups, partial read` };

/** The distinct values a field could group by: option lists verbatim, everything else generated. Dates spread over months when the widget buckets by month. */
function candidateGroupValues(field: Field, bucket: SeriesBucket | undefined, ctx: Context): FieldValue[] {
  switch (field.type) {
    case "select":
      return field.options.values.map(optionValue); // RFC 0008: card 47a
    case "boolean":
      return [true, false];
    case "reference":
      return [1, 2, 3].map((i) => `ref-${i}`);
    case "date":
      return bucket === "month" ? [0, 31, 62].map((d) => dateFromToday(d - 1, ctx.now)) : [0, 1, 2].map((d) => dateFromToday(d - 1, ctx.now));
    default:
      return [1, 2, 3].map((i) => `${SAMPLE_TEXT} ${i}`);
  }
}

/** A series widget's state plan: which group states are possible, and the records each one seeds. */
interface SeriesPlan {
  readonly axisValues: readonly StateAxisValue[];
  /** The records this choice puts in the data source, under the collection generator's own ids. */
  readonly seed: (choice: SeriesChoice) => readonly DataRecord[];
}

/**
 * Plans one series widget's states (43a decision 7: no groups, one group, many
 * groups, a partial read). The seeded records carry distinct values of the
 * `groupBy` field that still satisfy the view's filter and the entity's
 * validation, so the chart really shows that many groups; `partial` puts more
 * records in the table than `aggregateSeries` reads, so it reports a partial
 * read. Records keep the generator's `rec-N` ids — the widget owns the entity's
 * record set for the state, the way the `records` axis does. A field that can
 * show no group under the view's filter is a skipped widget, not an empty chart.
 */
function planSeries(widgetId: string, view: TableView, entity: EntityDocument, groupBy: { readonly field: string; readonly bucket?: SeriesBucket }, ctx: Context): SeriesPlan | { reason: string } {
  const fieldId = groupBy.field;
  const field = entity.fields.find((f) => f.id === fieldId);
  if (!field) return { reason: `series widget "${widgetId}" groups by field "${fieldId}", which entity "${entity.id}" does not have` };
  const base = planCollection(view, ctx);
  const picks: Record<string, string> = {};
  for (const axis of base.axes) if (axis.kind === "field" || axis.id === "records" || axis.id === PAGING_AXIS) picks[axis.id] = axis.values[0]?.id ?? "";
  const built = base.build({ ...picks, records: "many" });
  if (!built.ok || built.render.kind !== "table") return { reason: `series widget "${widgetId}": ${(built.ok ? "unexpected render" : built.reason)}` };
  const baseRecords = built.render.records;
  if (baseRecords.length === 0) return { reason: `series widget "${widgetId}": no records could be generated for entity "${entity.id}"` };
  // A group value is usable when every seeded record keeps passing the view's filter (the loader re-filters) and stays valid.
  const usable = (value: FieldValue | null): boolean =>
    (value !== null || !field.required) &&
    baseRecords.every((r) => {
      const values: RecordValues = { ...r.values, [fieldId]: value };
      return (view.filter === undefined || evaluateCondition(view.filter, values, ctx.now)) && validateRecord(entity, values, { mode: "stored" }).length === 0;
    });
  const good = candidateGroupValues(field, groupBy.bucket, ctx).filter((v) => usable(v));
  const empty = field.required ? false : usable(null);
  if (good.length === 0 && !empty) return { reason: `series widget "${widgetId}": field "${fieldId}" can show no group that the view's filter and validation allow` };
  const achievable: Record<SeriesChoice, boolean> = { none: empty, one: good.length >= 1, many: good.length >= SERIES_MANY_GROUPS, partial: good.length >= SERIES_MANY_GROUPS };
  const axisValues = SERIES_CHOICES.filter((c) => achievable[c]).map((c) => ({ id: c, label: SERIES_CHOICE_LABEL[c] }));
  const seed = (choice: SeriesChoice): readonly DataRecord[] => {
    const allowed = achievable[choice] ? choice : achievable.many ? "many" : achievable.one ? "one" : "none";
    const groups = allowed === "none" ? 0 : allowed === "one" ? 1 : SERIES_MANY_GROUPS;
    const per = Math.min(groups, good.length);
    const total = allowed === "partial" ? AGGREGATE_MAX_RECORDS + 1 : baseRecords.length;
    const records: DataRecord[] = [];
    for (let i = 0; i < total; i++) {
      const src = baseRecords[i % baseRecords.length]!;
      records.push({ ...src, id: `rec-${i + 1}`, values: { ...src.values, [fieldId]: per === 0 ? null : good[i % per]! } });
    }
    return records;
  };
  return { axisValues, seed };
}

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

function assemble(view: ViewDocument, plan: Plan, limit: number, viewer: ViewerPlan): ViewStatesResult {
  const axes = [...plan.axes, ...viewer.axes];
  // The "viewer not provided" state is one more state: it takes one place of the limit.
  const reserve = viewer.defaults !== undefined && limit > 1 ? 1 : 0;
  const combined = combineAxes(axes, limit - reserve);
  const states: ViewState[] = [];
  const skipped = [...plan.skipped];
  const stateFor = (id: string, label: string, selection: AxisSelection, extra?: { omitViewer: true }): void => {
    const built = plan.build(selection);
    // An impossible combination ("no records" with "1 record locked" or a withheld action) is left out, not reported.
    if (built.ok && needsRecord(selection) && !hasRecordToLock(built.render)) return;
    if (built.ok) states.push({ id, label, values: selection, render: lockRecords(built.render, selection), viewer: viewer.viewerFor(selection), ...extra });
    else if (!skipped.some((s) => s.id === "view")) skipped.push({ id, reason: built.reason });
  };
  for (const selection of combined.selections) stateFor(stateId(axes, selection), stateLabel(axes, selection), selection);
  const first = combined.selections[0];
  if (reserve === 1 && viewer.defaults !== undefined && first) {
    const selection: AxisSelection = { ...first, ...viewer.defaults, ...(viewer.axes.some((a) => a.id === PERMISSION_AXIS) ? { [PERMISSION_AXIS]: "unrestricted" } : {}) };
    stateFor(VIEWER_NOT_PROVIDED_STATE, "viewer not provided", selection, { omitViewer: true });
  }
  return { view: view.id, axes, states, skipped, strategy: combined.strategy, complete: combined.complete };
}

function dashboardStates(view: DashboardView, ctx: Context, limit: number, viewer: ViewerPlan): ViewStatesResult {
  const embeddedLimit = ctx.options.embeddedLimit ?? VIEW_STATES_DEFAULT_EMBEDDED_LIMIT;
  const skipped: SkippedState[] = [];
  const cache = new Map<string, ViewStatesResult | undefined>();
  const embedded = (id: string): ViewStatesResult | undefined => {
    if (!cache.has(id)) {
      const target = findView(ctx, id);
      if (!target) skipped.push({ id: `view:${id}`, reason: `view "${id}" is not among the documents` });
      else if (target.kind === "dashboard") skipped.push({ id: `view:${id}`, reason: `dashboard "${id}" cannot be embedded in a dashboard` });
      cache.set(id, target && target.kind !== "dashboard" ? viewStatesIn(target, ctx, embeddedLimit, true) : undefined);
    }
    return cache.get(id);
  };

  const axes: StateAxis[] = [{ id: "tab", label: "Tab", kind: "tab", values: view.tabs.map((t) => ({ id: t.id, label: `tab ${t.title}` })) }];
  // RFC 0001 slice 2 (card 43g): one unit per widget item that varies — an embedded view (its own states) or a series (its groups axis).
  type TabWidget = { item: string; view: string; axis: StateAxis; result: ViewStatesResult };
  type TabSeries = { item: string; view: TableView; entity: EntityDocument; groupBy: string; plan: SeriesPlan; axis: StateAxis };
  type TabUnits = { widgets: TabWidget[]; series: TabSeries[] };
  const tabUnits: TabUnits[] = view.tabs.map((tab) => {
    const widgets: TabWidget[] = [];
    const series: TabSeries[] = [];
    for (const item of tab.items) {
      if (item.widget === "view") {
        const result = embedded(item.view);
        if (!result || result.states.length === 0) continue;
        const axis: StateAxis = {
          id: `widget:${item.id}`,
          label: `${item.id} (${item.view})`,
          kind: "widget",
          values: result.states.map((s) => ({ id: s.id, label: `${item.view}: ${s.label}` })),
        };
        axes.push(axis);
        widgets.push({ item: item.id, view: item.view, axis, result });
      } else if (item.widget === "series") {
        const target = findView(ctx, item.view);
        if (!target || target.kind !== "table") {
          skipped.push({ id: `series:${item.id}`, reason: target ? `series widget "${item.id}" needs a table view; "${item.view}" is a ${target.kind}` : `series widget "${item.id}" points at view "${item.view}", which is not among the documents` });
          continue;
        }
        const entity = findEntity(ctx, target.entity);
        if (!entity) {
          skipped.push({ id: `series:${item.id}`, reason: `series widget "${item.id}" groups over entity "${target.entity}", which is not among the documents` });
          continue;
        }
        const plan = planSeries(item.id, target, entity, item.groupBy, ctx);
        if ("reason" in plan) {
          skipped.push({ id: `series:${item.id}`, reason: plan.reason });
          continue;
        }
        const axis: StateAxis = { id: `widget:${item.id}`, label: `${item.id} (${item.view})`, kind: "widget", values: plan.axisValues };
        axes.push(axis);
        series.push({ item: item.id, view: target, entity, groupBy: item.groupBy.field, plan, axis });
      }
    }
    return { widgets, series };
  });
  for (const result of cache.values()) skipped.push(...(result?.skipped.map((s) => ({ id: `${result.view}/${s.id}`, reason: s.reason })) ?? []));

  const states: ViewState[] = [];
  let complete = view.tabs.length <= limit;
  let strategy: "full" | "pairwise" = "full";
  // The "viewer not provided" state is one more state: it takes one place of the limit.
  const reserve = viewer.defaults !== undefined && limit > 1 ? 1 : 0;
  let remaining = limit - reserve;
  const tabs = view.tabs.slice(0, limit);
  const allAxes = [...axes, ...viewer.axes];
  const stateOf = (tab: DashboardView["tabs"][number], units: TabUnits, picked: AxisSelection, override?: { id: string; label: string; omitViewer: true }): ViewState => {
    const selection: Record<string, string> = { tab: tab.id, ...picked };
    // Embedded states are built without viewer axes; the dashboard's viewer and locked record apply to each.
    const widgetStates = units.widgets.flatMap((w) => {
      const state = w.result.states.find((s) => s.id === picked[w.axis.id]);
      return state ? [{ item: w.item, view: w.view, state: { ...state, render: lockRecords(state.render, picked), viewer: viewer.viewerFor(picked) } }] : [];
    });
    const seriesWidgets = units.series.flatMap((w) => {
      const raw = picked[w.axis.id] ?? "one";
      const choice: SeriesChoice = (SERIES_CHOICES as readonly string[]).includes(raw) ? (raw as SeriesChoice) : "one";
      return [{ item: w.item, view: w.view.id, groupBy: w.groupBy, groups: choice === "partial" ? "many" : choice, partial: choice === "partial", records: w.plan.seed(choice) }];
    });
    return {
      id: override?.id ?? stateId(allAxes, selection),
      label: override?.label ?? stateLabel(allAxes, selection),
      values: selection,
      render: { kind: "dashboard", view: view.id, tab: tab.id, widgets: widgetStates, ...(seriesWidgets.length > 0 ? { series: seriesWidgets } : {}), now: ctx.now },
      viewer: viewer.viewerFor(picked),
      ...(override ? { omitViewer: override.omitViewer } : {}),
    };
  };
  let firstPick: { tab: DashboardView["tabs"][number]; units: TabUnits; picked: AxisSelection } | undefined;
  /** A state for a tab only exists when that viewer can see the tab; a viewer who sees no tab gets one state, on the first tab. */
  const tabShownFor = (tab: DashboardView["tabs"][number], picked: AxisSelection): boolean => {
    const seen = visibleTabs(view, viewer.viewerFor(picked));
    return seen.length === 0 ? tab === view.tabs[0] : seen.some((t) => t.id === tab.id);
  };
  tabs.forEach((tab, index) => {
    const units = tabUnits[index] ?? { widgets: [], series: [] };
    const allot = Math.max(1, Math.floor(remaining / (tabs.length - index)));
    const combined = combineAxes([...units.widgets.map((w) => w.axis), ...units.series.map((w) => w.axis), ...viewer.axes], allot);
    if (!combined.complete) complete = false;
    if (combined.strategy === "pairwise") strategy = "pairwise";
    for (const picked of combined.selections) {
      // Left out: a tab this viewer cannot see (the dashboard shows the first visible tab, so the state would repeat it), and a
      // locked record when no widget shows a record.
      if (!tabShownFor(tab, picked)) continue;
      const state = stateOf(tab, units, picked);
      if (picked[PERMISSION_AXIS] === RECORD_LOCKED && !(state.render.kind === "dashboard" && state.render.widgets.some((w) => hasRecordToLock(w.state.render)))) continue;
      firstPick ??= { tab, units, picked };
      states.push(state);
    }
    remaining -= combined.selections.length;
  });
  if (reserve === 1 && viewer.defaults !== undefined && firstPick) {
    const picked: AxisSelection = { ...firstPick.picked, ...viewer.defaults, ...(viewer.axes.some((a) => a.id === PERMISSION_AXIS) ? { [PERMISSION_AXIS]: "unrestricted" } : {}) };
    // The default viewer may not see the tab the first state is on: use the first tab it sees.
    const shown = visibleTabs(view, viewer.viewerFor(picked))[0];
    const index = shown ? view.tabs.findIndex((t) => t.id === shown.id) : -1;
    const tab = index >= 0 ? (view.tabs[index] ?? firstPick.tab) : firstPick.tab;
    const units = index >= 0 ? (tabUnits[index] ?? firstPick.units) : firstPick.units;
    states.push(stateOf(tab, units, picked, { id: VIEWER_NOT_PROVIDED_STATE, label: "viewer not provided", omitViewer: true }));
  }
  for (const result of cache.values()) if (result && !result.complete) complete = false;
  return { view: view.id, axes: allAxes, states, skipped, strategy, complete };
}

/** `embedded` views (inside a dashboard) get no viewer axes: the dashboard owns them and applies its viewer to every widget. */
function viewStatesIn(view: ViewDocument, ctx: Context, limit: number, embedded = false): ViewStatesResult {
  const viewer: ViewerPlan = embedded
    ? { axes: [], defaults: undefined, viewerFor: () => resolveViewer(findViewerDocument(ctx.documents)).viewer }
    : buildViewerPlan(view, ctx);
  if (view.kind === "dashboard") return dashboardStates(view, ctx, limit, viewer);
  const plan = view.kind === "form" ? planForm(view, ctx) : planCollection(view, ctx);
  return assemble(view, plan, limit, viewer);
}

/**
 * Lists the states a view can be in, read from its documents: a pure
 * function of the view, the documents it needs and `options.now`.
 *
 * - Every condition the view uses (form `visibleWhen` and `requiredWhen`, the
 *   `filter` of a table, calendar or board, row-action bindings) becomes
 *   field axes with boundary values by type (see the README).
 * - The view kind adds axes: forms a `fill` axis (a batch composer also a `rows` axis); tables, calendars and boards
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
  const today = calendarToday(options.now);
  const ctx: Context = { documents, now: options.now, today, datetime: typicalDatetime(options.now, options.timeZone ?? "UTC"), options };
  return viewStatesIn(view, ctx, limit);
}
