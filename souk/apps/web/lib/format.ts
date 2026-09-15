import { formatCents } from '@souk/core';

export const price = (c: number): string => formatCents(c, 'fr-FR');

/**
 * French decimal notation: 0,1 — not 0.1.
 * Nutrition values come out of the database as JS numbers, which stringify
 * with a point. On a French label that is simply wrong.
 */
export function num(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

/** "450 g", "750 ml", "1 kg" — the unit as it must appear on the label. */
export function netQuantity(value: number, unit: string, drained?: number | null): string {
  const label: Record<string, string> = { G: 'g', KG: 'kg', ML: 'ml', L: 'l', PIECE: 'pièce(s)' };
  const main = `${num(value)} ${label[unit] ?? unit.toLowerCase()}`;
  return drained
    ? `${main} (poids net égoutté ${num(drained)} ${label[unit] ?? ''})`
    : main;
}

/** Renders **allergen** emphasis from the ingredient text as real markup. */
export function emphasiseAllergens(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
