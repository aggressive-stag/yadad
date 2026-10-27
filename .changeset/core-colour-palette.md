---
"@yadad/core": minor
---

`@yadad/core` exports `COLOR_PALETTE`, the components set's eight option colours as an ordered readonly array of `{ hex, name }` (the colour slot is the index), and `isPaletteColor(hex)`. An option colour (a select field's or a viewer select fact's `color`) outside the palette is now a validation warning that names the eight allowed values, because it paints nothing; it becomes an error in a later specVersion. The calendar's `legend` slot entries gain `color?`, the same `#RRGGBB` the entries of that slot receive. An editable board whose `groupBy` field, or an editable calendar whose `dateField`, is `readOnly` is a validation error, because a move writes that field. `describeContract()` no longer calls select `values` "unique texts"; it describes `{ value, label?, color? }` entries and the palette.
