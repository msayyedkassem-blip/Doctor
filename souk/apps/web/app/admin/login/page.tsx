'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function AdminLoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="font-display text-2xl">Administration</h1>
      <p className="mt-1 text-sm text-muted">Souk — gestion de la boutique</p>

      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5"
          />
        </div>

        {state?.error && (
          <p role="alert" className="rounded-lg border border-sumac/30 bg-sumac/10 px-3 py-2 text-sm text-sumac">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-olive px-5 py-2.5 font-medium text-cream transition hover:bg-olive-dark disabled:opacity-60"
        >
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
