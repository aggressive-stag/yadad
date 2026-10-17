// Prints the JSON Schema (draft 2020-12) for the records of an entity, so a
// backend can generate schemas at build time without JavaScript at runtime.
//
// Run: pnpm record-schema <entity.json>
//
// Runs against the TypeScript source with a small resolution hook, so it
// works from a fresh clone after `pnpm install` with no build step.
import { registerHooks } from "node:module";
import type { migrate, recordJsonSchema, validateDocument } from "../packages/core/src/index.ts";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = join(here, "../packages/core/src") + "/";
const coreUrl = pathToFileURL(coreSrc).href;

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

const file = process.argv[2];
if (file === undefined || file.startsWith("-")) {
  console.error("usage: pnpm record-schema <entity.json>");
  process.exit(2);
}

const core = (await import(pathToFileURL(join(coreSrc, "index.js")).href)) as {
  migrate: typeof migrate;
  recordJsonSchema: typeof recordJsonSchema;
  validateDocument: typeof validateDocument;
};
const { migrate: migrateDocument, recordJsonSchema: toRecordSchema, validateDocument: validate } = core;

let json: unknown;
try {
  json = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`${file}: cannot read as JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const result = validate(migrateDocument(json));
if (!result.ok) {
  for (const e of result.errors) console.error(`${file}: ${e.path} ${e.code}: ${e.message} ${e.hint}`);
  process.exit(1);
}
if (result.value.kind !== "entity") {
  console.error(`${file}: expected an entity document, found kind "${result.value.kind}".`);
  process.exit(1);
}
console.log(JSON.stringify(toRecordSchema(result.value), null, 2));
