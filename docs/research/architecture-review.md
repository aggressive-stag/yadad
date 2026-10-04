# Research: Architecture Review and Build Plan

> Reference material from the Oct 4, 2026 research pass. Its recommendations are merged into `ARCHITECTURE.md` and `docs/BUILD_PLAN.md`; where they differ, those files win. Kept here for the evidence and sources behind the decisions.

**Bottom line: the plan is mostly sound, but three changes matter before anyone starts coding.** First, add a headless, React-free `runtime` package for form state, condition evaluation, record validation and query semantics. Second, split the schema into entity definitions and view definitions, and design every view kind up front (form, table, dashboard) before freezing the contract. Third, change "own the code" to mean owning the styled layer only. Accessible behavior primitives and the drag/grid engines should be accepted as dependencies, and only in the components repo and the editor.

## TL;DR

- **Architecture:** keep the two repos and the inward-pointing dependency rules. Add a fifth engine package, `runtime` (pure TypeScript, no React). This copies the core/adapter split used by TanStack Table, Formily, RJSF and react-grid-layout v2. Then model the schema as `Entity` (fields, types, validation) plus `View` documents (form, table, dashboard) that reference field ids. This is the RJSF schema/uiSchema and JSON Forms schema/uischema pattern, extended to more than one view.
- **Build order:** start with guardrails and a walking skeleton. Then design and freeze the full contract, including view shapes for tables and dashboards that won't be rendered for weeks. Run a throwaway editor/grid spike early instead of in phase 6. Use real apps (a Fitnotes clone, a to-do app, an intake form port) as exit criteria rather than feature checklists.
- **Parallelism:** once the contract is tagged, components, theme, runtime, renderer views, adapters and fixtures/docs can run as separate agent workstreams. Use one worktree and one package per task, keep `packages/core` human-only with a CODEOWNERS gate, and have CI enforce dependency direction with dependency-cruiser. Review capacity, not agent count, limits throughput.

## Key findings (what the prior art shows)

| Project | Architectural lesson | Implication |
|---|---|---|
| **Puck** | One `Config` drives both `<Puck>` (editor producing a data payload) and `<Render>`. Ships `migrate()` for its own data-format changes and `transformProps` for user prop changes. Puck's blog says it initially used another drag library and switched to dnd-kit to customize collision for multi-column drops across flex and grid containers. | Validates the editor/renderer split. Copy the two migration kinds: engine-format migrations versus user-schema transforms. |
| **RJSF** | Data `schema` separate from `uiSchema`. Registry holds fields, widgets and templates. v5 split into `@rjsf/utils` (types, `ValidatorType` interface), `@rjsf/validator-ajv8`, `@rjsf/core`, and one package per theme. | Validation behind an interface; component sets as separate packages. Copy the field vs widget vs template distinction. |
| **JSON Forms** | Framework-independent `@jsonforms/core` (state, validation, testers) with renderer sets per framework. Renderers picked by ranked "tester" functions. Visibility is a declarative rule with effect (HIDE/SHOW/ENABLE/DISABLE) and condition. | Condition logic belongs in a headless core as declarative JSON. Don't copy ranked testers: exact-key lookup is easier for agents. |
| **Formily** | `@formily/core` is a framework-agnostic reactive form model; `@formily/react` binds it. | Supports a separate headless layer. Avoid its reactive-graph complexity. |
| **TanStack Table** | Table logic is framework-agnostic TypeScript with framework adapters. v8 removed its plugin system in favor of inversion of control. | Use it inside the components repo. Keep sort/filter semantics in documents and the adapter, not TanStack state. |
| **React Aria / Stately** | Each component split into state, behavior and rendered component. | `runtime` = state; components repo = behavior + render. |
| **react-grid-layout v2** (2.0.0, Dec 9, 2025) | TypeScript rewrite with `src/core/` (pure TS), `src/react/`, `src/legacy/` (v1 wrapper). Designed in public RFC `rfcs/0001-v2-typescript-rewrite.md`; the repo's `CLAUDE.md` points agents at it. | Model for module layout and breaking-change handling: RFC first, then a legacy wrapper. |
| **Form.io** | Form JSON and submission JSON fully separate. Revisions version the components array; a submission renders and validates against the revision it was captured under. | Confirms two-writer model and the record→revision pointer. |
| **json-render** | Catalog of components with Zod prop schemas; `catalog.prompt()` generates the LLM system prompt; the model streams RFC 6902 JSON Patch; AI may only use catalog components. | Generate agent docs from the registry; JSON Patch as the single write format for editor and agents. |
| **amis** | `amis-core`, `amis-formula` (expression engine), `amis-editor`. String expressions mixed into properties; an `env` object virtualizes I/O; API URLs inside schemas. | Copy the `env`/adapter idea. Avoid string expressions and API config in documents. |
| **Object UI** | Agent-driven churn, 40 packages, types coupled to a platform. | Fixed package list by policy; contract changes behind an RFC. |

