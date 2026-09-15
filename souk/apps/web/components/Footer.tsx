import Link from 'next/link';
import { getShopSettings } from '~/lib/shop';
import { FRANCHISE_INVOICE_MENTION } from '@souk/core';

export async function Footer() {
  const shop = await getShopSettings();

  return (
    <footer className="mt-20 border-t border-line bg-parchment">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="font-display text-xl">Souk</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Épicerie libanaise importée, livrée partout en France.
          </p>
        </div>

        <div className="text-sm">
          <p className="mb-2 font-semibold">Informations</p>
          <ul className="space-y-1.5 text-muted">
            <li><Link href="/livraison" className="hover:text-ink">Livraison</Link></li>
            <li><Link href="/cgv" className="hover:text-ink">Conditions générales de vente</Link></li>
            <li><Link href="/retractation" className="hover:text-ink">Droit de rétractation</Link></li>
            <li><Link href="/mentions-legales" className="hover:text-ink">Mentions légales</Link></li>
          </ul>
        </div>

        <div className="text-sm text-muted">
          {shop && (
            <address className="not-italic leading-relaxed">
              {shop.legalName}
              <br />
              {shop.addressLine1}
              <br />
              {shop.postalCode} {shop.city}
              {shop.siret && <><br />SIRET {shop.siret}</>}
              {/* Mandatory display for producers subject to the packaging EPR scheme. */}
              {shop.citeoIdu && <><br />Identifiant unique REP&nbsp;: {shop.citeoIdu}</>}
            </address>
          )}
          {shop?.vatMode === 'FRANCHISE' && (
            <p className="mt-3">{FRANCHISE_INVOICE_MENTION}</p>
          )}
        </div>
      </div>
    </footer>
  );
}
