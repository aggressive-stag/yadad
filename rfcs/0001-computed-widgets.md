# RFC 0001: Computed dashboard widgets

- Status: Accepted (slice 1 implemented)
- Touches: `core` (document types, validator, `describeContract`), `runtime` (aggregation, adapters), `renderer` (dashboard), `editor` (widget panel), `docs/records-protocol.md` (optional endpoint), registry contract (`widgets`)
- Bumps `specVersion` (to the next version; it is 1 at the time of writing) with a `migrate()` step and a before/after fixture pair.

## Summary

Add two dashboard widgets that compute over the records of a table view: `stat` (one number) and `series` (values grouped by a field, shown as a table, bar chart or line chart). A measure is a typed object (`count`, `sum`, `countDistinct`, `min`, `max`, `avg`, over one field or the product of two). No formulas, no strings to parse. Aggregation is a pure function in `runtime`; adapters may optionally compute it server-side.

## Motivation

A dashboard today can embed a view or count a view's rows (`widget: "view" | "count"`). Any app with a "stats" screen needs more. Generic cases:

- Total of a numeric field ("hours logged", "amount spent").
- Total of a product of two fields ("weight times reps" volume, "price times quantity" revenue).
- Distinct count of a field ("days with an entry", "customers seen").
- Group-by with a measure ("entries per day", "total per category", "max per item").
- A simple bar or line chart of such a series.

A workout log's stats screen needs all of these and expresses none of them today. The same gap blocks expense summaries, time tracking and habit streak screens, so the need is general.

## Detailed design

### Documents

Both widgets reference a table view, like `count` does: the view supplies the entity, data source and fixed filter. A widget may narrow further with its own `filter` (same `Condition` AST).

```jsonc
// Measure: a discriminated union on `op`
{ "op": "count" }                                   // records
{ "op": "sum", "field": "weight" }                  // sum of one field
{ "op": "sum", "product": ["weight", "reps"] }      // sum of a x b per record
{ "op": "countDistinct", "field": "date" }
{ "op": "min" | "max" | "avg", "field": "weight" }
```

```jsonc
// One number
{ "id": "volume", "x": 0, "y": 0, "w": 3, "h": 2,
  "widget": "stat", "label": "Total volume", "view": "all_sets",
  "measure": { "op": "sum", "product": ["weight", "reps"] },
  "filter": { "op": "gte", "field": "date", "value": "2026-01-01" } }

// A grouped series
{ "id": "per_day", "x": 0, "y": 2, "w": 8, "h": 5,
  "widget": "series", "label": "Volume per day", "view": "all_sets",
  "groupBy": { "field": "date" },                    // value of the field
  "measure": { "op": "sum", "product": ["weight", "reps"] },
  "display": "bar",                                  // "table" | "bar" | "line"
  "sort": { "by": "group", "dir": "asc" },           // or { "by": "value", "dir": "desc" }
  "limit": 30 }
```

Rules and limits chosen to stay small:

- `groupBy` is one field, grouped by exact value. Date bucketing (`"bucket": "week" | "month"`) is a possible additive follow-up, not in the first slice. Two-level grouping is out.
- `product` is exactly two number fields. It is a typed pair, not an expression language. Anything more (est. one-rep max, ratios, weighted averages) is where we stop; see Alternatives.
- `sum`, `avg`, `min`, `max` and `product` need number fields (`min`/`max` also accept `date`). `countDistinct` accepts any field type. Empty values are skipped, except by `count`.
- An empty input gives `null` for `min`, `max`, `avg`, and `0` for `count`, `sum`, `countDistinct`. The widget renders a placeholder for `null`.
- `limit` caps the groups shown (default 50, maximum 200). `sort` defaults to group ascending.
- `label` is required (as on `count`), and doubles as the accessible name of a chart.

### Validator (`core`)

Shape: `measure` and `groupBy` are discriminated and closed (unknown properties rejected like everywhere else). Set-level (`validateDocuments`): `view` exists and is a table; `measure` and `groupBy` field ids exist on that entity; field types fit the op (`sum` on a text field is `invalid-value` with `allowed` listing number fields); `filter` fields exist. Warnings (`empty` code) for a `series` whose view has no fixed filter and no limit is not needed; none proposed. `describeContract()` gains the two widgets, the measure ops and the `display` values, all generated from the same constants.

### Runtime

A pure, headless `aggregate(records, spec)` in `runtime` returns `{ value }` for a stat and `{ groups: { key, value }[] }` for a series, applying sort and limit. It is the one definition of the semantics (empty handling, rounding left to display). No React, no I/O.

### Data access: client-side first, optional server-side

Today `count` costs one `find` with `limit: 0` and reads `total`. Aggregates need values, so there are two options.

