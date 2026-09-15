/**
 * The 14 substances of Annex II to Regulation (EU) No 1169/2011.
 *
 * This list is closed: it is set by EU law and must not be extended or
 * trimmed. Anything else a customer reacts to is not a legal "allergen"
 * and belongs in the free-text ingredient list.
 */

export const Allergen = {
  GLUTEN: 'GLUTEN',
  CRUSTACEANS: 'CRUSTACEANS',
  EGGS: 'EGGS',
  FISH: 'FISH',
  PEANUTS: 'PEANUTS',
  SOYBEANS: 'SOYBEANS',
  MILK: 'MILK',
  NUTS: 'NUTS',
  CELERY: 'CELERY',
  MUSTARD: 'MUSTARD',
  SESAME: 'SESAME',
  SULPHITES: 'SULPHITES',
  LUPIN: 'LUPIN',
  MOLLUSCS: 'MOLLUSCS',
} as const;
export type Allergen = (typeof Allergen)[keyof typeof Allergen];

export const ALL_ALLERGENS: readonly Allergen[] = Object.freeze(
  Object.values(Allergen) as Allergen[],
);

interface AllergenLabel {
  readonly fr: string;
  readonly en: string;
  readonly ar: string;
}

/**
 * Display names. French is the legally operative one for the French market;
 * English and Arabic are a courtesy for the diaspora audience and carry no
 * legal weight.
 */
export const ALLERGEN_LABELS: Readonly<Record<Allergen, AllergenLabel>> = Object.freeze({
  GLUTEN: { fr: 'Céréales contenant du gluten', en: 'Cereals containing gluten', ar: 'حبوب تحتوي على الغلوتين' },
  CRUSTACEANS: { fr: 'Crustacés', en: 'Crustaceans', ar: 'القشريات' },
  EGGS: { fr: 'Œufs', en: 'Eggs', ar: 'البيض' },
  FISH: { fr: 'Poissons', en: 'Fish', ar: 'الأسماك' },
  PEANUTS: { fr: 'Arachides', en: 'Peanuts', ar: 'الفول السوداني' },
  SOYBEANS: { fr: 'Soja', en: 'Soybeans', ar: 'الصويا' },
  MILK: { fr: 'Lait (y compris lactose)', en: 'Milk (including lactose)', ar: 'الحليب' },
  NUTS: { fr: 'Fruits à coque', en: 'Tree nuts', ar: 'المكسرات' },
  CELERY: { fr: 'Céleri', en: 'Celery', ar: 'الكرفس' },
  MUSTARD: { fr: 'Moutarde', en: 'Mustard', ar: 'الخردل' },
  SESAME: { fr: 'Graines de sésame', en: 'Sesame seeds', ar: 'بذور السمسم' },
  SULPHITES: { fr: 'Anhydride sulfureux et sulfites', en: 'Sulphur dioxide and sulphites', ar: 'ثاني أكسيد الكبريت والكبريتيت' },
  LUPIN: { fr: 'Lupin', en: 'Lupin', ar: 'الترمس' },
  MOLLUSCS: { fr: 'Mollusques', en: 'Molluscs', ar: 'الرخويات' },
});

/**
 * Sulphites are only a declarable allergen above 10 mg/kg (or 10 mg/l),
 * expressed as total SO2. Below that they are an ordinary ingredient.
 * Relevant here for dried apricots, dried figs and some pickles.
 */
export const SULPHITE_DECLARATION_THRESHOLD_MG_PER_KG = 10;

/**
 * Tree nuts that count as FRUITS À COQUE under Annex II.
 *
 * Deliberately closed: pine nuts (pignons) and coconut are *not* on the EU
 * list even though shoppers often assume they are. Pine nuts matter for a
 * Lebanese catalogue — they appear in sfiha, kibbeh and many sweets — so if
 * you want to warn about them, do it in the ingredient text, not here.
 */
export const DECLARABLE_TREE_NUTS = Object.freeze([
  'amandes',
  'noisettes',
  'noix',
  'noix de cajou',
  'noix de pécan',
  'noix du Brésil',
  'pistaches',
  'noix de Macadamia',
] as const);

export function allergenLabel(allergen: Allergen, locale: 'fr' | 'en' | 'ar' = 'fr'): string {
  return ALLERGEN_LABELS[allergen][locale];
}
