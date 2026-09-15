import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { getProductsByCategory } from '~/lib/shop';
import { ProductCard } from '~/components/ProductCard';

type Params = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const categories = await prisma.category.findMany({ select: { slug: true } });
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  return category
    ? { title: category.nameFr, description: `${category.nameFr} — épicerie libanaise livrée en France.` }
    : {};
}

export default async function CategoryPage({ params }: Params) {
  const { slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) notFound();

  const products = await getProductsByCategory(slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-display text-3xl">{category.nameFr}</h1>
      <p className="mt-2 text-muted">{products.length} produits.</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
