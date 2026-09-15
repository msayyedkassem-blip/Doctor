import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { euros } from './money.js';
import { VatMode, VatCategory } from './vat.js';
import { ShippingMethod, quoteShipping } from './shipping.js';
import { computeCartTotals, type CartLineInput } from './cart.js';

const tahini: CartLineInput = {
  productId: 'p1', slug: 'tahini-al-wadi-450g', nameFr: 'Tahini Al Wadi 450 g',
  unitPriceCents: euros(5.9), quantity: 2,
  vatCategory: VatCategory.FOOD_REDUCED, shippingWeightGrams: 500,
};
const chocolates: CartLineInput = {
  productId: 'p2', slug: 'chocolat-fourre-200g', nameFr: 'Chocolats fourrés 200 g',
  unitPriceCents: euros(9.0), quantity: 1,
  vatCategory: VatCategory.CONFECTIONERY, shippingWeightGrams: 220,
};

describe('computeCartTotals', () => {
  it('shows no VAT breakdown at all under the franchise', () => {
    const t = computeCartTotals({ lines: [tahini, chocolates], shippingQuote: null, vatMode: VatMode.FRANCHISE });
    assert.equal(t.subtotalCents, euros(20.8));
    assert.equal(t.totalVatCents, 0);
    assert.deepEqual(t.vatBreakdown, [], 'no VAT line may appear while in franchise');
  });

  it('counts items and weight across lines', () => {
    const t = computeCartTotals({ lines: [tahini, chocolates], shippingQuote: null, vatMode: VatMode.FRANCHISE });
    assert.equal(t.itemCount, 3);
    assert.equal(t.itemsWeightGrams, 500 * 2 + 220);
  });

  it('adds shipping to the total', () => {
    const quote = quoteShipping({
      method: ShippingMethod.MONDIAL_RELAY_POINT, itemsWeightGrams: 1_220, subtotalCents: euros(20.8),
    });
    const t = computeCartTotals({ lines: [tahini, chocolates], shippingQuote: quote, vatMode: VatMode.FRANCHISE });
    assert.equal(t.shippingCents, quote.priceCents);
    assert.equal(t.totalCents, euros(20.8) + quote.priceCents);
    assert.equal(t.shippingMethod, ShippingMethod.MONDIAL_RELAY_POINT);
  });

  it('splits a mixed basket across both VAT rates once liable', () => {
    const t = computeCartTotals({ lines: [tahini, chocolates], shippingQuote: null, vatMode: VatMode.STANDARD });
    assert.equal(t.vatBreakdown.length, 2);
    assert.deepEqual(t.vatBreakdown.map((r) => r.rateBasisPoints), [550, 2000]);
    // Totals must reconcile exactly against the basket.
    const netSum = t.vatBreakdown.reduce((s, r) => s + r.netCents, 0);
    assert.equal(netSum + t.totalVatCents, t.totalCents);
  });

  it('apportions a discount across rates instead of dumping it on one', () => {
    const t = computeCartTotals({
      lines: [tahini, chocolates], shippingQuote: null,
      vatMode: VatMode.STANDARD, discountCents: euros(5),
    });
    assert.equal(t.discountCents, euros(5));
    assert.equal(t.totalCents, euros(15.8));
    const netSum = t.vatBreakdown.reduce((s, r) => s + r.netCents, 0);
    assert.equal(netSum + t.totalVatCents, t.totalCents, 'discounted basket must still reconcile');
  });

  it('never lets a discount push the basket below zero', () => {
    const t = computeCartTotals({
      lines: [tahini], shippingQuote: null,
      vatMode: VatMode.FRANCHISE, discountCents: euros(500),
    });
    assert.equal(t.discountCents, euros(11.8));
    assert.equal(t.totalCents, 0);
  });
});
