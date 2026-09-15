import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { EXPIRY_WARNING_DAYS } from '~/lib/admin';
import { price, num } from '~/lib/format';
import { BatchForm } from '~/components/admin/BatchForm';
import { landedUnitCost } from '@souk/core';

export const metadata: Metadata = { title: 'Stock & lots' };
export const dynamic = 'force-dynamic';

export default async function AdminStockPage() {
  const [batches, products] = await Promise.all([
    prisma.stockBatch.findMany({
      orderBy: { durabilityDate: 'asc' },
      include: { product: true },
    }),
    prisma.product.findMany({ orderBy: { displayNameFr: 'asc' } }),
  ]);

  const now = new Date();
  const warnAt = new Date(now);
  warnAt.setUTCDate(warnAt.getUTCDate() + EXPIRY_WARNING_DAYS);

  return (
    <div>
      <h1 className="font-display text-3xl">Stock &amp; lots</h1>
      <p className="mt-1 text-sm text-muted">
        Numéro de lot et date de durabilité se saisissent ici, par lot physique : c'est
        ce qui permet de répondre à un rappel produit.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Produit</th>
              <th scope="col" className="px-4 py-3 font-medium">Lot</th>
              <th scope="col" className="px-4 py-3 font-medium">Durabilité</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Quantité</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Coût de revient</th>
              <th scope="col" className="px-4 py-3 font-medium">Origine</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {batches.map((b) => {
              const expired = b.durabilityDate <= now;
              const soon = !expired && b.durabilityDate <= warnAt;
              const unitCost = landedUnitCost({
                supplierCost: b.supplierCostCents,
                freightShare: b.freightShareCents,
                customsDuty: b.customsDutyCents,
                importVat: b.importVatCents,
                otherCosts: b.otherCostsCents,
              });
              const margin = b.product.priceCents - unitCost;

              return (
                <tr key={b.id} className={expired ? 'bg-critical/5' : ''}>
                  <td className="px-4 py-3">{b.product.displayNameFr}</td>
                  <td className="px-4 py-3 font-mono text-xs">{b.lotNumber}</td>
                  <td className="px-4 py-3">
                    <span className={expired ? 'text-critical' : soon ? 'text-warning' : ''}>
                      {expired && <span aria-hidden="true">■ </span>}
                      {soon && <span aria-hidden="true">▲ </span>}
                      {b.durabilityDate.toLocaleDateString('fr-FR')}
                    </span>
                    {expired && <span className="block text-xs text-critical">Périmé</span>}
                    {soon && <span className="block text-xs text-warning">À écouler</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.quantityOnHand}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {unitCost > 0 ? (
                      <>
                        {price(unitCost)}
                        <span className={`block text-xs ${margin < 0 ? 'text-critical' : 'text-muted'}`}>
                          marge {price(margin)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{b.originProofRef ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl">Réceptionner un lot</h2>
        <p className="mt-1 text-sm text-muted">
          La TVA à l'import entre dans le coût de revient : sous le régime de la franchise
          elle n'est pas déductible.
        </p>
        <div className="mt-4">
          <BatchForm products={products} />
        </div>
      </section>
    </div>
  );
}
