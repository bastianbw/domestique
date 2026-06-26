'use client';
import type { Archetype, StageType } from '@/engine/types';

// ──────────────────────────────────────────────────────────────────────────
// Custom SVG graphics system. Everything is vector + currentColor so it scales
// crisply, ships tiny, and works fully offline. No photo/licensing footprint.
// ──────────────────────────────────────────────────────────────────────────

type IconProps = { className?: string; size?: number };

/** Minimal cyclist-on-a-bike brand mark (monoline, inherits color). */
export function CyclistMark({ className = '', size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="23" r="5.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="24" cy="23" r="5.4" stroke="currentColor" strokeWidth="1.6" />
      {/* frame */}
      <path d="M8 23 L15 23 L20 14 L24 23 M15 23 L19 14 H22"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* rider */}
      <path d="M19 14 L21.5 8.5 M16 16.5 L20 13 L23.5 15"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.4" cy="7.4" r="1.9" fill="currentColor" />
    </svg>
  );
}

/** Wide peloton silhouette banner — decorative hero strip. */
export function PelotonBanner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 120" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <defs>
        <linearGradient id="pelo-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <g stroke="url(#pelo-fade)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {[0, 70, 140, 205, 270, 335].map((x, i) => (
          <g key={i} transform={`translate(${x + (i % 2 ? 8 : 0)}, ${i % 2 ? 8 : 0})`}>
            <circle cx="18" cy="92" r="14" />
            <circle cx="58" cy="92" r="14" />
            <path d="M18 92 L36 92 L48 64 L58 92 M36 92 L46 64 H52" />
            <path d="M46 64 L51 50 M30 70 L46 62 L60 67" />
            <circle cx="52.5" cy="48" r="4" fill="url(#pelo-fade)" stroke="none" />
          </g>
        ))}
      </g>
    </svg>
  );
}

// ── Archetype role glyphs ───────────────────────────────────────────────────
const ROLE_PATHS: Record<Archetype, React.ReactNode> = {
  sprinter: <path d="M13 2 L4 13 H10 L8 18 L16 6 H10 L13 2 Z" fill="currentColor" />, // bolt
  puncheur: <path d="M2 16 L8 8 L11 11 L17 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />, // steep ramp
  climber: <path d="M2 17 L8 5 L12 12 L15 8 L18 17 Z" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />, // peaks
  gc: <path d="M3 6 L6 10 L10 4 L14 10 L17 6 L16 16 H4 L3 6 Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />, // crown
  rouleur: <g stroke="currentColor" strokeWidth="1.6" fill="none"><circle cx="10" cy="10" r="7" /><path d="M10 6 V10 L13 12" strokeLinecap="round" /></g>, // clock / TT
  breakaway: <path d="M2 10 H9 M5 6 L10 10 L5 14 M12 5 L17 10 L12 15" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />, // forward arrows
  domestique: <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"><rect x="7" y="6" width="6" height="11" rx="2" /><path d="M8.5 6 V4 H11.5 V6" /></g>, // bidon
};

const ROLE_TONE: Record<Archetype, string> = {
  sprinter: 'text-emerald-300',
  puncheur: 'text-amber-300',
  climber: 'text-rose-300',
  gc: 'text-yellow',
  rouleur: 'text-sky-300',
  breakaway: 'text-orange-300',
  domestique: 'text-chalk-300',
};

export function RoleIcon({ role, className = '', size = 18 }: { role: Archetype } & IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={`${ROLE_TONE[role]} ${className}`} aria-hidden>
      {ROLE_PATHS[role]}
    </svg>
  );
}

/** Small role chip: glyph + label, neutral surface. */
export function RoleTag({ role, label }: { role: Archetype; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-ink-700/70 px-2 py-0.5 text-[11px] font-medium text-chalk-300">
      <RoleIcon role={role} size={13} />
      {label}
    </span>
  );
}

