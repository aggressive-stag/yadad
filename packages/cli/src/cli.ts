import { readFileSync } from "node:fs";
import { describe } from "./describe.js";
import type { Io } from "./io.js";
import { validate } from "./validate.js";

const USAGE = `ydcli: check yadad documents and see what the installed @yadad/core accepts.

Usage:
  ydcli validate <file or directory>... [--json] [--strict]
  ydcli describe [--json | --kind <kind> | --example <kind>]

validate reads each JSON file (a directory means the *.json files directly in it),
migrates them to the current specVersion and validates them together.
  --json     print one JSON object on standard output and nothing else
  --strict   a warning fails the run too

describe prints what the installed @yadad/core accepts: as text, or as JSON with --json.
  --kind <kind>     one part: entity, form, table, calendar, board, dashboard, viewer, conditions
  --example <kind>  one complete, valid set of documents of that kind

Exit codes: 0 valid, 1 a document is invalid (or a file is not JSON), 2 the command could not run
(no documents found, a path that does not exist, an unknown option).
`;

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

/** Runs ydcli with the arguments after the program name. Returns the exit code. */
export function run(argv: readonly string[], io: Io): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "validate":
      return validate(rest, io);
    case "describe":
      return describe(rest, io);
    case "--version":
    case "-v":
      io.out(version() + "\n");
      return 0;
    case "--help":
    case "-h":
    case "help":
      io.out(USAGE);
      return 0;
    case undefined:
      io.err(USAGE);
      return 2;
    default:
      io.err(`ydcli: unknown command ${JSON.stringify(command)}.\n\n${USAGE}`);
      return 2;
  }
}
