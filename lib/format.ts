// Display formatting helpers (Danish-flavoured DKK, growth, probabilities).

export function kr(n: number): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(Math.round(n));
  return `${sign}${abs.toLocaleString('da-DK')}`;
}

/** Compact growth, e.g. +212k / −1.3M */
export function growth(n: number): string {
  const sign = n < 0 ? '−' : '+';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Price like 9.513M — full-precision internally either way, this is just display. */
export function priceM(n: number): string {
  return `${(n / 1_000_000).toFixed(3)}M`;
}

export function pct(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

export function pct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/** A 0..1 heat value → an inline style background using the green jersey. */
export function heatStyle(value: number, max: number): React.CSSProperties {
  const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return { background: `rgba(25, 179, 90, ${(t * 0.55).toFixed(3)})` };
}

export const ARCHE_LABEL: Record<string, string> = {
  sprinter: 'Sprinter',
  puncheur: 'Puncheur',
  climber: 'Climber',
  gc: 'GC',
  rouleur: 'Rouleur',
  breakaway: 'Breakaway',
  domestique: 'Domestique',
};
