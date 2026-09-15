import Link from 'next/link';
import type { Metadata } from 'next';
import { getCartTotals } from '~/lib/shop';
import { price, num } from '~/lib/format';
import { Thumb } from '~/components/Thumb';
import { QuantityControl } from '~/components/QuantityControl';
import { FRANCHISE_INVOICE_MENTION, FREE_SHIPPING_THRESHOLD } from '@souk/core';

export const metadata: Metadata = { title: 'Panier' };

export default async function CartPage() {
  const { totals, shippingOptions, vatMode } = await getCartTotals();

  if (totals.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-display text-3xl">Votre panier est vide</h1>
        <Link
          href="/catalogue"
          className="mt-6 inline-block rounded-lg bg-olive px-6 py-3 font-medium text-cream transition hover:bg-olive-dark"
        >
          Parcourir le catalogue
        </Link>
      </div>
    );
  }

  const missingForFreeShipping =
    FREE_SHIPPING_THRESHOLD !== null ? FREE_SHIPPING_THRESHOLD - totals.subtotalCents : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-display text-3xl">Panier</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_20rem]">
        <ul className="divide-y divide-line border-y border-line">
          {totals.lines.map((line) => (
            <li key={line.productId} className="flex gap-4 py-5">
              <div style={{ containerType: 'inline-size' }} className="w-20 shrink-0">
                <Thumb name={line.nameFr} className="aspect-square w-full rounded-lg" />
              </div>

              <div className="min-w-0 flex-1">
                <Link href={`/p/${line.slug}`} className="font-display text-lg hover:text-olive-dark">
                  {line.nameFr}
                </Link>
                <p className="mt-0.5 text-sm text-muted">{price(line.unitPriceCents)} l'unité</p>
                <div className="mt-3">
                  <QuantityControl productId={line.productId} quantity={line.quantity} />
                </div>
              </div>

              <p className="shrink-0 font-semibold tabular-nums">{price(line.lineTotalCents)}</p>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-xl border border-line bg-white p-5">
          <h2 className="font-display text-xl">Récapitulatif</h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Sous-total</dt>
              <dd className="tabular-nums">{price(totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Poids</dt>
              <dd className="tabular-nums">{num(totals.itemsWeightGrams / 1000)} kg</dd>
            </div>
          </dl>

          {missingForFreeShipping > 0 && (
            <p className="mt-4 rounded-lg bg-parchment px-3 py-2.5 text-sm text-muted">
              Plus que {price(missingForFreeShipping)} pour la livraison offerte en Point Relais.
            </p>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-sm font-semibold">Livraison estimée</p>
            <ul className="space-y-1.5 text-sm">
              {shippingOptions.map((q) => (
                <li key={q.method} className="flex justify-between gap-3">
                  <span className="text-muted">
                    {q.labelFr}
                    <span className="block text-xs">J+{q.minBusinessDays}–{q.maxBusinessDays}</span>
                  </span>
                  <span className="tabular-nums">
                    {q.isFree ? 'Offerte' : price(q.priceCents)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Le transporteur est choisi à l'étape suivante.
            </p>
          </div>

          <div className="mt-5 flex justify-between border-t border-line pt-4 text-lg font-semibold">
            <span>Total articles</span>
            <span className="tabular-nums">{price(totals.subtotalCents)}</span>
          </div>

          {/* Under the franchise no VAT line may appear — not even at 0 %. */}
          {vatMode === 'FRANCHISE' ? (
            <p className="mt-2 text-xs text-muted">{FRANCHISE_INVOICE_MENTION}</p>
          ) : (
            <dl className="mt-2 space-y-1 text-xs text-muted">
              {totals.vatBreakdown.map((r) => (
                <div key={r.rateBasisPoints} className="flex justify-between">
                  <dt>Dont TVA {(r.rateBasisPoints / 100).toFixed(1)} %</dt>
                  <dd className="tabular-nums">{price(r.vatCents)}</dd>
                </div>
              ))}
            </dl>
          )}

          <Link
            href="/commande"
            className="mt-5 block rounded-lg bg-olive px-5 py-3 text-center font-medium text-cream transition hover:bg-olive-dark"
          >
            Passer commande
          </Link>
        </aside>
      </div>
    </div>
  );
}
