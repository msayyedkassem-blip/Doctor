import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { ProductForm } from '~/components/admin/ProductForm';

export const metadata: Metadata = { title: 'Nouveau produit' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const categories = await prisma.category.findMany({ orderBy: { position: 'asc' } });

  return (
    <div>
      <h1 className="font-display text-3xl">Nouveau produit</h1>
      <p className="mt-1 text-sm text-muted">
        La fiche restera hors ligne tant que toutes les mentions obligatoires ne sont pas renseignées.
      </p>

      <div className="mt-6">
        {/* No issues listed yet: an empty form would simply report all of them. */}
        <ProductForm product={null} categories={categories} issues={[]} />
      </div>
    </div>
  );
}
