// ── Official Tour de France 2026 route — all 21 stages preloaded (§3) ─────────
// type = profile classification for the model. summitFinish = uphill finish
// (distinct growth shape). doubleSprint = double intermediate → extra green pts.
// Rest days: Jul 13 and Jul 20.

import type { Stage } from './types';

// 2026 points scale: flat-stage winner 70 green pts, medium/hilly winner 50,
// mountain winner 20; each intermediate sprint ~25 pts to the winner. KOM totals
// are per-stage estimates (editable on the Stages & Data page; calibration also
// corrects them). sprintPtsOnOffer = finish points + intermediateSprints × 25.
export const STAGES_2026: Stage[] = [
  { stage: 1,  date: 'Jul4',  type: 'ttt',       route: 'Barcelona (Spain)',                        km: 19.7, note: 'team time trial opener',          sprintPtsOnOffer: 0,   intermediateSprints: 0, mtnPtsOnOffer: 0 },
  { stage: 2,  date: 'Jul5',  type: 'hilly',     route: 'Tarragona → Barcelona (Montjuïc)',         km: 178,  note: 'punchy Montjuïc finish',          sprintPtsOnOffer: 75,  intermediateSprints: 1, mtnPtsOnOffer: 12 },
  { stage: 3,  date: 'Jul6',  type: 'high_mtn',  route: 'Granollers → Les Angles',                  km: 196,  note: 'first mountains',                 sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 65, summitFinish: true },
  { stage: 4,  date: 'Jul7',  type: 'hilly',     route: 'Carcassonne → Foix',                       km: 182,  note: 'rolling, break-friendly',         sprintPtsOnOffer: 75,  intermediateSprints: 1, mtnPtsOnOffer: 25 },
  { stage: 5,  date: 'Jul8',  type: 'flat',      route: 'Lannemezan → Pau',                         km: 158,  note: 'sprint (double sprint)',          sprintPtsOnOffer: 120, intermediateSprints: 2, mtnPtsOnOffer: 5,  doubleSprint: true },
  { stage: 6,  date: 'Jul9',  type: 'summit',    route: 'Pau → Gavarnie-Gèdre',                     km: 186,  note: 'summit finish (Tourmalet + Aspin)', sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 60, summitFinish: true },
  { stage: 7,  date: 'Jul10', type: 'flat',      route: 'Hagetmau → Bordeaux',                      km: 175,  note: 'sprint (double sprint)',          sprintPtsOnOffer: 120, intermediateSprints: 2, mtnPtsOnOffer: 0,  doubleSprint: true },
  { stage: 8,  date: 'Jul11', type: 'flat',      route: 'Périgueux → Bergerac',                     km: 182,  note: 'sprint',                          sprintPtsOnOffer: 95,  intermediateSprints: 1, mtnPtsOnOffer: 0 },
  { stage: 9,  date: 'Jul12', type: 'hilly',     route: 'Malemort → Ussel',                         km: 185,  note: 'hilly breakaway day',             sprintPtsOnOffer: 75,  intermediateSprints: 1, mtnPtsOnOffer: 20 },
  { stage: 10, date: 'Jul14', type: 'high_mtn',  route: 'Aurillac → Le Lioran',                     km: 167,  note: 'Massif Central (Bastille Day)',   sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 55, summitFinish: true },
  { stage: 11, date: 'Jul15', type: 'flat',      route: 'Vichy → Nevers',                           km: 161,  note: 'sprint',                          sprintPtsOnOffer: 95,  intermediateSprints: 1, mtnPtsOnOffer: 0 },
  { stage: 12, date: 'Jul16', type: 'flat',      route: 'Magny-Cours → Chalon-sur-Saône',           km: 181,  note: 'last sprint chance (double sprint)', sprintPtsOnOffer: 120, intermediateSprints: 2, mtnPtsOnOffer: 5,  doubleSprint: true },
  { stage: 13, date: 'Jul17', type: 'hilly',     route: 'Dole → Belfort',                           km: 205,  note: 'hilly Jura (Ballon d\'Alsace)',   sprintPtsOnOffer: 75,  intermediateSprints: 1, mtnPtsOnOffer: 30 },
  { stage: 14, date: 'Jul18', type: 'high_mtn',  route: 'Mulhouse → Le Markstein Fellering',        km: 155,  note: 'Vosges (Grand Ballon)',           sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 55, summitFinish: true },
  { stage: 15, date: 'Jul19', type: 'summit',    route: 'Champagnole → Plateau de Solaison',        km: 184,  note: 'summit finish (new climb, 11km @9%)', sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 60, summitFinish: true },
  { stage: 16, date: 'Jul21', type: 'hilly_itt', route: 'Évian-les-Bains → Thonon-les-Bains',       km: 26,   note: 'ONLY individual TT — hilly',      sprintPtsOnOffer: 0,   intermediateSprints: 0, mtnPtsOnOffer: 5 },
  { stage: 17, date: 'Jul22', type: 'flat',      route: 'Chambéry → Voiron',                        km: 175,  note: 'last sprint before Alps',         sprintPtsOnOffer: 95,  intermediateSprints: 1, mtnPtsOnOffer: 10 },
  { stage: 18, date: 'Jul23', type: 'summit',    route: 'Voiron → Orcières-Merlette',               km: 185,  note: 'summit finish (7km @6.5%)',       sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 40, summitFinish: true },
  { stage: 19, date: 'Jul24', type: 'summit',    route: 'Gap → Alpe d\'Huez',                       km: 128,  note: 'Alpe d\'Huez (1st), short/explosive', sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 45, summitFinish: true },
  { stage: 20, date: 'Jul25', type: 'summit',    route: 'Le Bourg-d\'Oisans → Alpe d\'Huez',        km: 171,  note: 'queen stage, Croix de Fer + Galibier', sprintPtsOnOffer: 45,  intermediateSprints: 1, mtnPtsOnOffer: 80, summitFinish: true },
  { stage: 21, date: 'Jul26', type: 'hilly',     route: 'Thoiry → Paris (Champs-Élysées)',          km: 130,  note: 'Montmartre climbs then sprint',   sprintPtsOnOffer: 75,  intermediateSprints: 1, mtnPtsOnOffer: 15 },
];

export const LAST_STAGE = 21;
export const REST_DAYS = ['Jul13', 'Jul20'];

export function getStage(n: number): Stage | undefined {
  return STAGES_2026.find((s) => s.stage === n);
}

export function isTTT(stage: Stage): boolean {
  return stage.type === 'ttt';
}

export function isITT(stage: Stage): boolean {
  return stage.type === 'hilly_itt';
}

/**
 * Stage blocks between rest days: 1–9, 10–15, 16–21 (rest days Jul13 & Jul20).
 * The forward-planning horizon is "how many stages until the next rest day",
 * so the optimizer naturally values a rider over the rest of the current block
 * rather than a fixed user-chosen depth. Capped so far stages don't dominate.
 */
export function autoHorizonDepth(fromStage: number, cap = 4): number {
  const blockEnds = [9, 15, LAST_STAGE];
  const end = blockEnds.find((e) => e >= fromStage) ?? LAST_STAGE;
  return Math.max(1, Math.min(cap, end - fromStage + 1));
}
