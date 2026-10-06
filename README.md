# yadad

Yet another drag and drop: a runtime, schema-driven React engine. Apps are described as small, strictly validated JSON documents (entities + views), and a renderer turns those documents plus live records into working forms, record tables and dashboards — with no redeploy.

Status (October 2026): pre-contract. The five engine packages are built and the gate is green (250 tests); the document contract is still `specVersion: 0` and has not been frozen or tagged `contract-v0` yet. The memory, key-value and HTTP data adapters all implement record versions and optimistic concurrency.

## What it is

- **Portable.** Nothing home-specific or work-specific in the engine. Only the component set, theme and data adapter change between contexts.
- **AI-friendly.** Agents edit small, validated JSON documents, not JSX. The schema is the contract.
- **Owned where it matters.** Schema, runtime, renderer, editor logic, styled components and tokens are owned. Hard behavior primitives (accessibility, drag/resize, table virtualization) are accepted dependencies, confined to the components repo and the editor.

`ARCHITECTURE.md` is the authoritative design; it wins any conflict.

## Two repositories

| Repo | What it is |
| --- | --- |
| **yadad** (this repo) | The engine: schema + validation, headless runtime, React renderer, editor, theme, fixtures, test kit, showcase. The open-source project. |
| **[yadad-components](https://github.com/aggressive-stag/yadad-components)** | The reference component set: styled, themeable field and layout components that implement the engine's `Registry` contract. Users can bring their own instead. |

The engine never imports from the components repo. Components are handed to the engine through an injected registry.

## Repo layout

```
packages/
  core/        types, JSON Schemas, document validation, spec migrations,
               contracts (Registry, DataAdapter, Query, theme tokens, errors)
  runtime/     headless, no React: form state, conditions, record validation,
               JSON Patch, and the memory / key-value / HTTP data adapters
  renderer/    React: walks view documents, resolves registry keys, wires runtime state
  editor/      authoring: emits JSON Patch against entity/view documents
  theme/       token contract + CSS-variable emitter
testing/       @yadad/testing: mock registry + contract test kit (published)
fixtures/      canonical valid/invalid documents
apps/showcase/  working demo app that renders the fixtures
docs/
  BUILD_PLAN.md                phases, exit criteria, parallelization map
  TASKS.md                     task cards
  DECISIONS.md                 settled decisions
  records-protocol.md          the HTTP records protocol
  research/                    prior art + architecture review
rfcs/                          contract and package changes
examples/                      (reserved)
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

## Read order

- **Maintainer:** `docs/DECISIONS.md` (confirm the rows marked **Confirm**) → `ARCHITECTURE.md` → `docs/BUILD_PLAN.md`.
- **Agent starting a task:** `ARCHITECTURE.md` → `AGENTS.md` → your card in `docs/TASKS.md`.

## Changes from the earlier spec

The earlier spec doc predates the research pass. These docs supersede it:

1. A fifth engine package, `runtime` (headless state and logic, no React).
2. Documents split into `entity` and `view` (`form`, `table`, `dashboard`); all three view shapes designed before the contract freeze.
3. `specVersion` (engine format, needs migrations) separated from `revision` (user edits).
4. Accessible primitives, table virtualization and drag/grid libraries accepted as dependencies, confined to the components repo and the editor.
5. Phase exit criteria are real apps, not feature checklists.
