'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { prisma } from '@souk/db';

const CART_COOKIE = 'souk_cart';
const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
/** Guard against a typo or a script turning into a 900-jar order. */
const MAX_QUANTITY_PER_LINE = 50;

async function getOrCreateCart(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;

  if (existing) {
    const found = await prisma.cart.findUnique({ where: { sessionToken: existing } });
    if (found) return found.id;
  }

  const token = randomUUID();
  const cart = await prisma.cart.create({ data: { sessionToken: token } });
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: CART_MAX_AGE_SECONDS,
    path: '/',
  });
  return cart.id;
}

export async function addToCart(productId: string, quantity = 1): Promise<void> {
  // Never trust a quantity from the client.
  const qty = Math.min(Math.max(1, Math.trunc(quantity)), MAX_QUANTITY_PER_LINE);

  // Only a published product may enter a basket.
  const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
  if (!product) throw new Error('Produit indisponible');

  const cartId = await getOrCreateCart();
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId, productId } },
  });

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId, productId } },
    update: { quantity: Math.min((existing?.quantity ?? 0) + qty, MAX_QUANTITY_PER_LINE) },
    create: { cartId, productId, quantity: qty },
  });

  revalidatePath('/panier');
  revalidatePath('/', 'layout');
}

export async function setQuantity(productId: string, quantity: number): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  const cart = await prisma.cart.findUnique({ where: { sessionToken: token } });
  if (!cart) return;

  const qty = Math.min(Math.trunc(quantity), MAX_QUANTITY_PER_LINE);

  if (qty <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    await prisma.cartItem.updateMany({
      where: { cartId: cart.id, productId },
      data: { quantity: qty },
    });
  }

  revalidatePath('/panier');
  revalidatePath('/', 'layout');
}

export async function removeFromCart(productId: string): Promise<void> {
  await setQuantity(productId, 0);
}
