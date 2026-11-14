# @yadad/cli

`ydcli` checks yadad documents before you build, and prints what the installed [`@yadad/core`](../core) accepts. It reads files and prints; it never writes a file and never runs your code. Node 22.18 or newer, no runtime dependencies. `@yadad/core` is a peer dependency, so the command always checks against the contract that is installed.

```sh
npm install --save-dev @yadad/cli @yadad/core
npx ydcli validate documents
```

In `package.json`: `"validate:documents": "ydcli validate documents"`, and run it as the first step of `build`.

## `ydcli validate <file or directory>... [--json] [--strict]`

- A directory means every `*.json` file directly in it, sorted by name (no recursion; pass more paths for more directories). A file is read as it is.
- Each file is parsed, upgraded with `migrate()` to the current `specVersion`, and the whole set is validated together with `validateDocuments`, so references between documents are checked. The files on disk are never changed.
- It validates everything it can and never stops at the first error. A document that refers to an invalid one gets its own `unknown-reference` error, because the set cannot resolve the reference; the first error listed for a file is the cause.
- A file that is not JSON is an error with the code `invalid-json`; the other files are still validated.
- Warnings are printed. They fail the run only with `--strict`.

```
documents/note.json: /fields/0/type [unknown-field-type] Unknown field type "money".
    hint: Field types: text, number, boolean, select, date, datetime, reference, time, tags.
documents/notes_table.json: /columns/0/field [unknown-reference] ...
FAIL: 2 errors in 2 of 4 files.
```

Errors, warnings and the `FAIL` line go to standard error; the `OK: 4 files valid.` line goes to standard output.

`--json` prints one object on standard output and nothing else:

```json
{
  "ok": false,
  "files": [{ "file": "documents/note.json", "document": "note", "ok": false }],
  "errors": [{ "file": "documents/note.json", "document": "note", "path": "/fields/0/type", "code": "unknown-field-type", "message": "...", "hint": "..." }],
  "warnings": []
}
```

`errors` and `warnings` have the keys `validateDocuments` returns, plus `file`. A file's `document` is its `id`, absent when the file has none or is not JSON. A file is `ok: false` when it has an error.

| Exit code | Meaning |
| --- | --- |
| 0 | Every document is valid. With `--strict`, there are no warnings either |
| 1 | A document is invalid, a file is not JSON, or (with `--strict`) there is a warning |
| 2 | The command could not run: a directory with no `.json` file (a build that validates nothing is the worse failure), a path that does not exist, an unknown option, no path given |

## `ydcli describe [--json | --kind <kind> | --example <kind>]`

Prints what the installed `@yadad/core` accepts, from `describeContract()`: document kinds and their keys, field types, condition operators and where each may appear, widgets, measures, limits and error codes. Readable text by default, JSON with `--json`. `--kind <kind>` prints one part (`entity`, `form`, `table`, `calendar`, `board`, `dashboard`, `viewer`, `conditions`) and `--example <kind>` prints one complete, valid set of documents of that kind. An unknown kind is exit 2.

## From code

`run(argv, io)` is exported for tests and tools; `io` is `{ out, err, cwd }`. It returns the exit code.
