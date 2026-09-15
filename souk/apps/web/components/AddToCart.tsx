'use client';

import { useState, useTransition } from 'react';
import { addToCart } from '~/lib/cart-actions';

export function AddToCart({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  if (disabled) {
    return (
      <p className="rounded-lg border border-line bg-parchment px-4 py-3 text-center text-sm text-muted">
        Temporairement épuisé
      </p>
    );
  }

  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor={`qty-${productId}`}>Quantité</label>
      <select
        id={`qty-${productId}`}
        value={qty}
        onChange={(e) => setQty(Number(e.target.value))}
        className="rounded-lg border border-line bg-white px-3 py-3 text-sm"
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await addToCart(productId, qty);
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
        }
        className="flex-1 rounded-lg bg-olive px-5 py-3 font-medium text-cream transition hover:bg-olive-dark disabled:opacity-60"
      >
        {pending ? 'Ajout…' : done ? 'Ajouté ✓' : 'Ajouter au panier'}
      </button>
    </div>
  );
}
