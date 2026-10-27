import { readdirSync, readFileSync } from "node:fs";
import { validateDocuments } from "@yadad/core";
import { expect, test } from "vitest";

const validDir = new URL("../../fixtures/valid/", import.meta.url);
const invalidDir = new URL("../../fixtures/invalid/", import.meta.url);

type Picked = { path: string; code: string; document?: string | undefined; allowed?: readonly string[] | undefined };

const CALENDAR_FIELDS = ["name", "day", "qty", "mood", "owner"];

/** The exact errors (in order) each invalid fixture must yield. */
const expected: Record<string, Picked[]> = {
  "unknown-entity.json": [{ path: "/entity", code: "unknown-reference", document: "thing_form", allowed: ["thing"] }],
  "unknown-form-field.json": [
    { path: "/sections/0/items/1/field", code: "unknown-reference", document: "thing_form", allowed: ["name"] },
  ],
  "unknown-form-condition-field.json": [
    { path: "/sections/0/items/0/visibleWhen/field", code: "unknown-reference", document: "thing_form", allowed: ["name", "mood"] },
  ],
  "unknown-table-field.json": [
    { path: "/columns/1/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/sort/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/quickFilters/0/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
    { path: "/filter/field", code: "unknown-reference", document: "thing_table", allowed: ["name"] },
  ],
  "quick-filter-default-wrong-shape.json": [
    { path: "/quickFilters/0/default", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/1/default", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/2/default", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/3/default", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/4/default", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "quick-filter-default-bad-range.json": [
    { path: "/quickFilters/0/default/from", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/1/default/from", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/2/default/to", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "quick-filter-default-range-order.json": [
    { path: "/quickFilters/0/default/step", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/0/default", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "quick-filter-placeholder-not-text.json": [
    { path: "/quickFilters/0/placeholder", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/1/placeholder", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "quick-filter-label-placeholder-empty.json": [
    { path: "/quickFilters/0/label", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/quickFilters/0/placeholder", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "sortable-true.json": [
    { path: "/sortable", code: "invalid-value", document: "thing_table", allowed: undefined },
    { path: "/columns/0/sortable", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "sort-on-unsortable-column.json": [
    { path: "/sort/1/field", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "readonly-form-item.json": [
    { path: "/sections/0/items/0/field", code: "invalid-value", document: "thing_form", allowed: undefined },
  ],
  "readonly-editable-column.json": [
    { path: "/columns/0/field", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "readonly-board-group.json": [
    { path: "/groupBy/0/field", code: "invalid-value", document: "thing_board", allowed: undefined },
  ],
  "readonly-calendar-date.json": [
    { path: "/dateField", code: "invalid-value", document: "thing_calendar", allowed: undefined },
  ],
  "readonly-not-true.json": [
    { path: "/fields/0/readOnly", code: "invalid-value", document: "thing", allowed: undefined },
  ],
  "sort-on-unsortable-view.json": [
    { path: "/sort/0/field", code: "invalid-value", document: "thing_table", allowed: undefined },
  ],
  "dashboard-unknown-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_form"] },
  ],
  "dashboard-count-non-table.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-count-unknown-field.json": [
    { path: "/tabs/0/items/0/filter/field", code: "unknown-reference", document: "board", allowed: ["name"] },
  ],
  "dashboard-stat-unknown-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-stat-unknown-field.json": [
    { path: "/tabs/0/items/0/measure/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
    { path: "/tabs/0/items/1/measure/product/1", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
    { path: "/tabs/0/items/2/filter/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "price", "day", "done"] },
  ],
  "dashboard-stat-wrong-field-type.json": [
    { path: "/tabs/0/items/0/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
    { path: "/tabs/0/items/1/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
    { path: "/tabs/0/items/2/measure/field", code: "invalid-value", document: "board", allowed: ["qty", "price", "day"] },
    { path: "/tabs/0/items/3/measure/product/1", code: "invalid-value", document: "board", allowed: ["qty", "price"] },
  ],
  "dashboard-stat-bad-measure.json": [
    { path: "/tabs/0/items/0/measure/op", code: "invalid-value", document: "board", allowed: ["count", "sum", "countDistinct", "min", "max", "avg"] },
    { path: "/tabs/0/items/1/measure/product", code: "invalid-value", document: "board" },
    { path: "/tabs/0/items/2/measure/product", code: "invalid-value", document: "board" },
    { path: "/tabs/0/items/3/measure/field", code: "unknown-property", document: "board", allowed: ["op"] },
    { path: "/tabs/0/items/4/measure/field", code: "required", document: "board" },
    { path: "/tabs/0/items/5/measure/product", code: "unknown-property", document: "board", allowed: ["op", "field"] },
  ],
  // RFC 0001 slice 2: one entry per series rule from 43b (shape) and 43c (cross-document).
  "dashboard-series-display.json": [
    { path: "/tabs/0/items/0/display", code: "invalid-value", document: "board", allowed: ["table", "bar", "line"] },
  ],
  "dashboard-series-bucket-shape.json": [
    { path: "/tabs/0/items/0/groupBy/bucket", code: "invalid-value", document: "board", allowed: ["day", "week", "month"] },
  ],
  "dashboard-series-sort.json": [{ path: "/tabs/0/items/0/sort/by", code: "invalid-value", document: "board", allowed: ["group", "value"] }],
  "dashboard-series-sort-dir.json": [{ path: "/tabs/0/items/0/sort/dir", code: "invalid-value", document: "board", allowed: ["asc", "desc"] }],
  "dashboard-series-limit.json": [{ path: "/tabs/0/items/0/limit", code: "invalid-value", document: "board" }],
  "dashboard-series-groupby-shape.json": [{ path: "/tabs/0/items/0/groupBy/field", code: "required", document: "board" }],
  "dashboard-series-unknown-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-series-calendar-view.json": [
    { path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["the_table"] },
  ],
  "dashboard-series-unknown-field.json": [
    { path: "/tabs/0/items/0/groupBy/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "day", "mood"] },
  ],
  "dashboard-series-ungroupable-field.json": [
    { path: "/tabs/0/items/0/groupBy/field", code: "invalid-value", document: "board", allowed: ["name", "day", "mood"] },
  ],
  "dashboard-series-bucket-non-date.json": [{ path: "/tabs/0/items/0/groupBy/bucket", code: "invalid-value", document: "board" }],
  "dashboard-series-measure-field.json": [
    { path: "/tabs/0/items/0/measure/field", code: "invalid-value", document: "board", allowed: ["qty"] },
    { path: "/tabs/0/items/1/measure/field", code: "unknown-reference", document: "board", allowed: ["name", "qty", "day", "mood"] },
  ],
  "relative-date-on-number-field.json": [{ path: "/filter/value", code: "invalid-value", document: "thing_table" }],
  "relative-date-not-integer.json": [{ path: "/filter/value/daysFromToday", code: "type", document: "thing_table" }],
  "relative-instant-on-date-field.json": [{ path: "/filter/value", code: "invalid-value", document: "t" }],
  "relative-instant-not-integer.json": [{ path: "/filter/value/hoursFromNow", code: "type", document: "t" }],
  "relative-instant-in-list.json": [{ path: "/filter/values/0", code: "type", document: "t" }],
  "reference-unknown-entity.json": [{ path: "/fields/0/entity", code: "unknown-reference", document: "entry", allowed: ["exercise", "entry"] }],
  "reference-unknown-display.json": [{ path: "/fields/0/display", code: "unknown-reference", document: "entry", allowed: ["name"] }],
  "reference-display-not-text.json": [{ path: "/fields/0/display", code: "invalid-value", document: "entry" }],
  "reference-missing-entity.json": [{ path: "/fields/0/entity", code: "required", document: "entry" }],
  "reference-unsupported-use.json": [
    { path: "/sort/0/field", code: "invalid-value", document: "entries" },
    { path: "/quickFilters/0/field", code: "invalid-value", document: "entries" },
    { path: "/filter/op", code: "invalid-value", document: "entries" },
  ],
  "row-action-unknown-view.json": [{ path: "/rowAction/open", code: "unknown-reference", document: "a", allowed: ["a"] }],
  "row-action-field-mismatch.json": [
    { path: "/rowAction/bind/0/field", code: "unknown-reference", document: "a", allowed: ["name", "qty"] },
    { path: "/rowAction/bind/0/to", code: "unknown-reference", document: "a", allowed: ["name", "qty"] },
  ],
  "row-action-type-mismatch.json": [{ path: "/rowAction/bind/0", code: "invalid-value", document: "a" }],
  "row-action-id-to-number.json": [{ path: "/rowAction/bind/0", code: "invalid-value", document: "a" }],
  "row-action-id-to-other-reference.json": [{ path: "/rowAction/bind/0", code: "invalid-value", document: "a" }],
  "row-action-cycle.json": [{ path: "/rowAction/open", code: "invalid-value", document: "b" }],
  "row-action-too-deep.json": [{ path: "/rowAction/open", code: "invalid-value", document: "a" }],
  "row-action-form-target.json": [{ path: "/rowAction/open", code: "invalid-value", document: "a", allowed: ["a"] }],
  "calendar-unknown-property.json": [{ path: "/color", code: "unknown-property", document: "cal" }],
  "calendar-empty-modes.json": [{ path: "/modes", code: "invalid-value", document: "cal", allowed: ["month", "week"] }],
  "calendar-duplicate-mode.json": [{ path: "/modes/2", code: "invalid-value", document: "cal" }],
  "calendar-bad-week-start.json": [{ path: "/weekStartsOn", code: "invalid-value", document: "cal" }],
  "calendar-too-many-detail-fields.json": [{ path: "/detailFields", code: "invalid-value", document: "cal" }],
  "calendar-date-field-wrong-type.json": [{ path: "/dateField", code: "invalid-value", document: "cal", allowed: ["day"] }],
  "calendar-title-field-wrong-type.json": [{ path: "/titleField", code: "invalid-value", document: "cal", allowed: ["name", "mood"] }],
  "calendar-missing-title-field.json": [{ path: "/titleField", code: "required", document: "cal", allowed: ["mood"] }],
  "calendar-color-field-wrong-type.json": [{ path: "/colorField", code: "invalid-value", document: "cal", allowed: ["mood", "owner"] }],
  "calendar-detail-repeats-title.json": [
    { path: "/detailFields/0", code: "invalid-value", document: "cal", allowed: ["qty", "mood", "owner"] },
    { path: "/detailFields/1", code: "invalid-value", document: "cal", allowed: ["qty", "mood", "owner"] },
  ],
  "calendar-unknown-entity.json": [{ path: "/entity", code: "unknown-reference", document: "cal", allowed: ["e"] }],
  "calendar-unknown-fields.json": [
    { path: "/dateField", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
    { path: "/titleField", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
    { path: "/detailFields/1", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
    { path: "/colorField", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
    { path: "/filter/field", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
    { path: "/sort/0/field", code: "unknown-reference", document: "cal", allowed: CALENDAR_FIELDS },
  ],
  "calendar-unsupported-use.json": [
    { path: "/filter/op", code: "invalid-value", document: "cal" },
    { path: "/sort/0/field", code: "invalid-value", document: "cal" },
  ],
  "calendar-row-action-form-target.json": [{ path: "/rowAction/open", code: "invalid-value", document: "cal", allowed: ["t"] }],
  "calendar-row-action-calendar-target.json": [{ path: "/rowAction/open", code: "invalid-value", document: "cal", allowed: ["t"] }],
  "calendar-row-action-too-deep.json": [{ path: "/rowAction/open", code: "invalid-value", document: "cal" }],
  "dashboard-count-calendar.json": [{ path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["t"] }],
  "dashboard-stat-calendar.json": [{ path: "/tabs/0/items/0/view", code: "unknown-reference", document: "board", allowed: ["t"] }],
  "duplicate-id.json": [{ path: "/id", code: "duplicate-id", document: "thing" }],
  "structural-unknown-kind.json": [
    { path: "/kind", code: "unknown-kind", document: "w", allowed: ["entity", "form", "table", "calendar", "board", "dashboard", "viewer"] },
  ],
  "board-empty-group-by.json": [{ path: "/groupBy", code: "invalid-value", document: "brd" }],
  "board-too-many-group-by.json": [{ path: "/groupBy", code: "invalid-value", document: "brd" }],
  "board-duplicate-group-by.json": [{ path: "/groupBy/1/field", code: "invalid-value", document: "brd" }],
  "board-too-many-card-fields.json": [{ path: "/cardFields", code: "invalid-value", document: "brd" }],
  "board-duplicate-card-field.json": [{ path: "/cardFields/1", code: "invalid-value", document: "brd" }],
  "board-unknown-property.json": [{ path: "/color", code: "unknown-property", document: "brd" }],
  "board-unknown-entity.json": [{ path: "/entity", code: "unknown-reference", document: "brd", allowed: ["e"] }],
  "board-unknown-fields.json": [
    { path: "/groupBy/0/field", code: "unknown-reference", document: "brd", allowed: ["name", "qty", "mood", "owner"] },
    { path: "/titleField", code: "unknown-reference", document: "brd", allowed: ["name", "qty", "mood", "owner"] },
    { path: "/cardFields/0", code: "unknown-reference", document: "brd", allowed: ["name", "qty", "mood", "owner"] },
    { path: "/filter/field", code: "unknown-reference", document: "brd", allowed: ["name", "qty", "mood", "owner"] },
    { path: "/sort/0/field", code: "unknown-reference", document: "brd", allowed: ["name", "qty", "mood", "owner"] },
  ],
  "board-group-by-wrong-type.json": [{ path: "/groupBy/0/field", code: "invalid-value", document: "brd", allowed: ["status"] }],
  "board-group-by-required-boolean.json": [{ path: "/groupBy/0/field", code: "invalid-value", document: "brd", allowed: [] }],
  "board-title-field-wrong-type.json": [{ path: "/titleField", code: "invalid-value", document: "brd", allowed: ["name"] }],
  "board-missing-title-field.json": [{ path: "/titleField", code: "required", document: "brd", allowed: [] }],
  "board-card-field-repeats-title.json": [{ path: "/cardFields/0", code: "invalid-value", document: "brd", allowed: ["status"] }],
  "viewer-bad-header-values.json": [
    { path: "/specVersion", code: "type", document: "Bad" },
    { path: "/id", code: "invalid-value", document: "Bad" },
    { path: "/revision", code: "invalid-value", document: "Bad" },
  ],
  "viewer-boolean-with-options.json": [
    { path: "/facts/0/options", code: "unknown-property", document: "viewer" },
  ],
  "viewer-clear-when-hidden.json": [
    { path: "/sections/0/items/0/clearWhenHidden", code: "invalid-value", document: "f" },
  ],
  "viewer-default-missing.json": [
    { path: "/facts/0/default", code: "required", document: "viewer" },
    { path: "/facts/1/default", code: "required", document: "viewer" },
  ],
  "viewer-default-not-in-values.json": [
    { path: "/facts/0/default", code: "invalid-value", document: "viewer", allowed: ["x","y"] },
  ],
  "viewer-default-wrong-type.json": [
    { path: "/facts/0/default", code: "type", document: "viewer" },
    { path: "/facts/1/default", code: "type", document: "viewer" },
  ],
  "viewer-editable-when-not-editable.json": [
    { path: "/columns/0/editableWhen", code: "invalid-value", document: "t" },
    { path: "/columns/1/editableWhen", code: "invalid-value", document: "t" },
    { path: "/editableWhen", code: "invalid-value", document: "cal" },
    { path: "/editableWhen", code: "invalid-value", document: "brd" },
  ],
  "viewer-fact-bad-id.json": [
    { path: "/facts/0/id", code: "required", document: "viewer" },
    { path: "/facts/1/id", code: "type", document: "viewer" },
    { path: "/facts/2/id", code: "invalid-value", document: "viewer" },
  ],
  "viewer-fact-bad-label.json": [
    { path: "/facts/0/label", code: "required", document: "viewer" },
    { path: "/facts/1/label", code: "type", document: "viewer" },
  ],
  "viewer-fact-bad-type.json": [
    { path: "/facts/0/type", code: "required", document: "viewer" },
    { path: "/facts/1/type", code: "invalid-value", document: "viewer", allowed: ["select","boolean"] },
  ],
  "viewer-fact-duplicate-id.json": [
    { path: "/facts/1/id", code: "invalid-value", document: "viewer" },
  ],
  "viewer-fact-not-object.json": [
    { path: "/facts/0", code: "type", document: "viewer" },
  ],
  "viewer-fact-unknown-property.json": [
    { path: "/facts/0/color", code: "unknown-property", document: "viewer" },
  ],
  "viewer-facts-empty.json": [
    { path: "/facts", code: "invalid-value", document: "viewer" },
  ],
  "viewer-facts-not-array.json": [
    { path: "/facts", code: "type", document: "viewer" },
  ],
  "viewer-facts-too-many.json": [
    { path: "/facts", code: "invalid-value", document: "viewer" },
  ],
  "viewer-filter-board.json": [
    { path: "/filter/condition", code: "invalid-value", document: "brd" },
  ],
  "viewer-filter-calendar.json": [
    { path: "/filter/conditions/1", code: "invalid-value", document: "cal" },
  ],
  "viewer-filter-table.json": [
    { path: "/filter", code: "invalid-value", document: "t" },
  ],
  "viewer-filter-widgets.json": [
    { path: "/tabs/0/items/0/filter", code: "invalid-value", document: "dash" },
    { path: "/tabs/0/items/1/filter", code: "invalid-value", document: "dash" },
  ],
  "viewer-leaf-bad-fact.json": [
    { path: "/sections/0/items/0/visibleWhen/conditions/0/fact", code: "required", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/1/fact", code: "type", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/2/fact", code: "invalid-value", document: "f" },
  ],
  "viewer-leaf-bad-op.json": [
    { path: "/sections/0/items/0/visibleWhen/op", code: "invalid-value", document: "f", allowed: ["eq","neq","gt","gte","lt","lte","in","contains","empty","notEmpty","and","or","not","viewerIn","fieldEqFact"] },
  ],
  "viewer-leaf-bad-value-entries.json": [
    { path: "/sections/0/items/0/visibleWhen/conditions/0/values/0", code: "type", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/1/values/1", code: "invalid-value", document: "f" },
  ],
  "viewer-leaf-bad-values.json": [
    { path: "/sections/0/items/0/visibleWhen/conditions/0/values", code: "required", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/1/values", code: "type", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/2/values", code: "invalid-value", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/3/values", code: "invalid-value", document: "f" },
  ],
  "viewer-leaf-extra-keys.json": [
    { path: "/sections/0/items/0/visibleWhen/field", code: "unknown-property", document: "f", allowed: ["op","fact","values"] },
    { path: "/sections/0/items/0/visibleWhen/value", code: "unknown-property", document: "f", allowed: ["op","fact","values"] },
    { path: "/sections/0/items/0/visibleWhen/conditions", code: "unknown-property", document: "f", allowed: ["op","fact","values"] },
  ],
  "viewer-missing-properties.json": [
    { path: "/id", code: "required", document: undefined },
    { path: "/revision", code: "required", document: undefined },
    { path: "/facts", code: "required", document: undefined },
  ],
  "viewer-no-viewer-document.json": [
    { path: "/sections/0/items/0/visibleWhen/fact", code: "unknown-reference", document: "f", allowed: [] },
  ],
  "viewer-record-leaf-board.json": [
    { path: "/rowAction/visibleWhen", code: "invalid-value", document: "brd" },
    { path: "/editableWhen", code: "invalid-value", document: "brd" },
  ],
  "viewer-record-leaf-calendar.json": [
    { path: "/rowAction/visibleWhen", code: "invalid-value", document: "cal" },
    { path: "/editableWhen", code: "invalid-value", document: "cal" },
  ],
  "viewer-record-leaf-dashboard.json": [
    { path: "/tabs/0/visibleWhen", code: "invalid-value", document: "dash" },
    { path: "/tabs/0/items/0/visibleWhen/condition", code: "invalid-value", document: "dash" },
  ],
  "viewer-record-leaf-table.json": [
    { path: "/rowAction/visibleWhen", code: "invalid-value", document: "t" },
    { path: "/columns/0/visibleWhen", code: "invalid-value", document: "t" },
    { path: "/columns/0/editableWhen/conditions/1", code: "invalid-value", document: "t" },
  ],
  "viewer-second-document.json": [
    { path: "", code: "invalid-value", document: "viewer_two" },
  ],
  "viewer-select-blank-value.json": [
    { path: "/facts/0/options/values/1", code: "invalid-value", document: "viewer" },
  ],
  "viewer-select-duplicate-value.json": [
    { path: "/facts/0/options/values/2", code: "invalid-value", document: "viewer" },
  ],
  "viewer-select-missing-options.json": [
    { path: "/facts/0/options", code: "required", document: "viewer" },
  ],
  "viewer-select-too-few-values.json": [
    { path: "/facts/0/options/values", code: "invalid-value", document: "viewer" },
  ],
  "viewer-select-too-many-values.json": [
    { path: "/facts/0/options/values", code: "invalid-value", document: "viewer" },
  ],
  "viewer-unknown-fact.json": [
    { path: "/sections/0/items/0/visibleWhen/fact", code: "unknown-reference", document: "f", allowed: ["role","beta"] },
    { path: "/sections/0/items/0/requiredWhen/fact", code: "unknown-reference", document: "f", allowed: ["role","beta"] },
    { path: "/columns/0/visibleWhen/fact", code: "unknown-reference", document: "t", allowed: ["role","beta"] },
    { path: "/editableWhen/fact", code: "unknown-reference", document: "cal", allowed: ["role","beta"] },
    { path: "/tabs/0/visibleWhen/fact", code: "unknown-reference", document: "dash", allowed: ["role","beta"] },
    { path: "/tabs/0/items/0/visibleWhen/fact", code: "unknown-reference", document: "dash", allowed: ["role","beta"] },
  ],
  "viewer-unknown-property.json": [
    { path: "/color", code: "unknown-property", document: "viewer" },
  ],
  "viewer-value-not-in-list.json": [
    { path: "/sections/0/items/0/visibleWhen/values/1", code: "invalid-value", document: "f", allowed: ["viewer","editor","owner"] },
  ],
  "viewer-value-wrong-type.json": [
    { path: "/sections/0/items/0/visibleWhen/conditions/0/values/0", code: "type", document: "f" },
    { path: "/sections/0/items/0/visibleWhen/conditions/1/values/0", code: "type", document: "f" },
  ],
  "datetime-field-bad-bounds.json": [
    { path: "/fields/1/min", code: "invalid-value", document: "e" },
    { path: "/fields/1/max", code: "invalid-value", document: "e" },
  ],
  "datetime-field-min-after-max.json": [{ path: "/fields/1/min", code: "invalid-value", document: "e" }],
  "datetime-field-impossible-instant.json": [{ path: "/fields/1/min", code: "invalid-value", document: "e" }],
  "datetime-condition-bad-value.json": [
    { path: "/filter/conditions/0/value", code: "invalid-value", document: "t" },
    { path: "/filter/conditions/1/value", code: "invalid-value", document: "t" },
    { path: "/filter/conditions/2/values/1", code: "invalid-value", document: "t" },
  ],
  "datetime-condition-contains.json": [{ path: "/filter/op", code: "invalid-value", document: "t" }],
  "datetime-condition-relative-date.json": [{ path: "/filter/value", code: "invalid-value", document: "t" }],
  "datetime-calendar-date-field.json": [{ path: "/dateField", code: "invalid-value", document: "cal", allowed: [] }],
  "datetime-board-group-by.json": [{ path: "/groupBy/0/field", code: "invalid-value", document: "b", allowed: [] }],
  "action-bad-id.json": [{ path: "/actions/0/id", code: "invalid-value", document: "e" }],
  "action-confirm-bad-tone.json": [{ path: "/actions/0/confirm/tone", code: "invalid-value", document: "e", allowed: ["neutral","danger"] }],
  "action-confirm-message-empty.json": [{ path: "/actions/0/confirm/message", code: "invalid-value", document: "e" }],
  "action-confirm-message-missing.json": [{ path: "/actions/0/confirm/message", code: "required", document: "e" }],
  "action-duplicate-id.json": [{ path: "/actions/2/id", code: "duplicate-id", document: "e" }],
  "action-input-bad-properties.json": [
    { path: "/actions/0/input/0/options", code: "required", document: "e" },
    { path: "/actions/0/input/1/min", code: "type", document: "e" },
    { path: "/actions/0/input/2/min", code: "unknown-property", document: "e" },
    { path: "/actions/0/input/3/min", code: "invalid-value", document: "e" },
  ],
  "action-input-duplicate-id.json": [{ path: "/actions/0/input/1/id", code: "duplicate-id", document: "e" }],
  "action-input-empty.json": [{ path: "/actions/0/input", code: "invalid-value", document: "e" }],
  "action-input-not-array.json": [{ path: "/actions/0/input", code: "type", document: "e" }],
  "action-input-reference.json": [{ path: "/actions/0/input/2/type", code: "invalid-value", document: "e", allowed: ["text","number","boolean","select","date","datetime","time"] }],
  "action-input-too-many.json": [{ path: "/actions/0/input", code: "invalid-value", document: "e" }],
  "action-input-unknown-type.json": [{ path: "/actions/0/input/0/type", code: "unknown-field-type", document: "e", allowed: ["text","number","boolean","select","date","datetime","time"] }],
  "action-label-empty.json": [{ path: "/actions/0/label", code: "invalid-value", document: "e" }],
  "action-label-missing.json": [{ path: "/actions/0/label", code: "required", document: "e" }],
  "action-not-object.json": [{ path: "/actions/1", code: "type", document: "e" }],
  "actions-not-array.json": [{ path: "/actions", code: "type", document: "e" }],
  "actions-too-many.json": [{ path: "/actions", code: "invalid-value", document: "e" }],
  "action-unknown-property.json": [{ path: "/actions/1/colour", code: "unknown-property", document: "e" }],
  "action-visible-when-bad-value.json": [
    { path: "/actions/0/visibleWhen/conditions/1/value", code: "invalid-value", document: "e" },
    { path: "/actions/0/visibleWhen/conditions/0/value", code: "invalid-value", document: "e" },
    { path: "/actions/0/visibleWhen/conditions/2/op", code: "invalid-value", document: "e" },
  ],
  "action-visible-when-no-viewer.json": [{ path: "/actions/0/visibleWhen/fact", code: "unknown-reference", document: "e", allowed: [] }],
  "action-visible-when-unknown-fact.json": [{ path: "/actions/0/visibleWhen/fact", code: "unknown-reference", document: "e", allowed: ["beta"] }],
  "action-visible-when-unknown-field.json": [{ path: "/actions/0/visibleWhen/conditions/1/field", code: "unknown-reference", document: "e", allowed: ["name","state","at"] }],
  "record-actions-bad-entries.json": [
    { path: "/recordActions/1", code: "type", document: "t" },
    { path: "/recordActions/2", code: "invalid-value", document: "t" },
  ],
  "record-actions-board-unknown-action.json": [{ path: "/recordActions/0", code: "unknown-reference", document: "b", allowed: ["act0","act1"] }],
  "record-actions-calendar-unknown-action.json": [{ path: "/recordActions/1", code: "unknown-reference", document: "cal", allowed: ["act0","act1"] }],
  "record-actions-empty.json": [{ path: "/recordActions", code: "empty", document: "t" }],
  "record-actions-entity-without-actions.json": [{ path: "/recordActions/0", code: "unknown-reference", document: "t", allowed: [] }],
  "record-actions-not-array.json": [{ path: "/recordActions", code: "type", document: "t" }],
  "record-actions-on-form.json": [{ path: "/recordActions", code: "unknown-property", document: "f" }],
  "record-actions-repeated.json": [{ path: "/recordActions/2", code: "duplicate-id", document: "t" }],
  "record-actions-too-many.json": [{ path: "/recordActions", code: "invalid-value", document: "t" }],
  "record-actions-unknown-action.json": [{ path: "/recordActions/1", code: "unknown-reference", document: "t", allowed: ["act0","act1"] }],
  "compare-bad-field-id.json": [{ path: "/columns/2/compare/field", code: "invalid-value", document: "t" }],
  "compare-bad-neighbour.json": [{ path: "/columns/2/compare/to", code: "invalid-value", document: "t", allowed: ["previousRow","nextRow"] }],
  "compare-both-members.json": [{ path: "/columns/2/compare", code: "invalid-value", document: "t" }],
  "compare-empty.json": [{ path: "/columns/2/compare", code: "required", document: "t" }],
  "compare-field-not-text.json": [{ path: "/columns/2/compare/field", code: "invalid-value", document: "t", allowed: ["body","before"] }],
  "compare-field-same-as-column.json": [{ path: "/columns/2/compare/field", code: "invalid-value", document: "t", allowed: ["before"] }],
  "compare-field-unknown.json": [{ path: "/columns/2/compare/field", code: "unknown-reference", document: "t", allowed: ["body","before"] }],
  "compare-not-object.json": [{ path: "/columns/2/compare", code: "type", document: "t" }],
  "compare-on-editable-column.json": [{ path: "/columns/2/compare", code: "invalid-value", document: "t" }],
  "compare-on-non-text-column.json": [
    { path: "/columns/0/compare", code: "invalid-value", document: "t", allowed: ["body","before"] },
    { path: "/columns/1/compare", code: "invalid-value", document: "t", allowed: ["body","before"] },
  ],
  "compare-unknown-key.json": [{ path: "/columns/2/compare/against", code: "unknown-property", document: "t" }],
};

const validSetDir = new URL("../../fixtures/valid-sets/", import.meta.url);

/** The exact warnings (and no errors) each whole-set valid fixture must yield. */
const expectedSetWarnings: Record<string, { path: string; code: string; document: string | undefined }[]> = {
  "off-palette-colour.json": [{ path: "/fields/0/options/values/1/color", code: "empty", document: "thing" }],
  "review.json": [],
  // A version-8 document with an off-palette colour stays valid; the colour only warns (card 48g).
  "rfc-0008-9-v8.json": [{ path: "/fields/2/options/values/1/color", code: "empty", document: "chore" }],
  "rfc-0010-v9.json": [],
  "rfc-0011-v10.json": [],
  "viewer-minimal.json": [],
  "viewer-unread-fact.json": [{ path: "/facts/1", code: "empty", document: "viewer" }],
};

const validFiles = readdirSync(validDir).filter((f) => f.endsWith(".json")).sort();
const invalidFiles = readdirSync(invalidDir).filter((f) => f.endsWith(".json")).sort();

/** Normalizes a set's errors to the fields the fixtures assert on. */
function problems(set: readonly unknown[]): Picked[] {
  const result = validateDocuments(set);
  if (result.ok) throw new Error("expected the set to be invalid");
  return result.errors.map((e) => ({ path: e.path, code: e.code, document: e.document, allowed: e.allowed }));
}

test("fixtures/valid validate together as one set with zero errors", () => {
  const set = validFiles.map((f) => JSON.parse(readFileSync(new URL(f, validDir), "utf8")));
  const result = validateDocuments(set);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.length).toBe(set.length);
});

test("fixtures/invalid contains exactly the expected files", () => {
  expect(invalidFiles).toEqual(Object.keys(expected).sort());
});

test.each(invalidFiles)("fixtures/invalid/%s yields exactly its expected errors", (file) => {
  const set = JSON.parse(readFileSync(new URL(file, invalidDir), "utf8"));
  expect(problems(set)).toEqual(expected[file]);
});

const validSetFiles = readdirSync(validSetDir).filter((f) => f.endsWith(".json")).sort();

test("fixtures/valid-sets contains exactly the expected files", () => {
  expect(validSetFiles).toEqual(Object.keys(expectedSetWarnings).sort());
});

test.each(validSetFiles)("fixtures/valid-sets/%s validates with exactly its expected warnings", (file) => {
  const result = validateDocuments(JSON.parse(readFileSync(new URL(file, validSetDir), "utf8")));
  expect(result.ok).toBe(true);
  expect(result.warnings.map((w) => ({ path: w.path, code: w.code, document: w.document }))).toEqual(expectedSetWarnings[file]);
});
