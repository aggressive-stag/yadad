/* global URL, console, process */
// Prints everything a yadad document can contain, from describeContract() in
// @yadad/core: document kinds and their properties, field types and their
// type-specific properties, condition ops and their exact shapes, widget
// types, grid limits, the id pattern and the error codes.
//
// Run: pnpm describe-registry [--json]
//
// Runs against the TypeScript source with a small resolution hook, so it
// works from a fresh clone after `pnpm install` with no build step.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const coreSrc = join(repoRoot, "packages/core/src") + "/";
const coreUrl = pathToFileURL(coreSrc).href;

// Inside @yadad/core source, `./x.js` points at `./x.ts`.
registerHooks({
  resolve(specifier, context, nextResolve) {
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

const { describeContract } = await import(pathToFileURL(join(coreSrc, "index.js")).href);
const contract = describeContract();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(contract, null, 2));
  process.exit(0);
}

const prop = (p) => `${p.required ? "required " : "optional "} ${p.key} -- ${p.description}`;

const lines = [];
lines.push(`yadad document contract (specVersion ${contract.specVersion})`);
lines.push("");
lines.push("ids must match " + contract.id.pattern + " -- " + contract.id.hint);
lines.push("");
lines.push("document kinds (a document has exactly one kind):");
for (const kind of contract.documentKinds) {
  lines.push(`  ${kind.kind} -- ${kind.description}`);
  for (const p of kind.properties) lines.push(`    ${prop(p)}`);
}
lines.push("");
lines.push("field types (entity fields):");
for (const type of contract.fieldTypes) {
  lines.push(`  ${type.type} -- ${type.description}`);
  if (type.properties.length === 0) {
    lines.push("    (no type-specific properties)");
  } else {
    for (const p of type.properties) lines.push(`    ${prop(p)}`);
  }
}
lines.push("");
lines.push(`conditions (visibility, required-ness, filters; may nest at most ${contract.conditions.maxDepth} levels):`);
for (const op of contract.conditions.ops) {
  lines.push(`  ${op.op}: shape ${JSON.stringify(op.shape)}  example: ${op.example}`);
}
lines.push(`  value types: ${contract.conditions.maxValueType}`);
const rel = contract.conditions.relativeDate;
lines.push(`  relative dates (${rel.ops.join(", ")} on ${rel.fieldTypes.join(", ")} fields; up to ${rel.maxDays} days): ${rel.description}`);
lines.push(`    example: ${rel.example}`);
lines.push("");
lines.push("widgets (dashboard grid items):");
for (const widget of contract.widgets) {
  lines.push(`  ${widget.widget} -- ${widget.description}`);
  for (const p of widget.properties) lines.push(`    ${prop(p)}`);
}
lines.push("");
const cal = contract.calendar;
lines.push(`calendar view: modes ${cal.modes.join(", ")} (default ${JSON.stringify(cal.defaultModes)}); weekStartsOn ${cal.weekStartsOn.min}-${cal.weekStartsOn.max} (default ${cal.weekStartsOn.default}); at most ${cal.detailFieldsMax} detailFields; dateField: ${cal.dateFieldTypes.join(" or ")}; titleField: ${cal.titleFieldTypes.join(" or ")}; colorField: ${cal.colorFieldTypes.join(" or ")}.`);
lines.push("");
const viewer = contract.viewer;
lines.push(`viewer document (at most ${viewer.documentsMax} per set): ${viewer.factsMax} facts at most; fact types ${viewer.factTypes.join(", ")}; a select fact lists ${viewer.factValuesMin} to ${viewer.factValuesMax} values.`);
lines.push("");
lines.push("where a condition may appear (accepts: record+viewer = any condition; viewer = viewerIn, and, or, not; record = no viewerIn):");
for (const place of contract.conditionPlaces) lines.push(`  ${place.path} [${place.kinds.join(", ")}] accepts ${place.accepts} -- ${place.description}`);
lines.push("");
lines.push("optional registry keys (a registry may omit them; the renderer then reports the view that needs one):");
for (const k of contract.optionalRegistryKeys) lines.push(`  ${k.key} (optional) -- ${k.description}`);
lines.push("");
lines.push("measures (the `measure` of a stat widget; empty values are skipped):");
for (const m of contract.measures) {
  const on = m.fields.length > 0 ? `field: ${m.fields.join(" or ")}${m.product ? "; or product: two number fields" : ""}` : "no field";
  lines.push(`  ${m.op} (${on}) -- ${m.description} Over no records: ${m.empty}. Example: ${m.example}`);
}
lines.push("");
lines.push(`grid (dashboard tabs): a tab has ${contract.grid.columns.default} columns by default, at most ${contract.grid.columns.max}.`);
for (const item of contract.grid.items) lines.push(`  item ${item.key}: whole number from ${item.min} to ${item.max}`);
lines.push("");
lines.push(`limits: pageSize is a whole number from 1 to ${contract.limits.pageSize.max}; a table's rowAction chain runs at most ${contract.limits.rowActionDepth.max} hops.`);
lines.push("");
lines.push("error codes (validation): " + contract.errorCodes.join(", "));
console.log(lines.join("\n"));
