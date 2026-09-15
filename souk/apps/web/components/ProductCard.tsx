import Link from 'next/link';
import type { Product } from '@souk/db';
import { Thumb } from './Thumb';
import { price } from '~/lib/format';
import { ALLERGEN_LABELS } from '@souk/core';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white transition hover:border-olive/40 hover:shadow-sm"
      style={{ containerType: 'inline-size' }}
    >
      <Thumb name={product.displayNameFr} className="aspect-4/3 w-full" />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg leading-snug group-hover:text-olive-dark">
          {product.displayNameFr}
        </h3>

        {product.allergens.length > 0 && (
          <p className="text-xs text-muted">
            Contient&nbsp;: {product.allergens.map((a) => ALLERGEN_LABELS[a].fr).join(', ')}
          </p>
        )}

        <p className="mt-auto pt-2 text-lg font-semibold tabular-nums">
          {price(product.priceCents)}
        </p>
      </div>
    </Link>
  );
}
