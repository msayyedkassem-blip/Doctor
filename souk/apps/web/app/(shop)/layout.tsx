import { Header } from '~/components/Header';
import { Footer } from '~/components/Footer';

/** Customer-facing chrome. Admin routes deliberately sit outside this group. */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-olive focus:px-4 focus:py-2 focus:text-cream"
      >
        Aller au contenu
      </a>
      <Header />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