## Recommended architecture

### Package layout

```
engine/
  packages/
    core/        types + JSON Schemas + doc validation + spec migrations + contracts
    runtime/     headless: form state, condition evaluator, record validation,
                 query model, JSON Patch apply, memory adapter
    renderer/    React binding: walks views, resolves registry keys, wires runtime state
    editor/      emits JSON Patch; property panels from registry optionsSchema (+ dnd/grid deps)
    theme/       token contract + CSS-variable emitter + 2 variants
  testing/       contract test kit, mock registry, fixture loader
  fixtures/      valid/invalid docs, expected error snapshots, migration fixtures
  apps/showcase, examples/
components/      sets/base/<type>/v1|v2, registry/base.ts, UPSTREAM.md
```

Why `runtime`: every mature project above isolates state and logic from the view binding. Logic becomes testable without a DOM, `core` stays a slow-moving contract, and the same logic can run server-side. Record validation as standard JSON Schema per entity lets FastAPI validate records with Python's `jsonschema` against the same document.

Data adapter: interface and `Query` in `core`; memory adapter in `runtime`; Supabase adapter host-side or in `adapters/supabase`. Views reference a named `dataSource` key that the host maps to adapters.

### Schema model: entity + views

```jsonc
// Entity document (data model)
{ "kind": "entity", "specVersion": 1, "id": "workout_set", "revision": 7,
  "fields": [
    { "id": "exercise", "type": "select", "label": "Exercise", "required": true,
      "options": { "source": "static", "values": ["Squat","Bench"] } },
    { "id": "weight", "type": "number", "label": "Weight", "min": 0, "unit": "kg" } ] }

// View document (layout)
{ "kind": "form", "specVersion": 1, "id": "log_set", "entity": "workout_set", "revision": 3,
  "sections": [ { "id": "main", "title": "Set", "items": [
    { "field": "exercise" },
    { "field": "weight", "visibleWhen": { "op": "neq", "field": "exercise", "value": null } } ] } ] }
```

- Discriminated unions everywhere (`kind`, `type`, `op`, `widget`); no index signatures or `additionalProperties: true`; typed `options` per field type.
- Conditions as a small JSON AST: `eq, neq, in, gt, gte, lt, lte, empty, notEmpty, and, or, not`.
- Document validation in `core` (meta schema + referential integrity); record validation in `runtime` (entity compiled to JSON Schema). Views may only tighten constraints.
- Hidden-field values: Form.io renamed "Clear Value When Hidden" to "Omit Value From Submission Data When Conditionally Hidden" (stored as `clearOnHide`) as of API Server 9.4.0. Default to keep; opt-in `clearWhenHidden`.
- One source of truth emitting both TS types and JSON Schema; commit the generated `*.schema.json`.

### Versioning

| | specVersion (engine format) | revision (user document) |
|---|---|---|
| Changes when | The engine's schema language changes | A user or editor edits an entity or view |
| Migration | Pure `migrate(doc, from, to)` in `core` (Puck `migrate()` equivalent) | None for additive edits; destructive edits need an explicit editor transform (Puck `transformProps` equivalent) |
| Records | n/a | Store `{entityId, entityRevision}`; upcast lazily on read; failed validation shows "saved under rev N" (Form.io approach) |

### Registry contract

```ts
interface FieldTypeEntry<T> {
  type: string;
  optionsSchema: JSONSchema;
  Input: Component<InputProps<T>>;
  Display: Component<DisplayProps<T>>;
  CellEditor?: Component<InputProps<T>>;
}
interface Registry { fields: Record<string, FieldTypeEntry<any>>; layout: { Section; Tabs; GridItem; FieldFrame }; widgets: Record<string, WidgetEntry>; }
```

Add RJSF-style templates (`FieldFrame`). Add a `describeRegistry()` catalog for agents (json-render idea).

### Ownership

