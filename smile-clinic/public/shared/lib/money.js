/** All arithmetic here is on integer cents. Never use floats for money. */

export function sumCents(values) {
  return values.reduce((total, v) => total + Math.round(Number(v) || 0), 0);
}

/** Applies a basis-point tax rate (e.g. 2100 = 21%) to a cents amount. */
export function taxOn(cents, rateBp) {
  return Math.round((cents * (Number(rateBp) || 0)) / 10000);
}

export function lineTotal({ quantity = 1, unit_price_cents = 0, discount_cents = 0 }) {
  const gross = Math.round(unit_price_cents) * Math.max(1, Math.round(quantity));
  return Math.max(0, gross - Math.round(discount_cents));
}

/**
 * Recomputes an invoice's monetary totals from its line items.
 * Line discounts are already inside line_total_cents; `invoiceDiscount` is an
 * extra whole-invoice discount applied before tax, spread proportionally.
 */
export function invoiceTotals(items, invoiceDiscountCents = 0) {
  const subtotal = sumCents(items.map((i) => i.line_total_cents));
  const discount = Math.min(Math.max(0, Math.round(invoiceDiscountCents)), subtotal);
  const base = subtotal - discount;
  const ratio = subtotal > 0 ? base / subtotal : 0;
  const tax = sumCents(items.map((i) => taxOn(Math.round(i.line_total_cents * ratio), i.tax_rate_bp)));
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    tax_cents: tax,
    total_cents: base + tax,
  };
}

/** Net of payments in minus refunds out, for an invoice or a patient. */
export function netPaid(payments) {
  return sumCents(payments.map((p) => (p.direction === 'refund' ? -p.amount_cents : p.amount_cents)));
}

export function statusFromBalance(total, paid, current) {
  if (current === 'void' || current === 'draft') return current;
  if (paid <= 0) return 'issued';
  if (paid >= total) return 'paid';
  return 'partial';
}
