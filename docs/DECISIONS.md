# Decisions

Settled decisions and what they replaced. Agents: do not reopen a settled decision; propose an RFC instead.

| # | Decision | Status | Replaces / notes |
| --- | --- | --- | --- |
| D1 | Two repos: `engine` (original work) and `components` (reference set) | Settled | Single repo with a components package |
| D2 | Engine packages: `core`, `runtime`, `renderer`, `editor`, `theme` (+ `testing/`, `fixtures/`) | **Confirm** | Earlier 4-package plan without `runtime`. Added because every mature comparable project separates headless state/logic from the view layer. |
| D3 | Dependency direction: everything points toward `core`; registry and data adapter are injected by the host | Settled | — |
| D4 | Runtime is the primary mode; build-time is bundled JSON in the same slot | Settled | — |
| D5 | Two inputs (documents, records), two writers (editor writes documents, pages write records) | Settled | Form.io two-document model |
| D6 | Documents split into `entity` (fields, validation) and `view` (`form`, `table`, `dashboard`) | **Confirm** | Earlier single `{page, fields}` schema |
| D7 | `specVersion` (engine format, needs migrations) is separate from `revision` (user edits, data) | **Confirm** | Earlier rule "every schema change bumps version and ships a migration" |
| D8 | Conditions are a JSON AST; no string expressions | Settled | amis-style expressions rejected |
| D9 | Exact-key registry with `Input`, `Display`, optional `CellEditor`, plus `FieldFrame` template | Settled | Ranked testers (JSON Forms) rejected |
| D10 | Own styled components and logic; accept Radix/React Aria and TanStack in the components repo, and react-grid-layout v2 + `@dnd-kit/react` in the editor behind an adapter | **Confirm** | Earlier "own everything, import nothing" stance; resolves the open dnd-kit question |
| D11 | Do not fork or build on Object UI; read it as reference only | Settled | Churn (v0→v17 in ~6 months), ObjectStack coupling, ~133 weekly downloads |
| D12 | Real apps are exit criteria: intake form (Phase 2), to-do (Phase 3), Fitnotes clone (Phases 4–5) | Settled | Feature-checklist phases |
| D13 | Freeze `contract-v0` (all view shapes) before any parallel agent work | Settled | — |
| D14 | 2–4 concurrent agents, worktree per task, one package per PR, CODEOWNERS on `core` | Settled | — |
| D15 | Components are styled through a public, host-configurable CSS surface: theme tokens (`--yadad-*`), per-component CSS variables that default to tokens, stable `data-part` hooks, and all CSS in `@layer yadad` so host styles win. Authored in plain CSS and shipped as pre-built CSS that hosts may import or skip. | Settled | Open question "Tailwind or plain CSS variables"; chosen for maximum host configurability with no build-tool lock-in |
| D16 | Test-only dev dependencies (DOM environments, testing libraries, axe) may be added without an RFC | Settled | AGENTS.md rule 7 now covers runtime and published dependencies only |

Rows marked **Confirm** change something from the original spec. The maintainer confirms them before Phase 1 starts.
