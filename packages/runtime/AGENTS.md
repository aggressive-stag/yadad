# AGENTS.md (runtime)

Package rules on top of the root `AGENTS.md`.

- **Owns:** headless state and logic. That means form state, the condition evaluator, record validation (entity compiled to standard JSON Schema), the query model, applying JSON Patch, and the memory `DataAdapter`.
- **Imports:** `@yadad/core` only. No React, no DOM, not even type imports.
- **Why it's separate:** logic is testable without a DOM, and the same record validation can run server-side.
- **Behavior:**
  - Hidden fields keep their values unless the item sets `clearWhenHidden: true`.
  - Views may only make rules stricter than the entity, never looser.
  - Never coerce records silently. Old records are upcast lazily on read, and a record that fails reports "saved under revision N" instead of throwing.
- **Tests:** pure functions with unit and property tests, driven by `fixtures/`.
- **Commit scope:** `runtime`.
