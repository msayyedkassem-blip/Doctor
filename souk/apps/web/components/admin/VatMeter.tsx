import type { VatMonitor } from '~/lib/admin';
import { price } from '~/lib/format';

const LEVEL = {
  good: { bar: 'bg-good', text: 'text-good', icon: '●', word: 'Conforme' },
  warning: { bar: 'bg-warning', text: 'text-warning', icon: '▲', word: 'Vigilance' },
  serious: { bar: 'bg-serious', text: 'text-serious', icon: '▲', word: 'Échéance' },
  critical: { bar: 'bg-critical', text: 'text-critical', icon: '■', word: 'Action requise' },
} as const;

/**
 * Turnover against the franchise ceiling.
 *
 * This is the number that quietly ends the VAT regime, and the majoré
 * crossing is retroactive to the first of the month — so it is the first
 * thing on the dashboard rather than a figure buried in an accounting page.
 *
 * The status colour is always accompanied by an icon and a word; on a light
 * surface the warning and serious steps fall below 3:1 contrast by design.
 */
export function VatMeter({ vat }: { vat: VatMonitor }) {
  const level = LEVEL[vat.level];
  const basePosition = (vat.baseThreshold / vat.majoreThreshold) * 100;

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">Seuil de TVA</h2>
        <p className={`text-sm font-medium ${level.text}`}>
          <span aria-hidden="true">{level.icon}</span> {level.word}
        </p>
      </div>

      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {price(vat.currentYearRevenueCents)}
      </p>
      <p className="text-sm text-muted">chiffre d'affaires de l'année en cours</p>

      <div className="mt-5">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-parchment"
          role="meter"
          aria-valuenow={Math.round(vat.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progression vers le seuil majoré de TVA"
        >
          <div
            className={`h-full rounded-full ${level.bar}`}
            style={{ width: `${Math.max(vat.progress * 100, 1)}%` }}
          />
          {/* Base threshold marker, drawn over the track. */}
          <div
            className="absolute inset-y-0 w-px bg-ink/35"
            style={{ left: `${basePosition}%` }}
            aria-hidden="true"
          />
        </div>

        <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
          <span>0 €</span>
          <span>{price(vat.baseThreshold)} — seuil de base</span>
          <span>{price(vat.majoreThreshold)}</span>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className={`font-medium ${level.text}`}>{vat.headlineFr}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{vat.detailFr}</p>
        {vat.status.kind === 'WITHIN' && (
          <p className="mt-2 text-sm text-muted">
            Marge restante avant le seuil majoré&nbsp;:{' '}
            <strong className="font-semibold text-ink tabular-nums">
              {price(vat.status.headroom)}
            </strong>
          </p>
        )}
      </div>
    </section>
  );
}
