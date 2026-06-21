'use client';
import type { StageType } from '@/engine/types';

// A mini elevation-profile motif per stage type — the roadbook signature.
const PROFILES: Record<StageType, string> = {
  flat:      'M0,34 L20,33 L45,34 L70,32 L100,33 L130,34 L160,33 L200,34',
  hilly:     'M0,34 L20,30 L35,22 L50,30 L70,18 L88,28 L110,16 L130,26 L150,20 L175,30 L200,34',
  summit:    'M0,36 L40,34 L70,30 L100,24 L130,16 L160,8 L185,4 L200,3',
  high_mtn:  'M0,34 L25,26 L45,12 L65,24 L90,8 L115,22 L140,6 L165,18 L190,6 L200,8',
  ttt:       'M0,32 L40,31 L80,32 L120,31 L160,32 L200,31',
  hilly_itt: 'M0,34 L30,28 L60,32 L90,22 L120,30 L150,20 L180,28 L200,24',
};

const COLOR: Record<StageType, string> = {
  flat: '#19b35a',
  hilly: '#19b35a',
  summit: '#e23b3b',
  high_mtn: '#e23b3b',
  ttt: '#f5d406',
  hilly_itt: '#f5d406',
};

export function Elevation({ type, className = '' }: { type: StageType; className?: string }) {
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" className={`elev ${className}`} aria-hidden>
      <path d={`${PROFILES[type]} L200,40 L0,40 Z`} fill={COLOR[type]} opacity="0.12" />
      <path d={PROFILES[type]} fill="none" stroke={COLOR[type]} strokeWidth="1.5" opacity="0.85" />
    </svg>
  );
}

export const STAGE_TYPE_LABEL: Record<StageType, string> = {
  flat: 'Flat',
  hilly: 'Hilly',
  summit: 'Summit',
  high_mtn: 'High Mtn',
  ttt: 'TTT',
  hilly_itt: 'ITT',
};
