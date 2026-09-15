import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { complianceIssuesFor } from '~/lib/admin';
import { price } from '~/lib/format';
import { PublishToggle } from '~/components/admin/PublishToggle';

export const metadata: Metadata = { title: 'Produits' };
export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const [products, shop] = await Promise.all([
    prisma.product.findMany({
      orderBy: { displayNameFr: 'asc' },
      include: { category: true },
    }),
    prisma.shopSettings.findUnique({ where: { id: 1 } }),
  ]);

  const now = new Date();
  const stockRows = await prisma.stockBatch.groupBy({
    by: ['productId'],
    where: { durabilityDate: { gt: now } },
    _sum: { quantityOnHand: true },
  });
  const stock = new Map(stockRows.map((r) => [r.productId, r._sum.quantityOnHand ?? 0]));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Produits</h1>
        <Link
          href="/admin/produits/nouveau"
          className="rounded-lg bg-olive px-4 py-2 text-sm font-medium text-cream transition hover:bg-olive-dark"
        >
          Nouveau produit
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Produit</th>
              <th scope="col" className="px-4 py-3 font-medium">Rayon</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Prix</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Stock</th>
              <th scope="col" className="px-4 py-3 font-medium">Conformité</th>
              <th scope="col" className="px-4 py-3 font-medium">En ligne</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {products.map((p) => {
              const issues = complianceIssuesFor(p, shop);
              const units = stock.get(p.id) ?? 0;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/produits/${p.id}`} className="font-medium hover:text-olive-dark">
                      {p.displayNameFr}
                    </Link>
                    <span className="block text-xs text-muted">{p.slug}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{p.category?.nameFr ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{price(p.priceCents)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${units === 0 ? 'text-critical' : units < 10 ? 'text-warning' : ''}`}>
                    {units}
                  </td>
                  <td className="px-4 py-3">
                    {issues.length === 0 ? (
                      <span className="text-good"><span aria-hidden="true">●</span> Complète</span>
                    ) : (
                      <span className="text-serious">
                        <span aria-hidden="true">▲</span> {issues.length} manque(s)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PublishToggle
                      productId={p.id}
                      isActive={p.isActive}
                      blocked={issues.length > 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {products.length === 0 && (
        <p className="mt-6 text-muted">Aucun produit pour le moment.</p>
      )}
    </div>
  );
}
