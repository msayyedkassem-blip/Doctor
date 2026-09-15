import type { Metadata } from 'next';
import { prisma } from '@souk/db';
import { SettingsForm } from '~/components/admin/SettingsForm';

export const metadata: Metadata = { title: 'Paramètres' };
export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const shop = await prisma.shopSettings.findUnique({ where: { id: 1 } });

  return (
    <div>
      <h1 className="font-display text-3xl">Paramètres</h1>
      <p className="mt-1 text-sm text-muted">
        Ces informations apparaissent sur chaque fiche produit et dans les mentions légales.
      </p>
      <div className="mt-6">
        <SettingsForm shop={shop} />
      </div>
    </div>
  );
}
