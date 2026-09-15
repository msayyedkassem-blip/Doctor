import { ALLERGEN_LABELS, type Allergen } from '@souk/core';

export function AllergenBadges({
  allergens, mayContain,
}: { allergens: Allergen[]; mayContain: Allergen[] }) {
  if (allergens.length === 0 && mayContain.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aucun des 14 allergènes à déclaration obligatoire.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {allergens.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase text-sumac mb-1.5">
            Contient
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {allergens.map((a) => (
              <li
                key={a}
                className="rounded-full border border-sumac/35 bg-sumac/10 px-2.5 py-1 text-sm text-sumac"
              >
                {ALLERGEN_LABELS[a].fr}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mayContain.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase text-muted mb-1.5">
            Peut contenir des traces de
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {mayContain.map((a) => (
              <li
                key={a}
                className="rounded-full border border-line bg-parchment px-2.5 py-1 text-sm text-muted"
              >
                {ALLERGEN_LABELS[a].fr}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
