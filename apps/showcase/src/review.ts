import { ForbiddenError, SPEC_VERSION } from "@yadad/core";
import type { DataAdapter, Document, EntityDocument, TableView } from "@yadad/core";
import { createMemoryAdapter } from "@yadad/runtime";
import type { ActionHandler } from "@yadad/runtime";

/**
 * The "notes with history" review example (RFC 0007: changes, history,
 * decisions). Records whose text is overwritten over time, a version history
 * you compare and restore, and pending decisions a second role acts on.
 *
 * Deliberately generic — no real service names. The entity and action
 * documents follow the review set from `fixtures/valid-sets/review.json`
 * (card 33); what a fixture set cannot carry is added here: a `kind` on
 * changes (edit / retire) and a server-derived `is_current` on versions — a
 * document cannot compute that, so the data source owns it and the handlers
 * keep it in step, exactly as a server would. ~31 change rows sit on a
 * `paging: "cursor"` memory adapter so cursor paging shows, and the action
 * handlers carry the card's two failures: `apply` refuses a non-owner with a
 * 403, and `simulateAnotherEditor` bumps a record's version behind the
 * screen so the next press earns a 409 from the adapter's own baseVersion
 * guard — the real source of a conflict, not a stage trick.
 */

/** What the "View as" role switch says about the viewer. The host decides; the demo shows both. */
export type ReviewRole = "editor" | "owner";

// ---------------------------------------------------------------------------
// Documents.
// ---------------------------------------------------------------------------

const REV = SPEC_VERSION;

const recordVersionEntity: EntityDocument = {
  kind: "entity",
  specVersion: REV,
  id: "record_version",
  revision: 1,
  fields: [
    { id: "key", type: "text", label: "Key", required: true },
    { id: "version", type: "number", label: "Version", min: 1, step: 1 },
    { id: "state", type: "select", label: "State", options: { source: "static", values: ["current", "superseded", "deleted"] } },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["edit", "retire"] } },
    { id: "changed_at", type: "datetime", label: "Changed at", required: true },
    { id: "author", type: "text", label: "Author" },
    { id: "body", type: "text", label: "Body" },
    { id: "previous_body", type: "text", label: "Body before the change" },
    // Server-derived: true on the one current version of each key. The data
    // source writes it; a viewer condition could read it.
    { id: "is_current", type: "boolean", label: "Is current" },
  ],
  actions: [
    {
      id: "restore_version",
      label: "Restore this version",
      confirm: {
        title: "Restore version",
        message: "Make this version the current one? The current version is kept in the history.",
        confirmLabel: "Restore",
      },
      // Reads the server-derived flag, per the card.
      visibleWhen: { op: "neq", field: "is_current", value: true },
    },
  ],
};

const decisionEntity: EntityDocument = {
  kind: "entity",
  specVersion: REV,
  id: "decision",
  revision: 1,
  fields: [
    { id: "code", type: "text", label: "Code", required: true },
    { id: "state", type: "select", label: "State", options: { source: "static", values: ["pending", "applied", "rejected"] } },
    { id: "kind", type: "select", label: "Kind", options: { source: "static", values: ["merge", "retire", "rename"] } },
    { id: "summary", type: "text", label: "Summary", required: true },
    { id: "confidence", type: "number", label: "Confidence", min: 0, max: 1, step: 0.01 },
    { id: "created_at", type: "datetime", label: "Proposed at" },
    { id: "decided_at", type: "datetime", label: "Decided at" },
    { id: "decided_by", type: "text", label: "Decided by" },
    { id: "reject_reason", type: "text", label: "Reason" },
    { id: "evidence", type: "text", label: "Evidence" },
  ],
  actions: [
    {
      id: "apply",
      label: "Apply",
      confirm: { message: "Apply this decision? It changes the records it names." },
      visibleWhen: { op: "eq", field: "state", value: "pending" },
    },
    {
      id: "reject",
      label: "Reject",
      confirm: { title: "Reject decision", message: "Reject this decision?", confirmLabel: "Reject", tone: "danger" },
      input: [{ id: "reason", type: "text", label: "Reason (optional)" }],
      visibleWhen: { op: "eq", field: "state", value: "pending" },
    },
    {
      id: "restore",
      label: "Restore",
      confirm: { message: "Move this decision back to pending?" },
      visibleWhen: { op: "in", field: "state", values: ["applied", "rejected"] },
    },
  ],
};

