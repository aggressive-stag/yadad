// Spec migrations: upgrade a document written for an older specVersion to the
// current one. Each step moves a document up exactly one version, so a
// document several versions behind runs through every step in order.

import { SPEC_VERSION } from "./document.js";

type JsonObject = { readonly [key: string]: unknown };

interface MigrationStep {
  readonly from: number;
  readonly to: number;
  /** What changed in the format, for people reading the list. */
  readonly description: string;
  readonly run: (doc: JsonObject) => JsonObject;
}

/** The steps, oldest first. Add one whenever SPEC_VERSION bumps. */
export const MIGRATIONS: readonly MigrationStep[] = [
  {
    from: 0,
    to: 1,
    description: 'Version 1 adds relative dates ({ "daysFromToday": N }) in conditions and number/date quick filters. Every version 0 document stays valid, so this step only stamps the new version.',
    run: (doc) => ({ ...doc, specVersion: 1 }),
  },
  {
    from: 1,
    to: 2,
    description: "Version 2 adds the first slices of RFCs 0001-0003: the dashboard `stat` widget, the `reference` field type and the table `rowAction`. Every version 1 document stays valid, so this step only stamps the new version.",
    run: (doc) => ({ ...doc, specVersion: 2 }),
  },
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Upgrades a document to the current specVersion. Anything that is not an
 * object with a known older numeric specVersion is returned unchanged, so
 * `validateDocument` still reports it. The input is never mutated.
 */
export function migrate(input: unknown): unknown {
  if (!isObject(input)) return input;
  let doc: JsonObject = input;
  for (;;) {
    const version = doc["specVersion"];
    if (typeof version !== "number" || version >= SPEC_VERSION) return doc;
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) return doc;
    doc = step.run(doc);
  }
}
