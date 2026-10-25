import { jsonPointer, validateDocuments, optionValue, VIEWER_FACT_VALUES_MAX, VIEWER_FACT_VALUES_MIN, VIEWER_FACTS_MAX } from "@yadad/core";
import type { Document, DocumentError, ViewerDocument, ViewerFact } from "@yadad/core";
import type { Json, PatchOperation } from "@yadad/runtime";

// Patches for the viewer document (RFC 0006): the facts a host can tell the
// renderers about the viewer. A fact's id and type are fixed once created, as
// for field ids; its label, its values and its default can change. Each patch
// starts with a `test` on the document id, so it refuses a stale document.

type Result = { ok: true; patch: PatchOperation[] } | { ok: false; error: DocumentError };

const ok = (patch: PatchOperation[]): Result => ({ ok: true, patch });
const fail = (path: (string | number)[], message: string, hint: string): Result => ({ ok: false, error: { path: jsonPointer(path), code: "invalid-value", message, hint } });
const guard = (doc: ViewerDocument): PatchOperation => ({ op: "test", path: "/id", value: doc.id });

const indexOf = (doc: ViewerDocument, factId: string): number => doc.facts.findIndex((f) => f.id === factId);

/** A new fact. A select fact starts with two values and the first as its default; a boolean starts at false (the least-privileged answer). */
export function newViewerFact(id: string, label: string, type: ViewerFact["type"]): ViewerFact {
  return type === "select"
    ? { id, label, type: "select", options: { source: "static", values: ["viewer", "member"] }, default: "viewer" }
    : { id, label, type: "boolean", default: false };
}

/** Appends a fact. */
export function addViewerFact(doc: ViewerDocument, fact: ViewerFact): Result {
  if (doc.facts.length >= VIEWER_FACTS_MAX) return fail(["facts"], `A viewer document declares at most ${VIEWER_FACTS_MAX} facts.`, "Remove a fact first.");
  if (indexOf(doc, fact.id) >= 0) return fail(["facts"], `There is already a fact "${fact.id}".`, "Pick another id.");
  return ok([guard(doc), { op: "add", path: "/facts/-", value: fact as unknown as Json }]);
}

/** Removes a fact. A viewer document keeps at least one fact. */
export function removeViewerFact(doc: ViewerDocument, factId: string): Result {
  const i = indexOf(doc, factId);
  if (i < 0) return fail(["facts"], `"${factId}" is not a fact.`, "Pick one of the declared facts.");
  if (doc.facts.length === 1) return fail(["facts"], "A viewer document declares at least one fact.", "Delete the viewer document instead, or add another fact first.");
  return ok([guard(doc), { op: "test", path: `/facts/${i}/id`, value: factId }, { op: "remove", path: `/facts/${i}` }]);
}

/** Moves a fact one place; the order is the order of the "View as" controls and of the state axes. */
export function moveViewerFact(doc: ViewerDocument, factId: string, by: -1 | 1): Result {
  const i = indexOf(doc, factId);
  if (i < 0) return fail(["facts"], `"${factId}" is not a fact.`, "Pick one of the declared facts.");
  const to = i + by;
  if (to < 0 || to >= doc.facts.length) return ok([]);
  return ok([guard(doc), { op: "test", path: `/facts/${i}/id`, value: factId }, { op: "move", from: `/facts/${i}`, path: `/facts/${to}` }]);
}

/** Changes a fact's label. */
export function setViewerFactLabel(doc: ViewerDocument, factId: string, label: string): Result {
  const i = indexOf(doc, factId);
  if (i < 0) return fail(["facts"], `"${factId}" is not a fact.`, "Pick one of the declared facts.");
  if (label.trim() === "") return fail(["facts", i, "label"], "A fact needs a label.", "Type a name for the fact.");
  if (doc.facts[i]?.label === label.trim()) return ok([]);
  return ok([guard(doc), { op: "test", path: `/facts/${i}/id`, value: factId }, { op: "replace", path: `/facts/${i}/label`, value: label.trim() }]);
}

