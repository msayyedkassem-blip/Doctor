/**
 * French VAT engine.
 *
 * The business currently operates under the FRANCHISE EN BASE DE TVA
 * (art. 293 B du CGI): no VAT is charged to customers, and VAT paid
 * upstream — including import VAT on goods cleared from Lebanon — is NOT
 * deductible. It is a cost of goods, not a credit.
 *
 * That regime ends automatically once turnover crosses a threshold, so the
 * engine is built switchable from day one rather than retrofitted later.
 */

import { type Cents, applyBasisPoints } from './money.js';

/* ------------------------------------------------------------------ */
/* Regime                                                              */
/* ------------------------------------------------------------------ */

export const VatMode = {
  /** art. 293 B CGI — no VAT charged, no VAT reclaimed. */
  FRANCHISE: 'FRANCHISE',
  /** Normal regime — VAT charged per product rate, input VAT deductible. */
  STANDARD: 'STANDARD',
} as const;
export type VatMode = (typeof VatMode)[keyof typeof VatMode];

/** Legal mention that MUST appear on every invoice while in franchise. */
export const FRANCHISE_INVOICE_MENTION = 'TVA non applicable, article 293 B du CGI';

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

/**
 * VAT category of a sellable item. Only consulted in STANDARD mode.
 *
 * The French food rates are not intuitive and the boundary is a classic
 * audit finding, so the distinction is modelled explicitly per product
 * rather than inferred from the category tree:
 *
 *  - FOOD_REDUCED (5.5%)  groceries for deferred consumption: tahini, olive
 *                         oil, za'atar, pulses, coffee, rose water, pickles,
 *                         and plain eating-chocolate bars.
 *  - CONFECTIONERY (20%)  confiserie and chocolate *confectionery* —
 *                         pralinés, truffles, filled bonbons — plus
 *                         margarine and caviar. Same shelf, different rate.
 *  - NON_FOOD (20%)       cookware, ceramics, empty gift boxes.
 */
export const VatCategory = {
  FOOD_REDUCED: 'FOOD_REDUCED',
  CONFECTIONERY: 'CONFECTIONERY',
  NON_FOOD: 'NON_FOOD',
} as const;
export type VatCategory = (typeof VatCategory)[keyof typeof VatCategory];

/** Rates in basis points (550 bp = 5.5%). */
export const VAT_RATE_BP: Readonly<Record<VatCategory, number>> = Object.freeze({
  FOOD_REDUCED: 550,
  CONFECTIONERY: 2000,
  NON_FOOD: 2000,
});

/** Shipping follows the rate of the goods it carries; mixed baskets use the highest. */
export const SHIPPING_VAT_CATEGORY_FALLBACK: VatCategory = 'FOOD_REDUCED';

/* ------------------------------------------------------------------ */
/* Threshold monitoring (art. 293 B CGI)                               */
/* ------------------------------------------------------------------ */

/** Turnover thresholds for *sale of goods*, in cents. Services differ. */
export const FRANCHISE_THRESHOLD_GOODS: Cents = 8_500_000; // 85 000 €
export const FRANCHISE_THRESHOLD_GOODS_MAJORE: Cents = 9_350_000; // 93 500 €

export type FranchiseStatus =
  | { readonly kind: 'WITHIN'; readonly headroom: Cents }
  /** Base threshold crossed last year: VAT applies from 1 January of the year after next. */
  | { readonly kind: 'ENDS_NEXT_YEAR'; readonly effectiveFrom: Date }
  /** Majoré threshold crossed: VAT applies from the 1st of the month of the crossing. */
  | { readonly kind: 'ENDED'; readonly effectiveFrom: Date };

/**
 * Decide whether the franchise still applies.
 *
 * Rules encoded (goods, 2026):
 *  - Turnover in year N-1 above 85 000 € (but never above 93 500 €)
 *      -> franchise runs to the end of year N, VAT from 1 Jan of N+1.
 *  - Turnover in the current year above 93 500 €
 *      -> franchise stops immediately, VAT from the 1st of the month in
 *         which the crossing happened.
 *
 * @param currentYearRevenue turnover booked so far in the current calendar year
 * @param previousYearRevenue turnover booked in the previous calendar year
 * @param crossingDate the date the majoré threshold was crossed, when known;
 *                     defaults to `asOf` (today) for a live check
 */
