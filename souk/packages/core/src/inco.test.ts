import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Allergen } from './allergens.js';
import { VatCategory } from './vat.js';
import { productSchema, checkDistanceSellingCompliance, assertDistanceSellingReady, type Product } from './inco.js';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'tahini-al-wadi-450g',
  displayName: { fr: 'Tahini Al Wadi 450 g', en: 'Al Wadi Tahini 450 g', ar: 'طحينة الوادي ٤٥٠ غ' },
  legalName: 'Purée de graines de sésame décortiquées grillées',
  brand: 'Al Wadi Al Akhdar',
  countryOfOrigin: 'Liban',
  ingredientsFr: 'Graines de sésame décortiquées grillées 100%.',
  allergens: [Allergen.SESAME],
  mayContain: [Allergen.NUTS],
  quidFr: 'Sésame 100%',
  netQuantity: { value: 450, unit: 'G', drainedValue: null },
  nutrition: {
    energyKj: 2614, energyKcal: 631, fat: 54, saturates: 7.6,
    carbohydrate: 10, sugars: 0.5, protein: 21, salt: 0.02, fibre: 9.3,
  },
  durabilityKind: 'DDM',
  storageConditionsFr: 'À conserver dans un endroit frais et sec. Remuer avant emploi.',
  usageInstructionsFr: null,
  foodBusinessOperator: {
    legalName: 'SOUK IMPORT', addressLine1: '12 rue de la Paix', addressLine2: null,
    postalCode: '75002', city: 'Paris', country: 'France', siret: '00000000000000',
  },
  priceCents: 590,
  vatCategory: VatCategory.FOOD_REDUCED,
  shippingWeightGrams: 500,
  images: [],
  isActive: true,
} as const;

const validProduct: Product = productSchema.parse(base);

describe('checkDistanceSellingCompliance', () => {
  it('passes a fully documented product', () => {
    assert.deepEqual(checkDistanceSellingCompliance(validProduct), []);
  });

  it('does NOT require the durability date before purchase (art. 14 exempts it)', () => {
    // The schema carries no pre-purchase date field at all; the product is
    // compliant without one. The date is enforced at dispatch, per batch.
    assert.equal('durabilityDate' in validProduct, false);
    assert.deepEqual(checkDistanceSellingCompliance(validProduct), []);
  });

  it('flags a missing legal name', () => {
    const issues = checkDistanceSellingCompliance({ ...validProduct, legalName: '  ' });
    assert.ok(issues.some((i) => i.field === 'legalName'));
  });

  it('flags a missing ingredient list', () => {
    const issues = checkDistanceSellingCompliance({ ...validProduct, ingredientsFr: '' });
    assert.ok(issues.some((i) => i.field === 'ingredientsFr'));
  });

  it('catches sesame in the ingredients but absent from the allergen list', () => {
    const issues = checkDistanceSellingCompliance({ ...validProduct, allergens: [] });
    assert.ok(issues.some((i) => i.field === 'allergens'));
  });

  it('accepts a zero nutrition value as declared, not missing', () => {
    const zeroed = { ...validProduct, nutrition: { ...validProduct.nutrition, sugars: 0, salt: 0 } };
    assert.deepEqual(checkDistanceSellingCompliance(zeroed), []);
  });

  it('assertDistanceSellingReady throws with every gap listed', () => {
    const broken = { ...validProduct, legalName: '', ingredientsFr: '' };
    assert.throws(() => assertDistanceSellingReady(broken), /non conforme INCO \(2\)/);
  });
});
