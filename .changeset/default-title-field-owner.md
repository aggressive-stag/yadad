---
"@yadad/core": minor
"@yadad/runtime": patch
---

New export `defaultTitleField(entity)` in @yadad/core: the single owner of the "an omitted view titleField falls back to the entity's first text field" rule. The validator's calendar/board title checks and both runtime `titleFieldOf` helpers now call it instead of re-encoding the rule — the four copies could drift apart silently, validator against runtime. Behaviour unchanged.
