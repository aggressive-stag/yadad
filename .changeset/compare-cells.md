---
"@yadad/runtime": minor
---

Add `neighbourQuery` and `compareCells` (RFC 0007): the widened offset query that loads one row beyond the page edge for a `to` compare (`offset - 1` / `limit + 1`), and the per-row word diff of each cell against its neighbour row or another field of the same record. A row with no neighbour has no cell; an empty comparator counts as `""`, so everything is added. Cursor pages cannot be widened backwards — pass the previous page's last row as `edge` to `compareCells`.
