# @yadad/core

The yadad contract: document types (entities, form/table/dashboard views), the condition AST, document validation (`validateDocument`, `validateDocuments`), and the `Registry` and `DataAdapter` interfaces. Headless — no React, no I/O, no dependencies.

`describeContract()` returns a plain JSON description of everything a document can contain — document kinds and their properties, field types and their type-specific properties, condition ops with their exact shapes, widget types, grid limits, the id pattern and the error codes. It is generated from the same constants the validator uses, so it cannot describe what the validator rejects; the repo root script `pnpm describe-registry` prints it (readable text by default, `--json` for machines).

The contract is pre-contract (`specVersion: 0`, in flux); see the repo [README](https://github.com/aggressive-stag/yadad) and [ARCHITECTURE.md](https://github.com/aggressive-stag/yadad/blob/main/ARCHITECTURE.md) for the design.