const decisionRecordEntity: EntityDocument = {
  kind: "entity",
  specVersion: REV,
  id: "decision_record",
  revision: 1,
  fields: [
    { id: "decision_code", type: "text", label: "Decision code", required: true },
    { id: "record", type: "reference", label: "Record", entity: "record_version", display: "key" },
    { id: "role", type: "select", label: "Role", options: { source: "static", values: ["subject", "target"] } },
  ],
};

const changesView: TableView = {
  kind: "table",
  specVersion: REV,
  id: "review_changes",
  entity: "record_version",
  revision: 1,
  dataSource: "review",
  title: "Changes",
  // Overwritten or deleted versions only: the current text lives in the record itself.
  filter: { op: "in", field: "state", values: ["superseded", "deleted"] },
  columns: [
    { field: "kind" },
    { field: "changed_at" },
    { field: "key" },
    { field: "author" },
    { field: "body", compare: { field: "previous_body" } },
  ],
  sort: [{ field: "changed_at", dir: "desc" }],
  // kind, by whom, and since (the quick filter on the datetime).
  quickFilters: [{ field: "kind" }, { field: "author" }, { field: "changed_at" }],
  pageSize: 8, // 31 rows: cursor paging shows
  rowAction: { open: "review_history", bind: [{ field: "key", to: "key" }] },
};

const historyView: TableView = {
  kind: "table",
  specVersion: REV,
  id: "review_history",
  entity: "record_version",
  revision: 1,
  dataSource: "review",
  title: "Version history",
  columns: [
    { field: "version" },
    { field: "changed_at" },
    { field: "author" },
    { field: "state" },
    // Oldest first; each body diffed against the row before it.
    { field: "body", compare: { to: "previousRow" } },
  ],
  sort: [{ field: "version", dir: "asc" }],
  recordActions: ["restore_version"],
};

const decisionsView: TableView = {
  kind: "table",
  specVersion: REV,
  id: "review_decisions",
  entity: "decision",
  revision: 1,
  dataSource: "review",
  title: "Decisions",
  columns: [
    { field: "kind" },
    { field: "summary" },
    { field: "confidence" },
    { field: "created_at" },
    { field: "evidence" },
  ],
  sort: [{ field: "created_at", dir: "desc" }],
  quickFilters: [{ field: "state" }, { field: "created_at" }],
  recordActions: ["apply", "reject", "restore"],
  rowAction: { open: "review_decision_records", bind: [{ field: "code", to: "decision_code" }] },
};

const decisionRecordsView: TableView = {
  kind: "table",
  specVersion: REV,
  id: "review_decision_records",
  entity: "decision_record",
  revision: 1,
  dataSource: "review",
  title: "Records named by the decision",
  columns: [{ field: "record" }, { field: "role" }],
};

/** The whole set: entities before views, so set validation resolves references. */
export const reviewDocuments: readonly Document[] = [recordVersionEntity, decisionEntity, decisionRecordEntity, changesView, historyView, decisionsView, decisionRecordsView];

// ---------------------------------------------------------------------------
// Seed data + data source.
// ---------------------------------------------------------------------------

const AUTHORS = ["ana", "bo", "cy", "dee"] as const;
const LINES = [
  "Bring water.",
  "Bring water and snacks.",
  "Start at the park.",
  "Start at the library.",
  "Call before arriving.",
  "Call a day before arriving.",
  "Keep the receipt.",
  "Keep the receipt in the drawer.",
  "Lock the gate after dark.",
  "Water the ferns on Fridays.",
] as const;

/** Zero-padded ISO instants, so the adapter's text sort is also the date order. */
const ts = (day: number, minuteOfDay: number): string =>
  `2026-10-${String(day).padStart(2, "0")}T${String(Math.floor(minuteOfDay / 60) % 24).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}:00Z`;

