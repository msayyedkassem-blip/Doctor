/**
 * Mandatory food information — Regulation (EU) No 1169/2011 ("INCO").
 *
 * Article 9 lists the particulars every prepacked food must carry.
 * Article 14 is the one that governs this business: for DISTANCE SELLING,
 * all of those particulars EXCEPT the date of minimum durability must be
 * available to the customer BEFORE the purchase is concluded, on the
 * selling medium itself, at no extra cost — and ALL of them, date included,
 * must be present at the moment of delivery.
 *
 * In practice that means the product page is a regulated document, not
 * marketing copy, and `assertDistanceSellingReady` below is what stops an
 * incomplete listing from going live.
 */

import { z } from 'zod';
import { Allergen } from './allergens.js';
import { VatCategory } from './vat.js';

/* ------------------------------------------------------------------ */
/* Value objects                                                       */
/* ------------------------------------------------------------------ */

export const NetQuantityUnit = { G: 'G', KG: 'KG', ML: 'ML', L: 'L', PIECE: 'PIECE' } as const;
export type NetQuantityUnit = (typeof NetQuantityUnit)[keyof typeof NetQuantityUnit];

export const netQuantitySchema = z.object({
  value: z.number().positive(),
  unit: z.nativeEnum(NetQuantityUnit),
  /** Drained weight, for goods packed in liquid (olives, pickles, vine leaves). */
  drainedValue: z.number().positive().nullable().default(null),
});
export type NetQuantity = z.infer<typeof netQuantitySchema>;

/**
 * Nutrition declaration per 100 g / 100 ml (Art. 30). All seven fields are
 * mandatory; energy must be given in BOTH kJ and kcal.
 * Values are grams unless noted.
 */
export const nutritionSchema = z.object({
  energyKj: z.number().nonnegative(),
  energyKcal: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  saturates: z.number().nonnegative(),
  carbohydrate: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  /** Optional under Art. 30(2). */
  fibre: z.number().nonnegative().nullable().default(null),
});
export type Nutrition = z.infer<typeof nutritionSchema>;

/**
 * The food business operator whose name and address appear on the label
 * (Art. 8(1)). For goods imported from outside the EU this is the IMPORTER
 * established in the Union — i.e. this company. It is a legal
 * responsibility, not a formality: the FBO named here answers to the DDPP
 * for the conformity of the food.
 */
export const foodBusinessOperatorSchema = z.object({
  legalName: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable().default(null),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(2).default('France'),
  /** SIRET — not an INCO requirement, but required in the site's mentions légales. */
  siret: z.string().nullable().default(null),
});
export type FoodBusinessOperator = z.infer<typeof foodBusinessOperatorSchema>;

export const DurabilityKind = {
  /** DDM — "à consommer de préférence avant". Quality date. Shelf-stable goods. */
  DDM: 'DDM',
  /** DLC — "à consommer jusqu'au". Safety date. Perishables. */
  DLC: 'DLC',
} as const;
export type DurabilityKind = (typeof DurabilityKind)[keyof typeof DurabilityKind];

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

const localizedText = z.object({
  fr: z.string().min(1),
  en: z.string().default(''),
  ar: z.string().default(''),
});

