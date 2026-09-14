/**
 * Basket pricing.
 *
 * One pipeline, shared by the website, the Android app and the admin, so a
 * total can never differ between surfaces. Every amount is integer cents.
 */

import { type Cents, addCents, multiplyCents } from './money.js';
import {
  type VatCategory,
  type VatMode,
  type VatSwitchStrategy,
  VAT_RATE_BP,
  SHIPPING_VAT_CATEGORY_FALLBACK,
  taxAmount,
} from './vat.js';
import type { ShippingQuote } from './shipping.js';
import type { ShippingMethod } from './shipping.js';

export interface CartLineInput {
  readonly productId: string;
  readonly slug: string;
  readonly nameFr: string;
  readonly unitPriceCents: Cents;
  readonly quantity: number;
  readonly vatCategory: VatCategory;
  readonly shippingWeightGrams: number;
}

export interface CartLine extends CartLineInput {
  readonly lineTotalCents: Cents;
  readonly lineWeightGrams: number;
}

export interface VatBreakdownRow {
  readonly rateBasisPoints: number;
  readonly netCents: Cents;
  readonly vatCents: Cents;
}

export interface CartTotals {
  readonly lines: readonly CartLine[];
  readonly itemCount: number;
  readonly itemsWeightGrams: number;
  /** Sum of line totals, before shipping. */
  readonly subtotalCents: Cents;
  readonly shippingCents: Cents;
  readonly discountCents: Cents;
  /** What the customer pays. */
  readonly totalCents: Cents;
  /** Empty in FRANCHISE mode — no VAT line may be shown. */
  readonly vatBreakdown: readonly VatBreakdownRow[];
  readonly totalVatCents: Cents;
  readonly shippingMethod: ShippingMethod | null;
}

export function buildCartLines(inputs: readonly CartLineInput[]): CartLine[] {
  return inputs.map((input) => ({
    ...input,
    lineTotalCents: multiplyCents(input.unitPriceCents, input.quantity),
    lineWeightGrams: input.shippingWeightGrams * input.quantity,
  }));
}

/**
 * Price a basket.
 *
 * The discount is applied to the goods subtotal before VAT is carved out,
 * and is apportioned across VAT rates in proportion to each rate's share of
 * the basket — otherwise a mixed basket of groceries (5.5%) and
 * confectionery (20%) would report the wrong tax split once the franchise
 * ends.
 */
export function computeCartTotals(params: {
  lines: readonly CartLineInput[];
  shippingQuote: ShippingQuote | null;
  vatMode: VatMode;
  vatSwitchStrategy?: VatSwitchStrategy;
  discountCents?: Cents;
}): CartTotals {
  const lines = buildCartLines(params.lines);
  const discountCents = Math.max(0, params.discountCents ?? 0);

  const subtotalCents = addCents(...lines.map((l) => l.lineTotalCents));
  const itemsWeightGrams = lines.reduce((sum, l) => sum + l.lineWeightGrams, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const cappedDiscount = Math.min(discountCents, subtotalCents);
  const shippingCents = params.shippingQuote?.priceCents ?? 0;
  const totalCents = subtotalCents - cappedDiscount + shippingCents;

  // Group the discounted goods by VAT category, then rate them.
  const byCategory = new Map<VatCategory, Cents>();
  for (const line of lines) {
    byCategory.set(line.vatCategory, (byCategory.get(line.vatCategory) ?? 0) + line.lineTotalCents);
  }

  const rows = new Map<number, { net: Cents; vat: Cents }>();
  const accumulate = (net: Cents, vat: Cents, rateBasisPoints: number) => {
    const existing = rows.get(rateBasisPoints) ?? { net: 0, vat: 0 };
    rows.set(rateBasisPoints, { net: existing.net + net, vat: existing.vat + vat });
  };

  for (const [category, gross] of byCategory) {
    // Apportion the discount by this category's share of the subtotal.
    const share = subtotalCents === 0 ? 0 : Math.round((cappedDiscount * gross) / subtotalCents);
    const taxed = taxAmount({
      storedPrice: gross - share,
      mode: params.vatMode,
      category,
      strategy: params.vatSwitchStrategy,
    });
    accumulate(taxed.net, taxed.vat, taxed.rateBasisPoints);
  }

  if (shippingCents > 0) {
    // Shipping follows the goods it carries; a mixed basket takes the highest rate.
    const shippingCategory =
      [...byCategory.keys()].sort((a, b) => VAT_RATE_BP[b] - VAT_RATE_BP[a])[0] ??
      SHIPPING_VAT_CATEGORY_FALLBACK;
    const taxed = taxAmount({
      storedPrice: shippingCents,
      mode: params.vatMode,
      category: shippingCategory,
      strategy: params.vatSwitchStrategy,
    });
    accumulate(taxed.net, taxed.vat, taxed.rateBasisPoints);
  }

  const vatBreakdown: VatBreakdownRow[] = [...rows.entries()]
    .filter(([rateBasisPoints]) => rateBasisPoints > 0)
    .map(([rateBasisPoints, v]) => ({ rateBasisPoints, netCents: v.net, vatCents: v.vat }))
    .sort((a, b) => a.rateBasisPoints - b.rateBasisPoints);

  return {
    lines,
    itemCount,
    itemsWeightGrams,
    subtotalCents,
    shippingCents,
    discountCents: cappedDiscount,
    totalCents,
    vatBreakdown,
    totalVatCents: addCents(...vatBreakdown.map((r) => r.vatCents)),
    shippingMethod: params.shippingQuote?.method ?? null,
  };
}
