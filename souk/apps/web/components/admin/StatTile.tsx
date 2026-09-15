import Link from 'next/link';

/**
 * A hero number, not a chart. The data's job here is a single magnitude the
 * operator either acts on or ignores — a plot would add ink without adding
 * information.
 */
export function StatTile({
  label, value, hint, href, tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'serious' | 'critical';
}) {
  // Status colour is paired with the label text below; it never carries the
  // meaning on its own.
  const toneClass = {
    neutral: 'text-ink',
    good: 'text-good',
    warning: 'text-warning',
    serious: 'text-serious',
    critical: 'text-critical',
  }[tone];

  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );

  const className =
    'block rounded-xl border border-line bg-white p-4' +
    (href ? ' transition hover:border-olive/40' : '');

  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}
