import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header } from '~/components/Header';
import { Footer } from '~/components/Footer';

export const metadata: Metadata = {
  title: {
    default: 'Souk — épicerie libanaise livrée en France',
    template: '%s | Souk',
  },
  description:
    "Produits d'épicerie libanaise importés du Liban et livrés partout en France : tahini, zaatar, huile d'olive, café, douceurs.",
  // Installable from the browser: nobody is forced to download an app.
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
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-olive focus:px-4 focus:py-2 focus:text-cream"
        >
          Aller au contenu
        </a>
        <Header />
        <main id="main" className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
