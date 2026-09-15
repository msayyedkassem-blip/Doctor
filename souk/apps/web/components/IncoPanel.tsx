import type { Product, ShopSettings } from '@souk/db';
import { AllergenBadges } from './AllergenBadges';
import { emphasiseAllergens, netQuantity, num } from '~/lib/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-[15px] leading-relaxed">{children}</dd>
    </div>
  );
}

/** Per 100 g / 100 ml, in the order and wording required by art. 30. */
function NutritionTable({ p }: { p: Product }) {
  const unit = p.netQuantityUnit === 'ML' || p.netQuantityUnit === 'L' ? '100 ml' : '100 g';
  const rows: [string, string, boolean][] = [
    ['Énergie', `${num(Math.round(p.energyKj))} kJ / ${num(Math.round(p.energyKcal))} kcal`, false],
    ['Matières grasses', `${num(p.fat)} g`, false],
    ['dont acides gras saturés', `${num(p.saturates)} g`, true],
    ['Glucides', `${num(p.carbohydrate)} g`, false],
    ['dont sucres', `${num(p.sugars)} g`, true],
    ...(p.fibre !== null
      ? ([['Fibres alimentaires', `${num(p.fibre)} g`, false]] as [string, string, boolean][])
      : []),
    ['Protéines', `${num(p.protein)} g`, false],
    ['Sel', `${num(p.salt)} g`, false],
  ];

  return (
    <table className="w-full max-w-md text-[15px]">
      <caption className="mb-2 text-left text-sm text-muted">
        Valeurs nutritionnelles moyennes pour {unit}
      </caption>
      <tbody>
        {rows.map(([label, value, indent]) => (
          <tr key={label} className="border-b border-line/70 last:border-0">
            <th scope="row" className={`py-1.5 text-left font-normal ${indent ? 'pl-5 text-muted' : ''}`}>
              {label}
            </th>
            <td className="py-1.5 text-right tabular-nums">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The mandatory particulars of Reg. (EU) 1169/2011.
 *
 * Art. 14 requires all of these to be available BEFORE the purchase is
 * concluded — so this panel is part of the offer, not supplementary detail.
 * It is rendered server-side and never hidden behind a tab that requires
 * JavaScript to open.
 *
 * The durability date is deliberately absent: art. 14 exempts it before
 * purchase, and it is printed on the pack the customer receives.
 */
export function IncoPanel({ product, shop }: { product: Product; shop: ShopSettings | null }) {
  return (
    <section aria-labelledby="inco-heading" className="mt-12">
      <h2 id="inco-heading" className="font-display text-2xl">
        Informations réglementaires
      </h2>
      <p className="mt-1 mb-2 text-sm text-muted">
        Informations obligatoires sur les denrées alimentaires — règlement (UE) n° 1169/2011.
      </p>

      <dl>
        <Row label="Dénomination légale de vente">{product.legalName}</Row>

        <Row label="Liste des ingrédients">
          <p
            className="ingredients"
            dangerouslySetInnerHTML={{ __html: emphasiseAllergens(product.ingredientsFr) }}
          />
          {product.quidFr && <p className="mt-2 text-sm text-muted">{product.quidFr}</p>}
        </Row>

        <Row label="Allergènes">
          <AllergenBadges
            allergens={product.allergens}
            mayContain={product.mayContain}
          />
        </Row>

        <Row label="Quantité nette">
          {netQuantity(product.netQuantityValue, product.netQuantityUnit, product.netQuantityDrained)}
        </Row>

        <Row label="Déclaration nutritionnelle">
          <NutritionTable p={product} />
        </Row>

        <Row label="Conditions de conservation">{product.storageConditionsFr}</Row>

        {product.usageInstructionsFr && (
          <Row label="Conseils d'utilisation">{product.usageInstructionsFr}</Row>
        )}

        <Row label="Pays d'origine">{product.countryOfOrigin}</Row>

        <Row label="Exploitant du secteur alimentaire">
          {shop ? (
            <address className="not-italic">
              {shop.legalName}
              <br />
              {shop.addressLine1}
              {shop.addressLine2 && <><br />{shop.addressLine2}</>}
              <br />
              {shop.postalCode} {shop.city}, {shop.country}
            </address>
          ) : (
            '—'
          )}
          <p className="mt-2 text-sm text-muted">
            Importateur responsable de la conformité de la denrée dans l'Union européenne.
          </p>
        </Row>

        <Row label="Date de durabilité">
          <p className="text-muted">
            {product.durabilityKind === 'DDM'
              ? "La date de durabilité minimale (« à consommer de préférence avant ») figure sur l'emballage du produit livré."
              : "La date limite de consommation (« à consommer jusqu'au ») figure sur l'emballage du produit livré."}
          </p>
        </Row>
      </dl>
    </section>
  );
}
