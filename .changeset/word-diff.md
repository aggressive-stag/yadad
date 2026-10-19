---
"@yadad/runtime": minor
---

Add `diffWords(before, after)` (RFC 0007): a word diff over runs of non-space characters and runs of whitespace, an LCS over the tokens with neighbours merged, deterministic on ties, and bounded — past 2,000 tokens on either side it returns one `removed` plus one `added` segment instead of computing.
