import type { Metadata, Viewport } from 'next';
import './globals.css';

/**
 * Root layout: document shell only.
 *
 * The storefront chrome lives in (shop)/layout.tsx so that the admin — and
 * its login page — do not inherit a customer-facing header and footer.
 * Route groups do not affect URLs.
 */
export const metadata: Metadata = {
  title: {
    default: 'Souk — épicerie libanaise livrée en France',
    template: '%s | Souk',
  },
  description:
    "Produits d'épicerie libanaise importés du Liban et livrés partout en France : tahini, zaatar, huile d'olive, café, douceurs.",
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#fbf7f0',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
