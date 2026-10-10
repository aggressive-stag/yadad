---
"@yadad/core": minor
---

`describeContract()`: a pure function that returns a plain JSON description of everything a document can contain (document kinds and their properties, field types and their type-specific properties, condition ops with their exact shapes, widget types, grid limits, the id pattern, the error codes). It is generated from the same constants the validator uses, so it cannot describe what the validator rejects; the new drift tests in `contract.test.ts` prove it (every listed property is accepted at its path, every unlisted one is rejected, every op shape validates). The root script `pnpm describe-registry` prints the description (readable text by default, `--json` for machines) directly from the TypeScript source, so it works from a fresh clone after `pnpm install` with no build step.
