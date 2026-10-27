// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { waitForRows, waitForSettled } from "./wait.js";

function Late({ rows }: { rows: number }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <div data-yadad-table-view="t" aria-busy={!loaded}>
      {loaded && Array.from({ length: rows }, (_, i) => <div key={i} data-testid={`row-${i}`} />)}
    </div>
  );
}

describe("waiting for views", () => {
  test("waitForRows waits through the busy state, optionally for an exact count", async () => {
    const { container } = render(<Late rows={3} />);
    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(0);
    expect(await waitForRows(container, { view: "t", count: 3 })).toHaveLength(3);
  });

  test("waitForSettled returns once nothing is busy", async () => {
    const { container } = render(<Late rows={1} />);
    await waitForSettled(container);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
