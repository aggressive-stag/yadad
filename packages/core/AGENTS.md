# AGENTS.md (core)

Package rules on top of the root `AGENTS.md`. **This package is the contract and is human-owned** (`CODEOWNERS`). Touch it only when your task card says so.

- **Owns:** document shapes (entity, form/table/dashboard views), JSON Schemas, document validation (meta schema plus referential checks), spec migrations, and the interfaces `Registry`, `DataAdapter`, `Query`, theme token names and the error format.
- **Imports:** nothing from the workspace. The only allowed dependency is its validator library. No React, DOM or I/O.
- **Shapes:** discriminated unions everywhere (`kind`, `type`, `op`, `widget`). No index signatures, no `additionalProperties: true`, no `custom` field type, no string expressions, no `any` in exports.
- **Schemas:** one source of truth. Author types once and generate the JSON Schemas; commit the generated `*.schema.json` and never hand-edit them.
- **Errors:** `{ path, code, message, hint }`, where `path` is a JSON Pointer and the message is readable by a person and actionable by an agent.
- **Changes:** need an RFC in `rfcs/` and maintainer review. Schema changes also bump `specVersion` and add a `migrate()` step with a before/after fixture pair.
- **Commit scope:** `core`.
