'use client';

import { useActionState } from 'react';
import type { ShopSettings } from '@souk/db';
import { saveSettings, type ActionResult } from '~/lib/admin-actions';

const input = 'mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="font-display text-xl">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function F({ label, name, value, hint, type = 'text', required, full }: {
  label: string; name: string; value?: string | null;
  hint?: string; type?: string; required?: boolean; full?: boolean;
}) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="block text-sm font-medium">{label}</span>
      <input name={name} type={type} required={required} defaultValue={value ?? ''} className={input} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SettingsForm({ shop }: { shop: ShopSettings | null }) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    saveSettings, undefined,
  );

  return (
    <form action={formAction} className="space-y-5 pb-16">
      <Section
        title="Identité légale"
        description="Vous êtes l'exploitant du secteur alimentaire nommé sur chaque étiquette : importateur responsable de la conformité des denrées dans l'Union européenne (art. 8.1 INCO)."
      >
        <F label="Raison sociale" name="legalName" value={shop?.legalName} required full />
        <F label="Adresse" name="addressLine1" value={shop?.addressLine1} required />
        <F label="Complément d'adresse" name="addressLine2" value={shop?.addressLine2} />
        <F label="Code postal" name="postalCode" value={shop?.postalCode} required />
        <F label="Ville" name="city" value={shop?.city} required />
        <F label="Pays" name="country" value={shop?.country ?? 'France'} required />
        <F label="SIRET" name="siret" value={shop?.siret} />
        <F label="Numéro de TVA intracommunautaire" name="vatNumber" value={shop?.vatNumber}
          hint="Nécessaire pour importer hors UE, même sous le régime de la franchise." />
        <F label="Identifiant unique REP (Citeo)" name="citeoIdu" value={shop?.citeoIdu} full
          hint="Obligatoire pour tout metteur sur le marché d'emballages, et doit être affiché sur le site." />
        <F label="E-mail de contact" name="contactEmail" type="email" value={shop?.contactEmail} required />
        <F label="Téléphone" name="contactPhone" value={shop?.contactPhone} />
      </Section>

      <Section
        title="Régime de TVA"
        description="Le basculement est automatique une fois les seuils franchis : au-delà de 93 500 € en cours d'année, la TVA s'applique rétroactivement au 1er du mois."
      >
        <label className="block">
          <span className="block text-sm font-medium">Régime</span>
          <select name="vatMode" defaultValue={shop?.vatMode ?? 'FRANCHISE'} className={input}>
            <option value="FRANCHISE">Franchise en base — art. 293 B du CGI</option>
            <option value="STANDARD">Régime réel — TVA facturée</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium">À la sortie de la franchise</span>
          <select name="vatSwitchStrategy" defaultValue={shop?.vatSwitchStrategy ?? 'ABSORB'} className={input}>
            <option value="ABSORB">Absorber — prix affichés inchangés, marge réduite</option>
            <option value="PASS_THROUGH">Répercuter — prix affichés augmentés de la TVA</option>
          </select>
        </label>

        <F label="CA de l'année en cours (€)" name="currentYearRevenueCents"
          value={shop ? (shop.currentYearRevenueCents / 100).toFixed(2) : '0'}
          hint="Alimente le suivi de seuil du tableau de bord." />
        <F label="CA de l'année précédente (€)" name="previousYearRevenueCents"
          value={shop ? (shop.previousYearRevenueCents / 100).toFixed(2) : '0'}
          hint="Au-delà de 85 000 €, la TVA s'applique dès le 1er janvier suivant." />
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-olive px-5 py-2.5 font-medium text-cream transition hover:bg-olive-dark disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {state?.ok === true && <span className="text-sm text-good">Enregistré ✓</span>}
        {state?.ok === false && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}
