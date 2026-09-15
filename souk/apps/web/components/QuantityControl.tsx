'use client';

import { useTransition } from 'react';
import { setQuantity, removeFromCart } from '~/lib/cart-actions';

export function QuantityControl({
  productId, quantity,
}: { productId: string; quantity: number }) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-lg border border-line bg-white">
        <button
          type="button"
          aria-label="Diminuer la quantité"
          disabled={pending}
          onClick={() => start(async () => { await setQuantity(productId, quantity - 1); })}
          className="px-3 py-1.5 text-lg leading-none text-muted transition hover:text-ink disabled:opacity-50"
        >
          −
        </button>
        <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
          {quantity}
        </span>
        <button
          type="button"
          aria-label="Augmenter la quantité"
          disabled={pending}
          onClick={() => start(async () => { await setQuantity(productId, quantity + 1); })}
          className="px-3 py-1.5 text-lg leading-none text-muted transition hover:text-ink disabled:opacity-50"
        >
          +
        </button>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await removeFromCart(productId); })}
        className="text-sm text-muted underline underline-offset-2 transition hover:text-sumac disabled:opacity-50"
      >
        Retirer
      </button>
    </div>
  );
}
