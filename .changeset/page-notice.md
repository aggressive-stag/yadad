---
"@yadad/core": minor
"@yadad/runtime": minor
---

A list `Page` may carry an optional `notice: { tone: "info" | "warning"; text: string }`, the server's statement about one answer (for example "served without vector search"). It is protocol data, so documents and `specVersion` are unchanged. `docs/records-protocol.md` documents the `notice` key on a list response. The HTTP adapter passes a well-formed `notice` through and drops a malformed one with a console warning.
