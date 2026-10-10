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
lines.push("");
lines.push("widgets (dashboard grid items):");
for (const widget of contract.widgets) {
  lines.push(`  ${widget.widget} -- ${widget.description}`);
  for (const p of widget.properties) lines.push(`    ${prop(p)}`);
}
lines.push("");
lines.push(`grid (dashboard tabs): a tab has ${contract.grid.columns.default} columns by default, at most ${contract.grid.columns.max}.`);
for (const item of contract.grid.items) lines.push(`  item ${item.key}: whole number from ${item.min} to ${item.max}`);
lines.push("");
lines.push(`limits: pageSize is a whole number from 1 to ${contract.limits.pageSize.max}.`);
lines.push("");
lines.push("error codes (validation): " + contract.errorCodes.join(", "));
console.log(lines.join("\n"));
