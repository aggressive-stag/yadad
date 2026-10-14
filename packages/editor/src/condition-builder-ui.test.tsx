// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EntityDocument } from "@yadad/core";
import { mockRegistry } from "@yadad/testing";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { builtOf, ConditionBuilder } from "./condition-builder.js";
import type { ConditionDraft } from "./condition-builder.js";

afterEach(cleanup);

const entity: EntityDocument = {
  kind: "entity",
  specVersion: 0,
  id: "task",
  revision: 1,
  fields: [
    { id: "status", type: "select", label: "Status", options: { source: "static", values: ["open", "closed"] } },
    { id: "points", type: "number", label: "Points" },
    { id: "title", type: "text", label: "Title" },
    { id: "due", type: "date", label: "Due" },
  ],
};

function Harness({ initial, onDraft }: { initial: ConditionDraft; onDraft: (d: ConditionDraft | undefined) => void }) {
  const [draft, setDraft] = useState<ConditionDraft | undefined>(initial);
  return (
    <ConditionBuilder
      id="t"
      label="Show only when"
      registry={mockRegistry}
      entity={entity}
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        onDraft(d);
      }}
    />
  );
}

describe("ConditionBuilder", () => {
  test("changing the field resets an operator the new type does not offer", () => {
    const drafts: (ConditionDraft | undefined)[] = [];
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "in", field: "status", values: ["open"] }] }} onDraft={(d) => drafts.push(d)} />);
    fireEvent.change(document.getElementById("t-field-0") as HTMLSelectElement, { target: { value: "Points" } });
    expect(drafts.at(-1)?.comparisons[0]).toMatchObject({ field: "points", op: "eq" });
  });

  test("changing the field keeps an operator the new type still offers", () => {
    const drafts: (ConditionDraft | undefined)[] = [];
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "neq", field: "points", value: 3 }] }} onDraft={(d) => drafts.push(d)} />);
    fireEvent.change(document.getElementById("t-field-0") as HTMLSelectElement, { target: { value: "Title" } });
    expect(drafts.at(-1)?.comparisons[0]).toMatchObject({ field: "title", op: "neq" });
  });

  test("a draft with an unfinished row builds to nothing and shows a hint", () => {
    const draft: ConditionDraft = {
      combine: "all",
      comparisons: [
        { not: false, op: "eq", field: "points", value: 1 },
        { not: false, op: "eq", field: "title" },
      ],
    };
    expect(builtOf(draft)).toBeUndefined();
    render(<Harness initial={draft} onDraft={() => {}} />);
    expect(screen.getByText("Fill in every row to apply this condition.")).toBeTruthy();
  });

  test("a date comparison can switch between a fixed date and today plus days", () => {
    const drafts: (ConditionDraft | undefined)[] = [];
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "gte", field: "due", value: "2026-10-01" }] }} onDraft={(d) => drafts.push(d)} />);
    expect(document.getElementById("t-days-0")).toBeNull();
    fireEvent.change(document.getElementById("t-mode-0") as HTMLSelectElement, { target: { value: "Today plus or minus days" } });
    expect(drafts.at(-1)?.comparisons[0]?.value).toEqual({ daysFromToday: 0 });
    expect(builtOf(drafts.at(-1))).toEqual({ op: "gte", field: "due", value: { daysFromToday: 0 } });
    fireEvent.change(document.getElementById("t-days-0") as HTMLInputElement, { target: { value: "-7" } });
    expect(builtOf(drafts.at(-1))).toEqual({ op: "gte", field: "due", value: { daysFromToday: -7 } });
    expect(screen.getByText("Due is at least 7 days ago")).toBeTruthy();
    // Changing only the operator keeps the relative value.
    fireEvent.change(document.getElementById("t-op-0") as HTMLSelectElement, { target: { value: "is at most" } });
    expect(builtOf(drafts.at(-1))).toEqual({ op: "lte", field: "due", value: { daysFromToday: -7 } });
    fireEvent.change(document.getElementById("t-mode-0") as HTMLSelectElement, { target: { value: "A fixed date" } });
    expect(drafts.at(-1)?.comparisons[0]?.value).toBeUndefined();
    expect(document.getElementById("t-days-0")).toBeNull();
  });

  test("clearing the days leaves the row unfinished", () => {
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "eq", field: "due", value: { daysFromToday: 2 } }] }} onDraft={() => {}} />);
    fireEvent.change(document.getElementById("t-days-0") as HTMLInputElement, { target: { value: "" } });
    expect(screen.getByText("Fill in every row to apply this condition.")).toBeTruthy();
  });

  test("a number field offers no date mode", () => {
    render(<Harness initial={{ combine: "all", comparisons: [{ not: false, op: "eq", field: "points", value: 1 }] }} onDraft={() => {}} />);
    expect(document.getElementById("t-mode-0")).toBeNull();
  });
});
