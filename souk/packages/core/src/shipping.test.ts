import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { euros } from './money.js';
import { ShippingMethod, quoteShipping, quoteAllShipping, PACKAGING_TARE_GRAMS, estimateDeliveryWindow } from './shipping.js';

describe('quoteShipping', () => {
  it('adds the packaging tare to the billable weight', () => {
    const q = quoteShipping({ method: ShippingMethod.MONDIAL_RELAY_POINT, itemsWeightGrams: 400, subtotalCents: euros(20) });
    assert.equal(q.billableGrams, 400 + PACKAGING_TARE_GRAMS);
    assert.equal(q.priceCents, euros(4.5), '650 g falls in the 1 kg tier, not the 500 g one');
  });

  it('grants free relay shipping above the threshold', () => {
    const q = quoteShipping({ method: ShippingMethod.MONDIAL_RELAY_POINT, itemsWeightGrams: 2_000, subtotalCents: euros(75) });
    assert.equal(q.isFree, true);
    assert.equal(q.priceCents, 0);
  });

  it('does not extend free shipping to the fast home option', () => {
    const q = quoteShipping({ method: ShippingMethod.COLISSIMO_HOME, itemsWeightGrams: 2_000, subtotalCents: euros(75) });
    assert.equal(q.isFree, false);
    assert.ok(q.priceCents > 0);
  });

  it('splits an over-limit basket into parcels and rates each one', () => {
    const q = quoteShipping({ method: ShippingMethod.COLISSIMO_HOME, itemsWeightGrams: 45_000, subtotalCents: euros(300) });
    assert.equal(q.parcelCount, 2);
    assert.equal(q.priceCents, euros(29.4) * 2);
  });

  it('sorts all quotes cheapest first', () => {
    const quotes = quoteAllShipping({ itemsWeightGrams: 1_500, subtotalCents: euros(30) });
    assert.equal(quotes.length, 2);
    assert.ok(quotes[0]!.priceCents <= quotes[1]!.priceCents);
  });
});

describe('estimateDeliveryWindow', () => {
  it('skips the weekend', () => {
    // Thursday 2026-09-10 + 2 business days -> Monday 2026-09-14
    const q = quoteShipping({ method: ShippingMethod.COLISSIMO_HOME, itemsWeightGrams: 500, subtotalCents: euros(20) });
    const w = estimateDeliveryWindow(new Date('2026-09-10T00:00:00Z'), q);
    assert.equal(w.earliest.toISOString().slice(0, 10), '2026-09-14');
  });
});
