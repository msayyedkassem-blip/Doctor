import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { complianceIssuesFor } from '~/lib/admin';
import { ProductForm } from '~/components/admin/ProductForm';

export const metadata: Metadata = { title: 'Modifier un produit' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, categories, shop] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.category.findMany({ orderBy: { position: 'asc' } }),
    prisma.shopSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!product) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{product.displayNameFr}</h1>
          <p className="mt-1 text-sm text-muted">
            {product.isActive ? 'En ligne' : 'Hors ligne'} ·{' '}
            <Link href={`/p/${product.slug}`} className="underline underline-offset-2">
              Voir la fiche ↗
            </Link>
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ProductForm
          product={product}
          categories={categories}
          issues={complianceIssuesFor(product, shop)}
        />
      </div>
    </div>
  );
}
