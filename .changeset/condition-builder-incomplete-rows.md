---
'@yadad/editor': patch
---

Fix two condition builder bugs:

- Apply stays disabled until every condition row is complete, and the builder says so. Before, an unfinished row (for example a comparison with no value yet) was dropped silently when applying.
- Changing a row's field now resets its operator to "is" when the new field's type does not offer it (for example "is one of" carried onto a number field), instead of leaving a row that could never be applied.
