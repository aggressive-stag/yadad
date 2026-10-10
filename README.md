# yadad

Yet another drag and drop: a runtime, schema-driven React engine. Apps are described as small, strictly validated JSON documents (entities + views), and a renderer turns those documents plus live records into working forms, record tables and dashboards — with no redeploy.

Status (October 2026): pre-contract. The five engine packages are built and the gate is green (288 tests); the document contract is still `specVersion: 0` and in flux — no freeze is planned. The memory, key-value and HTTP data adapters all implement record versions and optimistic concurrency.

## What it is

- **Portable.** Nothing home-specific or work-specific in the engine. Only the component set, theme and data adapter change between contexts.
- **AI-friendly.** Agents edit small, validated JSON documents, not JSX. The schema is the contract.
- **Owned where it matters.** Schema, runtime, renderer, editor logic, styled components and tokens are owned. The editor's drag and resize are hand-written and keyboard accessible; accepted dependencies (accessible primitives, table virtualization) are confined to the components repo.

`ARCHITECTURE.md` is the authoritative design; it wins any conflict. `docs/DECISIONS.md` lists the settled decisions.

## Two repositories

| Repo | What it is |
| --- | --- |
| **yadad** (this repo) | The engine: schema + validation, headless runtime, React renderer, editor, theme, fixtures, test kit, showcase. The open-source project. |
| **[yadad-components](https://github.com/aggressive-stag/yadad-components)** | The reference component set: styled, themeable field and layout components that implement the engine's `Registry` contract. Users can bring their own instead. |

The engine never imports from the components repo. Components are handed to the engine through an injected registry. Both repos publish `@yadad/*` packages to the GitLab npm registry, with GitHub as the source.

## Repo layout

```
packages/
  core/        types, document validation, spec migrations,
               contracts (Registry, DataAdapter, Query, error format)
  runtime/     headless, no React: form state, conditions, record validation,
               JSON Patch, and the memory / key-value / HTTP data adapters
  renderer/    React: walks view documents, resolves registry keys, wires runtime state
  editor/      authoring: emits JSON Patch against entity/view documents,
               property panels, hand-written drag/resize
  theme/       token names + values + CSS-variable emitter
testing/       @yadad/testing: mock registry + contract test kit (published)
fixtures/      canonical valid/invalid documents
apps/showcase/  the one example app: renders the fixtures, editable in place
docs/
  DECISIONS.md                 settled decisions
  records-protocol.md          the HTTP records protocol
  research/                    prior art + architecture review
  BUILD_PLAN.md, TASKS.md      historical plans
rfcs/                          (reserved)
examples/                      (reserved, empty)
```

## Getting started

`pnpm` is not on `PATH`; use `corepack pnpm`.

```sh
corepack pnpm install
corepack pnpm test        # the local gate (see below)
```

Run the showcase on a random port:

```sh
corepack pnpm --filter @yadad/showcase dev
```

The gate (all must pass before a push):

```sh
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm depcruise && corepack pnpm test
```

## How work lands

Agents commit straight to `main` (small Angular-format commits, a changeset when a published package changes), land with the gate green, and release with `corepack pnpm changeset version`; GitLab CI publishes the new versions. No PRs, no review gates. See `AGENTS.md`.

## Read order

- **Maintainer:** `docs/DECISIONS.md` → `ARCHITECTURE.md`.
- **Agent starting a task:** `ARCHITECTURE.md` → `AGENTS.md` → your task card (the owner tells you where it is).

## Changes from the earlier spec

The earlier spec doc predates the research pass. These docs supersede it:

1. A fifth engine package, `runtime` (headless state and logic, no React).
2. Documents split into `entity` and `view` (`form`, `table`, `dashboard`); all three view shapes implemented, contract still in flux.
3. `specVersion` (engine format, needs migrations) separated from `revision` (user edits).
4. Hand-written, keyboard-accessible drag/resize in the editor instead of grid/dnd libraries; accessible primitives and table virtualization remain accepted dependencies, confined to the components repo.
5. Phase exit criteria are real apps, not feature checklists.
6. No contract freeze is planned; the contract moves in flux with changesets instead of an RFC-0001 gate.
