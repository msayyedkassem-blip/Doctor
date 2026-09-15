import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, endSession } from '~/lib/auth';

const NAV = [
  { href: '/admin', label: "Tableau de bord" },
  { href: '/admin/produits', label: 'Produits' },
  { href: '/admin/stock', label: 'Stock & lots' },
  { href: '/admin/parametres', label: 'Paramètres' },
];

async function logout() {
  'use server';
  await endSession();
  redirect('/admin/login');
}

/**
 * Every admin route is gated here rather than in middleware: the session
 * check uses node:crypto, which is not available on the edge runtime, and a
 * layout guard runs server-side on every request to this subtree.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect('/admin/login');

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 lg:flex-row">
        <aside className="lg:w-52 lg:shrink-0">
          <div className="flex items-center justify-between">
            <Link href="/admin" className="font-display text-xl">Souk <span className="text-muted">admin</span></Link>
            <form action={logout}>
              <button type="submit" className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                Déconnexion
              </button>
            </form>
          </div>

          <nav className="mt-5">
            <ul className="flex gap-x-4 overflow-x-auto whitespace-nowrap text-sm lg:flex-col lg:gap-y-1 lg:whitespace-normal">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-lg px-2.5 py-1.5 text-muted transition hover:bg-parchment hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="lg:mt-3 lg:border-t lg:border-line lg:pt-3">
                <Link href="/" className="block rounded-lg px-2.5 py-1.5 text-muted transition hover:text-ink">
                  Voir la boutique ↗
                </Link>
              </li>
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
