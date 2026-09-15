import 'server-only';
import { prisma } from '@souk/db';
import {
  evaluateFranchise, checkDistanceSellingCompliance, productSchema,
  FRANCHISE_THRESHOLD_GOODS, FRANCHISE_THRESHOLD_GOODS_MAJORE,
  type FranchiseStatus, type ComplianceIssue,
} from '@souk/core';
import type { Product, ShopSettings } from '@souk/db';

/** Batches closer than this to their date need attention, not panic. */
export const EXPIRY_WARNING_DAYS = 90;
/** Below this many sellable units, a product is worth reordering. */
export const LOW_STOCK_THRESHOLD = 10;

/**
 * Re-shape a database Product into the core model so the shared compliance
 * checker can read it. The food business operator is shop-level.
 */
export function toCoreProduct(p: Product, shop: ShopSettings | null) {
  return productSchema.parse({
    id: p.id,
    slug: p.slug,
    displayName: { fr: p.displayNameFr, en: p.displayNameEn, ar: p.displayNameAr },
    legalName: p.legalName,
    brand: p.brand,
    countryOfOrigin: p.countryOfOrigin,
    ingredientsFr: p.ingredientsFr,
    allergens: p.allergens,
    mayContain: p.mayContain,
    quidFr: p.quidFr,
    netQuantity: {
      value: p.netQuantityValue,
      unit: p.netQuantityUnit,
      drainedValue: p.netQuantityDrained,
    },
    nutrition: {
      energyKj: p.energyKj, energyKcal: p.energyKcal,
      fat: p.fat, saturates: p.saturates,
      carbohydrate: p.carbohydrate, sugars: p.sugars,
      protein: p.protein, salt: p.salt, fibre: p.fibre,
    },
    durabilityKind: p.durabilityKind,
    storageConditionsFr: p.storageConditionsFr,
    usageInstructionsFr: p.usageInstructionsFr,
    foodBusinessOperator: {
      legalName: shop?.legalName ?? '',
      addressLine1: shop?.addressLine1 ?? '',
      addressLine2: shop?.addressLine2 ?? null,
      postalCode: shop?.postalCode ?? '',
      city: shop?.city ?? '',
      country: shop?.country ?? 'France',
      siret: shop?.siret ?? null,
    },
    priceCents: p.priceCents,
    vatCategory: p.vatCategory,
    shippingWeightGrams: p.shippingWeightGrams,
    images: p.images,
    isActive: p.isActive,
  });
}

export function complianceIssuesFor(p: Product, shop: ShopSettings | null): ComplianceIssue[] {
  try {
    return checkDistanceSellingCompliance(toCoreProduct(p, shop));
  } catch (error) {
    // A row that cannot even be parsed into the core model is, by definition,
    // not publishable. Surface it as an issue rather than crashing the page.
    return [{
      field: 'produit',
      messageFr: `Données invalides : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
    }];
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface VatMonitor {
  readonly status: FranchiseStatus;
  readonly currentYearRevenueCents: number;
  readonly previousYearRevenueCents: number;
  readonly baseThreshold: number;
  readonly majoreThreshold: number;
  /** 0–1 against the majoré threshold, clamped. */
  readonly progress: number;
  readonly level: 'good' | 'warning' | 'serious' | 'critical';
  readonly headlineFr: string;
  readonly detailFr: string;
}

export function buildVatMonitor(shop: ShopSettings | null): VatMonitor {
  const current = shop?.currentYearRevenueCents ?? 0;
  const previous = shop?.previousYearRevenueCents ?? 0;
  const asOf = new Date();

  const status = evaluateFranchise({
    currentYearRevenue: current,
    previousYearRevenue: previous,
    asOf,
    ...(shop?.franchiseEndedOn ? { crossingDate: shop.franchiseEndedOn } : {}),
  });

  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  let level: VatMonitor['level'] = 'good';
  let headlineFr = 'Franchise en base applicable';
  let detailFr = 'Aucune TVA facturée. La TVA à l\'import reste un coût non déductible.';

  if (status.kind === 'ENDED') {
    level = 'critical';
    headlineFr = 'Franchise terminée';
    detailFr = `Seuil majoré dépassé. La TVA s'applique depuis le ${fmt(status.effectiveFrom)}, y compris sur les ventes déjà réalisées ce mois-là.`;
  } else if (status.kind === 'ENDS_NEXT_YEAR') {
    level = 'serious';
    headlineFr = 'TVA applicable au 1er janvier';
    detailFr = `Le seuil de base a été dépassé l'an dernier. La TVA s'appliquera à partir du ${fmt(status.effectiveFrom)}.`;
  } else if (current > FRANCHISE_THRESHOLD_GOODS) {
    level = 'warning';
    headlineFr = 'Seuil de base dépassé';
    detailFr = "Au-delà de 93 500 € cette année, la TVA s'applique rétroactivement au 1er du mois concerné.";
  }

  return {
    status,
    currentYearRevenueCents: current,
    previousYearRevenueCents: previous,
    baseThreshold: FRANCHISE_THRESHOLD_GOODS,
    majoreThreshold: FRANCHISE_THRESHOLD_GOODS_MAJORE,
    progress: Math.min(1, current / FRANCHISE_THRESHOLD_GOODS_MAJORE),
    level,
    headlineFr,
    detailFr,
  };
}

export async function getDashboard() {
  const shop = await prisma.shopSettings.findUnique({ where: { id: 1 } });
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + EXPIRY_WARNING_DAYS);
  const now = new Date();

  const [products, totalProducts, activeProducts, expiringSoon, expired, ordersToPrepare] =
    await Promise.all([
      prisma.product.findMany(),
      prisma.product.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.stockBatch.count({
        where: { durabilityDate: { gt: now, lte: horizon }, quantityOnHand: { gt: 0 } },
      }),
      prisma.stockBatch.count({
        where: { durabilityDate: { lte: now }, quantityOnHand: { gt: 0 } },
      }),
      prisma.order.count({ where: { status: { in: ['PAID', 'PREPARING'] } } }),
    ]);

  // Products whose listing would fail the art. 14 gate if published.
  const nonCompliant = products.filter((p) => complianceIssuesFor(p, shop).length > 0);

  // Sellable units per product, counting only in-date batches.
  const stockRows = await prisma.stockBatch.groupBy({
    by: ['productId'],
    where: { durabilityDate: { gt: now } },
    _sum: { quantityOnHand: true },
  });
  const stockByProduct = new Map(stockRows.map((r) => [r.productId, r._sum.quantityOnHand ?? 0]));
  const lowStock = products.filter(
    (p) => p.isActive && (stockByProduct.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD,
  );

  return {
    shop,
    vat: buildVatMonitor(shop),
    totalProducts,
    activeProducts,
    nonCompliant,
    lowStock,
    expiringSoon,
    expired,
    ordersToPrepare,
  };
}