/** Sets what a viewer the host says nothing about gets. */
export function setViewerFactDefault(doc: ViewerDocument, factId: string, value: string | boolean): Result {
  const i = indexOf(doc, factId);
  const fact = doc.facts[i];
  if (!fact) return fail(["facts"], `"${factId}" is not a fact.`, "Pick one of the declared facts.");
  if (fact.type === "select" ? typeof value !== "string" || !fact.options.values.some((o) => optionValue(o) === value) : typeof value !== "boolean") {
    return fail(["facts", i, "default"], `${String(value)} is not a value of ${factId}.`, "Pick one of the fact's values.");
  }
  if (fact.default === value) return ok([]);
  return ok([guard(doc), { op: "test", path: `/facts/${i}/id`, value: factId }, { op: "replace", path: `/facts/${i}/default`, value }]);
}

/** Adds a value to a select fact. */
export function addViewerFactValue(doc: ViewerDocument, factId: string, value: string): Result {
  const i = indexOf(doc, factId);
  const fact = doc.facts[i];
  if (!fact || fact.type !== "select") return fail(["facts"], `"${factId}" is not a select fact.`, "Only select facts have values.");
  const v = value.trim();
  if (v === "") return fail(["facts", i, "options", "values"], "A value cannot be blank.", "Type the value.");
  if (fact.options.values.some((o) => optionValue(o) === v)) return fail(["facts", i, "options", "values"], `${factId} already has the value "${v}".`, "Pick another value.");
  if (fact.options.values.length >= VIEWER_FACT_VALUES_MAX) return fail(["facts", i, "options", "values"], `A select fact has at most ${VIEWER_FACT_VALUES_MAX} values.`, "Remove a value first.");
  return ok([guard(doc), { op: "test", path: `/facts/${i}/id`, value: factId }, { op: "add", path: `/facts/${i}/options/values/-`, value: v }]);
}

/** Removes a value of a select fact. The default cannot go: pick another default first. */
export function removeViewerFactValue(doc: ViewerDocument, factId: string, value: string): Result {
  const i = indexOf(doc, factId);
  const fact = doc.facts[i];
  if (!fact || fact.type !== "select") return fail(["facts"], `"${factId}" is not a select fact.`, "Only select facts have values.");
  const at = fact.options.values.findIndex((o) => optionValue(o) === value);
  if (at < 0) return fail(["facts", i, "options", "values"], `${factId} has no value "${value}".`, "Pick one of its values.");
  if (fact.options.values.length <= VIEWER_FACT_VALUES_MIN) return fail(["facts", i, "options", "values"], `A select fact keeps at least ${VIEWER_FACT_VALUES_MIN} values.`, "Add another value first.");
  if (fact.default === value) return fail(["facts", i, "default"], `"${value}" is the default of ${factId}.`, "Make another value the default, then remove this one.");
  return ok([guard(doc), { op: "test", path: `/facts/${i}/options/values/${at}`, value }, { op: "remove", path: `/facts/${i}/options/values/${at}` }]);
}

/**
 * What an edit of the viewer document would break elsewhere in the set: the
 * errors the candidate causes that the current document does not (a condition
 * naming a removed fact or value), as `document` + `path` + message. Empty
 * when nothing else reads what changed. The validator is the source of truth,
 * so this stays right as the places a viewer condition may appear grow.
 */
export function viewerEditConflicts(current: ViewerDocument, candidate: ViewerDocument, documents: readonly Document[]): DocumentError[] {
  const others = documents.filter((d) => d.kind !== "viewer");
  const failures = (viewer: ViewerDocument): DocumentError[] => {
    const result = validateDocuments([...others, viewer]);
    return result.ok ? [] : [...result.errors];
  };
  const key = (e: DocumentError) => `${e.document ?? ""}|${e.path}|${e.code}`;
  const before = new Set(failures(current).map(key));
  return failures(candidate).filter((e) => !before.has(key(e)) && e.document !== candidate.id);
}
