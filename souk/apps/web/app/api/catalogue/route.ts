import { NextResponse } from 'next/server';
import { prisma } from '@souk/db';

export const dynamic = 'force-dynamic';

/**
 * Catalogue feed for the mobile app.
 *
 * Returns only products that passed the INCO publication gate, and carries
 * the full regulated payload — allergens, nutrition, legal name, operator —
 * because art. 14 applies to the app exactly as it does to the website. A
 * trimmed "mobile-lite" payload would put the app out of compliance.
 */
export async function GET() {
  const [categories, products, shop] = await Promise.all([
    prisma.category.findMany({ orderBy: { position: 'asc' } }),
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { displayNameFr: 'asc' },
    }),
    prisma.shopSettings.findUnique({ where: { id: 1 } }),
  ]);

  const now = new Date();
  const stock = await prisma.stockBatch.groupBy({
    by: ['productId'],
    where: { durabilityDate: { gt: now } },
    _sum: { quantityOnHand: true },
  });
  const stockByProduct = new Map(stock.map((s) => [s.productId, s._sum.quantityOnHand ?? 0]));

  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      vatMode: shop?.vatMode ?? 'FRANCHISE',
      operator: shop && {
        legalName: shop.legalName,
        addressLine1: shop.addressLine1,
        addressLine2: shop.addressLine2,
        postalCode: shop.postalCode,
        city: shop.city,
        country: shop.country,
        citeoIdu: shop.citeoIdu,
      },
      categories: categories.map((c) => ({
        id: c.id, slug: c.slug, nameFr: c.nameFr, position: c.position,
      })),
      products: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        categoryId: p.categoryId,
        displayNameFr: p.displayNameFr,
        legalName: p.legalName,
        brand: p.brand,
        countryOfOrigin: p.countryOfOrigin,
        descriptionFr: p.descriptionFr,
        ingredientsFr: p.ingredientsFr,
        allergens: p.allergens,
        mayContain: p.mayContain,
        quidFr: p.quidFr,
        netQuantityValue: p.netQuantityValue,
        netQuantityUnit: p.netQuantityUnit,
        netQuantityDrained: p.netQuantityDrained,
        nutrition: {
          energyKj: p.energyKj, energyKcal: p.energyKcal,
          fat: p.fat, saturates: p.saturates,
          carbohydrate: p.carbohydrate, sugars: p.sugars,
          protein: p.protein, salt: p.salt, fibre: p.fibre,
        },
        durabilityKind: p.durabilityKind,
        storageConditionsFr: p.storageConditionsFr,
        usageInstructionsFr: p.usageInstructionsFr,
        priceCents: p.priceCents,
        vatCategory: p.vatCategory,
        shippingWeightGrams: p.shippingWeightGrams,
        inStock: (stockByProduct.get(p.id) ?? 0) > 0,
      })),
    },
    {
      headers: {
        // The app caches locally; a short shared cache is enough.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
