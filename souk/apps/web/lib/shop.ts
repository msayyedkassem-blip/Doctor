import 'server-only';
import { cookies } from 'next/headers';
import { prisma } from '@souk/db';
import {
  computeCartTotals, quoteAllShipping, type CartLineInput,
  type VatMode, type ShippingQuote,
} from '@souk/core';

/** Only ever surface products that passed the INCO publication gate. */
const ACTIVE = { isActive: true } as const;

export async function getShopSettings() {
  return prisma.shopSettings.findUnique({ where: { id: 1 } });
}

export async function getCategories() {
  return prisma.category.findMany({
    where: { products: { some: ACTIVE } },
    orderBy: { position: 'asc' },
    include: { _count: { select: { products: { where: ACTIVE } } } },
  });
}

export async function getFeaturedProducts() {
  return prisma.product.findMany({
    where: { ...ACTIVE, isFeatured: true },
    orderBy: { displayNameFr: 'asc' },
    include: { category: true },
  });
}

export async function getProductsByCategory(slug: string) {
  return prisma.product.findMany({
    where: { ...ACTIVE, category: { slug } },
    orderBy: { displayNameFr: 'asc' },
    include: { category: true },
  });
}

export async function getAllProducts() {
  return prisma.product.findMany({
    where: ACTIVE,
    orderBy: { displayNameFr: 'asc' },
    include: { category: true },
  });
}

export async function getProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { ...ACTIVE, slug },
    include: { category: true },
  });
}

/**
 * Stock actually sellable today: batches still in date, summed.
 * A batch past its durability date is not stock, it is waste.
 */
export async function getAvailableStock(productId: string): Promise<number> {
  const rows = await prisma.stockBatch.aggregate({
    where: { productId, durabilityDate: { gt: new Date() } },
    _sum: { quantityOnHand: true },
  });
  return rows._sum.quantityOnHand ?? 0;
}

/* ------------------------------------------------------------------ */
/* Cart                                                                */
/* ------------------------------------------------------------------ */

const CART_COOKIE = 'souk_cart';

/** Read the cart for this visitor, without creating one. */
export async function getCart() {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token) return null;
  return prisma.cart.findUnique({
    where: { sessionToken: token },
    include: { items: { include: { product: true } } },
  });
}

/**
 * Price the current cart through the shared engine, so the website and the
 * mobile app can never disagree about a total.
 */
export async function getCartTotals() {
  const [cart, settings] = await Promise.all([getCart(), getShopSettings()]);
  const vatMode: VatMode = settings?.vatMode ?? 'FRANCHISE';

  const lines: CartLineInput[] = (cart?.items ?? [])
    // Defensive: a product deactivated after it entered a basket must not be sold.
    .filter((item) => item.product.isActive)
    .map((item) => ({
      productId: item.productId,
      slug: item.product.slug,
      nameFr: item.product.displayNameFr,
      unitPriceCents: item.product.priceCents,
      quantity: item.quantity,
      vatCategory: item.product.vatCategory,
      shippingWeightGrams: item.product.shippingWeightGrams,
    }));

  const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const weight = lines.reduce((s, l) => s + l.shippingWeightGrams * l.quantity, 0);

  const shippingOptions: ShippingQuote[] = lines.length
    ? quoteAllShipping({ itemsWeightGrams: weight, subtotalCents: subtotal })
    : [];

  const totals = computeCartTotals({
    lines,
    shippingQuote: null, // carrier is chosen at checkout, not in the basket
    vatMode,
  });

  return { cart, totals, shippingOptions, vatMode };
}
