import { PrismaClient } from '@prisma/client';
import {
  checkDistanceSellingCompliance, productSchema,
  computeCartTotals, quoteAllShipping, quoteShipping, ShippingMethod,
  VatMode, formatCents, evaluateFranchise, euros,
} from '@souk/core';

const prisma = new PrismaClient();

const counts = {
  categories: await prisma.category.count(),
  products: await prisma.product.count(),
  active: await prisma.product.count({ where: { isActive: true } }),
  batches: await prisma.stockBatch.count(),
};
console.log('rows:', counts);

// --- negative test: does the INCO gate actually block? ---------------
const good = await prisma.product.findFirstOrThrow({ where: { slug: 'tahini-450g' } });
const asCore = (p: typeof good, overrides: Record<string, unknown> = {}) => productSchema.parse({
  id: p.id, slug: p.slug,
  displayName: { fr: p.displayNameFr, en: p.displayNameEn, ar: p.displayNameAr },
  legalName: p.legalName, brand: p.brand, countryOfOrigin: p.countryOfOrigin,
  ingredientsFr: p.ingredientsFr, allergens: p.allergens, mayContain: p.mayContain, quidFr: p.quidFr,
  netQuantity: { value: p.netQuantityValue, unit: p.netQuantityUnit, drainedValue: p.netQuantityDrained },
  nutrition: { energyKj: p.energyKj, energyKcal: p.energyKcal, fat: p.fat, saturates: p.saturates,
    carbohydrate: p.carbohydrate, sugars: p.sugars, protein: p.protein, salt: p.salt, fibre: p.fibre },
  durabilityKind: p.durabilityKind, storageConditionsFr: p.storageConditionsFr,
  usageInstructionsFr: p.usageInstructionsFr,
  foodBusinessOperator: { legalName: 'SOUK IMPORT', addressLine1: '1 rue de Paris', addressLine2: null,
    postalCode: '75001', city: 'Paris', country: 'France', siret: null },
  priceCents: p.priceCents, vatCategory: p.vatCategory,
  shippingWeightGrams: p.shippingWeightGrams, images: [], isActive: true,
  ...overrides,
});

console.log('\ngate on a good product :', checkDistanceSellingCompliance(asCore(good)).length, 'issues');
const stripped = checkDistanceSellingCompliance(asCore(good, { legalName: 'x', allergens: [] }));
console.log('gate with sesame undeclared:', stripped.length, 'issue(s)');
for (const i of stripped) console.log('   ->', i.field, '|', i.messageFr);

// --- end-to-end basket from real rows -------------------------------
const picks = await prisma.product.findMany({
  where: { slug: { in: ['tahini-450g', 'huile-olive-750ml', 'halva-pistache-400g'] } },
});
const lines = picks.map((p) => ({
  productId: p.id, slug: p.slug, nameFr: p.displayNameFr,
  unitPriceCents: p.priceCents, quantity: p.slug === 'tahini-450g' ? 2 : 1,
  vatCategory: p.vatCategory, shippingWeightGrams: p.shippingWeightGrams,
}));

const weight = lines.reduce((s, l) => s + l.shippingWeightGrams * l.quantity, 0);
const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

console.log('\nbasket:', lines.map((l) => `${l.quantity}x ${l.nameFr}`).join(' + '));
console.log('weight:', weight, 'g   subtotal:', formatCents(subtotal));
console.log('\nshipping options:');
for (const q of quoteAllShipping({ itemsWeightGrams: weight, subtotalCents: subtotal })) {
  console.log(`   ${q.labelFr.padEnd(34)} ${formatCents(q.priceCents).padStart(9)}  J+${q.minBusinessDays}–${q.maxBusinessDays}  (${q.billableGrams} g, ${q.parcelCount} colis)`);
}

const relay = quoteShipping({ method: ShippingMethod.MONDIAL_RELAY_POINT, itemsWeightGrams: weight, subtotalCents: subtotal });
for (const mode of [VatMode.FRANCHISE, VatMode.STANDARD] as const) {
  const t = computeCartTotals({ lines, shippingQuote: relay, vatMode: mode });
  console.log(`\n--- ${mode} ---`);
  console.log('  sous-total', formatCents(t.subtotalCents), ' livraison', formatCents(t.shippingCents), ' TOTAL', formatCents(t.totalCents));
  if (t.vatBreakdown.length === 0) console.log('  (aucune ligne de TVA — TVA non applicable, art. 293 B du CGI)');
  for (const r of t.vatBreakdown) {
    console.log(`  TVA ${(r.rateBasisPoints / 100).toFixed(1)}% sur ${formatCents(r.netCents)} = ${formatCents(r.vatCents)}`);
  }
}

const status = evaluateFranchise({ currentYearRevenue: euros(81_000), previousYearRevenue: euros(40_000), asOf: new Date('2026-09-14') });
console.log('\nfranchise @ 81 000 € CA:', status.kind, status.kind === 'WITHIN' ? `headroom ${formatCents(status.headroom)}` : '');

await prisma.$disconnect();
