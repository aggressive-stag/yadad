// @vitest-environment jsdom
// The RFC 0007 dialog scenarios, run through the real table renderer and the
// memory adapter: press an action, answer the dialog, make the source refuse
// or go stale. The kit never imports a renderer (same split as
// state-checks.test.tsx) — this file is the one line of host wiring.
import { mockRegistry } from "@yadad/testing";
import { describeActionScenarios } from "@yadad/testing/contract-kit";
import { TableRenderer } from "./table-renderer.js";

describeActionScenarios({
  registry: mockRegistry,
  mount: ({ entity, view, registry, adapter }) => <TableRenderer entity={entity} view={view} registry={registry} dataSources={new Map([["default", adapter]])} />,
});
