import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import snapshot from '../assets/catalogue-snapshot.json';
import type { Catalogue } from './types';

/**
 * Catalogue loading, offline-first.
 *
 * Three sources, in order of freshness:
 *   1. the server, when reachable;
 *   2. the last successful response, cached on the device;
 *   3. a snapshot bundled into the build.
 *
 * (3) is what makes a sideloaded APK useful before any server is deployed —
 * the app opens on a real catalogue rather than an error. It is also the
 * offline story Google and Apple look for in a store review: the app does
 * something a bookmark cannot.
 */

const CACHE_KEY = 'souk:catalogue:v1';
const API_URL_KEY = 'souk:apiUrl:v1';
const REQUEST_TIMEOUT_MS = 8000;

/** Build-time default. 10.0.2.2 is the host machine as seen from an Android emulator. */
const DEFAULT_API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://10.0.2.2:3100';

export async function getApiUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(API_URL_KEY);
  return stored?.trim() || DEFAULT_API_URL;
}

/** Lets the operator repoint a already-installed APK at a deployed server. */
export async function setApiUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) await AsyncStorage.setItem(API_URL_KEY, trimmed);
  else await AsyncStorage.removeItem(API_URL_KEY);
}

/**
 * Turn a fetch failure into something a shopper can read.
 *
 * An aborted request surfaces as "signal is aborted without reason", which
 * is meaningless outside a debugger — and this string is shown in the app.
 */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted/i.test(error.message)) {
      return 'délai dépassé';
    }
    if (/^HTTP \d+/.test(error.message)) return error.message;
    return 'serveur injoignable';
  }
  return 'erreur réseau';
}

export type CatalogueSource = 'network' | 'cache' | 'bundled';

export interface LoadResult {
  catalogue: Catalogue;
  source: CatalogueSource;
  error?: string;
}

export async function loadCatalogue(): Promise<LoadResult> {
  const base = await getApiUrl();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(`${base}/api/catalogue`, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalogue = (await response.json()) as Catalogue;

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(catalogue));
    return { catalogue, source: 'network' };
  } catch (error) {
    const message = describeNetworkError(error);

    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        return { catalogue: JSON.parse(cached) as Catalogue, source: 'cache', error: message };
      } catch {
        // Corrupt cache: fall through to the bundled snapshot.
      }
    }

    return { catalogue: snapshot as unknown as Catalogue, source: 'bundled', error: message };
  }
}