export function evaluateFranchise(params: {
  currentYearRevenue: Cents;
  previousYearRevenue: Cents;
  asOf: Date;
  crossingDate?: Date;
}): FranchiseStatus {
  const { currentYearRevenue, previousYearRevenue, asOf } = params;

  if (currentYearRevenue > FRANCHISE_THRESHOLD_GOODS_MAJORE) {
    const crossed = params.crossingDate ?? asOf;
    // First day of the month in which the majoré threshold was crossed.
    const effectiveFrom = new Date(Date.UTC(crossed.getUTCFullYear(), crossed.getUTCMonth(), 1));
    return { kind: 'ENDED', effectiveFrom };
  }

  if (previousYearRevenue > FRANCHISE_THRESHOLD_GOODS) {
    // 1 January of the year following the current one.
    const effectiveFrom = new Date(Date.UTC(asOf.getUTCFullYear() + 1, 0, 1));
    return { kind: 'ENDS_NEXT_YEAR', effectiveFrom };
  }

  return {
    kind: 'WITHIN',
    headroom: FRANCHISE_THRESHOLD_GOODS_MAJORE - currentYearRevenue,
  };
}

/* ------------------------------------------------------------------ */
/* Price computation                                                   */
/* ------------------------------------------------------------------ */

/**
 * How to react when the franchise ends.
 *
 * Prices are stored as the amount the customer actually pays (TTC), because
 * French B2C law requires the advertised price to be the all-inclusive one.
 * When VAT switches on, something has to give:
 *
 *  - ABSORB       shelf price unchanged, VAT carved out of it, margin drops.
 *  - PASS_THROUGH shelf price rises by the VAT, margin preserved.
 */
export const VatSwitchStrategy = {
  ABSORB: 'ABSORB',
  PASS_THROUGH: 'PASS_THROUGH',
} as const;
export type VatSwitchStrategy = (typeof VatSwitchStrategy)[keyof typeof VatSwitchStrategy];

export interface TaxedAmount {
  /** Excluding VAT. */
  readonly net: Cents;
  readonly vat: Cents;
  /** What the customer pays. */
  readonly gross: Cents;
  readonly rateBasisPoints: number;
}

/**
 * Split a stored (TTC) price into net / VAT / gross.
 *
 * In FRANCHISE mode this is a no-op: net === gross, VAT is zero, and no VAT
 * line may appear anywhere on the invoice.
 */
export function taxAmount(params: {
  storedPrice: Cents;
  mode: VatMode;
  category: VatCategory;
  strategy?: VatSwitchStrategy;
}): TaxedAmount {
  const { storedPrice, mode, category } = params;

  if (mode === VatMode.FRANCHISE) {
    return { net: storedPrice, vat: 0, gross: storedPrice, rateBasisPoints: 0 };
  }

  const rateBasisPoints = VAT_RATE_BP[category];
  const strategy = params.strategy ?? VatSwitchStrategy.ABSORB;

  if (strategy === VatSwitchStrategy.PASS_THROUGH) {
    // Stored price is treated as net; VAT is added on top.
    const vat = applyBasisPoints(storedPrice, rateBasisPoints);
    return { net: storedPrice, vat, gross: storedPrice + vat, rateBasisPoints };
  }

  // ABSORB: stored price is the gross; carve the VAT out of it.
  // net = gross / (1 + rate)  ->  computed in integer cents, VAT is the remainder
  // so that net + vat === gross exactly, with no rounding drift.
  const net = Math.round((storedPrice * 10_000) / (10_000 + rateBasisPoints));
  return { net, vat: storedPrice - net, gross: storedPrice, rateBasisPoints };
}

/**
 * Landed unit cost of an imported good under franchise.
 *
 * Import VAT is charged at customs and, because the franchise grants no
 * right of deduction, it stays in the cost base. Getting this wrong is the
 * single most common way a franchise-en-base importer overstates margin.
 *
 * Note: even under the franchise, importing from outside the EU requires a
 * French VAT number and the import VAT is self-assessed on a CA3 return —
 * declared, then not deducted.
 */
export function landedUnitCost(params: {
  /** Supplier price per unit, ex-works or FOB Beirut. */
  supplierCost: Cents;
  /** Freight + insurance + handling apportioned to the unit. */
  freightShare: Cents;
  /** Customs duty apportioned to the unit. Often 0 under EU–Lebanon origin. */
  customsDuty: Cents;
  /** Import VAT apportioned to the unit — NOT deductible under franchise. */
  importVat: Cents;
  /** Other apportioned costs: EPR/Citeo eco-contribution, customs broker. */
  otherCosts?: Cents;
}): Cents {
  return (
    params.supplierCost +
    params.freightShare +
    params.customsDuty +
    params.importVat +
    (params.otherCosts ?? 0)
  );
}
