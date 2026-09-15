import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { getProductBySlug, getAvailableStock, getShopSettings } from '~/lib/shop';
import { Thumb } from '~/components/Thumb';
import { AddToCart } from '~/components/AddToCart';
import { IncoPanel } from '~/components/IncoPanel';
import { price, netQuantity } from '~/lib/format';
import { withdrawalRight, WITHDRAWAL_PERIOD_DAYS } from '@souk/core';

type Params = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { slug: true },
  });
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.displayNameFr,
    description: product.descriptionFr || product.legalName,
    openGraph: { title: product.displayNameFr, description: product.descriptionFr },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [stock, shop] = await Promise.all([
    getAvailableStock(product.id),
    getShopSettings(),
  ]);

  // Shown up front so the customer knows their return rights before buying,
  // not after. Sealed shelf-stable goods DO carry the 14-day right.
  const returns = withdrawalRight({
    durabilityKind: product.durabilityKind,
    sealBroken: false,
    deliveredAt: new Date(),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Fil d'Ariane" className="mb-6 text-sm text-muted">
        <Link href="/catalogue" className="hover:text-ink">Catalogue</Link>
        {product.category && (
          <>
            <span className="mx-2">/</span>
            <Link href={`/c/${product.category.slug}`} className="hover:text-ink">
              {product.category.nameFr}
            </Link>
          </>
        )}
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div style={{ containerType: 'inline-size' }}>
          <Thumb
            name={product.displayNameFr}
            className="aspect-square w-full rounded-2xl border border-line"
          />
        </div>

        <div>
          <h1 className="font-display text-3xl leading-tight">{product.displayNameFr}</h1>
          <p className="mt-1.5 text-muted">{product.legalName}</p>

          <p className="mt-5 text-3xl font-semibold tabular-nums">{price(product.priceCents)}</p>
          <p className="mt-1 text-sm text-muted">
            {netQuantity(product.netQuantityValue, product.netQuantityUnit, product.netQuantityDrained)}
            {product.brand && <> · {product.brand}</>}
          </p>

          {product.descriptionFr && (
            <p className="mt-5 leading-relaxed">{product.descriptionFr}</p>
          )}

          <div className="mt-7">
            <AddToCart productId={product.id} disabled={stock <= 0} />
          </div>

          {stock > 0 && stock <= 5 && (
            <p className="mt-3 text-sm text-sumac">
              Plus que {stock} en stock
            </p>
          )}

          <div className="mt-8 space-y-2 border-t border-line pt-6 text-sm text-muted">
            <p>Expédié depuis la France · Origine {product.countryOfOrigin}</p>
            <p>
              {returns.applies
                ? `Rétractation sous ${WITHDRAWAL_PERIOD_DAYS} jours si le produit est encore scellé.`
                : returns.explanationFr}
            </p>
          </div>
        </div>
      </div>

      <IncoPanel product={product} shop={shop} />
    </div>
  );
}