export const productSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),

  /**
   * Marketing name — what the shopper recognises ("Zaatar du Liban").
   * NOT a substitute for the legal name below.
   */
  displayName: localizedText,

  /**
   * Art. 17 — the legal name of the food, or its customary/descriptive name.
   * This is the field the DDPP reads. "Mélange d'épices à base de thym,
   * sumac et graines de sésame", not "Za'atar".
   */
  legalName: z.string().min(1),

  brand: z.string().nullable().default(null),

  /** Art. 26 — country of origin, mandatory where its omission could mislead. */
  countryOfOrigin: z.string().min(2),

  /** Art. 9(1)(b) — full ingredient list, descending by weight, in French. */
  ingredientsFr: z.string().min(1),

  /**
   * Art. 9(1)(c) — declarable allergens, drawn from the closed Annex II list.
   * Must be consistent with `ingredientsFr`, where they are also emphasised.
   */
  allergens: z.array(z.nativeEnum(Allergen)).default([]),

  /**
   * Allergens from unavoidable cross-contamination ("peut contenir des
   * traces de..."). Voluntary information under Art. 36 — but once given it
   * must be accurate and not misleading.
   */
  mayContain: z.array(z.nativeEnum(Allergen)).default([]),

  /** Art. 9(1)(d) — QUID, e.g. "Sésame 35%". Null when not applicable. */
  quidFr: z.string().nullable().default(null),

  netQuantity: netQuantitySchema,
  nutrition: nutritionSchema,

  durabilityKind: z.nativeEnum(DurabilityKind).default(DurabilityKind.DDM),

  /** Art. 9(1)(g) — storage and conditions of use. */
  storageConditionsFr: z.string().min(1),
  /** Art. 9(1)(j) — instructions for use, where needed to use the food properly. */
  usageInstructionsFr: z.string().nullable().default(null),

  foodBusinessOperator: foodBusinessOperatorSchema,

  /** Stored price in cents, all taxes included (what the customer pays). */
  priceCents: z.number().int().nonnegative(),
  vatCategory: z.nativeEnum(VatCategory).default(VatCategory.FOOD_REDUCED),

  /** Gross shipping weight of one saleable unit, including its packaging. */
  shippingWeightGrams: z.number().int().positive(),

  images: z.array(z.string()).default([]),
  isActive: z.boolean().default(false),
});
export type Product = z.infer<typeof productSchema>;

/* ------------------------------------------------------------------ */
/* Distance-selling gate (Art. 14)                                     */
/* ------------------------------------------------------------------ */

export interface ComplianceIssue {
  readonly field: string;
  readonly messageFr: string;
}

/**
 * Check a product against the Art. 14(1)(a) pre-purchase duty.
 *
 * Returns the list of blocking gaps; an empty array means the listing may
 * be published. The date of minimum durability is deliberately NOT checked
 * here — Art. 14 exempts it before purchase. It is enforced instead at
 * dispatch, against the physical stock batch.
 */
export function checkDistanceSellingCompliance(product: Product): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const require = (ok: boolean, field: string, messageFr: string) => {
    if (!ok) issues.push({ field, messageFr });
  };

  require(product.legalName.trim().length > 0, 'legalName',
    "La dénomination légale de vente est obligatoire (art. 17).");
  require(product.ingredientsFr.trim().length > 0, 'ingredientsFr',
    "La liste des ingrédients est obligatoire (art. 9.1.b).");
  require(product.netQuantity.value > 0, 'netQuantity',
    "La quantité nette est obligatoire (art. 9.1.e).");
  require(product.storageConditionsFr.trim().length > 0, 'storageConditionsFr',
    "Les conditions de conservation sont obligatoires (art. 9.1.g).");
  require(product.foodBusinessOperator.legalName.trim().length > 0, 'foodBusinessOperator',
    "Le nom et l'adresse de l'exploitant (ici l'importateur) sont obligatoires (art. 8.1).");
  require(product.countryOfOrigin.trim().length > 0, 'countryOfOrigin',
    "Le pays d'origine est obligatoire pour ce produit (art. 26).");

  // Nutrition: every mandatory field must be present. Zero is a legitimate
  // value, so presence is what is checked, not truthiness.
  const n = product.nutrition;
  const nutritionComplete = [
    n.energyKj, n.energyKcal, n.fat, n.saturates,
    n.carbohydrate, n.sugars, n.protein, n.salt,
  ].every((v) => typeof v === 'number' && Number.isFinite(v));
  require(nutritionComplete, 'nutrition',
    "La déclaration nutritionnelle complète pour 100 g/ml est obligatoire (art. 30).");

  // Cheap consistency check: an ingredient text naming sesame while the
  // allergen list omits it is the commonest labelling defect in this catalogue.
  if (/sésame|sesame|tahin/i.test(product.ingredientsFr) && !product.allergens.includes(Allergen.SESAME)) {
    issues.push({
      field: 'allergens',
      messageFr: "Les ingrédients mentionnent du sésame mais l'allergène SESAME n'est pas déclaré.",
    });
  }

  return issues;
}

/** Throwing variant, for use at the publish/activate boundary. */
export function assertDistanceSellingReady(product: Product): void {
  const issues = checkDistanceSellingCompliance(product);
  if (issues.length > 0) {
    throw new Error(
      `Produit non conforme INCO (${issues.length}) : ` +
        issues.map((i) => `${i.field} — ${i.messageFr}`).join(' | '),
    );
  }
}
