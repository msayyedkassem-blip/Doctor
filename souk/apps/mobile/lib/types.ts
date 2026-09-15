import type { Allergen, VatCategory } from '@souk/core';

export interface ApiProduct {
  id: string;
  slug: string;
  categoryId: string | null;
  displayNameFr: string;
  legalName: string;
  brand: string | null;
  countryOfOrigin: string;
  descriptionFr: string;
  ingredientsFr: string;
  allergens: Allergen[];
  mayContain: Allergen[];
  quidFr: string | null;
  netQuantityValue: number;
  netQuantityUnit: string;
  netQuantityDrained: number | null;
  nutrition: {
    energyKj: number; energyKcal: number;
    fat: number; saturates: number;
    carbohydrate: number; sugars: number;
    protein: number; salt: number; fibre: number | null;
  };
  durabilityKind: 'DDM' | 'DLC';
  storageConditionsFr: string;
  usageInstructionsFr: string | null;
  priceCents: number;
  vatCategory: VatCategory;
  shippingWeightGrams: number;
  inStock: boolean;
}

export interface ApiCategory {
  id: string; slug: string; nameFr: string; position: number;
}

export interface ApiOperator {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
  citeoIdu: string | null;
}

export interface Catalogue {
  generatedAt: string;
  vatMode: 'FRANCHISE' | 'STANDARD';
  operator: ApiOperator | null;
  categories: ApiCategory[];
  products: ApiProduct[];
}
