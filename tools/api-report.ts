// The API report gate: one checked-in api-extractor report per published entry
// point (etc/<package>.api.md, etc/<package>.<subpath>.api.md), generated from
// the declarations `tsc -b` writes to dist/.
//
// Run: pnpm api:check    fails when the built API differs from the reports
//      pnpm api:update   rewrites the reports on purpose (commit the diff)
//
// Entry points come from each package's "exports" map (the "types" target), so
// a new package or subpath is picked up without editing this file. A package
// with no "types" export (for example one that only ships a binary) has no
// report. Reports in etc/ that no entry point produces are stale and fail the
// check.
import { Extractor, ExtractorConfig, ExtractorLogLevel } from "@microsoft/api-extractor";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");
const reportFolder = join(root, "etc");

type Entry = { name: string; dts: string };

const entries: Entry[] = [];
const packageDirs = [
  ...readdirSync(join(root, "packages"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join("packages", d.name)),
  "testing",
];
for (const dir of packageDirs) {
  const manifestPath = join(root, dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name: string; exports?: Record<string, { types?: string }> };
  const short = manifest.name.replace(/^@yadad\//, "");
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (target.types === undefined) continue;
    const suffix = subpath === "." ? "" : "." + subpath.replace(/^\.\//, "").replaceAll("/", "-");
    entries.push({ name: short + suffix, dts: join(root, dir, target.types) });
  }
}

// The reports describe dist/, so make sure it is current (incremental, a no-op when typecheck just ran).
execFileSync("pnpm", ["exec", "tsc", "-b"], { cwd: root, stdio: "inherit" });

mkdirSync(reportFolder, { recursive: true });
const failures: string[] = [];
for (const { name, dts } of entries) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      mainEntryPointFilePath: dts,
      compiler: { overrideTsconfig: { compilerOptions: { skipLibCheck: true, moduleResolution: "bundler", module: "esnext", target: "es2023", types: [] } } },
      apiReport: { enabled: true, reportFileName: `${name}.api.md`, reportFolder, reportTempFolder: join(root, "node_modules/.cache/api-report") },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        // Reports list names and signatures; release tags and forgotten exports are not the gate's business.
        extractorMessageReporting: {
          "ae-missing-release-tag": { logLevel: ExtractorLogLevel.None },
          "ae-forgotten-export": { logLevel: ExtractorLogLevel.None },
          "ae-undocumented": { logLevel: ExtractorLogLevel.None },
          "ae-unresolved-link": { logLevel: ExtractorLogLevel.None },
          default: { logLevel: ExtractorLogLevel.Warning },
        },
        tsdocMessageReporting: { default: { logLevel: ExtractorLogLevel.None } },
      },
    },
    configObjectFullPath: join(root, "api-extractor.json"),
    packageJsonFullPath: join(dirname(dirname(dts)), "package.json"),
  });
  const result = Extractor.invoke(config, { localBuild: update, showVerboseMessages: false });
  if (!result.succeeded) failures.push(name);
}

const expected = new Set(entries.map((e) => `${e.name}.api.md`));
const stale = existsSync(reportFolder) ? readdirSync(reportFolder).filter((f) => f.endsWith(".api.md") && !expected.has(f)) : [];
if (update) {
  for (const f of stale) rmSync(join(reportFolder, f));
  if (failures.length > 0) {
    console.error(`api-extractor failed for: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`API reports written for ${entries.length} entry points in etc/.`);
} else if (failures.length > 0 || stale.length > 0) {
  for (const f of failures) console.error(`API report out of date: etc/${f}.api.md`);
  for (const f of stale) console.error(`Stale API report (no such entry point): etc/${f}`);
  console.error("\nIf the change to the public API is intended, run `pnpm api:update` and commit etc/.");
  process.exit(1);
} else {
  console.log(`API reports match for ${entries.length} entry points.`);
}
