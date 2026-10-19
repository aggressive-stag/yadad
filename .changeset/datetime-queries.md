---
"@yadad/runtime": minor
---

Filter and sort the `datetime` field (RFC 0007): conditions compare canonical instants as strings (string order is time order), `null` is empty, and the in-process sort keeps empties last in both directions. The from/to quick-filter range uses 34a's `instantRangeBounds`, so a range typed as 10:00 to 10:30 includes 10:30:59.999. Adapter conformance now covers datetime order, empties-last both ways, and a range that includes the last millisecond.
