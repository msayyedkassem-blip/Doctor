/**
 * Seeds the shop with its legal identity and a starter catalogue.
 *
 * Idempotent: safe to re-run. Products are upserted by slug.
 *
 * Note the publication gate at the end — a product is only made active if
 * it passes the art. 14 distance-selling check from @souk/core. The seed
 * exercises the same gate the admin will, so an incomplete listing can
 * never reach the storefront, even from a script.
 */

import { PrismaClient } from '@prisma/client';
import {
  checkDistanceSellingCompliance,
  productSchema,
  type Product as CoreProduct,
} from '@souk/core';
import { CATEGORIES, PRODUCTS, type SeedProduct } from './catalogue.ts';

const prisma = new PrismaClient();

/** Placeholder legal identity — replace with the real company details. */
const SHOP = {
  legalName: 'SOUK IMPORT',
  addressLine1: '1 rue de Paris',
  addressLine2: null,
  postalCode: '75001',
  city: 'Paris',
  country: 'France',
  siret: null,
  vatNumber: null,
  citeoIdu: null,
  contactEmail: 'contact@example.com',
  contactPhone: null,
} as const;

/**
 * Re-shape a seed row into the core Product so the compliance checker can
 * read it. The food business operator is shop-level, so it is injected here
 * rather than duplicated on every row.
 */
function toCoreProduct(seed: SeedProduct, id: string): CoreProduct {
  return productSchema.parse({
    id,
    slug: seed.slug,
    displayName: { fr: seed.displayNameFr, en: seed.displayNameEn, ar: seed.displayNameAr },
    legalName: seed.legalName,
    brand: seed.brand,
    countryOfOrigin: seed.countryOfOrigin,
    ingredientsFr: seed.ingredientsFr,
    allergens: seed.allergens,
    mayContain: seed.mayContain,
    quidFr: seed.quidFr,
    netQuantity: {
      value: seed.netQuantityValue,
      unit: seed.netQuantityUnit,
      drainedValue: seed.netQuantityDrained,
    },
    nutrition: {
      energyKj: seed.energyKj, energyKcal: seed.energyKcal,
      fat: seed.fat, saturates: seed.saturates,
      carbohydrate: seed.carbohydrate, sugars: seed.sugars,
      protein: seed.protein, salt: seed.salt, fibre: seed.fibre,
    },
    durabilityKind: seed.durabilityKind,
    storageConditionsFr: seed.storageConditionsFr,
    usageInstructionsFr: seed.usageInstructionsFr,
    foodBusinessOperator: {
      legalName: SHOP.legalName,
      addressLine1: SHOP.addressLine1,
      addressLine2: SHOP.addressLine2,
      postalCode: SHOP.postalCode,
      city: SHOP.city,
      country: SHOP.country,
      siret: SHOP.siret,
    },
    priceCents: seed.priceCents,
    vatCategory: seed.vatCategory,
    shippingWeightGrams: seed.shippingWeightGrams,
    images: [],
    isActive: false,
  });
}

async function main(): Promise<void> {
  console.log('Seeding…\n');

  await prisma.shopSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...SHOP },
  });
  console.log(`  shop      ${SHOP.legalName}`);

  const supplier = await prisma.supplier.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Fournisseur Beyrouth (à remplacer)',
      country: 'Liban',
    },
  });

  const categoryIdBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameFr: c.nameFr, nameEn: c.nameEn, nameAr: c.nameAr, position: c.position },
      create: { slug: c.slug, nameFr: c.nameFr, nameEn: c.nameEn, nameAr: c.nameAr, position: c.position },
    });
    categoryIdBySlug.set(c.slug, row.id);
  }
  console.log(`  categories ${CATEGORIES.length}`);

  let activated = 0;
  const blocked: { slug: string; reasons: string[] }[] = [];

  for (const seed of PRODUCTS) {
    const categoryId = categoryIdBySlug.get(seed.categorySlug) ?? null;

    const data = {
      displayNameFr: seed.displayNameFr,
      displayNameEn: seed.displayNameEn,
      displayNameAr: seed.displayNameAr,
      legalName: seed.legalName,
      brand: seed.brand,
      countryOfOrigin: seed.countryOfOrigin,
      descriptionFr: seed.descriptionFr,
      ingredientsFr: seed.ingredientsFr,
      allergens: seed.allergens,
      mayContain: seed.mayContain,
      quidFr: seed.quidFr,
      netQuantityValue: seed.netQuantityValue,
      netQuantityUnit: seed.netQuantityUnit,
      netQuantityDrained: seed.netQuantityDrained,
      energyKj: seed.energyKj, energyKcal: seed.energyKcal,
      fat: seed.fat, saturates: seed.saturates,
      carbohydrate: seed.carbohydrate, sugars: seed.sugars,
      protein: seed.protein, salt: seed.salt, fibre: seed.fibre,
      durabilityKind: seed.durabilityKind,
      storageConditionsFr: seed.storageConditionsFr,
      usageInstructionsFr: seed.usageInstructionsFr,
      priceCents: seed.priceCents,
      vatCategory: seed.vatCategory,
      shippingWeightGrams: seed.shippingWeightGrams,
      isFeatured: seed.isFeatured,
      categoryId,
      supplierId: supplier.id,
    };

    const product = await prisma.product.upsert({
      where: { slug: seed.slug },
      update: data,
      create: { slug: seed.slug, ...data },
    });

    // The publication gate: art. 14 requires every mandatory particular
    // except the durability date to be present BEFORE purchase.
    const issues = checkDistanceSellingCompliance(toCoreProduct(seed, product.id));
    if (issues.length === 0) {
      await prisma.product.update({ where: { id: product.id }, data: { isActive: true } });
      activated += 1;
    } else {
      await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
      blocked.push({ slug: seed.slug, reasons: issues.map((i) => `${i.field}: ${i.messageFr}`) });
    }

    // One opening stock batch per product so the storefront has something to
    // sell. Lot numbers and dates are placeholders — replace them with the
    // figures on the cartons when the first container clears customs.
    const durabilityDate = new Date();
    durabilityDate.setUTCFullYear(durabilityDate.getUTCFullYear() + 1);

    const existingBatch = await prisma.stockBatch.findFirst({
      where: { productId: product.id, lotNumber: 'SEED-LOT-001' },
    });
    if (!existingBatch) {
      await prisma.stockBatch.create({
        data: {
          productId: product.id,
          supplierId: supplier.id,
          lotNumber: 'SEED-LOT-001',
          durabilityDate,
          quantityOnHand: 40,
          // Landed cost left at zero on purpose: filling it with invented
          // figures would make the margin report confidently wrong.
        },
      });
    }
  }

  console.log(`  products   ${activated} active, ${blocked.length} blocked\n`);

  if (blocked.length > 0) {
    console.log('Blocked by the INCO gate:');
    for (const b of blocked) {
      console.log(`  ${b.slug}`);
      for (const r of b.reasons) console.log(`     - ${r}`);
    }
    console.log('');
  }

  console.log('Reminder: the nutrition and ingredient data is INDICATIVE.');
  console.log('Replace every value with the figures printed on the pack before selling.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
