import { validateDocuments } from "@yadad/core";
import { expect, test } from "vitest";
import { withBookings } from "./App";

// The editor validates the whole set on every save, so one document the set validator
// refuses blocks every edit. A saved filter that read the viewer did exactly that.
test("the demo documents validate together as one set, with no errors and no warnings", () => {
  const set = withBookings({ entities: new Map(), views: new Map() });
  const result = validateDocuments([...set.entities.values(), ...set.views.values(), ...(set.viewer ? [set.viewer] : [])]);
  expect(result.ok ? [] : result.errors.map((e) => `${e.document ?? ""}${e.path}: ${e.message}`)).toEqual([]);
  expect(result.warnings.map((w) => `${w.document ?? ""}${w.path}: ${w.message}`)).toEqual([]);
});
