# AGENTS.md (renderer)

Package rules on top of the root `AGENTS.md`.

- **Owns:** turning view documents plus runtime state into React trees. It walks the view, resolves each field `type` and widget through the injected `Registry`, and wires up `runtime` state.
- **Imports:** `@yadad/core` and `@yadad/runtime` (React comes in as a dependency when the first view renders). Never import a component, the editor or a drag/grid library.
- **Registry keys only:** no component names or file paths. Exact-key lookup, no ranked testers. If a key is missing, report an error in the core error format rather than guessing.
- **Dashboards in view mode:** plain CSS grid from `x, y, w, h`. No grid library.
- **Data:** records come through the injected `DataAdapter`, looked up by the view's `dataSource` key. No URLs.
- **Tests:** run against the mock registry (stub components with `data-testid`). Engine CI never needs real components.
- **Commit scope:** `renderer`.
