---
"@yadad/renderer": minor
---

Cursor paging in the table (RFC 0007): a first page with no `total` and a `next` switches the pager to cursors — the table keeps the cursors it visited, so Previous works without backward cursors — and shows "Page N" with Previous/Next and no "of N". Changing the sort, a quick filter or the page size clears the stack. A response with neither total nor next is the last page. The dashboard `count` on a server that does not count walks the pages (the runtime already did) and shows the number read, or "5000+" when it stopped at the cap with more pending.
