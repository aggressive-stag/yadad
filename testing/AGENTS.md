# AGENTS.md (testing)

Package rules on top of the root `AGENTS.md`. Published as `@yadad/testing` for the components repo.

- **Owns:**
  - The contract test kit. Every registry entry must render with fixture options, emit the right JSON type on change, show a given error and pass axe.
  - The mock registry: stub components with `data-testid`.
  - The fixture loader.
- **Imports:** `@yadad/core`.
- **Stability:** the components repo pins this package to a `contract-vN` tag, so changing what the kit checks is a contract change. Treat it like `core` and get maintainer review.
- **Commit scope:** `testing`.