// ── Jersey icon ─────────────────────────────────────────────────────────────
const JERSEY_FILL: Record<string, string> = {
  yellow: '#f2c100', green: '#2fa866', polka: '#ffffff', white: '#ffffff', aggressive: '#e5544b',
};
export function Jersey({ kind, className = '', size = 16 }: { kind: string } & IconProps) {
  const fill = JERSEY_FILL[kind] ?? '#aab4c0';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={`${kind} jersey`}>
      <title>{`${kind} jersey`}</title>
      <path d="M8 3 L4 6 L2 10 L5 12 V20 H19 V12 L22 10 L20 6 L16 3 C15 5 9 5 8 3 Z"
        fill={fill} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" strokeLinejoin="round" />
      {kind === 'polka' && (
        <g fill="#e5544b">
          <circle cx="9" cy="11" r="1.1" /><circle cx="13" cy="10" r="1.1" /><circle cx="11" cy="14" r="1.1" /><circle cx="15" cy="14" r="1.1" /><circle cx="8" cy="16" r="1.1" />
        </g>
      )}
    </svg>
  );
}

/** Captain mark — a filled star roundel. */
export function CaptainStar({ className = '', size = 16, active = true }: IconProps & { active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-label="captain">
      <circle cx="10" cy="10" r="9" fill={active ? '#f2c100' : 'none'} stroke={active ? 'none' : '#6f7a89'} strokeWidth="1.3" />
      <path d="M10 4.5 L11.6 8 L15.3 8.4 L12.5 11 L13.3 14.7 L10 12.8 L6.7 14.7 L7.5 11 L4.7 8.4 L8.4 8 Z"
        fill={active ? '#0d1117' : '#6f7a89'} />
    </svg>
  );
}

// ── Inline data-viz ─────────────────────────────────────────────────────────
/** A thin horizontal magnitude bar (0..1 of `value/max`). */
export function BarMeter({ value, max, tone = 'green', className = '' }:
  { value: number; max: number; tone?: 'green' | 'gold' | 'polka' | 'neutral'; className?: string }) {
  const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = tone === 'gold' ? '#f2c100' : tone === 'polka' ? '#e5544b' : tone === 'neutral' ? '#6f7a89' : '#2fa866';
  return (
    <span className={`relative inline-block h-1.5 w-full overflow-hidden rounded-full bg-ink-700 ${className}`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t * 100).toFixed(1)}%`, background: color }} />
    </span>
  );
}

/** Signed contribution bars centred on a zero baseline (for EV breakdown). */
export function ContribBar({ value, scale, tone }: { value: number; scale: number; tone?: 'green' | 'gold' | 'polka' }) {
  const t = scale > 0 ? Math.max(-1, Math.min(1, value / scale)) : 0;
  const pos = value >= 0;
  const color = tone === 'gold' ? '#f2c100' : tone === 'polka' ? '#e5544b' : pos ? '#2fa866' : '#e5544b';
  return (
    <span className="relative block h-2 w-full rounded-full bg-ink-700/70">
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink-400/70" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={pos
          ? { left: '50%', width: `${(t * 50).toFixed(1)}%`, background: color }
          : { right: '50%', width: `${(-t * 50).toFixed(1)}%`, background: color }}
      />
    </span>
  );
}

// ── Elevation profiles (richer than the old motif) ──────────────────────────
const PROFILES: Record<StageType, number[]> = {
  flat: [33, 33, 34, 32, 33, 34, 33, 34, 33, 34],
  hilly: [33, 28, 22, 29, 17, 27, 15, 25, 19, 30],
  summit: [37, 35, 31, 27, 22, 16, 11, 7, 4, 3],
  high_mtn: [33, 25, 12, 24, 8, 22, 6, 18, 6, 8],
  ttt: [32, 31, 32, 31, 32, 31, 32, 31, 32, 31],
  hilly_itt: [34, 29, 33, 24, 31, 22, 29, 21, 27, 24],
};

const STAGE_COLOR: Record<StageType, string> = {
  flat: '#2fa866', hilly: '#3fa3c4', summit: '#e5544b',
  high_mtn: '#e5544b', ttt: '#f2c100', hilly_itt: '#f2c100',
};

export function Elevation({ type, className = '' }: { type: StageType; className?: string }) {
  const ys = PROFILES[type];
  const color = STAGE_COLOR[type];
  const step = 200 / (ys.length - 1);
  const line = ys.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y}`).join(' ');
  const area = `${line} L200,40 L0,40 Z`;
  const gid = `elev-${type}`;
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" className={`elev ${className}`} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export const STAGE_TYPE_LABEL: Record<StageType, string> = {
  flat: 'Flat', hilly: 'Hilly', summit: 'Summit',
  high_mtn: 'High mountain', ttt: 'Team time trial', hilly_itt: 'Time trial',
};
