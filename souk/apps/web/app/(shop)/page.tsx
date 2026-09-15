import Link from 'next/link';
import { getCategories, getFeaturedProducts } from '~/lib/shop';
import { ProductCard } from '~/components/ProductCard';
import {
  FREE_SHIPPING_THRESHOLD, CARRIERS, ShippingMethod, formatCents,
} from '@souk/core';

export default async function HomePage() {
  const [featured, categories] = await Promise.all([getFeaturedProducts(), getCategories()]);
  const relay = CARRIERS[ShippingMethod.MONDIAL_RELAY_POINT];
  const colissimo = CARRIERS[ShippingMethod.COLISSIMO_HOME];

  return (
    <>
      <section className="border-b border-line bg-parchment">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <p className="text-sm font-medium tracking-wide uppercase text-olive">
            Importé du Liban
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">
            L'épicerie libanaise, livrée partout en France.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
            Tahini broyé à la meule, zaatar du jour, huile d'olive du Koura.
            Les produits d'un supermarché de Beyrouth, expédiés depuis la France.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/catalogue"
              className="rounded-lg bg-olive px-6 py-3 font-medium text-cream transition hover:bg-olive-dark"
            >
              Voir le catalogue
            </Link>
            {FREE_SHIPPING_THRESHOLD !== null && (
              <span className="rounded-lg border border-line bg-white px-5 py-3 text-sm text-muted">
                Livraison offerte en Point Relais dès {formatCents(FREE_SHIPPING_THRESHOLD)}
              </span>
            )}
          </div>

          <dl className="mt-10 grid gap-5 text-sm sm:grid-cols-2 lg:max-w-2xl">
            <div className="rounded-xl border border-line bg-white p-4">
              <dt className="font-semibold">{colissimo.labelFr}</dt>
              <dd className="mt-1 text-muted">
                Livré chez vous en {colissimo.minBusinessDays} à {colissimo.maxBusinessDays} jours ouvrés.
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <dt className="font-semibold">{relay.labelFr}</dt>
              <dd className="mt-1 text-muted">
                L'option économique, en {relay.minBusinessDays} à {relay.maxBusinessDays} jours ouvrés.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="font-display text-2xl">Les essentiels</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="font-display text-2xl">Rayons</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/c/${c.slug}`}
                className="flex items-baseline justify-between rounded-xl border border-line bg-white px-4 py-3.5 transition hover:border-olive/40"
              >
                <span>{c.nameFr}</span>
                <span className="text-sm text-muted tabular-nums">{c._count.products}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
