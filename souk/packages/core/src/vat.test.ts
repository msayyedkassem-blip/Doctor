import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { euros } from './money.js';
import {
  VatMode,
  VatCategory,
  VatSwitchStrategy,
  taxAmount,
  evaluateFranchise,
  landedUnitCost,
  FRANCHISE_THRESHOLD_GOODS_MAJORE,
} from './vat.js';

describe('taxAmount', () => {
  it('charges no VAT under the franchise', () => {
    const r = taxAmount({ storedPrice: euros(12.5), mode: VatMode.FRANCHISE, category: VatCategory.FOOD_REDUCED });
    assert.equal(r.vat, 0);
    assert.equal(r.net, euros(12.5));
    assert.equal(r.gross, euros(12.5));
    assert.equal(r.rateBasisPoints, 0);
  });

  it('carves 5.5% out of the shelf price when absorbing', () => {
    const r = taxAmount({
      storedPrice: euros(10.55), mode: VatMode.STANDARD,
      category: VatCategory.FOOD_REDUCED, strategy: VatSwitchStrategy.ABSORB,
    });
    assert.equal(r.gross, euros(10.55), 'shelf price must not move');
    assert.equal(r.net, 1000);
    assert.equal(r.vat, 55);
  });

  it('adds VAT on top when passing through', () => {
    const r = taxAmount({
      storedPrice: euros(10), mode: VatMode.STANDARD,
      category: VatCategory.FOOD_REDUCED, strategy: VatSwitchStrategy.PASS_THROUGH,
    });
    assert.equal(r.net, euros(10));
    assert.equal(r.vat, 55);
    assert.equal(r.gross, euros(10.55));
  });

  it('rates confectionery at 20%, not the food rate', () => {
    const r = taxAmount({ storedPrice: euros(12), mode: VatMode.STANDARD, category: VatCategory.CONFECTIONERY });
    assert.equal(r.rateBasisPoints, 2000);
  });

  it('never drifts: net + vat === gross for every price up to 100 EUR', () => {
    for (let p = 1; p <= 10_000; p++) {
      for (const category of [VatCategory.FOOD_REDUCED, VatCategory.CONFECTIONERY] as const) {
        const r = taxAmount({ storedPrice: p, mode: VatMode.STANDARD, category });
        assert.equal(r.net + r.vat, r.gross, `drift at ${p} / ${category}`);
      }
    }
  });
});

describe('evaluateFranchise', () => {
  const asOf = new Date('2026-09-14T00:00:00Z');

  it('stays within while below both thresholds', () => {
    const s = evaluateFranchise({ currentYearRevenue: euros(40_000), previousYearRevenue: euros(30_000), asOf });
    assert.equal(s.kind, 'WITHIN');
    assert.equal(s.kind === 'WITHIN' && s.headroom, FRANCHISE_THRESHOLD_GOODS_MAJORE - euros(40_000));
  });

  it('ends on 1 January of next year when only the base threshold was crossed last year', () => {
    const s = evaluateFranchise({ currentYearRevenue: euros(50_000), previousYearRevenue: euros(88_000), asOf });
    assert.equal(s.kind, 'ENDS_NEXT_YEAR');
    assert.equal(s.kind === 'ENDS_NEXT_YEAR' && s.effectiveFrom.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('ends immediately, from the 1st of the crossing month, above the majore threshold', () => {
    const s = evaluateFranchise({
      currentYearRevenue: euros(94_000), previousYearRevenue: euros(60_000),
      asOf, crossingDate: new Date('2026-09-09T11:00:00Z'),
    });
    assert.equal(s.kind, 'ENDED');
    assert.equal(s.kind === 'ENDED' && s.effectiveFrom.toISOString(), '2026-09-01T00:00:00.000Z');
  });

  it('treats the majore threshold as strictly greater-than', () => {
    const s = evaluateFranchise({
      currentYearRevenue: FRANCHISE_THRESHOLD_GOODS_MAJORE, previousYearRevenue: 0, asOf,
    });
    assert.equal(s.kind, 'WITHIN');
  });
});

describe('landedUnitCost', () => {
  it('keeps non-deductible import VAT inside the cost base', () => {
    const cost = landedUnitCost({
      supplierCost: euros(3.0), freightShare: euros(0.45),
      customsDuty: 0, importVat: euros(0.19), otherCosts: euros(0.02),
    });
    assert.equal(cost, euros(3.66));
  });
});
