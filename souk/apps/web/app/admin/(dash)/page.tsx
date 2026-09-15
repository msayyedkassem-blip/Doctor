import Link from 'next/link';
import type { Metadata } from 'next';
import { getDashboard, EXPIRY_WARNING_DAYS, LOW_STOCK_THRESHOLD } from '~/lib/admin';
import { StatTile } from '~/components/admin/StatTile';
import { VatMeter } from '~/components/admin/VatMeter';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const d = await getDashboard();

  return (
    <div>
      <h1 className="font-display text-3xl">Tableau de bord</h1>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <VatMeter vat={d.vat} />

        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="Commandes à préparer"
            value={d.ordersToPrepare}
            href="/admin/commandes"
          />
          <StatTile
            label="Produits en ligne"
            value={`${d.activeProducts} / ${d.totalProducts}`}
            href="/admin/produits"
          />
          <StatTile
            label="Fiches non conformes"
            value={d.nonCompliant.length}
            hint={d.nonCompliant.length > 0 ? 'Bloquées à la publication' : 'Toutes publiables'}
            tone={d.nonCompliant.length > 0 ? 'serious' : 'good'}
            href="/admin/produits"
          />
          <StatTile
            label="Lots périmés"
            value={d.expired}
            hint={d.expired > 0 ? 'À retirer du stock' : 'Aucun'}
            tone={d.expired > 0 ? 'critical' : 'good'}
            href="/admin/stock"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <StatTile
          label={`Lots à moins de ${EXPIRY_WARNING_DAYS} jours`}
          value={d.expiringSoon}
          hint="À écouler en priorité"
          tone={d.expiringSoon > 0 ? 'warning' : 'good'}
          href="/admin/stock"
        />
        <StatTile
          label="Produits en stock faible"
          value={d.lowStock.length}
          hint={`Moins de ${LOW_STOCK_THRESHOLD} unités vendables`}
          tone={d.lowStock.length > 0 ? 'warning' : 'good'}
          href="/admin/stock"
        />
      </div>

      {d.nonCompliant.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xl">Fiches à compléter</h2>
          <p className="mt-1 text-sm text-muted">
            Ces produits ne peuvent pas être mis en ligne : le règlement INCO impose
            que toutes les mentions obligatoires soient disponibles avant l'achat.
          </p>
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white">
            {d.nonCompliant.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <Link href={`/admin/produits/${p.id}`} className="font-medium hover:text-olive-dark">
                  {p.displayNameFr}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!d.shop?.citeoIdu && (
        <p className="mt-8 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span aria-hidden="true">▲</span>{' '}
          <strong>Identifiant unique REP manquant.</strong>{' '}
          L'adhésion à Citeo est obligatoire pour tout metteur sur le marché d'emballages,
          et l'identifiant doit être affiché sur le site.{' '}
          <Link href="/admin/parametres" className="underline underline-offset-2">
            Renseigner
          </Link>
        </p>
      )}
    </div>
  );
}
