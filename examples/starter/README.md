# yadad starter

A small team-tasks app built on the yadad engine. There is almost no screen code: the app is the JSON files in `documents/` (entities, forms, tables, a board, a calendar, a dashboard), and `src/` only loads them and hands them to the renderers. It has a real backend, a records-protocol server you can read in one sitting. The engine's CI builds and tests it, so it stays current.

## Run it

Inside the yadad repository:

```sh
pnpm install
pnpm --filter @yadad/example-starter dev
```

That starts the records server (`server/`, port 8787, SQLite file `data/starter.db`, seeded once) and Vite, which proxies `/api` to it. Records survive restarts. `pnpm --filter @yadad/example-starter dev:memory` runs the app alone on the in-memory adapter (nothing persists). `check` validates every document (file, JSON pointer, message) and exits non-zero on an error; `build` makes a production bundle.

The server uses `node:sqlite`, which needs Node 22.13 or newer without a flag (it prints an experimental warning), and `node server/index.ts` needs 22.18, the engine's floor.

## Take it out as your own app

1. Copy the `examples/starter` folder out of the repository.
2. In its `package.json`, replace each `workspace:*` with the current registry version of that package, and add `vite` and `vitest` versions if you want to keep the scripts.
3. Add the registry line for the scope: `echo "@yadad:registry=https://<gitlab-host>/api/v4/packages/npm/" >> .npmrc` (see the root README for the host).
4. `npm install && npm run dev`. The `tsconfig.json` extends the engine's base config; replace it with your own (a plain strict config with `jsx: react-jsx` works).

## Change something

1. **Add a status.** In `documents/task.json`, add `"Review"` to the `status` field's `options.values`. The form's select, the table's inline edit, the board's columns, the calendar legend and the dashboard chart all gain it.
2. **Make a column read-only.** In `documents/tasks.json`, delete `"editable": true` from the `due` column. The Edit button on a row no longer offers the date.
3. **Add a screen.** Copy `documents/board.json` to `documents/board_by_person.json`, change `id`, `title` and make `groupBy` `[{ "field": "assignee" }]`. A new nav entry appears; no code changed.

Break a document on purpose (delete a required key) and `check` names the file and pointer; `dev` shows the same errors instead of the app.

## What is where

| Path | What |
| --- | --- |
| `documents/` | the app: one JSON document per file |
| `src/documents.ts` | loads them with a glob import, builds the nav list |
| `src/main.tsx` | emits the theme, validates the documents, shows errors or the app |
| `src/App.tsx` | the shell: nav from the documents, selected view in the URL (`#/tasks`), light/dark switch |
| `src/adapter.ts`, `src/seed.ts` | the data adapter (HTTP to the server, or in-memory with `VITE_DATA=memory`) and the seed records |
| `server/index.ts` | the records-protocol server, about 240 lines; `server/index.test.ts` tests it |
| `scripts/dev.ts` | starts server and Vite together |
| `tests/` | one render test per view, the `requiredWhen` rule, and `checkViewStates` over every view |

Features worth finding: the task form's `requiredWhen` (Notes are required while the status is Blocked), the `subRecords` checklist (appears once the task is saved), two saved filters on the tasks table, a `rowAction` drill-down from People, and a dashboard with a `view`, `count` and `series` widget.

## The server

**The server has no authentication.** Anyone who can reach the port can read and change every record. A real app must add sign-in, per-user scoping and CSRF protection; see [`docs/security.md`](../../docs/security.md).

It implements the [records protocol](../../docs/records-protocol.md) endpoints the views use: list (paging, sort, filter), find one, create, update with `baseVersion` and the `409` conflict answer, delete, and the protocol's error body with paths. Filters are translated by whitelist to SQL with bound parameters for `eq neq gt gte lt lte in empty notEmpty and or not`; any other operator (such as `contains`) is a `400`. Required fields, field rules and references are checked from the entity documents in `documents/`, with the field rules from `validateRecord` in `@yadad/runtime`, as the protocol advises. Batch and record actions are not implemented because no view uses them.
