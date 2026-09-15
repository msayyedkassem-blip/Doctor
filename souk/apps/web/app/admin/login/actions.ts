'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  adminPasswordHash, verifyPassword, startSession,
  isLockedOut, recordFailure, clearFailures,
} from '~/lib/auth';

export async function login(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '');

  const hash = adminPasswordHash();
  if (!hash) {
    return { error: "ADMIN_PASSWORD_HASH n'est pas configuré sur le serveur." };
  }

  // Throttle per client IP. Behind a proxy this is the forwarded address.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isLockedOut(ip)) {
    return { error: 'Trop de tentatives. Réessayez dans quelques minutes.' };
  }

  if (!verifyPassword(password, hash)) {
    recordFailure(ip);
    // Deliberately vague: no hint about whether the password was close.
    return { error: 'Mot de passe incorrect.' };
  }

  clearFailures(ip);
  await startSession();
  redirect('/admin');
}
