# AGENTS.md (theme)

Package rules on top of the root `AGENTS.md`.

- **Owns:** token values, the CSS-variable emitter, and two theme variants.
- **Imports:** nothing from the workspace.
- **Tokens:** token names are part of the frozen contract, so renaming or removing one needs an RFC. Adding a value to an existing name is a normal change.
- **Components:** read tokens only as CSS variables. Nothing in this package knows about components.
- **Commit scope:** `theme`.
