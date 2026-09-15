'use client';

import { useActionState } from 'react';
import type { Product } from '@souk/db';
import { createBatch, type ActionResult } from '~/lib/admin-actions';

export function BatchForm({ products }: { products: Product[] }) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createBatch, undefined,
  );

  const input = 'mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';

  return (
    <form action={formAction} className="rounded-xl border border-line bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="block text-sm font-medium">Produit</span>
          <select name="productId" required defaultValue="" className={input}>
            <option value="" disabled>— choisir —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.displayNameFr}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium">Numéro de lot</span>
          <input name="lotNumber" required className={input} placeholder="Tel qu'imprimé par le producteur" />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">Date de durabilité</span>
          <input name="durabilityDate" type="date" required className={input} />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">Quantité reçue</span>
          <input name="quantityOnHand" type="number" min={0} required defaultValue={0} className={input} />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">Preuve d'origine</span>
          <input name="originProofRef" className={input} placeholder="Réf. EUR.1 / déclaration" />
          <span className="mt-1 block text-xs text-muted">
            Sans elle, la préférence UE–Liban ne s'applique pas.
          </span>
        </label>
      </div>

      <fieldset className="mt-5 border-t border-line pt-4">
        <legend className="text-sm font-medium">Coût de revient unitaire (€)</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <label className="block">
            <span className="block text-xs text-muted">Achat fournisseur</span>
            <input name="supplierCostCents" inputMode="decimal" defaultValue="0" className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Transport</span>
            <input name="freightShareCents" inputMode="decimal" defaultValue="0" className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Droits de douane</span>
            <input name="customsDutyCents" inputMode="decimal" defaultValue="0" className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">TVA import (non déductible)</span>
            <input name="importVatCents" inputMode="decimal" defaultValue="0" className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted">Autres (Citeo, transitaire)</span>
            <input name="otherCostsCents" inputMode="decimal" defaultValue="0" className={input} />
          </label>
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-olive px-5 py-2.5 font-medium text-cream transition hover:bg-olive-dark disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer le lot'}
        </button>
        {state?.ok === true && <span className="text-sm text-good">Lot enregistré ✓</span>}
        {state?.ok === false && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}
