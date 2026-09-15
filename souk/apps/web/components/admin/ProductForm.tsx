'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ALL_ALLERGENS, ALLERGEN_LABELS, type ComplianceIssue } from '@souk/core';
import { saveProduct, type ActionResult } from '~/lib/admin-actions';
import type { Category, Product } from '@souk/db';

/* Small field primitives — plain labelled inputs, no abstraction tax. */

function Field({
  label, name, defaultValue, type = 'text', required, hint, placeholder, step, inputMode,
}: {
  label: string; name: string; defaultValue?: string | number | null;
  type?: string; required?: boolean; hint?: string; placeholder?: string; step?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">
        {label} {required && <span className="text-sumac" aria-hidden="true">*</span>}
      </span>
      <input
        name={name}
        type={type}
        step={step}
        inputMode={inputMode}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ''}
        className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function TextArea({
  label, name, defaultValue, required, hint, rows = 3,
}: {
  label: string; name: string; defaultValue?: string | null;
  required?: boolean; hint?: string; rows?: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">
        {label} {required && <span className="text-sumac" aria-hidden="true">*</span>}
      </span>
      <textarea
        name={name}
        rows={rows}
        required={required}
        defaultValue={defaultValue ?? ''}
        className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Select({
  label, name, defaultValue, options, hint,
}: {
  label: string; name: string; defaultValue?: string | null;
  options: { value: string; label: string }[]; hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="font-display text-xl">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function AllergenGrid({ name, selected, legend }: {
  name: string; selected: string[]; legend: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_ALLERGENS.map((a) => (
          <label key={a} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={a}
              defaultChecked={selected.includes(a)}
              className="size-4 rounded border-line"
            />
            {ALLERGEN_LABELS[a].fr}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */

export function ProductForm({
  product, categories, issues,
}: {
  product: Product | null;
  categories: Category[];
  issues: ComplianceIssue[];
}) {
  const save = saveProduct.bind(null, product?.id ?? null);
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    save, undefined,
  );

  return (
    <form action={formAction} className="space-y-5 pb-16">
      {/*
        The compliance gate, surfaced before the fields rather than after a
        failed save. These are the art. 14 particulars that must be on the
        page before a customer can buy.
      */}
      {issues.length > 0 && (
        <div className="rounded-xl border border-serious/40 bg-serious/10 p-4">
          <p className="font-medium text-serious">
            <span aria-hidden="true">▲</span> Fiche incomplète — publication bloquée
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {issues.map((i) => <li key={i.field}>• {i.messageFr}</li>)}
          </ul>
        </div>
      )}

      <Section
        title="Identité"
        description="La dénomination légale n'est pas le nom commercial : c'est la description réglementaire du produit."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom commercial (FR)" name="displayNameFr" required defaultValue={product?.displayNameFr} />
          <Field label="Identifiant URL (slug)" name="slug" required defaultValue={product?.slug}
            hint="Minuscules et tirets, ex. tahini-450g" />
        </div>
        <TextArea
          label="Dénomination légale de vente" name="legalName" required
          defaultValue={product?.legalName} rows={2}
          hint="Art. 17 — ex. « Mélange d'épices à base de thym, sumac et graines de sésame », pas « Zaatar »."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom (EN)" name="displayNameEn" defaultValue={product?.displayNameEn} />
          <Field label="Nom (AR)" name="displayNameAr" defaultValue={product?.displayNameAr} />
          <Field label="Marque" name="brand" defaultValue={product?.brand} />
          <Field label="Pays d'origine" name="countryOfOrigin" required
            defaultValue={product?.countryOfOrigin ?? 'Liban'} />
        </div>
        <Select
          label="Rayon" name="categoryId" defaultValue={product?.categoryId}
          options={[{ value: '', label: '— aucun —' },
            ...categories.map((c) => ({ value: c.id, label: c.nameFr }))]}
        />
        <TextArea label="Description commerciale" name="descriptionFr" defaultValue={product?.descriptionFr} />
      </Section>

      <Section
        title="Ingrédients et allergènes"
        description="Entourez chaque allergène de **deux astérisques** dans la liste : il sera mis en évidence comme l'exige l'art. 21."
      >
        <TextArea
          label="Liste des ingrédients" name="ingredientsFr" required rows={4}
          defaultValue={product?.ingredientsFr}
          hint="Par ordre de poids décroissant. Ex. : Graines de **sésame** décortiquées grillées 100 %."
        />
        <Field label="QUID" name="quidFr" defaultValue={product?.quidFr}
          hint="Pourcentage des ingrédients mis en avant, ex. « Sésame 100 % »." />
        <AllergenGrid name="allergens" legend="Contient (liste fermée des 14 allergènes)"
          selected={product?.allergens ?? []} />
        <AllergenGrid name="mayContain" legend="Peut contenir des traces de"
          selected={product?.mayContain ?? []} />
      </Section>

      <Section title="Quantité nette">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantité" name="netQuantityValue" required inputMode="decimal"
            defaultValue={product?.netQuantityValue} />
          <Select label="Unité" name="netQuantityUnit" defaultValue={product?.netQuantityUnit ?? 'G'}
            options={[
              { value: 'G', label: 'grammes' }, { value: 'KG', label: 'kilogrammes' },
              { value: 'ML', label: 'millilitres' }, { value: 'L', label: 'litres' },
              { value: 'PIECE', label: 'pièces' },
            ]} />
          <Field label="Poids net égoutté" name="netQuantityDrained"
            defaultValue={product?.netQuantityDrained}
            hint="Pour les produits en saumure ou au sirop." />
        </div>
      </Section>

      <Section
        title="Déclaration nutritionnelle"
        description="Pour 100 g ou 100 ml. Les sept premières valeurs sont obligatoires (art. 30) — une valeur nulle se saisit 0, pas vide."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Énergie (kJ)" name="energyKj" required defaultValue={product?.energyKj} />
          <Field label="Énergie (kcal)" name="energyKcal" required defaultValue={product?.energyKcal} />
          <Field label="Matières grasses (g)" name="fat" required defaultValue={product?.fat} />
          <Field label="dont saturés (g)" name="saturates" required defaultValue={product?.saturates} />
          <Field label="Glucides (g)" name="carbohydrate" required defaultValue={product?.carbohydrate} />
          <Field label="dont sucres (g)" name="sugars" required defaultValue={product?.sugars} />
          <Field label="Protéines (g)" name="protein" required defaultValue={product?.protein} />
          <Field label="Sel (g)" name="salt" required defaultValue={product?.salt} />
          <Field label="Fibres (g)" name="fibre" defaultValue={product?.fibre} hint="Facultatif." />
        </div>
      </Section>

      <Section title="Conservation">
        <Select
          label="Type de date" name="durabilityKind" defaultValue={product?.durabilityKind ?? 'DDM'}
          options={[
            { value: 'DDM', label: 'DDM — à consommer de préférence avant' },
            { value: 'DLC', label: 'DLC — à consommer jusqu\'au (périssable)' },
          ]}
          hint="La DLC exclut le produit du droit de rétractation ; la DDM ne l'exclut pas."
        />
        <TextArea label="Conditions de conservation" name="storageConditionsFr" required
          defaultValue={product?.storageConditionsFr} rows={2} />
        <TextArea label="Conseils d'utilisation" name="usageInstructionsFr"
          defaultValue={product?.usageInstructionsFr} rows={2} />
      </Section>

      <Section title="Vente">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prix (€)" name="priceCents" required
            defaultValue={product ? (product.priceCents / 100).toFixed(2) : ''}
            hint="Prix payé par le client." />
          <Field label="Poids expédié (g)" name="shippingWeightGrams" required type="number"
            defaultValue={product?.shippingWeightGrams}
            hint="Unité emballée, pour le calcul du port." />
          <Select
            label="Catégorie de TVA" name="vatCategory" defaultValue={product?.vatCategory ?? 'FOOD_REDUCED'}
            options={[
              { value: 'FOOD_REDUCED', label: 'Alimentaire — 5,5 %' },
              { value: 'CONFECTIONERY', label: 'Confiserie / chocolat — 20 %' },
              { value: 'NON_FOOD', label: 'Non alimentaire — 20 %' },
            ]}
            hint="Sans effet tant que la franchise s'applique."
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isFeatured" defaultChecked={product?.isFeatured ?? false}
            className="size-4 rounded border-line" />
          Mettre en avant sur la page d'accueil
        </label>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-olive px-5 py-2.5 font-medium text-cream transition hover:bg-olive-dark disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <Link href="/admin/produits" className="text-sm text-muted underline underline-offset-2">
          Retour à la liste
        </Link>

        {state?.ok === true && <span className="text-sm text-good">Enregistré ✓</span>}
        {state?.ok === false && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}
