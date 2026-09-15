import Link from 'next/link';
import { getCategories, getCart } from '~/lib/shop';

export async function Header() {
  const [categories, cart] = await Promise.all([getCategories(), getCart()]);
  const count = (cart?.items ?? []).reduce((s, i) => s + i.quantity, 0);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="font-display text-2xl tracking-tight">
          Souk
        </Link>

        <Link
          href="/panier"
          className="ml-auto rounded-lg border border-line bg-white px-3.5 py-2 text-sm transition hover:border-olive/40"
        >
          Panier
          {count > 0 && (
            <span className="ml-2 rounded-full bg-olive px-2 py-0.5 text-xs text-cream tabular-nums">
              {count}
            </span>
          )}
        </Link>
      </div>

      {/*
        Categories get their own row rather than competing with the logo for
        space. Seven rayons do not fit beside a wordmark at 1280px, and a
        wrapping nav pushed the cart button out of alignment.
      */}
      <nav aria-label="Rayons" className="border-t border-line/60">
        <ul className="mx-auto flex max-w-6xl gap-x-5 overflow-x-auto px-4 py-2 text-sm whitespace-nowrap">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="text-muted transition hover:text-olive-dark">
                {c.nameFr}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
