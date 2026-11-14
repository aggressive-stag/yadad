// `ydcli validate <file or directory>...`: reads JSON documents, migrates each
// to the current specVersion and validates them together with validateDocuments
// from the installed @yadad/core, so cross-document references are checked.
// Every error is reported with the file it came from. The command reads and
// reports only; it never writes a file and never runs a consumer's code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate, validateDocument, validateDocuments } from "@yadad/core";
import type { DocumentError } from "@yadad/core";
import type { Io } from "./io.js";

/** An error or warning, as `validateDocuments` returns it, plus the file it belongs to. `invalid-json` is the one code this command adds. */
export interface ReportedIssue {
  readonly file: string;
  readonly document?: string;
  readonly path: string;
  readonly code: DocumentError["code"] | "invalid-json";
  readonly message: string;
  readonly hint: string;
  readonly allowed?: readonly string[];
}

export interface ReportedFile {
  readonly file: string;
  /** The document's id, when the file held an object with a string `id`. */
  readonly document?: string;
  /** False when the file has at least one error. Warnings do not change it. */
  readonly ok: boolean;
}

/** What `--json` prints. */
export interface ValidateReport {
  readonly ok: boolean;
  readonly files: readonly ReportedFile[];
  readonly errors: readonly ReportedIssue[];
  readonly warnings: readonly ReportedIssue[];
}

interface Loaded {
  readonly file: string;
  /** The migrated document; absent when the file is not JSON. */
  readonly value?: unknown;
  readonly id?: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The files a path names: itself, or the `*.json` files directly in a directory, sorted by name. Problems are returned, not thrown. */
function expand(path: string, cwd: string): { files: string[]; problem?: string } {
  const absolute = resolve(cwd, path);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return { files: [], problem: `${path}: no such file or directory` };
  }
  if (!stat.isDirectory()) return { files: [path] };
  const names = readdirSync(absolute)
    .filter((name) => name.endsWith(".json") && statSync(join(absolute, name)).isFile())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (names.length === 0) return { files: [], problem: `${path}: no documents found (no .json files directly in this directory)` };
  return { files: names.map((name) => join(path, name)) };
}

function load(file: string, cwd: string): { loaded: Loaded; error?: ReportedIssue } {
  let parsed: unknown;
  try {
    const text = readFileSync(resolve(cwd, file), "utf8");
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { loaded: { file }, error: { file, path: "", code: "invalid-json", message: `Not valid JSON: ${message}`, hint: "Fix the syntax error; a document is one JSON object." } };
  }
  const value = migrate(parsed);
  const id = typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined;
  return { loaded: id === undefined ? { file, value } : { file, value, id } };
}

/**
 * Finds the file an error belongs to from the document id it carries. When
 * several files hold the same id (or none has one), the file whose own
 * validation reports the same path and code wins; otherwise a set-level error
 * such as a duplicate id is put on the last file that holds the id.
 */
function attributor(docs: readonly { index: number; loaded: Loaded }[]): (e: DocumentError) => number {
  const given = new Set<string>();
  return (e) => {
    const same = docs.filter((d) => d.loaded.id === e.document);
    const candidates = same.length > 0 ? same : docs;
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only) return only.index;
    const own = candidates.filter((d) => {
      const result = validateDocument(d.loaded.value);
      return [...(result.ok ? [] : result.errors), ...result.warnings].some((x) => x.path === e.path && x.code === e.code);
    });
    const fresh = own.find((d) => !given.has(`${d.index}|${e.path}|${e.code}`));
    const chosen = fresh ?? own[0] ?? candidates[candidates.length - 1];
    if (!chosen) return 0;
    given.add(`${chosen.index}|${e.path}|${e.code}`);
    return chosen.index;
  };
}

function issueLines(prefix: string, i: ReportedIssue): string {
  return (
    `${prefix}${i.file}: ${i.path === "" ? "/" : i.path} [${i.code}] ${i.message}\n` +
    (i.hint ? `    hint: ${i.hint}\n` : "") +
    (i.allowed ? `    allowed: ${i.allowed.join(", ")}\n` : "")
  );
}

