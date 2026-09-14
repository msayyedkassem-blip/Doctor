/**
 * Money is ALWAYS an integer number of euro cents. Never a float.
 *
 * Rationale: 0.1 + 0.2 !== 0.3 in IEEE-754, and an e-commerce ledger that
 * drifts by a cent per order is a reconciliation nightmare at year end.
 * Every price, fee, tax and total in this codebase is `Cents`.
 */

/** An integer number of euro cents. */
export type Cents = number;

export const EUR = 'EUR' as const;
export type Currency = typeof EUR;

export function cents(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite amount: ${value}`);
  return Math.round(value);
}

/** Build Cents from a euro amount, e.g. euros(4.99) -> 499. */
export function euros(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite amount: ${value}`);
  return Math.round(value * 100);
}

export function addCents(...amounts: Cents[]): Cents {
  return amounts.reduce((sum, a) => sum + a, 0);
}

export function multiplyCents(amount: Cents, quantity: number): Cents {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantity must be a non-negative integer, got ${quantity}`);
  }
  return amount * quantity;
}

/**
 * Apply a percentage expressed in basis points (1% = 100 bp) with
 * half-up rounding. Used for VAT and percentage discounts.
 */
export function applyBasisPoints(amount: Cents, basisPoints: number): Cents {
  return Math.round((amount * basisPoints) / 10_000);
}

/** Format for display. Locale defaults to fr-FR ("4,99 €"). */
export function formatCents(amount: Cents, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: EUR,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}
