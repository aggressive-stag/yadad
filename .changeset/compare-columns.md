---
"@yadad/renderer": minor
---

Compare columns (RFC 0007): a table column with `compare` now shows its text as a word diff against its comparator — `to: "previousRow" | "nextRow"` (the neighbour in the table's own sort, loaded one row beyond the page edge with `neighbourQuery` and never displayed) or `field` (another text field of the same record). The segments go to the text Display as the new `diff` extra; a row with no neighbour (the oldest version) and a registry that ignores `diff` both show plain text.
