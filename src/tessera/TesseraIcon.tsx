import { useId } from "react";

const tiles = [
  { x: 22, y: 22, from: "#ff9dbd", to: "var(--tile-pink)" },
  { x: 54, y: 22, from: "#c3b9fa", to: "var(--tile-lavender)" },
  { x: 22, y: 54, from: "#7fe3d9", to: "var(--tile-teal)" },
  { x: 54, y: 54, from: "#f6c290", to: "var(--tile-amber)" },
];

/** Tessera's app icon: a navy rounded square holding a 2×2 grid of rounded tiles. */
export function TesseraIcon({ size = 96, animate = false, className = "" }: { size?: number; animate?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="Tessera app icon">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--tessera-navy)" />
          <stop offset="1" stopColor="var(--tessera-navy-deep)" />
        </linearGradient>
        {tiles.map((t, i) => (
          <linearGradient key={i} id={`${id}-t${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={t.from} />
            <stop offset="1" stopColor={t.to} />
          </linearGradient>
        ))}
      </defs>
      <rect width="100" height="100" rx="22" fill={`url(#${id}-bg)`} />
      {tiles.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width="24" height="24" rx="6" fill={`url(#${id}-t${i})`}
          className={animate ? "tessera-tile-anim" : undefined}
          style={animate ? { animationDelay: `${200 + i * 180}ms` } : undefined} />
      ))}
    </svg>
  );
}

export const tileColors = ["bg-tile-pink", "bg-tile-lavender", "bg-tile-teal", "bg-tile-amber"] as const;

export function TileBullet({ i }: { i: number }) {
  return <span aria-hidden="true" className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-[3px] ${tileColors[i % 4]}`} />;
}