- **Own:** schema, runtime, renderer, editor logic, styled components (shadcn's open-code model), tokens.
- **Depend on, components repo only:** Radix / React Aria / Base UI behavior primitives; TanStack Table / Virtual.
- **Depend on, editor only:** react-grid-layout v2 (latest 2.2.3, Mar 24, 2026; avoid 2.2.2, which its release notes flag for a critical layout bug) and `@dnd-kit/react` (pre-1.0, 0.5.0 Jun 2026; legacy `@dnd-kit/core` last released 6.3.1 Dec 2024; old docs repo archived Feb 21, 2026). Both behind an `editor/dnd` adapter.
- **Renderer stays dependency-free:** view-mode dashboards are CSS grid from `x,y,w,h`.

### Testing

Fixture corpus; contract test kit; renderer tests against a mock registry; migration tests; runtime unit/property tests; visual tests in the components repo after Phase 4; per-package size budgets (RJSF runs size-limit on every package).

### Stability policy

Fixed package list (RFC to add); `0.x` with `contract-vN` tags on core; changesets; deprecation for at least one minor with runtime warnings; public API reports; no escape hatches in v1.

## Build order, parallelization, coordination, risks

Merged into `docs/BUILD_PLAN.md`. Notable evidence: practitioner guides recommend capping parallel agents at 3–4 (jamilxt, DEV Community, Sep 2026) or 2–4 (MindStudio); the AGENTS.md convention says the nearest `AGENTS.md` to the edited file takes precedence.

## Caveats

- Object UI, Formily and amis maintenance/download figures come from the earlier evaluation, not re-verified in this pass.
- Some architecture descriptions (RJSF layering, json-render JSON Patch streaming, amis package names) rely on DeepWiki and secondary summaries; they matched primary docs where checked.
- Worktree and agent-concurrency guidance comes from practitioner blogs, not controlled studies.
- The exact dnd-kit version range in Puck 0.23's `package.json` was not confirmed.
- Effort estimates are judgment calls.

## Sources

1. https://dev.to/andrea_schiona/running-coding-agents-in-parallel-with-git-worktrees-4cnk
2. https://www.stefanos-lignos.dev/posts/nx-module-boundaries
3. https://nimbalyst.com/blog/git-worktrees-for-ai-coding-agents-complete-guide/
4. https://puckeditor.com/docs/integrating-puck/component-configuration
5. https://puckeditor.com/docs/integrating-puck/data-migration
6. https://rjsf-team.github.io/react-jsonschema-form/docs/advanced-customization/custom-widgets-fields/
7. https://rjsf-team.github.io/react-jsonschema-form/docs/migration-guides/v5.x%20upgrade%20guide/
8. https://deepwiki.com/rjsf-team/react-jsonschema-form
9. https://mintlify.wiki/eclipsesource/jsonforms/api/core/overview
10. https://jsonforms.io/docs/tutorial/custom-renderers
11. https://jsonforms.io/docs/uischema/rules
12. https://github.com/alibaba/uform/blob/master/./packages/react/README.md
13. https://tanstack.com/table/latest/docs/overview
14. https://react-aria.adobe.com/blog/introducing-react-spectrum
15. https://react-spectrum.adobe.com/architecture.html
16. https://github.com/react-grid-layout/react-grid-layout/blob/master/rfcs/0001-v2-typescript-rewrite.md
17. https://github.com/react-grid-layout/react-grid-layout/blob/master/CLAUDE.md
18. https://github.com/react-grid-layout/react-grid-layout
19. https://www.npmjs.com/package/react-grid-layout?activeTab=versions
20. https://form.io/features/form-revisions-form-json-schema/
21. https://github.com/vercel-labs/json-render/tree/main
22. https://deepwiki.com/vercel-labs/json-render/2-getting-started
23. https://deepwiki.com/baidu/amis
24. https://github.com/baidu/amis/blob/master/docs/zh-CN/concepts/schema.md
25. https://dev.to/canonical/why-baidus-amis-framework-is-an-excellent-design-5cch
26. https://ui.shadcn.com/docs
27. https://www.npmjs.com/package/@measured/puck?activeTab=dependencies
28. https://www.npmjs.com/package/@dnd-kit/react
29. https://github.com/clauderic/dnd-kit/releases
30. https://github.com/dnd-kit/docs
31. https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents
32. https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees
33. https://agents.md/
34. https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/
35. https://github.com/adobe/react-spectrum
