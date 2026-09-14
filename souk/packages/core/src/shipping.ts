/**
 * Shipping rates for metropolitan France.
 *
 * Two carriers, chosen for two different jobs:
 *   - MONDIAL_RELAY_POINT  cheapest per parcel; customer collects from a
 *                          relay point. Typically J+3 to J+5.
 *   - COLISSIMO_HOME       delivered to the door, typically J+2. This is the
 *                          "fast" option; it is what carries the delivery
 *                          promise on the site.
 *
 * IMPORTANT: the tables below are INDICATIVE public rates used so the
 * checkout works end-to-end from day one. Once the carrier contracts (or a
 * Boxtal / Sendcloud account) are signed, replace the tables with the
 * negotiated grid — that is the only change needed, the engine is unaffected.
 */

import { type Cents, euros } from './money.js';

export const ShippingMethod = {
  MONDIAL_RELAY_POINT: 'MONDIAL_RELAY_POINT',
  COLISSIMO_HOME: 'COLISSIMO_HOME',
} as const;
export type ShippingMethod = (typeof ShippingMethod)[keyof typeof ShippingMethod];

interface WeightTier {
  /** Inclusive upper bound of the tier, in grams. */
  readonly maxGrams: number;
  readonly priceCents: Cents;
}

/** Tiers must be sorted ascending by maxGrams. */
const MONDIAL_RELAY_TIERS: readonly WeightTier[] = Object.freeze([
  { maxGrams: 500, priceCents: euros(3.9) },
  { maxGrams: 1_000, priceCents: euros(4.5) },
  { maxGrams: 2_000, priceCents: euros(5.3) },
  { maxGrams: 3_000, priceCents: euros(6.2) },
  { maxGrams: 5_000, priceCents: euros(7.5) },
  { maxGrams: 7_000, priceCents: euros(9.2) },
  { maxGrams: 10_000, priceCents: euros(11.0) },
  { maxGrams: 15_000, priceCents: euros(14.5) },
  { maxGrams: 20_000, priceCents: euros(17.9) },
  { maxGrams: 30_000, priceCents: euros(23.0) },
]);

const COLISSIMO_TIERS: readonly WeightTier[] = Object.freeze([
  { maxGrams: 250, priceCents: euros(4.99) },
  { maxGrams: 500, priceCents: euros(6.4) },
  { maxGrams: 750, priceCents: euros(7.3) },
  { maxGrams: 1_000, priceCents: euros(7.6) },
  { maxGrams: 2_000, priceCents: euros(8.55) },
  { maxGrams: 5_000, priceCents: euros(13.75) },
  { maxGrams: 10_000, priceCents: euros(19.6) },
  { maxGrams: 15_000, priceCents: euros(23.5) },
  { maxGrams: 30_000, priceCents: euros(29.4) },
]);

interface CarrierSpec {
  readonly tiers: readonly WeightTier[];
  /** Hard carrier limit; above this the basket must be split into two parcels. */
  readonly maxParcelGrams: number;
  readonly minBusinessDays: number;
  readonly maxBusinessDays: number;
  readonly labelFr: string;
}

export const CARRIERS: Readonly<Record<ShippingMethod, CarrierSpec>> = Object.freeze({
  MONDIAL_RELAY_POINT: {
    tiers: MONDIAL_RELAY_TIERS,
    maxParcelGrams: 30_000,
    minBusinessDays: 3,
    maxBusinessDays: 5,
    labelFr: 'Point Relais® Mondial Relay',
  },
  COLISSIMO_HOME: {
    tiers: COLISSIMO_TIERS,
    maxParcelGrams: 30_000,
    minBusinessDays: 2,
    maxBusinessDays: 3,
    labelFr: 'Colissimo — livraison à domicile',
  },
});

/**
 * Packaging tare added to the sum of item weights: box, filler, and the
 * bubble wrap that keeps glass jars of tahini and molasses intact.
 */
export const PACKAGING_TARE_GRAMS = 250;

/** Free shipping above this basket value. Set to null to disable. */
export const FREE_SHIPPING_THRESHOLD: Cents | null = euros(69);

/** Free shipping, when it applies, is granted on the relay option only. */
export const FREE_SHIPPING_METHOD: ShippingMethod = ShippingMethod.MONDIAL_RELAY_POINT;

export interface ShippingQuote {
  readonly method: ShippingMethod;
  readonly labelFr: string;
  readonly priceCents: Cents;
  readonly billableGrams: number;
  /** Number of parcels the basket needs at this carrier's weight limit. */
  readonly parcelCount: number;
  readonly minBusinessDays: number;
  readonly maxBusinessDays: number;
  readonly isFree: boolean;
}

function priceForWeight(spec: CarrierSpec, grams: number): Cents {
  const tier = spec.tiers.find((t) => grams <= t.maxGrams);
  if (tier) return tier.priceCents;
  // Heavier than the top tier — should have been split into parcels already.
  const top = spec.tiers[spec.tiers.length - 1];
  if (!top) throw new Error('Carrier has no rate tiers configured');
  return top.priceCents;
}

/**
 * Quote one carrier for a basket.
 *
 * Baskets heavier than the carrier's parcel limit are split into the
 * minimum number of equal parcels and each parcel is rated separately —
 * which is what actually happens at the packing bench.
 */
export function quoteShipping(params: {
  method: ShippingMethod;
  /** Sum of `shippingWeightGrams * quantity` over the basket. */
  itemsWeightGrams: number;
  /** Basket value, used for the free-shipping threshold. */
  subtotalCents: Cents;
}): ShippingQuote {
  const { method, itemsWeightGrams, subtotalCents } = params;
  const spec = CARRIERS[method];

  const billableGrams = itemsWeightGrams + PACKAGING_TARE_GRAMS;
  const parcelCount = Math.max(1, Math.ceil(billableGrams / spec.maxParcelGrams));
  const perParcelGrams = Math.ceil(billableGrams / parcelCount);
  const priceCents = priceForWeight(spec, perParcelGrams) * parcelCount;

  const isFree =
    FREE_SHIPPING_THRESHOLD !== null &&
    method === FREE_SHIPPING_METHOD &&
    subtotalCents >= FREE_SHIPPING_THRESHOLD;

  return {
    method,
    labelFr: spec.labelFr,
    priceCents: isFree ? 0 : priceCents,
    billableGrams,
    parcelCount,
    minBusinessDays: spec.minBusinessDays,
    maxBusinessDays: spec.maxBusinessDays,
    isFree,
  };
}

/** Quote every available carrier, cheapest first. */
export function quoteAllShipping(params: {
  itemsWeightGrams: number;
  subtotalCents: Cents;
}): ShippingQuote[] {
  return (Object.keys(CARRIERS) as ShippingMethod[])
    .map((method) => quoteShipping({ ...params, method }))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/**
 * Business-day delivery window, skipping weekends.
 *
 * Deliberately ignores French public holidays — adding them without a
 * maintained calendar would give a false promise. Treat the upper bound as
 * the one to advertise.
 */
export function estimateDeliveryWindow(dispatchedAt: Date, quote: ShippingQuote): {
  earliest: Date;
  latest: Date;
} {
  const addBusinessDays = (from: Date, days: number): Date => {
    const d = new Date(from.getTime());
    let remaining = days;
    while (remaining > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return d;
  };
  return {
    earliest: addBusinessDays(dispatchedAt, quote.minBusinessDays),
    latest: addBusinessDays(dispatchedAt, quote.maxBusinessDays),
  };
}
