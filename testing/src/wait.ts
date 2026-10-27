// Wait for a yadad view to finish loading, instead of racing it. Both helpers
// poll with Testing Library's `waitFor`; neither uses a fixed delay.
import { waitFor } from "@testing-library/dom";

/** What counts as a draw of one row: a table row, a board card or a calendar entry of the mock registry (not a row's action bar). */
const MOCK_ROWS = '[data-testid^="row-"]:not([data-testid^="row-actions-"]), [data-testid^="card-"], [data-testid^="entry-"]';

/** What a view that is still loading reports: `aria-busy`, a loading quick filter, or the series widget's loading marker. */
const BUSY = '[aria-busy="true"], [data-yadad-filter-loading], [data-testid="series-loading"]';

/** Options for {@link waitForRows}. */
export interface WaitForRowsOptions {
  /** Only look inside this view (the renderer's `data-yadad-table-view`, `-board-view` or `-calendar-view` id). */
  readonly view?: string;
  /** Wait until exactly this many rows are drawn. Without it, wait for at least one. */
  readonly count?: number;
  /** A CSS selector for one drawn row, when the registry is not the mock registry. */
  readonly rowSelector?: string;
}

function scope(container: HTMLElement, view: string | undefined): HTMLElement {
  if (view === undefined) return container;
  const found = container.querySelector<HTMLElement>(`[data-yadad-table-view="${view}"], [data-yadad-board-view="${view}"], [data-yadad-calendar-view="${view}"]`);
  if (found === null) throw new Error(`No view "${view}" is drawn yet.`);
  return found;
}

function assertSettled(container: HTMLElement): void {
  const busy = container.querySelectorAll(BUSY);
  if (busy.length > 0) throw new Error(`${busy.length} element(s) still report loading.`);
}

/** Wait until nothing under `container` reports busy. Returns the container. */
export async function waitForSettled(container: HTMLElement = document.body): Promise<HTMLElement> {
  await waitFor(() => assertSettled(container));
  return container;
}

/** Wait until the view has stopped loading and its rows are drawn (exactly `count` of them when given). Returns the rows. */
export async function waitForRows(container: HTMLElement = document.body, options: WaitForRowsOptions = {}): Promise<HTMLElement[]> {
  const { view, count, rowSelector = MOCK_ROWS } = options;
  let rows: HTMLElement[] = [];
  await waitFor(() => {
    const root = scope(container, view);
    assertSettled(root);
    rows = [...root.querySelectorAll<HTMLElement>(rowSelector)];
    if (count === undefined ? rows.length === 0 : rows.length !== count) {
      throw new Error(`Expected ${count ?? "some"} drawn row(s), found ${rows.length}.`);
    }
  });
  return rows;
}
