/**
 * Order lifecycle and consumer-law rules.
 */

import { DurabilityKind } from './inco.js';

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

export const OrderStatus = {
  /** Basket turned into an order, Stripe PaymentIntent not yet confirmed. */
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  /** Funds captured. Stock is committed at this point, not before. */
  PAID: 'PAID',
  PREPARING: 'PREPARING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Allowed transitions. Anything absent here is a bug, not a business case —
 * the point is that an order can never silently skip payment or un-ship.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED', 'REFUNDED'],
  PREPARING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
});

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transition de commande interdite : ${from} -> ${to}`);
  }
}

/** Statuses after which stock has left the building. */
export function isDispatched(status: OrderStatus): boolean {
  return status === OrderStatus.SHIPPED || status === OrderStatus.DELIVERED;
}

/* ------------------------------------------------------------------ */
/* Right of withdrawal (art. L221-18 and L221-28 code de la consommation) */
/* ------------------------------------------------------------------ */

export const WITHDRAWAL_PERIOD_DAYS = 14;

export const WithdrawalExemption = {
  /** L221-28 4° — goods liable to deteriorate or expire rapidly. */
  PERISHABLE: 'PERISHABLE',
  /** L221-28 5° — sealed goods, unsealed after delivery, not returnable for hygiene reasons. */
  UNSEALED_HYGIENE: 'UNSEALED_HYGIENE',
} as const;
export type WithdrawalExemption = (typeof WithdrawalExemption)[keyof typeof WithdrawalExemption];

export interface WithdrawalRight {
  readonly applies: boolean;
  readonly exemption: WithdrawalExemption | null;
  readonly deadline: Date | null;
  readonly explanationFr: string;
}

/**
 * Decide whether a delivered item can be returned under the 14-day right.
 *
 * The widespread belief that "food is exempt" is wrong, and it is worth
 * being precise because getting it backwards is a DGCCRF finding:
 *
 *   - The L221-28 exemption covers goods that DETERIORATE RAPIDLY — fresh
 *     produce, chilled items, anything on a DLC.
 *   - Shelf-stable groceries on a DDM — tahini, olive oil, za'atar, pulses,
 *     coffee, rose water, sealed pickles — do NOT deteriorate rapidly, so
 *     the 14-day right DOES apply to essentially this whole catalogue.
 *
 * The practical protection is the second exemption: a jar that arrived
 * sealed and was opened by the customer cannot be sent back. So the rule
 * below is "returnable while still sealed", which is both lawful and
 * operationally sane.
 */
export function withdrawalRight(params: {
  durabilityKind: DurabilityKind;
  /** True when the unit is sold sealed AND the customer has broken the seal. */
  sealBroken: boolean;
  deliveredAt: Date;
}): WithdrawalRight {
  if (params.durabilityKind === DurabilityKind.DLC) {
    return {
      applies: false,
      exemption: WithdrawalExemption.PERISHABLE,
      deadline: null,
      explanationFr:
        "Produit périssable (DLC) : exclu du droit de rétractation (art. L221-28 4° du code de la consommation).",
    };
  }

  if (params.sealBroken) {
    return {
      applies: false,
      exemption: WithdrawalExemption.UNSEALED_HYGIENE,
      deadline: null,
      explanationFr:
        "Produit scellé descellé après livraison : retour impossible pour des raisons d'hygiène (art. L221-28 5°).",
    };
  }

  const deadline = new Date(params.deliveredAt.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + WITHDRAWAL_PERIOD_DAYS);

  return {
    applies: true,
    exemption: null,
    deadline,
    explanationFr:
      `Produit non périssable encore scellé : rétractation possible sous ${WITHDRAWAL_PERIOD_DAYS} jours après livraison.`,
  };
}

/* ------------------------------------------------------------------ */
/* Stock batches                                                       */
/* ------------------------------------------------------------------ */

/**
 * A physical batch of one product: the level at which lot number and
 * durability date live. Art. 14 exempts the date from the pre-purchase
 * duty, but it must be on the goods at delivery — and traceability
 * (Reg. 178/2002) means the lot shipped to each customer must be
 * recoverable for a recall.
 */
export interface StockBatch {
  readonly id: string;
  readonly productId: string;
  /** Lot number as printed by the producer. Required for recall traceability. */
  readonly lotNumber: string;
  readonly durabilityDate: Date;
  readonly quantityOnHand: number;
  readonly receivedAt: Date;
}

/**
 * Pick batches to fulfil a quantity, oldest durability date first (FEFO —
 * first expired, first out). Returns null when stock is insufficient.
 */
export function allocateFefo(
  batches: readonly StockBatch[],
  quantity: number,
  asOf: Date,
): { batchId: string; lotNumber: string; quantity: number }[] | null {
  const usable = batches
    .filter((b) => b.quantityOnHand > 0 && b.durabilityDate > asOf)
    .sort((a, b) => a.durabilityDate.getTime() - b.durabilityDate.getTime());

  const picks: { batchId: string; lotNumber: string; quantity: number }[] = [];
  let remaining = quantity;

  for (const batch of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.quantityOnHand);
    picks.push({ batchId: batch.id, lotNumber: batch.lotNumber, quantity: take });
    remaining -= take;
  }

  return remaining > 0 ? null : picks;
}