/** Runs `ydcli validate` with the arguments after the sub-command; returns the exit code (0, 1 or 2). */
export function validate(args: readonly string[], io: Io): number {
  let json = false;
  let strict = false;
  const paths: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--strict") strict = true;
    else if (arg.startsWith("-") && arg !== "-") {
      io.err(`ydcli validate: unknown option ${JSON.stringify(arg)}. Options are --json and --strict (see ydcli --help).\n`);
      return 2;
    } else paths.push(arg);
  }
  if (paths.length === 0) {
    io.err("ydcli validate: name a JSON file or a directory of them, for example: ydcli validate documents\n");
    return 2;
  }

  const files: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const found = expand(path, io.cwd);
    if (found.problem !== undefined) problems.push(found.problem);
    for (const file of found.files) {
      const key = resolve(io.cwd, file);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  if (problems.length > 0) {
    io.err(problems.map((p) => `ydcli validate: ${p}\n`).join(""));
    return 2;
  }

  const errors: ReportedIssue[] = [];
  const warnings: ReportedIssue[] = [];
  const loaded: Loaded[] = [];
  files.forEach((file) => {
    const result = load(file, io.cwd);
    loaded.push(result.loaded);
    if (result.error) errors.push(result.error);
  });

  const docs = loaded.flatMap((l, index) => (l.value === undefined ? [] : [{ index, loaded: l }]));
  if (docs.length > 0) {
    const result = validateDocuments(docs.map((d) => d.loaded.value));
    const which = attributor(docs);
    const tag = (e: DocumentError): ReportedIssue & { index: number } => {
      const index = which(e);
      const { document: _document, ...rest } = e;
      const document = e.document ?? loaded[index]?.id;
      return { file: loaded[index]?.file ?? "", ...(document === undefined ? {} : { document }), ...rest, index };
    };
    for (const e of result.ok ? [] : result.errors) errors.push(tag(e));
    for (const w of result.warnings) warnings.push(tag(w));
  }
  // Group by file, in the order of the files, keeping each file's own order.
  const fileIndex = new Map(files.map((f, i) => [f, i]));
  const order = (list: ReportedIssue[]): ReportedIssue[] =>
    list.map((issue, n) => ({ issue, n })).sort((a, b) => (fileIndex.get(a.issue.file) ?? 0) - (fileIndex.get(b.issue.file) ?? 0) || a.n - b.n).map(({ issue }) => {
      const { index: _index, ...clean } = issue as ReportedIssue & { index?: number };
      return clean;
    });
  const sortedErrors = order(errors);
  const sortedWarnings = order(warnings);

  const failing = new Set(sortedErrors.map((e) => e.file));
  const reportedFiles: ReportedFile[] = loaded.map((l) => ({ file: l.file, ...(l.id === undefined ? {} : { document: l.id }), ok: !failing.has(l.file) }));
  const ok = sortedErrors.length === 0 && !(strict && sortedWarnings.length > 0);

  if (json) {
    const report: ValidateReport = { ok, files: reportedFiles, errors: sortedErrors, warnings: sortedWarnings };
    io.out(JSON.stringify(report, null, 2) + "\n");
    return ok ? 0 : 1;
  }

  io.err(sortedErrors.map((e) => issueLines("", e)).join("") + sortedWarnings.map((w) => issueLines("warning: ", w)).join(""));
  if (ok) {
    io.out(`OK: ${plural(files.length, "file")} valid${sortedWarnings.length > 0 ? `, ${plural(sortedWarnings.length, "warning")}` : ""}.\n`);
    return 0;
  }
  const affected = new Set([...sortedErrors.map((e) => e.file), ...(strict ? sortedWarnings.map((w) => w.file) : [])]);
  const counted = plural(sortedErrors.length, "error") + (strict && sortedWarnings.length > 0 ? ` and ${plural(sortedWarnings.length, "warning")}` : "");
  io.err(`FAIL: ${counted} in ${affected.size} of ${plural(files.length, "file")}${strict ? " (--strict)" : ""}.\n`);
  return 1;
}
