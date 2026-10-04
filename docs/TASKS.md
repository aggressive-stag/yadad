# Task Cards: Phase 0 and Phase 1

Each card lists the package, the files an agent may change, what must pass, and when it is done. Owner `human` means the maintainer does it or reviews line by line; `agent` cards can run in the background. Later phases get cards once `contract-v0` is tagged.

---

## Phase 0: guardrails + walking skeleton

### P0-01 Scaffold the engine monorepo
- **Owner:** agent · **Where:** repo root
- **Allowed:** root config files, empty `packages/{core,runtime,renderer,editor,theme}`, `testing/`, `fixtures/`, `apps/showcase`, `examples/`, `rfcs/`
- **Do:** pnpm workspaces, TypeScript project references, Vitest, ESLint, changesets, a `package.json` per package with only its allowed internal deps.
- **Done when:** `pnpm install && pnpm typecheck && pnpm test` pass on an empty skeleton.

### P0-02 Enforce dependency direction in CI
- **Owner:** agent, human review · **Where:** root
- **Allowed:** `.dependency-cruiser.cjs`, CI workflow, a test fixture under `tools/forbidden-import-fixture/`
- **Do:** rules from `ARCHITECTURE.md` §4 (core imports nothing; runtime → core; renderer/editor → core + runtime; no `react` in core/runtime; no deep imports; nothing imports components).
- **Done when:** CI fails on the forbidden-import fixture and passes without it.

### P0-03 CODEOWNERS and agent docs
- **Owner:** human · **Where:** root
- **Allowed:** `CODEOWNERS`, `AGENTS.md`, `packages/*/AGENTS.md`, `ARCHITECTURE.md`
- **Done when:** `core`, `fixtures/`, `rfcs/` require maintainer review; each package has a short `AGENTS.md`.

### P0-04 Skeleton contract (throwaway-compatible)
- **Owner:** human · **Where:** `packages/core`
- **Do:** minimal `entity` + `form` view types, `text` field only, `Registry` and `DataAdapter` interfaces, error format. Clearly marked pre-contract.
- **Done when:** the example documents in P0-05 validate.

### P0-05 One text field end to end
- **Owner:** agent · **Where:** `runtime`, `renderer`, `apps/showcase`, `testing/`
- **Do:** memory adapter; form state for one field; renderer walks a form view and resolves `text` from an injected registry; mock registry in `testing/`; showcase wires it up.
- **Fixtures:** `fixtures/valid/entity-hello.json`, `fixtures/valid/form-hello.json`
- **Done when:** showcase renders the field, saving creates a record in the memory adapter with `entityRevision`, and changing the label in JSON changes the page with no code edits.

### P0-06 Components repo + `text/v1`
- **Owner:** agent · **Where:** components repo
- **Do:** scaffold per `yadad-components/AGENTS.md`; `text/v1`; `registry/base.ts`; `UPSTREAM.md`; minimal contract kit run.
- **Done when:** the contract kit passes for `text/v1`, and the showcase can use it in place of the mock registry.

---

## Phase 1: contract design + freeze

### P1-01 Choose the type/schema source-of-truth tool
- **Owner:** human · **Where:** `rfcs/`
- **Do:** pick a Zod- or TypeBox-style approach that emits both TS types and JSON Schema; record in RFC-0001.
- **Done when:** RFC section merged; generation script runs in CI.

### P1-02 Entity + field types
- **Owner:** human (agent may draft) · **Where:** `packages/core`
- **Do:** `text, number, date, select, boolean`, each with a typed `options` object and validation keywords.
- **Done when:** generated JSON Schemas committed; no index signatures or `additionalProperties: true`.

### P1-03 View shapes: form, table, dashboard
- **Owner:** human · **Where:** `packages/core`
- **Do:** form sections/items; table columns, default sort/filter, inline-edit flags; dashboard tabs, grid items `{x,y,w,h,widget}`, widget union. Use B (P1-08) findings for the dashboard shape.
- **Done when:** the intake form and the Fitnotes entities + views are expressible and validate.

### P1-04 Condition AST
- **Owner:** human · **Where:** `packages/core`
- **Do:** ops `eq, neq, in, gt, gte, lt, lte, empty, notEmpty, and, or, not`; `visibleWhen`, `enabledWhen`, `requiredWhen`; `clearWhenHidden` default false.
- **Done when:** types + JSON Schema + valid/invalid fixtures.

### P1-05 Referential validation and error format
- **Owner:** agent · **Where:** `packages/core` (card grants access)
- **Do:** views must reference existing entity and field ids; conditions must reference existing fields; errors `{path, code, message, hint}` with JSON Pointer paths.
- **Done when:** every invalid fixture produces its snapshot error.

### P1-06 `specVersion` + `migrate()` harness
- **Owner:** agent, human review · **Where:** `packages/core`, `fixtures/migrations/`
- **Done when:** a dummy v0→v1 migration with a before/after fixture pair passes the migration test.

### P1-07 Fixture corpus + `describeRegistry()`
- **Owner:** agent · **Where:** `fixtures/`, `testing/`
- **Do:** valid + invalid documents for every field type and view kind; `describeRegistry()` emits a markdown catalog.
- **Done when:** corpus green; catalog output committed for agents.

### P1-08 Editor/grid spike (throwaway)
- **Owner:** agent · **Where:** branch `spike/editor-grid` only
- **Do:** react-grid-layout v2 + `@dnd-kit/react` editing a dashboard view through JSON Patch.
- **Done when:** a short findings note is attached to RFC-0001; the branch is deleted.

### P1-09 Freeze
- **Owner:** human
- **Done when:** RFC-0001 merged, `contract-v0` tagged, `@engine/core` and `@engine/testing` prerelease published for the components repo.