/** Indexes a const array without the `| undefined` the checked build would otherwise spread. */
function pick<T>(xs: readonly T[], i: number): T {
  const x = xs[i % xs.length];
  if (x === undefined) throw new Error("unreachable: modulo of a non-empty array");
  return x;
}

export interface ReviewStore {
  /** The adapter the showcase registers under the `review` dataSource key. */
  readonly adapter: DataAdapter;
  /** Record id of a seeded version, by `<key>:<version>` — for tests. */
  versionId(key: string, version: number): string;
  /** Record id of a seeded decision, by code — for tests. */
  decisionId(code: string): string;
  /**
   * The "Simulate another editor" button: rewrites the record with its own
   * values, which bumps its version. The screen still holds the old
   * `baseVersion`, so its next act is a 409 — the same conflict a real
   * concurrent write produces, from the adapter's own guard.
   */
  simulateAnotherEditor(entity: string, id: string): Promise<void>;
}

/**
 * The seeded review data source. `getRole` reads the host's current "View as"
 * role (RFC 0006: the host knows the viewer, the documents do not).
 */
export function reviewStore(getRole: () => ReviewRole): ReviewStore {
  // The ids create hands out, tracked in seed order so handlers and tests can
  // name records. The memory adapter assigns ids from one counter; the seed
  // below is the only writer before the store is returned.
  const ids = new Map<string, string>();

  const handlers: Readonly<Record<string, ActionHandler>> = {
    // Restore: this version becomes current, the old current keeps its row
    // and becomes superseded. The adapter writes what this returns for the
    // acted-on record; the demotion is a second write (the memory adapter's
    // body is synchronous, so it lands before the act resolves).
    "record_version.restore_version": (record) => {
      const key = String(record.values["key"] ?? "");
      const previous = ids.get(`${key}:current`);
      if (previous !== undefined && previous !== record.id) void raw.update("record_version", previous, { state: "superseded", is_current: false }, { entityRevision: 1 });
      ids.set(`${key}:current`, record.id);
      return { values: { state: "current", is_current: true } };
    },
    "decision.apply": (record) => {
      // The card's 403: an editor may propose, only the owner may apply.
      if (getRole() !== "owner") throw new ForbiddenError(`Only the owner can apply decision ${String(record.values["code"] ?? "")}.`);
      return { values: { state: "applied", decided_at: ts(20, 600), decided_by: `role:${getRole()}` } };
    },
    "decision.reject": (record, input) => ({
      values: {
        state: "rejected",
        decided_at: ts(20, 660),
        decided_by: `role:${getRole()}`,
        reject_reason: typeof input["reason"] === "string" && input["reason"] !== "" ? input["reason"] : null,
      },
    }),
    "decision.restore": () => ({ values: { state: "pending", decided_at: null, decided_by: null, reject_reason: null } }),
  };

  const raw = createMemoryAdapter({
    paging: "cursor", // never counts: the pager shows Previous/Next without "of N"
    fields: {
      record_version: ["key", "version", "state", "kind", "changed_at", "author", "body", "previous_body", "is_current"],
      decision: ["code", "state", "kind", "summary", "confidence", "created_at", "decided_at", "decided_by", "reject_reason", "evidence"],
      decision_record: ["decision_code", "record", "role"],
    },
    actions: handlers,
  });

  seed(raw, ids);

  const REQUIRED: Readonly<Record<string, string>> = { record_version: "key", decision: "code", decision_record: "decision_code" };
  return {
    adapter: raw,
    versionId: (key, version) => ids.get(`${key}:${version}`) ?? "",
    decisionId: (code) => ids.get(`decision:${code}`) ?? "",
    async simulateAnotherEditor(entity, id) {
      const record = await raw.findOne(entity, id);
      if (record === null) return;
      const field = REQUIRED[entity] ?? "key";
      // Rewriting a value with itself is still a write: version bumps, values do not move.
      // Every seeded record carries its required field, so the `?? ""` never fires.
      await raw.update(entity, id, { [field]: record.values[field] ?? "" }, { entityRevision: 1 });
    },
  };
}

