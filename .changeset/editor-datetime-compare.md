---
"@yadad/editor": minor
---

datetime fields and compare columns are editable. The fields panel gives a datetime field its `min` and `max` as canonical instants (the native box types a local time, read as UTC; the stored form is accepted verbatim, and anything else the document validator refuses, naming the form). A datetime column can be a quick filter — a from/to range, like `date`. Each table column gains a Compare choice: the previous row, the next row, or another text field of the same entity; an editable column, a non-text column, a comparator that is not another text field, and a column comparing with itself are all refused against the live entity, each naming the real reason.
