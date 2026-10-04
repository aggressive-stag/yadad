/* global module */
// Dependency direction from ARCHITECTURE.md §4. Paths are relative to the
// repo root. Declared workspace deps resolve through pnpm symlinks to their
// real paths (packages/<name>/...). Undeclared ones and subpath imports do not
// resolve at all and stay bare specifiers (@yadad/<name>/...), so every rule
// matches both forms.
//
// tools/forbidden-import-fixture/ proves every rule fires (pnpm depcruise:fixture).

/** Anything in the workspace except the listed packages, by path or by package name. */
const workspaceExcept = (...allowed) => {
  const ok = allowed.join("|");
  return `^(packages/(?!(${ok})/)|testing/|apps/|@yadad/(?!(${ok})(/|$)))`;
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-imports-nothing",
      comment: "core imports nothing from the workspace (ARCHITECTURE.md §4).",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: workspaceExcept("core") },
    },
    {
      name: "runtime-imports-core-only",
      comment: "runtime imports core only.",
      severity: "error",
      from: { path: "^packages/runtime/" },
      to: { path: workspaceExcept("core", "runtime") },
    },
    {
      name: "renderer-imports-core-runtime-only",
      comment: "renderer imports core and runtime only; it looks up components by registry key.",
      severity: "error",
      from: { path: "^packages/renderer/" },
      to: { path: workspaceExcept("core", "runtime", "renderer") },
    },
    {
      name: "editor-imports-core-runtime-only",
      comment: "editor imports core and runtime only; it asks the registry about components.",
      severity: "error",
      from: { path: "^packages/editor/" },
      to: { path: workspaceExcept("core", "runtime", "editor") },
    },
    {
      name: "theme-imports-nothing",
      comment: "theme imports nothing from the workspace.",
      severity: "error",
      from: { path: "^packages/theme/" },
      to: { path: workspaceExcept("theme") },
    },
    {
      name: "no-react-in-core-or-runtime",
      comment: "core and runtime are headless: no react or react-dom, not even types.",
      severity: "error",
      from: { path: "^packages/(core|runtime)/" },
      to: { path: "(^|/node_modules/)react(-dom)?(/|$)" },
    },
    {
      name: "no-deep-imports",
      comment: "Import other workspace packages through their public entry point only.",
      severity: "error",
      from: { path: "^(packages/[^/]+|testing|apps/[^/]+)/" },
      to: {
        path: "^(packages/[^/]+|testing)/(?!src/index\\.ts$)|^@yadad/[^/]+/",
        pathNot: "^$1/",
      },
    },
    {
      name: "no-components-repo",
      comment: "Engine packages never import the components repo; host apps (apps/*) inject it as a registry.",
      severity: "error",
      from: { path: "^(packages/[^/]+|testing)/" },
      to: { path: "(^|/)(yadad-components|@yadad/components)(/|$)" },
    },
    {
      name: "not-to-unresolvable",
      comment: "Every import must resolve. Catches undeclared dependencies and typos.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^virtual:" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.worktrees)/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
