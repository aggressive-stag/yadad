---
"@yadad/renderer": patch
---

A form that edits a record now says when a validation error is on a field the form does not show: `"Score" is not on this form. Its stored value breaks a rule: must be at most 100.` with the hint to fix it where the field can be edited. The save is still refused.
