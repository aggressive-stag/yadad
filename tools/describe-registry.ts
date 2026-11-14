// `pnpm describe-registry [--json | --kind <kind> | --example <kind>]` is
// `ydcli describe` from packages/cli, run against the TypeScript source with a
// small resolution hook, so it works from a fresh clone after `pnpm install`
// with no build step. The text and the flags are documented in packages/cli.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import type * as cli from "../packages/cli/src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["core", "cli"].map((name) => pathToFileURL(join(repoRoot, "packages", name, "src") + "/").href);
const inSource = (url: string | undefined): boolean => url !== undefined && sources.some((s) => url.startsWith(s));

registerHooks({
  resolve(specifier, context, nextResolve) {
    // @yadad/core is the workspace package: take its source export, not a build.
    if (specifier === "@yadad/core") return nextResolve(specifier, { ...context, conditions: ["@yadad/source", ...context.conditions] });
    // Inside the source of core and cli, `./x.js` points at `./x.ts`.
    if (specifier.endsWith(".js") && inSource(context.parentURL)) {
      const mapped = isAbsolute(specifier)
        ? specifier.slice(0, -".js".length) + ".ts"
        : fileURLToPath(new URL(specifier.slice(0, -".js".length) + ".ts", context.parentURL));
      if (existsSync(mapped)) return { url: pathToFileURL(mapped).href, shortCircuit: true, format: "module-typescript" };
    }
    return nextResolve(specifier, context);
  },
});

const { run } = (await import(pathToFileURL(join(repoRoot, "packages/cli/src/index.ts")).href)) as typeof cli;

process.exitCode = run(["describe", ...process.argv.slice(2)], {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  cwd: process.cwd(),
});
