'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@souk/db';
import { ALL_ALLERGENS } from '@souk/core';
import { isAuthenticated } from '~/lib/auth';
import { complianceIssuesFor } from '~/lib/admin';

/** Every mutation re-checks the session: a server action is a public endpoint. */
async function requireAdmin(): Promise<void> {
  if (!(await isAuthenticated())) throw new Error('Non autorisé');
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

/** Accepts French decimal commas — the operator types 0,5 not 0.5. */
const decimal = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const cleaned = v.trim().replace(',', '.');
  return cleaned === '' ? undefined : Number(cleaned);
}, z.number().nonnegative());

const optionalDecimal = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return Number(v.trim().replace(',', '.'));
}, z.number().nonnegative().nullable());

/** Money arrives as euros and is stored as integer cents. */
const euroToCents = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}, z.number().int().nonnegative());

const text = (min = 1) => z.string().trim().min(min);
const nullableText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().nullable(),
);

const productInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalide (minuscules et tirets)'),
  displayNameFr: text(),
  displayNameEn: z.string().trim().default(''),
  displayNameAr: z.string().trim().default(''),
  legalName: text(),
  brand: nullableText,
  countryOfOrigin: text(),
  descriptionFr: z.string().trim().default(''),
  ingredientsFr: text(),
  quidFr: nullableText,
  netQuantityValue: decimal,
  netQuantityUnit: z.enum(['G', 'KG', 'ML', 'L', 'PIECE']),
  netQuantityDrained: optionalDecimal,
  energyKj: decimal, energyKcal: decimal,
  fat: decimal, saturates: decimal,
  carbohydrate: decimal, sugars: decimal,
  protein: decimal, salt: decimal,
  fibre: optionalDecimal,
  durabilityKind: z.enum(['DDM', 'DLC']),
  storageConditionsFr: text(),
  usageInstructionsFr: nullableText,
  priceCents: euroToCents,
  vatCategory: z.enum(['FOOD_REDUCED', 'CONFECTIONERY', 'NON_FOOD']),
  shippingWeightGrams: z.coerce.number().int().positive(),
  categoryId: nullableText,
  isFeatured: z.coerce.boolean().default(false),
});

function readProductForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const allergenSet = new Set(formData.getAll('allergens').map(String));
  const mayContainSet = new Set(formData.getAll('mayContain').map(String));

  return {
    ...productInput.parse({ ...raw, isFeatured: formData.get('isFeatured') === 'on' }),
    allergens: ALL_ALLERGENS.filter((a) => allergenSet.has(a)),
    mayContain: ALL_ALLERGENS.filter((a) => mayContainSet.has(a)),
  };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export async function saveProduct(
  productId: string | null,
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  let data;
  try {
    data = readProductForm(formData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return { ok: false, error: `${first?.path.join('.') ?? 'champ'} : ${first?.message ?? 'invalide'}` };
    }
    throw error;
  }

  // Slug is the public URL and must stay unique.
  const clash = await prisma.product.findFirst({
    where: { slug: data.slug, ...(productId ? { NOT: { id: productId } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: `Le slug « ${data.slug} » est déjà utilisé.` };

  const saved = productId
    ? await prisma.product.update({ where: { id: productId }, data })
    : await prisma.product.create({ data });

  // A product that no longer passes the art. 14 gate must come offline
  // immediately — editing a live listing into non-compliance is the likeliest
  // way this happens.
  const shop = await prisma.shopSettings.findUnique({ where: { id: 1 } });
  if (saved.isActive && complianceIssuesFor(saved, shop).length > 0) {
    await prisma.product.update({ where: { id: saved.id }, data: { isActive: false } });
  }

  revalidatePath('/admin/produits');
  revalidatePath('/', 'layout');

  if (!productId) redirect(`/admin/produits/${saved.id}`);
  return { ok: true };
}

/** Publish or unpublish. Publishing runs the compliance gate first. */
export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();

  const [product, shop] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.shopSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!product) return { ok: false, error: 'Produit introuvable' };

  if (active) {
    const issues = complianceIssuesFor(product, shop);
    if (issues.length > 0) {
      return {
        ok: false,
        error: `Publication impossible — ${issues.length} mention(s) obligatoire(s) manquante(s).`,
      };
    }
  }

  await prisma.product.update({ where: { id: productId }, data: { isActive: active } });
  revalidatePath('/admin/produits');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Stock batches                                                       */
/* ------------------------------------------------------------------ */

const batchInput = z.object({
  productId: z.string().uuid(),
  lotNumber: text(),
  durabilityDate: z.coerce.date(),
  quantityOnHand: z.coerce.number().int().nonnegative(),
  supplierCostCents: euroToCents,
  freightShareCents: euroToCents,
  customsDutyCents: euroToCents,
  importVatCents: euroToCents,
  otherCostsCents: euroToCents,
  originProofRef: nullableText,
});

export async function createBatch(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  try {
    const data = batchInput.parse(Object.fromEntries(formData.entries()));
    await prisma.stockBatch.create({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return { ok: false, error: `${first?.path.join('.') ?? 'champ'} : ${first?.message ?? 'invalide'}` };
    }
    throw error;
  }

  revalidatePath('/admin/stock');
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function adjustBatchQuantity(batchId: string, quantity: number): Promise<ActionResult> {
  await requireAdmin();
  await prisma.stockBatch.update({
    where: { id: batchId },
    data: { quantityOnHand: Math.max(0, Math.trunc(quantity)) },
  });
  revalidatePath('/admin/stock');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Shop settings                                                       */
/* ------------------------------------------------------------------ */

const settingsInput = z.object({
  legalName: text(),
  addressLine1: text(),
  addressLine2: nullableText,
  postalCode: text(),
  city: text(),
  country: text(),
  siret: nullableText,
  vatNumber: nullableText,
  citeoIdu: nullableText,
  contactEmail: z.string().trim().email(),
  contactPhone: nullableText,
  vatMode: z.enum(['FRANCHISE', 'STANDARD']),
  vatSwitchStrategy: z.enum(['ABSORB', 'PASS_THROUGH']),
  currentYearRevenueCents: euroToCents,
  previousYearRevenueCents: euroToCents,
});

export async function saveSettings(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  try {
    const data = settingsInput.parse(Object.fromEntries(formData.entries()));
    await prisma.shopSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return { ok: false, error: `${first?.path.join('.') ?? 'champ'} : ${first?.message ?? 'invalide'}` };
    }
    throw error;
  }

  revalidatePath('/admin', 'layout');
  revalidatePath('/', 'layout');
  return { ok: true };
}
