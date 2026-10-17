# @yadad/testing

Test support for yadad: a mock registry and the registry contract test kit. Use it to test code that renders yadad documents without a real component set, or to prove that your own component set satisfies the `Registry` contract.

```sh
npm install --save-dev @yadad/testing
```

Peer dependencies: React 19, `react-dom`, `vitest` and `jsdom`.

## Mock registry

`mockRegistry` (a `Registry<ReactNode>`) has an unstyled stub component for every field type, layout piece and widget, each with a `data-testid` hook.

```tsx
import { render, screen } from "@testing-library/react";
import { FormRenderer } from "@yadad/renderer";
import { mockRegistry } from "@yadad/testing";

render(<FormRenderer entity={entity} view={form} registry={mockRegistry} dataSources={dataSources} />);
```

## Source states

A screen has states that come from the data source: still loading, failed to load, a save refused, a conflict. `createStateAdapter(seed, options)` returns a `DataAdapter` seeded with a view state's records (from `viewStates` in `@yadad/runtime`) or with a list of records, and puts it in one of them.

```ts
import { createStateAdapter } from "@yadad/testing";

const adapter = createStateAdapter(state, { source: "refused", status: 400, field: "title", message: "Title is taken." });
adapter.configure({ source: "ready" }); // switch while the test runs
```

- `source: "ready"` (default) works like the memory adapter.
- `"loading"`: `find` and `findOne` never settle.
- `"error"`: reads reject with an `Error` carrying `message`.
- `"refused"`: writes throw a `RecordValidationError` with one field error (400, the default, pointing at `field`) or a `ForbiddenError` (`status: 403`).
- `"conflict"`: writes throw a `RecordConflictError` (409) carrying the stored record.

`sourceStates(viewStates(view, documents, { now }), documents)` adds a `source` axis to the view's data states. Every data state stays once with `source: "ready"`; each other source that makes sense for the view (a save can only be refused or conflict where the view writes) gets one state. Each state has `adapter()`, a fresh adapter seeded with its records and put in its source state.

## Contract kit

Import it from `@yadad/testing/contract-kit` in a Vitest file. For every field type, the kit checks that your component renders with fixture options, emits the right JSON type on change, shows an error it is given, and passes axe; the layout components get their own checks.

```tsx
import { describeRegistryContract } from "@yadad/testing/contract-kit";
import { myRegistry } from "./registry";

describeRegistryContract(myRegistry);
```

- `registryContractChecks(registry, samples?)` returns the checks as `{ name, run() }` objects, for use outside Vitest. Run them one at a time.
- `defaultSamples` is the fixture per field type; pass your own `FieldSamples` to override them.
- The `layout.Calendar` key is optional, so the calendar checks only run when the registry has a calendar; the mock registry's `MockCalendar` passes them.

See the [repo README](../README.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
