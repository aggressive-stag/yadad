---
"@yadad/core": minor
---

A `reference` field may be a quick filter (RFC 0011 item 3). The control is a picker over the target entity's records, the filter matches the stored id with `eq`, and its `default` is a record id (a non-empty string). `placeholder` stays text-only, and a reference field is still refused as a sort key. Use it for a server-backed choice list that is already an entity, instead of a `select` filled at build time.
