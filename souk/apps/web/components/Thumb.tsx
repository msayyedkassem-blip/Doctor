/**
 * Placeholder visual until real photography exists.
 *
 * Deliberately not a grey box: a warm tile with the product's initial keeps
 * the grid readable while shooting the catalogue, and makes it obvious at a
 * glance which products still lack an image.
 */
export function Thumb({ name, className = '' }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase();
  // Stable hue per product so the grid looks composed rather than random.
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 28% 88%), hsl(${(hue + 40) % 360} 24% 80%))`,
      }}
      aria-hidden="true"
    >
      <span
        className="font-display select-none opacity-40"
        style={{ fontSize: 'clamp(2rem, 18cqw, 5rem)', color: `hsl(${hue} 40% 28%)` }}
      >
        {initial}
      </span>
    </div>
  );
}
