---
"@yadad/core": patch
---

Validator internals, behaviour frozen: the calendar and board field checkers shared a verbatim preamble (find/idsOfType/unknown/typed), a title fallback and a filter/sort/actions tail — three copies of rules that had to be edited together. Now one file-local ViewFieldChecker factory, checkViewTitle and checkViewFilterSortTail, plus entityFieldIds for the seven repeated field-id lists. Same codes, paths, messages and check order, pinned by the untouched document-fixture suites.
