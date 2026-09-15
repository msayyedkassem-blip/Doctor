'use client';

import { useState, useTransition } from 'react';
import { setProductActive } from '~/lib/admin-actions';

export function PublishToggle({
  productId, isActive, blocked,
}: { productId: string; isActive: boolean; blocked: boolean }) {
  const [active, setActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A non-compliant listing cannot be published at all — the control is
  // disabled here and the server refuses independently.
  if (blocked && !active) {
    return <span className="text-xs text-muted">Bloqué</span>;
  }

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await setProductActive(productId, !active);
            if (result.ok) setActive(!active);
            else setError(result.error);
          })
        }
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          active ? 'bg-olive' : 'bg-line'
        } disabled:opacity-60`}
      >
        <span className="sr-only">{active ? 'Retirer de la vente' : 'Mettre en vente'}</span>
        <span
          className={`inline-block h-4.5 w-4.5 rounded-full bg-white transition ${
            active ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      {error && <p className="mt-1 max-w-48 text-xs text-critical">{error}</p>}
    </div>
  );
}
