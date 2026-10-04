import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";

// Which registry the showcase injects (DECISIONS.md D15: hosts choose).
// Default: the mock registry from @yadad/testing. To use another one:
//   YADAD_REGISTRY_MODULE=../../../yadad-components/registry/base.ts \
//   YADAD_REGISTRY_EXPORT=baseRegistry \
//   YADAD_REGISTRY_CSS=../../../yadad-components/dist/yadad-components.css \
//   pnpm dev
// Paths are relative to apps/showcase.
const registryModule = process.env["YADAD_REGISTRY_MODULE"];
const registryExport = process.env["YADAD_REGISTRY_EXPORT"] ?? "registry";
const registryCss = process.env["YADAD_REGISTRY_CSS"];

/** The nearest folder above `file` with a package.json: the registry's repo, which Vite must be allowed to serve. */
function packageRoot(file: string): string {
  let dir = dirname(file);
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

function registryPlugin(): Plugin {
  const id = "virtual:yadad-registry";
  return {
    name: "yadad-registry",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loadId) {
      if (loadId !== `\0${id}`) return undefined;
      if (!registryModule) return `export { mockRegistry as registry } from "@yadad/testing";`;
      const css = registryCss ? `import ${JSON.stringify(resolve(registryCss))};\n` : "";
      return `${css}export { ${registryExport} as registry } from ${JSON.stringify(resolve(registryModule))};`;
    },
  };
}

export default defineConfig({
  plugins: [registryPlugin()],
  // A registry from another repo brings its own React; use the showcase's.
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    // AGENTS.md: a random dev-server port, so parallel worktrees never collide.
    port: 20000 + Math.floor(Math.random() * 20000),
    strictPort: false,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), ...(registryModule ? [packageRoot(resolve(registryModule))] : [])],
    },
  },
  // tsc -b emits into dist/ too; keep the app bundle in its own folder.
  build: { outDir: "dist/app" },
});