1. **Client-side (recommended first slice).** The renderer pages through `find` (respecting the repo's 500 per-request cap) until `total` is read, up to a hard ceiling of 5000 records, and runs `aggregate`. Past the ceiling the widget shows a "partial, first N of M records" notice rather than a wrong number. Pros: no protocol change, every existing backend and the memory/key-value adapters work unchanged. Cons: many requests and transferred rows for large tables; ordering must be stable across pages (the protocol already requires this).
2. **Server-side (additive, optional).** A new optional adapter method `aggregate?(entity, spec, query)` and a protocol endpoint, `POST {base}/{entity}/_aggregate`, with body `{ "entityRevision", "filter"?, "measure", "groupBy"?, "limit"? }`, replying `200 { "value": number | null }` or `{ "groups": [{ "key", "value" }] }`. The same by-whitelist rule as filters applies: the server checks the op and field ids against what it knows and never builds queries from strings. `_aggregate` cannot collide with an id (ids never start with `_`). The renderer uses it when the adapter provides it, otherwise falls back to option 1. A backend that implements it may be stricter or cheaper, but must match `aggregate()` semantics; the contract test kit gets a shared case list to enforce that.

Recommendation: ship option 1 and specify option 2 in `records-protocol.md` as optional, implement it in the HTTP and memory adapters in a later slice once a real backend needs it.

### Renderer, registry, editor

- Registry: `widgets` gains `stat: Component<StatWidgetProps>` and `series: Component<SeriesWidgetProps>`, like `count`. Components receive already computed data (`value`, or `groups`, plus `display`, `label`, a formatter hint from the field's `unit`). They never fetch. Chart drawing lives in the components repo; the engine ships no chart dependency (AGENTS rule 7). A components set may implement `bar`/`line` as inline SVG; the mock registry renders a table.
- Renderer: the dashboard fetches and aggregates, handles loading/error/partial states the way `count` does, and re-aggregates when the view's records change (same refresh path as `count`).
- Editor: a widget panel for `stat` and `series` built from the contract: view picker (table views), measure op and field pickers (filtered by type), `groupBy` picker, `display`, sort, limit, and the existing condition builder for `filter`. Panels emit JSON Patch as today.

## Fit with the hard rules

- No string expressions: measures are closed typed objects; `product` is a pair of field ids, not a formula.
- No escape hatches: no index signatures or props bags; every property is validated; registry keys only (`stat`, `series`); no component names or paths.
- Documents are the contract: behavior changes through widget types, validator, then runtime and renderer. No special cases in components.
- `core` stays free of I/O and React; aggregation sits in `runtime`.
- `specVersion` bump; `migrate()` is the identity for existing documents (the change is additive), plus before/after fixtures and valid/invalid fixtures for each widget and measure op.

## Alternatives considered

- **Expression strings** (`"sum(weight * reps)"`): rejected by D8.
- **A general `computed` field type on entities**: stores or derives per-record values (`volume = weight * reps`) once, and then `sum` needs only `field`. Attractive, but it needs an expression or a typed operator set, derived-value storage or on-read evaluation in every adapter, and it widens the entity contract. The `product` pair covers the common case at a fraction of the cost. Revisit only if more than pairwise products show up.
- **A `chart` widget with an inline data query** (own entity, own filter): duplicates the table view's entity/data source/filter and loses reuse; referencing a table view matches how `count` works.
- **Make aggregation server-only**: breaks the memory and key-value adapters and any backend that has not implemented it.
- **Ship a charting dependency in the renderer**: forbidden without an RFC and a poor fit for the registry model.

## Phasing

1. **Slice 1:** `stat` widget, ops `count`, `sum` (field or product), `countDistinct`, `min`, `max`, `avg`; client-side aggregation; validator, fixtures, editor panel, mock registry component. This alone makes "total volume", "days trained" and "max weight" expressible.
2. **Slice 2:** `series` with `groupBy`, `display: "table"`, then `bar` and `line` in the components repo.
3. **Slice 3 (optional):** `_aggregate` endpoint and `aggregate?` adapter method; date `bucket`.

Where I would stop: one group key, no formulas beyond the product pair, no multi-series charts, no derived-from-aggregate values (such as an estimated one-rep max, which needs a per-record formula). A host that needs those should compute them in its backend and expose the result as a field.

## Decision (2026-10-15)

Accepted; slice 1 is being implemented.

1. The pairwise `product` is accepted; no `computed` field design first.
2. Client-side aggregation with the 5000-record ceiling and a "partial" notice is fine for slice 1; `_aggregate` comes later if needed.
3. Two widgets: `stat` and `series`.
4. Date bucketing comes later, not in the first `series` slice.
5. The components repo draws charts; the engine stays chart-free.

Slice 1 renders `stat` through the existing count display registry component (a labelled number) rather than a new registry key, unless that component cannot show a formatted decimal.

## Open questions for the owner

1. Is the pairwise `product` acceptable, or should anything beyond plain `sum` of a field wait for a `computed` field design?
2. Is the client-side ceiling (5000 records, then a "partial" notice) acceptable for the first slice, or must `_aggregate` ship with it?
3. Should `stat` and `series` be one widget with an optional `groupBy`? Two keeps registry components simple and typed; one halves the contract surface.
4. Date bucketing (`week`, `month`) in the first `series` slice or later?
5. Should the components repo own the chart drawing (my assumption), or is a small engine-owned SVG renderer wanted so a bare registry still shows charts?

## Slice 2: series (decisions, 2026-10-21)

RFC 0001 is Accepted and slice 1 (`stat`) shipped; `series` has not, and consumers are asking for grouped numbers ("volume per week", "tasks done per week"). These calls settle what cards `43b`–`43j` and components `17a`–`17c` build against. They are recommendations: the cards follow them unless the owner answers otherwise. Open question 4 above (bucketing later) is superseded here — bucketing ships in slice 2.

1. **Shape.** As the example in Detailed design: `{ widget: "series", label, view, groupBy: { field, bucket? }, measure, display: "table" | "bar" | "line", sort?: { by: "group" | "value", dir: "asc" | "desc" }, limit?, filter? }`. `label` is required and is the chart's accessible name. `view` names a table view (entity, data source, fixed filter — same as `count`/`stat`); `filter` is the same `Condition` AST and gets the same relative-date resolution as `aggregate()`. `measure` is the slice-1 `Measure` union, unchanged. `limit` defaults to **50**, at most **200**. `sort` defaults to `{ by: "group", dir: "asc" }`.
2. **groupBy field types:** `select`, `boolean`, `reference` (groups labelled with the target's `display`), `text` (exact value), and `date`. Not `number`, not `datetime`, in this slice — a number groupBy invites histograms, which are a different widget. The validator refuses the rest.
3. **Date bucketing ships in slice 2.** `bucket: "day" | "week" | "month"`, allowed only on a `date` groupBy (validator refuses it elsewhere); without a bucket, `date` means `day`. Week keys are the **Monday of the ISO week**, stored as `YYYY-MM-DD`; month keys are `YYYY-MM`. The key is the group's `key`; the label is the same string, formatted by the component if it likes.
4. **Empty group values are skipped, and counted.** A record whose groupBy value is absent or empty joins no group and increments the widget's `skipped: number`; the component may say "N records without a <field>". `count` behaves the same here — grouping drops the record from every group; a total is what `stat` is for.
5. **Gaps.** For a `date` groupBy sorted by group, every bucket between the first and last non-empty group is present: missing buckets carry `0` for `count`/`sum`/`countDistinct` and `null` for `min`/`max`/`avg`, so a line chart shows the valley instead of drawing a straight line over it. No gap-filling for other field types, for `sort.by: "value"`, or below the first / above the last bucket. `limit` then keeps the **last N buckets** when sorted by group (the most recent ones) — a capped chart of the newest data, not the oldest.
6. **Registry.** A new **optional** key `widgets.series` (`Component<SeriesWidgetProps>`), optional the way `layout.Calendar` was: a document may ask for a chart the installed component set does not ship. Without the key the widget renders an ErrorSummary naming the key. Props: `label`, `display`, `groups: { key, label, value: number | null, text }[]` (`text` is the value formatted like `stat`'s — grouped digits, at most two decimals, a dash for `null`), `skipped`, `partial?: { read, total }`, `loading`, `error?`, and `measureLabel` (e.g. "Sum of weight × reps") so the component can label the value axis. Components never fetch, and the engine stays chart-free (decision 5 of 2026-10-15): the engine computes groups, the components repo draws bars and lines.
7. **States.** A dashboard's series widget varies over `groups=none|one|many` and `partial`, like the other widgets vary over their axes; the state grid gains those axes (card 43g).
8. **Ceiling and paging.** The same walk as `stat`: 500 per request, stop at 5000 records, `partial: { read, total }` when the table holds more — the per-group numbers then cover the first `read` records, and the component says so.

Contract consequence (cards 43b–43d): `"series"` joins `WIDGET_TYPES`, `SeriesWidget` and `SeriesGroup` types join `document.ts` with validators for every rule above, `specVersion` rises to the next number (7 at the time of writing — read `SPEC_VERSION`; an identity `migrate()` step and a before/after fixture pair, since everything here is additive), and the mock registry gains `widgets.series` behind the same gate as the other optional keys.

## Owner questions (slice 2)

1. GroupBy types: ship select/boolean/reference/text/date and refuse number/datetime (decision 2), or is a number bucket wanted now?
2. Date bucketing: day/week/month with Monday-ISO keys (decision 3), or calendar weeks starting Sunday?
3. Gaps: fill missing buckets and keep the **last** N when capped (decision 5), or keep the first N as `limit` did for unordered groups?
4. Registry: `widgets.series` optional with an ErrorSummary naming the key (decision 6), or required like the base widgets?
