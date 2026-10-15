---
"@yadad/core": minor
---

Add `recordJsonSchema(entity)`, which compiles an entity to a standard JSON Schema (draft 2020-12) for a record's `values`, so a backend can validate records with any JSON Schema library instead of re-implementing the field rules. `pnpm record-schema <entity.json>` prints the schema for an entity file. Nothing existing changes. Known differences from `validateRecord` are listed in `docs/records-protocol.md`.
