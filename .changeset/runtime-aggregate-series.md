---
"@yadad/runtime": minor
---

aggregateSeries(): the series widget's computation (RFC 0001 slice 2). Pages the entity like aggregate() — same 500-per-request walk, same 5000-record ceiling, same partial — and folds one slice-1 measure per group. Group values are exact (select, boolean, reference id, text) or date buckets (day, ISO-Monday week, YYYY-MM month); records without a group value are skipped and counted; a date series sorted by group has its empty buckets filled with 0 or no-value per op. Labels, formatting and charts stay out of the engine.
