import { describe, expect, test } from "vitest";
import { LOAD_FAILURE_HINT, loadFailure } from "./load-state.js";

describe("loadFailure (card 45d)", () => {
  test("one message and one hint for every renderer", () => {
    expect(loadFailure("Server is down")).toEqual({
      path: "",
      code: "invalid-value",
      message: "Could not load records: Server is down",
      hint: "Retry, or reload the page.",
    });
    expect(LOAD_FAILURE_HINT).toBe("Retry, or reload the page.");
  });

  test("a caller may override only the hint", () => {
    expect(loadFailure("nope", "Check the connection.").hint).toBe("Check the connection.");
  });
});
