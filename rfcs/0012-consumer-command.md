# RFC 0012: A command consumers can run to validate and describe

- Status: Accepted (2026-11-14). See `## Owner decisions`.
- Touches: the package list or `core`'s `package.json` (a `bin`), depending on the option chosen. Nothing in the document contract, `specVersion` or the records protocol.
- Needs an RFC because AGENTS.md rule 7 says no new package without one, and a `bin` changes what a package ships.

## Summary

Every app that uses yadad needs to check its documents before it builds, and to look up what a document may contain. All three consumer apps wrote the same script for the first, and one wrote another for the second. The engine has the second as `tools/describe-registry.ts`, but only inside this repository.

This RFC proposes one command with two sub-commands:

- `yadad validate <files or directories>` checks documents and exits non-zero when any is invalid.
- `yadad describe [--json]` prints what the installed version of yadad accepts.

It adds no contract and no dependency. It only moves work that every consumer repeats into the package.

## What the three scripts do

All three call `validateDocuments` from the installed `@yadad/core` on every JSON file in `documents/`, run it as the first step of `build`, and exit 1 on a failure. They differ in small ways, and each difference is something another consumer would want.

| Script | Reads | Output on failure | Extras |
| --- | --- | --- | --- |
| a task app, `frontend/scripts/check-documents.ts` (44 lines) | `documents/*.json`, sorted | `INVALID <document> <path>: <code> — <message>`, then the hint, then the `allowed` list if present | Prints warnings. Exits 1 when the folder is empty |
| a workout log, `frontend/scripts/validate-documents.ts` (58 lines) | `documents/*.json`, sorted | `<document>: <path> [<code>] <message>`, then an indented hint | No warnings. Exits 1 when the folder is empty. Prints `OK: N valid` |
| a memory app, `frontend/scripts/validate-documents.mjs` (46 lines) and `describe.mjs` (5 lines) | `documents/*.json`, sorted | `<document> <path>: <message>` (no code, no hint) | Runs `migrate()` first. Reports a file that is not JSON with its file name. An empty folder is fine. Prints warnings. `describe.mjs` prints `describeContract()` as JSON |

What each does that the others do not:

- Only the task app prints the `allowed` list. Only the memory app migrates first, names the file for a JSON syntax error and accepts an empty folder (the other two exit 1 with "no documents found").
- None of them names the file in a validation error. They print the document id, so someone with two documents of the same id, or a file whose name differs from its id, has to search.
- Each is a copy that drifts: the output format, whether warnings print and what an empty folder means are all different.
- `tools/describe-registry.ts` in this repository prints the contract as text, or JSON with `--json`. It works from source and needs the repo, so a consumer cannot run it.

## The proposal

### `yadad validate <path>...`

- Each path is a JSON file, or a directory. A directory means every `*.json` file directly in it, sorted by name (no recursion; pass more paths for more directories).
- Every file is parsed, passed through `migrate()` and then validated as one set with `validateDocuments`, so cross-document references are checked.
- Every error is printed with the file, the JSON pointer, the code, the message and the hint. The file is found by mapping the error's document id back to the file that held it.
- Warnings are printed too. They do not fail the run unless `--strict` is given.
- It validates everything it can before it stops. It never stops at the first error.

Text output, one error per line, for a person and for a log:

```
documents/note.json: /fields/0/type [unknown-field-type] Unknown field type "money".
    hint: Field types: text, number, boolean, select, date, datetime, reference, time, tags.
documents/notes_table.json: /entity [unknown-reference] View references unknown entity "note".
    hint: Name an entity that exists in the set.
FAIL: 2 errors in 2 of 4 files.
```

`--json` prints one JSON object on standard output and nothing else (the summary line moves into it):

