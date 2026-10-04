/* global URL, console, process */
// Proves every rule in .dependency-cruiser.cjs fires: cruises this fixture
// (a miniature workspace with one deliberate violation per rule) and fails
// unless the violations match EXPECTED exactly. Run: pnpm depcruise:fixture

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";

const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs");
const baseDir = fileURLToPath(new URL(".", import.meta.url));

const EXPECTED = [
  ["core-imports-nothing", "packages/core/src/index.ts", "packages/runtime/src/index.ts"],
  ["no-react-in-core-or-runtime", "packages/runtime/src/index.ts", "react"],
  ["runtime-imports-core-only", "packages/runtime/src/index.ts", "packages/renderer/src/index.ts"],
  ["renderer-imports-core-runtime-only", "packages/renderer/src/index.ts", "packages/editor/src/index.ts"],
  ["editor-imports-core-runtime-only", "packages/editor/src/index.ts", "packages/theme/src/index.ts"],
  ["no-deep-imports", "packages/editor/src/index.ts", "packages/core/src/internal.ts"],
  ["theme-imports-nothing", "packages/theme/src/index.ts", "@yadad/core"],
  ["no-components-repo", "apps/showcase/src/index.ts", "@yadad/components"],
  ["not-to-unresolvable", "packages/runtime/src/index.ts", "react"],
  ["not-to-unresolvable", "packages/theme/src/index.ts", "@yadad/core"],
  ["not-to-unresolvable", "apps/showcase/src/index.ts", "@yadad/components"],
].map((v) => v.join(" | "));

const { enhancedResolveOptions, ...options } = config.options;
const { output } = await cruise(
  ["packages", "apps"],
  { ...options, baseDir, validate: true, ruleSet: { forbidden: config.forbidden } },
  enhancedResolveOptions,
);

const actual = output.summary.violations.map((v) => [v.rule.name, v.from, v.to].join(" | "));
const missing = EXPECTED.filter((v) => !actual.includes(v));
const unexpected = actual.filter((v) => !EXPECTED.includes(v));
const unproven = config.forbidden
  .map((rule) => rule.name)
  .filter((name) => !EXPECTED.some((v) => v.startsWith(`${name} |`)));

for (const v of missing) console.error(`missing:    ${v}`);
for (const v of unexpected) console.error(`unexpected: ${v}`);
for (const name of unproven) console.error(`no fixture violation for rule: ${name}`);

if (missing.length || unexpected.length || unproven.length) process.exit(1);
console.log(`forbidden-import fixture: all ${config.forbidden.length} rules fire (${actual.length} violations as expected)`);
