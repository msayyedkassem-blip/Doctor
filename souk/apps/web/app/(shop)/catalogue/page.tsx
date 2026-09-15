import type { Metadata } from 'next';
import { getAllProducts } from '~/lib/shop';
import { ProductCard } from '~/components/ProductCard';

export const metadata: Metadata = {
  title: 'Catalogue',
  description: "Tous les produits d'épicerie libanaise disponibles à la livraison en France.",
};

export default async function CataloguePage() {
  const products = await getAllProducts();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-display text-3xl">Catalogue</h1>
      <p className="mt-2 text-muted">{products.length} produits disponibles.</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