```json
{
  "ok": false,
  "files": [
    { "file": "documents/note.json", "document": "note", "ok": false },
    { "file": "documents/notes_table.json", "document": "notes_table", "ok": false },
    { "file": "documents/note_form.json", "document": "note_form", "ok": true },
    { "file": "documents/overview.json", "document": "overview", "ok": true }
  ],
  "errors": [
    { "file": "documents/note.json", "document": "note", "path": "/fields/0/type", "code": "unknown-field-type", "message": "Unknown field type \"money\".", "hint": "Field types: text, number, ..." }
  ],
  "warnings": []
}
```

The `errors` and `warnings` entries have the same keys as the ones `validateDocuments` returns, plus `file`. An agent reads `errors[].file` and `errors[].path` and edits that place.

**Exit codes.**

| Code | Meaning |
| --- | --- |
| 0 | Every document is valid. Warnings may be present (with `--strict`, they make it 1) |
| 1 | At least one document is invalid, or a file is not JSON (reported as an error with the code `invalid-json` and the file name) |
| 2 | The command could not do its job: no documents found, a path that does not exist, an unknown option |

**A directory with one invalid document and several valid ones.** The command reads and validates all of them. It prints the errors of the invalid one and, with `--json`, lists the valid ones as `"ok": true`. It exits 1. A valid document is not reported as broken, with one honest exception: a document that refers to the invalid one gets its own `unknown-reference` error, because the set cannot resolve the reference (the example above). The first error listed is the root cause; the text output prints errors in the order of the files, so the cause comes first when the files are named sensibly, and the summary line counts both. If the only invalid file is a `.json` that does not parse, the run reports `invalid-json` for it and still validates the others.

An empty directory is exit 2 with a message, not a pass: a build that silently validates nothing is the worse failure. A project that really has no documents yet does not call the command.

### `yadad describe [--json]`

Prints what `describeContract()` gives for the installed `@yadad/core`: document kinds and their keys, field types, condition operators, where each condition may appear, widgets, measures and limits, error codes. With `--json` it prints the JSON; without, it prints the readable text that `tools/describe-registry.ts` prints today. The text is the same code, so the engine's own `pnpm describe-registry` becomes an alias of the command. It always describes the version that is installed, which is the point: the consumer never reads a contract for a version it does not use.

A later step, not part of this RFC, may add `--kind <kind>` and `--example <kind>` so an agent can ask for one section (a feedback item asked for `--example dashboard`).

### What replaces each consumer script

| Today | One command |
| --- | --- |
| The task app's `node scripts/check-documents.ts` | `yadad validate documents --strict` (it already prints warnings) |
| The workout log's `node scripts/validate-documents.ts` | `yadad validate documents` |
| The memory app's `node scripts/validate-documents.mjs` | `yadad validate documents` (it migrates first, as that script does; an empty folder becomes exit 2, so the memory app guards it with a file check, or does not run the command until it has documents) |
| The memory app's `node scripts/describe.mjs` | `yadad describe --json` |

Each package.json then reads `"validate:documents": "yadad validate documents"`.

### Documents kept as TypeScript modules

The three scripts read JSON files. A consumer that keeps its documents as TypeScript modules (to share constants, say) has two routes:

- **Export JSON first.** The consumer's own script writes the documents to a folder, and the command validates the folder. The command never runs consumer code. This is the proposed default.
- **Load modules.** `yadad validate documents.ts` imports a `.ts`, `.mjs` or `.js` file that default-exports a document or an array of documents. Node 22.18 and newer imports `.ts` files directly (type stripping), so this needs no new dependency. It runs the consumer's code, so a CI job that validates untrusted contributions should not use it.

The RFC proposes the first as the default and the second behind a flag (`--import`), and leaves the second for the owner to accept or drop.

## Where it lives

