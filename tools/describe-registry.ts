// Prints everything a yadad document can contain, from describeContract() in
// @yadad/core: document kinds and their properties, field types and their
// type-specific properties, condition ops and their exact shapes, widget
// types, grid limits, the id pattern and the error codes.
//
// Run: pnpm describe-registry [--json | --kind <kind> | --example <kind>]
//   --kind <kind>     print only that part (entity, form, table, calendar, board, dashboard, viewer, conditions)
//   --example <kind>  print one complete, valid set of documents of that kind (JSON)
//
// Runs against the TypeScript source with a small resolution hook, so it
// works from a fresh clone after `pnpm install` with no build step.
import { registerHooks } from "node:module";
import type { describeContract } from "../packages/core/src/index.ts";
import { existsSync } from "node:fs";
import { EXAMPLE_KINDS, examples } from "./describe-examples.ts";
import type { ExampleKind } from "./describe-examples.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const coreSrc = join(repoRoot, "packages/core/src") + "/";
const coreUrl = pathToFileURL(coreSrc).href;

// Inside @yadad/core source, `./x.js` points at `./x.ts`.
registerHooks({
  resolve(specifier: string, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("file://")) spec = fileURLToPath(spec);
    if (spec.endsWith(".js")) {
      const parentIsCore = context.parentURL !== undefined && context.parentURL.startsWith(coreUrl);
      const entryIsCore = isAbsolute(spec) && spec.startsWith(coreSrc);
      if (parentIsCore || entryIsCore) {
        const mapped = isAbsolute(spec)
          ? spec.slice(0, -".js".length) + ".ts"
          : fileURLToPath(new URL(spec.slice(0, -".js".length) + ".ts", context.parentURL));
        if (existsSync(mapped)) {
          return { url: pathToFileURL(mapped).href, shortCircuit: true, format: "module-typescript" };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const core = (await import(pathToFileURL(join(coreSrc, "index.js")).href)) as { describeContract: typeof describeContract };
const contract = core.describeContract();

const args = process.argv.slice(2);
const flagValue = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};
const kindList = EXAMPLE_KINDS.join(", ");
const asKind = (flag: string, value: string | undefined): ExampleKind => {
  if (value !== undefined && (EXAMPLE_KINDS as readonly string[]).includes(value)) return value as ExampleKind;
  console.error(`${flag} ${value ?? "(missing)"}: not a kind. The kinds are: ${kindList}`);
  process.exit(1);
};

if (args.includes("--json")) {
  console.log(JSON.stringify(contract, null, 2));
  process.exit(0);
}

const exampleFlag = flagValue("--example");
if (args.includes("--example")) {
  console.log(JSON.stringify(examples(contract.specVersion)[asKind("--example", exampleFlag)], null, 2));
  process.exit(0);
}

const kindFlag = flagValue("--kind");
const only = args.includes("--kind") ? asKind("--kind", kindFlag) : undefined;

const prop = (p: { required: boolean; key: string; description: string }): string => `${p.required ? "required " : "optional "} ${p.key} -- ${p.description}`;

/** The parts of the output, each a list of lines, in the order the full output prints them. */
const part: Record<string, string[]> = {};
const add = (name: string, ...lines: string[]): void => {
  (part[name] ??= []).push(...lines);
};

add("header", `yadad document contract (specVersion ${contract.specVersion})`, "");
add("id", "ids must match " + contract.id.pattern + " -- " + contract.id.hint, "");
add("kinds", "document kinds (a document has exactly one kind):");
for (const kind of contract.documentKinds) {
  add(`kind:${kind.kind}`, `  ${kind.kind} -- ${kind.description}`);
  for (const p of kind.properties) add(`kind:${kind.kind}`, `    ${prop(p)}`);
}
add("fields", "", "field types (entity fields):");
for (const type of contract.fieldTypes) {
  add("fields", `  ${type.type} -- ${type.description}`);
  if (type.properties.length === 0) {
    add("fields", "    (no type-specific properties)");
  } else {
    for (const p of type.properties) add("fields", `    ${prop(p)}`);
  }
}
add("conditions", "", `conditions (visibility, required-ness, filters; may nest at most ${contract.conditions.maxDepth} levels):`);
for (const op of contract.conditions.ops) {
  add("conditions", `  ${op.op}: shape ${JSON.stringify(op.shape)}  example: ${op.example}`);
}
add("conditions", `  value types: ${contract.conditions.maxValueType}`);
const rel = contract.conditions.relativeDate;
add("conditions", `  relative dates (${rel.ops.join(", ")} on ${rel.fieldTypes.join(", ")} fields; up to ${rel.maxDays} days): ${rel.description}`);
add("conditions", `    example: ${rel.example}`);
const inst = contract.conditions.relativeInstant;
add("conditions", `  relative instants (${inst.ops.join(", ")} on ${inst.fieldTypes.join(", ")} fields; up to ${inst.maxHours} hours): ${inst.description}`);
add("conditions", `    example: ${inst.example}`);
add("widgets", "", "widgets (dashboard grid items):");
for (const widget of contract.widgets) {
  add("widgets", `  ${widget.widget} -- ${widget.description}`);
  for (const p of widget.properties) add("widgets", `    ${prop(p)}`);
}
const cal = contract.calendar;
add("calendar", "", `calendar view: modes ${cal.modes.join(", ")} (default ${JSON.stringify(cal.defaultModes)}); weekStartsOn ${cal.weekStartsOn.min}-${cal.weekStartsOn.max} (default ${cal.weekStartsOn.default}); at most ${cal.detailFieldsMax} detailFields; dateField: ${cal.dateFieldTypes.join(" or ")}; titleField: ${cal.titleFieldTypes.join(" or ")}; colorField: ${cal.colorFieldTypes.join(" or ")}.`);
const viewer = contract.viewer;
add("viewer", "", `viewer document (at most ${viewer.documentsMax} per set): ${viewer.factsMax} facts at most; fact types ${viewer.factTypes.join(", ")}; a select fact lists ${viewer.factValuesMin} to ${viewer.factValuesMax} values.`);
const actions = contract.actions;
add("actions", "", `record actions (entity \`actions\`, offered by a view's \`recordActions\`): an entity declares ${actions.max} at most, a view offers ${actions.recordActionsMax} at most, an action asks for ${actions.inputMax} input fields at most (types ${actions.inputFieldTypes.join(", ")}); confirm tones ${actions.confirmTones.join(", ")}.`);
add("places", "", "where a condition may appear (accepts: record+viewer = any condition; viewer = viewerIn, and, or, not; record = no viewerIn):");
for (const place of contract.conditionPlaces) add("places", `  ${place.path} [${place.kinds.join(", ")}] accepts ${place.accepts} -- ${place.description}`);
add("registry", "", "optional registry keys (a registry may omit them; the renderer then reports the view that needs one):");
for (const k of contract.optionalRegistryKeys) add("registry", `  ${k.key} (optional) -- ${k.description}`);
add("measures", "", "measures (the `measure` of a stat widget; empty values are skipped):");
for (const m of contract.measures) {
  const on = m.fields.length > 0 ? `field: ${m.fields.join(" or ")}${m.product ? "; or product: two number fields" : ""}` : "no field";
  add("measures", `  ${m.op} (${on}) -- ${m.description} Over no records: ${m.empty}. Example: ${m.example}`);
}
add("grid", "", `grid (dashboard tabs): a tab has ${contract.grid.columns.default} columns by default, at most ${contract.grid.columns.max}.`);
for (const item of contract.grid.items) add("grid", `  item ${item.key}: whole number from ${item.min} to ${item.max}`);
add("limits", "", `limits: pageSize is a whole number from 1 to ${contract.limits.pageSize.max}; a table's rowAction chain runs at most ${contract.limits.rowActionDepth.max} hops.`);
add("errors", "", "error codes (validation): " + contract.errorCodes.join(", "));

/** Only for `--kind dashboard`: what the grid numbers are in, and what the renderer does on a narrow screen. */
const gridNotes = [
  "",
  "reading the grid: x and y are the column and row an item starts in, counted from 0; w is the number of columns it spans and h the number of rows.",
  "  A row is a fixed height (4rem unless the host sets --yadad-grid-row-height); the columns share the tab's width (12 by default, `columns` up to 24).",
  "  Below `stackBelow` pixels (a prop of DashboardRenderer, 640 by default; not a document key) the renderer drops the grid and stacks the items in reading order, one column wide.",
];

const full = ["header", "id", "kinds", ...contract.documentKinds.map((k) => `kind:${k.kind}`), "fields", "conditions", "widgets", "calendar", "viewer", "actions", "places", "registry", "measures", "grid", "limits", "errors"];
const byKind: Record<ExampleKind, string[]> = {
  entity: ["kind:entity", "fields", "actions"],
  form: ["kind:form"],
  table: ["kind:table", "limits"],
  calendar: ["kind:calendar", "calendar"],
  board: ["kind:board"],
  dashboard: ["kind:dashboard", "widgets", "measures", "grid"],
  viewer: ["kind:viewer", "viewer"],
  conditions: ["conditions", "places"],
};

// Part names are internal: "kind:entity" is printed under the "document kinds" heading only in the full output.
const lines = (only === undefined ? full : byKind[only]).flatMap((name) => part[name] ?? []);
if (only !== undefined) {
  if (lines[0] === "") lines.shift();
  if (only === "dashboard") lines.push(...gridNotes);
}

/** Wraps a line at `width` columns on spaces; continuation lines are indented four spaces past the line's own indent. */
function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = /^ */.exec(line)?.[0] ?? "";
  const out: string[] = [];
  let current = "";
  for (const word of line.slice(indent.length).split(" ")) {
    const lead = out.length === 0 ? indent : indent + "    ";
    if (current !== "" && lead.length + current.length + 1 + word.length > width) {
      out.push(lead + current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  out.push((out.length === 0 ? indent : indent + "    ") + current);
  return out;
}

console.log(lines.flatMap((line) => wrap(line, 120)).join("\n"));
