import type { DocumentError } from "@yadad/core";

/** The one hint a load failure gives (card 45d): try the action again, or reload. */
export const LOAD_FAILURE_HINT = "Retry, or reload the page.";

/**
 * The ErrorSummary entry every renderer shows when a read fails. One message
 * and one hint for all five sites — they used to carry three hints between
 * them ("Reload the page to try again.", "Reload the page or try again
 * later.", "Retry, or reload the page."), so the same failure told the user
 * different things depending on which view they were in.
 */
export function loadFailure(message: string, hint: string = LOAD_FAILURE_HINT): DocumentError {
  return { path: "", code: "invalid-value", message: `Could not load records: ${message}`, hint };
}
