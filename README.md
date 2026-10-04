# yadad

Yet another drag and drop: a runtime, schema-driven React engine (forms, record tables, dashboards from JSON documents). Status as of October 4, 2026: architecture planned, Phase 0 in progress.

## Repo layout

This is the engine repo. The reference component set lives in [yadad-components](https://github.com/aggressive-stag/yadad-components), with its own `AGENTS.md`.

```
README.md                      this file (replace with the project README later)
ARCHITECTURE.md                authoritative architecture; wins any conflict
AGENTS.md                      rules for AI coding agents in the engine repo
docs/
  BUILD_PLAN.md                phases, exit criteria, parallelization map, risks
  TASKS.md                     task cards for Phase 0 and Phase 1
  DECISIONS.md                 settled decisions and what they replaced
  OPEN_QUESTIONS.private.md    unresolved items (local only, gitignored)
  research/
    prior-art.md               comparable projects, Object UI evaluation
    architecture-review.md     research report behind the architecture
```

## Read order

- **Maintainer:** `docs/DECISIONS.md` (confirm the four rows marked **Confirm**) → `docs/OPEN_QUESTIONS.private.md` (local only) → `ARCHITECTURE.md` → `docs/BUILD_PLAN.md`.
- **Agent starting a task:** `ARCHITECTURE.md` → `AGENTS.md` → your card in `docs/TASKS.md`.

## Changes from the earlier spec

The earlier spec doc predates the research pass. These docs supersede it:

1. A fifth engine package, `runtime` (headless state and logic, no React).
2. Documents split into `entity` and `view` (`form`, `table`, `dashboard`); all three view shapes designed before the contract freeze.
3. `specVersion` (engine format, needs migrations) separated from `revision` (user edits).
4. Accessible primitives, table virtualization and drag/grid libraries accepted as dependencies, confined to the components repo and the editor.
5. A throwaway editor/grid spike runs alongside contract design.
6. Phase exit criteria are real apps: intake form, to-do app, Fitnotes clone.

## Not in this pack

Code, configs (`.dependency-cruiser.cjs`, CI workflows, CODEOWNERS) and the RFC-0001 template. Those are Phase 0 task cards.
