# RFC 0002: Creating related records together

- Status: Accepted (slice 1 in progress)
- Touches: `core` (field type, form item, validator, `DataAdapter`), `runtime` (form state, adapters), `renderer` (form), `editor`, `docs/records-protocol.md` (new endpoint), registry contract (`fields`)
- Bumps `specVersion` (to the next version; it is 1 at the time of writing) with a `migrate()` step and a before/after fixture pair.

## Summary

Let one form create a parent record and its child records in one save. Three pieces: a `reference` field type (a child stores its parent's id), a `repeat` form item (a repeating group of child fields), and a `transaction` operation on the data adapter and records protocol that creates records of several entities in order, all or nothing, where later steps point at the ids of earlier ones by alias.

## Motivation

A form creates exactly one record of one entity. Many apps need "a header with N lines, saved together":

- An order with line items; an invoice with rows; a survey with answers.
- A workout session with exercises, each with sets.
- A project with its first tasks.

Without this a consumer must create the parent in one form, then open N more forms by hand, and a failure midway leaves orphans. No document can express the relationship at all, because fields have no way to point at another entity (the select field's "dynamic sources come later" note is the same gap).

## Detailed design

### 1. `reference` field type

```jsonc
{ "id": "session", "type": "reference", "label": "Session", "required": true,
  "entity": "session" }                 // an entity document id
```

- The stored value is the target record's id (a string), the same as any text value on the wire. The protocol, `FieldValue` and conditions need no change: `eq`, `in`, `empty` work on ids.
- `entity` must name an existing entity (set-level validation). Self references are allowed. No cascade or integrity rules in the engine: the server owns referential integrity (delete restrictions, orphans). The engine only documents that a child's `reference` is what the server should enforce.
- `Input`: a picker that lists records of the target entity (`find`, searchable by the target's first text field or a `display` field id; see open questions). `Display`: the label of the referenced record, looked up in a batched `find` with an `in` filter on ids, falling back to the raw id. Registry `fields` gains the `reference` entry like any new field type (AGENTS rule 9: JSON Schema entry, registry contract entry, valid and invalid fixtures, render test).
- Optional `display: "<fieldId>"` on the field names which target field labels a record.

### 2. `repeat` form item

A form section item is either `{ field }` today. Add a second discriminated variant (`kind` discriminant on items, defaulting to `field`, for a non-breaking migration):

```jsonc
{ "kind": "repeat", "id": "exercises", "title": "Exercises",
  "entity": "session_exercise",          // child entity
  "parentField": "session",              // reference field on the child pointing at the form's entity
  "min": 1, "max": 20,
  "items": [                             // child fields, optionally nested repeats
    { "field": "exercise" },
    { "kind": "repeat", "id": "sets", "entity": "workout_set",
      "parentField": "exercise_entry", "min": 1, "items": [ { "field": "weight" }, { "field": "reps" } ] } ] }
```

- A repeat is a typed, closed shape: `items` holds field items and nested repeats only (reuses `visibleWhen`, `requiredWhen`, `clearWhenHidden` on child field items; conditions inside a repeat row see that row's values only).
- Validator: `entity` exists; `parentField` exists on the child entity, is a `reference`, and targets the enclosing entity; `items` fields exist on the child entity; `min <= max`; nesting depth at most 3 (form, repeat, repeat), so this cannot grow into a general tree editor; the repeat `id` is unique within the form.
- Record validation (`runtime`) validates every row against its child entity, and the existing constraints (`required`, `min`, `max`, `step`) apply per row. Errors use JSON Pointer paths into the form values, such as `/exercises/1/sets/0/reps`.
- Renderer: add row, remove row, reorder rows (buttons, keyboard accessible, in the style of the editor's reorder). Row chrome uses existing `layout` keys (`Section`, `Button`, `FieldFrame`); a new layout key is not needed for slice 1. Form state in `runtime` becomes a small tree: `{ values, repeats: { [repeatId]: Row[] } }`; the existing draft autosave must serialize it.
- A form whose view has a `repeat` creates records only (no editing of existing children in slice 1).

### 3. Atomic chained creates

The current batch endpoint is single-entity and its creates cannot refer to each other. Add one endpoint and one adapter method.

```ts
interface DataAdapter {
  // ...existing...
  /** Create records of several entities in order, all or nothing. */
  transaction?(steps: TransactionStep[], meta: { entityRevisions: Record<string, number> }): Promise<TransactionResult>;
}
type TransactionStep = {
  entity: string;
  as?: string;                       // alias later steps can point at
  values: RecordValues;
  refs?: { field: string; step: string }[]; // set `field` to the id created by the step with this alias
};
```

```jsonc
// POST {base}/_transaction
{ "entityRevisions": { "session": 2, "session_exercise": 1, "workout_set": 3 },
  "steps": [
    { "entity": "session", "as": "s", "values": { "date": "2026-10-14" } },
    { "entity": "session_exercise", "as": "e0", "values": { "exercise": "Squat" }, "refs": [ { "field": "session", "step": "s" } ] },
    { "entity": "workout_set", "values": { "weight": 100, "reps": 5 }, "refs": [ { "field": "exercise_entry", "step": "e0" } ] } ] }
// 200 { "created": [ { "step": 0, "record": Record }, ... ] }
```

- `refs` is a typed list of `{field, step}`, not a template or placeholder syntax. A `ref` may only point to an earlier step (forward and unknown aliases are `400`, `path` such as `/steps/2/refs/0/step`), and the target field must be one the server knows to be a reference. A step's `values` may not also set a field named in `refs`.
- All or nothing; error `path` points into the request body, as in batch. Steps run in order, so the response order equals request order.
- `_transaction` cannot collide with an entity id route as ids and entity routes are `{base}/{entity}`; entity ids must therefore not equal `_transaction` (the id pattern already forbids a leading `_`, to be confirmed in the validator).
- `meta.entityRevisions` carries one revision per entity involved (the protocol's `entityRevision` is per entity).
- Memory and key-value adapters implement it trivially by snapshot and rollback. The HTTP adapter calls the endpoint.
- **Fallback when an adapter lacks `transaction`:** the renderer creates sequentially, then, on failure, deletes what it created and reports the failure ("rolled back" or "N records could not be undone"). It is best effort and documented as non-atomic, so a backend that wants safety implements `_transaction`. Alternatively the renderer refuses to render a `repeat` form without it (open question).

## Fit with the hard rules

- No escape hatches: `reference` and `repeat` are closed, discriminated, validated; `refs` is data, not an expression. Registry keys only (`reference` field type); no component names.
- Documents are the contract: relationships live in the entity (`reference`) and the view (`repeat`); the runtime and renderer follow. Nothing special-cased in components.
- Dependency direction: types and validation in `core`, form tree and the transaction fallback in `runtime`, UI in `renderer`/`editor`.
- `core` public API grows (`reference` field, `repeat` item, `transaction?`), so: `specVersion` bump, a `migrate()` step (identity for existing documents; existing items get implicit `kind: "field"` or the validator accepts the absent discriminant), before/after fixtures, valid and invalid fixtures for each new shape.
- Record values stay flat scalars on the wire. Nothing nests inside a record.

## Alternatives considered

- **Nested records** (a session record containing an `exercises` array value): breaks the flat `FieldValue` model, the protocol and per-entity validation; rejected.
- **Server-side compound endpoint per app** (the host writes one `POST /sessions` that accepts a tree): works today with no engine change, but every consumer reinvents it and the form cannot be described by a document. Still a fine escape for hosts; this RFC just makes the common case portable.
- **Templated references in batch** (`"session": "$s"` placeholders in values): a string mini-language inside values; rejected under D8. `refs` keeps it typed.
- **Extend `_batch` to many entities** instead of a new endpoint: batch also deletes and keys by entity in the URL; a second endpoint is clearer than overloading it.
- **Flatten to a single level** (a set row carries `exercise` as a plain select; the "session" is a date grouping): needs no engine change and is the cheapest design for some apps. For those apps this RFC is unnecessary; it matters where a real parent record carries its own fields.

## Phasing

1. **Slice 1:** `reference` field (picker and display, validation, fixtures) usable on its own, since linking records is useful even in single-record forms.
2. **Slice 2:** `transaction?` in core, runtime adapters and the HTTP protocol (with contract-test-kit cases), still without UI.
3. **Slice 3:** `repeat` form item, one level only (parent plus children), create only, using `transaction` with the sequential fallback.
4. **Slice 4:** nested repeats (depth 3), editing existing parent-with-children, table display of children.

Where I would stop: no cascade deletes, no editing a tree in place in slice 3, no many-to-many, no computed rollups of children onto parents (see RFC 0001 for aggregation).

## Decision (2026-10-15)

Accepted; slice 1 (the `reference` field alone) is being implemented.

1. `reference` plus `repeat` is the right level.
2. One repeat level (parent plus children) when `repeat` lands.
3. Deferred to slice 3.
4. An explicit `display` field id, defaulting to the target entity's first text field.
5. The server enforces references; the client only offers existing records in the picker.

## Open questions for the owner

1. Is `reference` plus `repeat` the right level, or is flattening to one level (extra fields on the child) the preferred answer for the first consumer, deferring this RFC?
2. Maximum nesting depth: one repeat level (two entities), or three entities as written?
3. Must `repeat` forms require `transaction`, or is the best-effort sequential fallback acceptable?
4. How is a reference labelled in the picker and the table: an explicit `display` field id (proposed), the first text field, or a separate label template (rejected here as an expression)?
5. Should the server be responsible for enforcing that `refs` fields are references and the parent exists, or should the client also validate (a pre-check `find`)?