| Option | What it costs | What it gives |
| --- | --- | --- |
| **A. A `bin` in `@yadad/core`** | `core` ships a file that uses `node:fs` and `node:process`. It stays dependency-free and nothing in the library imports it, so a browser bundle never sees it. `core`'s package stops being "pure, runs anywhere" in the strict sense, though its exports still are. The dependency rule "core imports nothing" is about workspace packages, so it still holds. `core`'s `files` and `package.json` change; a `bin` entry makes `npx yadad` work after install | The command is always the same version as the contract it checks, with nothing extra to install. No new package. It is the smallest change |
| **B. A `bin` in `@yadad/testing`** | `testing` has peers on React, `react-dom`, Vitest and jsdom. A Docker build stage that only validates documents would have to install all four, or see peer warnings. `testing` imports `core` and `runtime`, so a build-time check lives next to the test kit | Fits "checking things". Costs consumers a heavy install for a light job |
| **C. A new package, `@yadad/cli`** | A new package needs an RFC (this one), a row in the dependency rules, a changeset entry, a README and a place in the release script. It would have `@yadad/core` as a peer dependency so it always uses the installed contract. Another thing to keep in step with `core`'s version | A clean home that can grow (`describe --kind`, `init`) without crowding `core`. The `bin` is not in a package a browser bundle might include |

**Recommendation: A.** The command is a thin wrapper over two functions `core` already exports, `validateDocuments` and `describeContract`, and it must always agree with the installed `core`. Putting it in `core` makes that automatic and needs no new package and no peer range. The `node:` imports stay in the `bin` file, which no export of `core` reaches. If the command later grows past validate and describe (scaffolding, codegen), moving it to C is a small step, since only the `bin` field changes. If the owner wants `core` to contain no Node-only file at all, choose C, not B.

## Contract impact

None for documents, records or `specVersion`. Option A adds a `bin` file and a `bin` field to `packages/core/package.json` (and a changeset: minor, `core`). Option C adds a package. `tools/describe-registry.ts` becomes a thin call to the same code. The three consumers delete their scripts in their own repositories, on their own schedule.

## Open questions for the owner

1. **Where does it live?** A (recommended), B or C. This decides everything else.
2. **Should `--import` (loading TypeScript and JavaScript modules) exist at all,** or is "export JSON first" the only route?
3. **Should an empty directory be exit 2 (proposed) or exit 0?** The memory app's script today says "fine for now".
4. **Should warnings fail the run by default?** Proposed: no, only with `--strict`.
5. **Name:** `yadad` (proposed), or `yadad-docs`, to avoid a bare name that another package may want.

## Owner decisions (2026-11-14)

1. **Where it lives: C, a new `@yadad/cli` package.** The owner wants the checker separate from the library, so documents can be validated without touching the code that renders them and `core` keeps no Node-only file. `@yadad/cli` has `@yadad/core` as a peer dependency (it always checks against the installed contract), gets a row in the dependency rules (it imports `core` only), a README, a changeset entry and a place in the release.
2. **`--import`: not now.** Only JSON files are read. Loading TypeScript or JavaScript modules is listed under `## Possible improvements`.
3. **An empty directory is exit 2**, as proposed.
4. **Warnings do not fail the run** unless `--strict` is given, as proposed.
5. **Name: `ydcli`.** The package is `@yadad/cli` and its `bin` is `ydcli` (`ydcli validate documents`, `ydcli describe --json`). Wherever this RFC says `yadad validate` or `yadad describe`, read `ydcli`. Names considered and kept as possible later renames (only the `bin` field changes, so a rename is cheap, and the old name can stay as an alias for a release): `yada`, `ydctl`, `yadad-doctor`.

## Possible improvements

Not part of the first version; each waits for a consumer that needs it.

- `--import`: validate documents kept as `.ts`, `.mjs` or `.js` modules by importing them (Node 22.18+ strips types, so no new dependency). It runs the consumer's code, so it must stay opt-in and out of CI jobs that check untrusted contributions.
- `describe --kind <kind>` and `describe --example <kind>`, so an agent can ask for one section (a feedback item asked for `--example dashboard`).

## Not proposed

- Writing or fixing documents. The command reads and reports only.
- Validating records. A server uses `recordJsonSchema` for that (see `docs/records-protocol.md`).
- Running the state checks. Those need a DOM and a registry, so they stay in `@yadad/testing`.
