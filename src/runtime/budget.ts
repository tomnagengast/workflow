// Token budget.
//
// Byte-faithful to the monolith (`/Users/tom/cmptr/bin/workflow` ~68,
// ~521-529): `BudgetError` is the sentinel thrown when the token budget is
// exhausted (it propagates through parallel()/pipeline() instead of collapsing to
// null). `makeBudget` builds the `budget` object exposed to the sandbox:
// `{ total, spent(), remaining() }` where total === null means unlimited.
//
// The factory takes a getter for the live spent count so it tracks the runner's
// running total exactly as the monolith's closure over `self.spent` did. No top-
// level await.

/** Thrown when the token budget is exhausted. Distinct so parallel()/pipeline()
 * can re-throw it (a budget kill is fatal) instead of swallowing it to null. */
export class BudgetError extends Error {}

/** The `budget` bag injected into the sandbox. Byte-identical shape to the
 * monolith's `makeBudget`: `total` (null = unlimited), `spent()` (live), and
 * `remaining()` (Infinity when unlimited, else max(0, total - spent)). */
export interface Budget {
  total: number | null;
  spent: () => number;
  remaining: () => number;
}

/** Build the budget bag. `total` is the configured ceiling (null = unlimited);
 * `getSpent` returns the runner's live spent count. */
export function makeBudget(total: number | null, getSpent: () => number): Budget {
  return {
    total: total == null ? null : total,
    spent: () => getSpent(),
    remaining: () => (total == null ? Infinity : Math.max(0, total - getSpent())),
  };
}