const DECISION_SEEDS: readonly { code: string; state: "pending" | "applied" | "rejected"; kind: "merge" | "retire" | "rename"; summary: string; confidence: number; evidence: string; reject_reason?: string }[] = [
  { code: "DEC-101", state: "pending", kind: "merge", summary: "Merge the two park lists", confidence: 0.92, evidence: "Both lists describe the Friday walk and share three items." },
  { code: "DEC-102", state: "pending", kind: "retire", summary: "Retire the 2019 route sheet", confidence: 0.61, evidence: "Replaced by the library route; no reads in ninety days." },
  { code: "DEC-103", state: "pending", kind: "rename", summary: "Rename receipts to expenses", confidence: 0.35, evidence: "Two other documents already call it expenses." },
  { code: "DEC-104", state: "applied", kind: "merge", summary: "Merge the call lists", confidence: 0.88, evidence: "Duplicates in both." },
  { code: "DEC-105", state: "rejected", kind: "retire", summary: "Retire the fern log", confidence: 0.2, evidence: "Low traffic.", reject_reason: "The garden club still reads it." },
  { code: "DEC-106", state: "applied", kind: "rename", summary: "Rename gates to entries", confidence: 0.7, evidence: "Clearer in the mobile view." },
];

/** Codes of the seeded decisions, for the page's "Simulate another editor" picker. */
export const DECISION_CODES: readonly string[] = DECISION_SEEDS.map((d) => d.code);
/** Keys of the seeded notes (note_1 .. note_15), same order. */
export const NOTE_KEYS: readonly string[] = Array.from({ length: 15 }, (_, i) => `note_${i + 1}`);

/**
 * Seeds 15 keys x 3 versions + one deleted version (31 change rows), six
 * decisions, and the records the pending ones name. The memory adapter's
 * writes have no await inside them, so the tables are complete by the time
 * this returns — the same fire-and-forget seeding `team.ts` uses.
 */
function seed(db: DataAdapter, ids: Map<string, string>): void {
  for (let k = 1; k <= 15; k += 1) {
    const key = `note_${k}`;
    for (let v = 1; v <= 3; v += 1) {
      const body = pick(LINES, k + v);
      void db
        .create(
          "record_version",
          {
            key,
            version: v,
            state: v === 3 ? "current" : "superseded",
            kind: v === 2 ? "retire" : "edit",
            changed_at: ts(1 + ((k * 3 + v) % 26), (k * 37 + v * 11) % 1440),
            author: pick(AUTHORS, k + v),
            body,
            ...(v > 1 ? { previous_body: pick(LINES, k + v - 1) } : {}),
            is_current: v === 3,
          },
          { entityRevision: 1 },
        )
        .then((record) => {
          ids.set(`${key}:${v}`, record.id);
          if (v === 3) ids.set(`${key}:current`, record.id);
        });
    }
  }
  void db
    .create(
      "record_version",
      { key: "note_1", version: 4, state: "deleted", kind: "retire", changed_at: ts(27, 610), author: "ana", body: "Retire the whole page.", previous_body: pick(LINES, 1), is_current: false },
      { entityRevision: 1 },
    )
    .then((record) => ids.set("note_1:4", record.id));

  for (const [i, d] of DECISION_SEEDS.entries()) {
    void db
      .create(
        "decision",
        {
          code: d.code,
          state: d.state,
          kind: d.kind,
          summary: d.summary,
          confidence: d.confidence,
          evidence: d.evidence,
          created_at: ts(10 + i, (i * 137) % 1440),
          ...(d.state !== "pending" ? { decided_at: ts(18 + i, 30), decided_by: "owner" } : {}),
          ...(d.reject_reason !== undefined ? { reject_reason: d.reject_reason } : {}),
        },
        { entityRevision: 1 },
      )
      .then((record) => ids.set(`decision:${d.code}`, record.id));
  }
}
