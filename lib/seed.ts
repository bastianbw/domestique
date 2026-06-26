// Seed/sample start list (§7 deliverable #6) — a plausible ~40-rider field so
// every screen is demonstrable before the real Holdet list drops. Replace it on
// the Stages & Data page by importing the real start list. NOT real prices.

import type { Rider, Archetype } from '@/engine/types';

let seq = 0;
function mk(
  name: string,
  team: string,
  archetype: Archetype,
  priceM: number,
  o: Partial<Rider> = {},
): Rider {
  return {
    id: `r${++seq}`,
    name,
    team,
    archetype,
    price: Math.round(priceM * 1_000_000),
    form: o.form ?? 70,
    pcsRank: o.pcsRank ?? 50,
    teamStrength: o.teamStrength ?? 70,
    injury: o.injury ?? 'fit',
    breakawayTendency: o.breakawayTendency ?? 15,
    gcPosition: o.gcPosition,
    jerseys: o.jerseys,
    sprintTrainSupport: o.sprintTrainSupport,
    oddsByStage: o.oddsByStage,
    ownershipPct: o.ownershipPct,
  };
}

export function seedRiders(): Rider[] {
  seq = 0;
  return [
    // GC / climbers
    mk('Tadej Pogacar', 'UAE Emirates', 'gc', 12.0, { form: 95, pcsRank: 1, teamStrength: 92, gcPosition: 1, ownershipPct: 70 }),
    mk('Jonas Vingegaard', 'Visma-LAB', 'gc', 11.5, { form: 93, pcsRank: 2, teamStrength: 90, gcPosition: 2, ownershipPct: 65 }),
    mk('Remco Evenepoel', 'Soudal QuickStep', 'gc', 10.5, { form: 90, pcsRank: 3, teamStrength: 84, gcPosition: 3, ownershipPct: 45 }),
    mk('Primoz Roglic', 'Red Bull-BORA', 'gc', 9.5, { form: 86, pcsRank: 6, teamStrength: 85, gcPosition: 5 }),
    mk('Carlos Rodriguez', 'INEOS', 'gc', 7.5, { form: 82, pcsRank: 12, teamStrength: 80, gcPosition: 8 }),
    mk('Felix Gall', 'Decathlon-AG2R', 'climber', 6.5, { form: 81, pcsRank: 18, teamStrength: 74 }),
    mk('Santiago Buitrago', 'Bahrain', 'climber', 6.0, { form: 80, pcsRank: 22, teamStrength: 72, breakawayTendency: 45 }),
    mk('Sepp Kuss', 'Visma-LAB', 'climber', 6.5, { form: 79, pcsRank: 20, teamStrength: 90 }),
    mk('Enric Mas', 'Movistar', 'climber', 5.5, { form: 78, pcsRank: 24, teamStrength: 70 }),
    mk('Adam Yates', 'UAE Emirates', 'climber', 6.0, { form: 80, pcsRank: 16, teamStrength: 92 }),

    // Puncheurs
    mk('Mathieu van der Poel', 'Alpecin-Deceuninck', 'puncheur', 9.0, { form: 90, pcsRank: 5, teamStrength: 82, breakawayTendency: 40, ownershipPct: 50 }),
    mk('Wout van Aert', 'Visma-LAB', 'puncheur', 8.5, { form: 87, pcsRank: 7, teamStrength: 90, breakawayTendency: 30, ownershipPct: 48 }),
    mk('Julian Alaphilippe', 'Tudor', 'puncheur', 5.0, { form: 76, pcsRank: 35, teamStrength: 62, breakawayTendency: 55 }),
    mk('Tom Pidcock', 'Q36.5', 'puncheur', 6.0, { form: 81, pcsRank: 19, teamStrength: 60, breakawayTendency: 35 }),
    mk('Marc Hirschi', 'Tudor', 'puncheur', 5.5, { form: 79, pcsRank: 26, teamStrength: 62, breakawayTendency: 40 }),

    // Sprinters
    mk('Jasper Philipsen', 'Alpecin-Deceuninck', 'sprinter', 8.0, { form: 88, pcsRank: 8, teamStrength: 82, sprintTrainSupport: 85, ownershipPct: 55 }),
    mk('Jonathan Milan', 'Lidl-Trek', 'sprinter', 7.5, { form: 87, pcsRank: 9, teamStrength: 80, sprintTrainSupport: 82, ownershipPct: 52 }),
    mk('Biniam Girmay', 'Intermarche', 'sprinter', 6.5, { form: 82, pcsRank: 15, teamStrength: 66, sprintTrainSupport: 68 }),
    mk('Dylan Groenewegen', 'Jayco', 'sprinter', 5.5, { form: 79, pcsRank: 28, teamStrength: 64, sprintTrainSupport: 70 }),
    mk('Arnaud De Lie', 'Lotto', 'sprinter', 5.5, { form: 80, pcsRank: 25, teamStrength: 58, sprintTrainSupport: 66 }),
    mk('Tim Merlier', 'Soudal QuickStep', 'sprinter', 6.5, { form: 84, pcsRank: 14, teamStrength: 84, sprintTrainSupport: 80 }),
    mk('Fabio Jakobsen', 'Picnic-PostNL', 'sprinter', 4.5, { form: 74, pcsRank: 40, teamStrength: 60, sprintTrainSupport: 64 }),

    // Rouleurs / TT
    mk('Filippo Ganna', 'INEOS', 'rouleur', 6.0, { form: 83, pcsRank: 13, teamStrength: 80 }),
    mk('Stefan Kung', 'Groupama-FDJ', 'rouleur', 4.5, { form: 76, pcsRank: 38, teamStrength: 66 }),
    mk('Joshua Tarling', 'INEOS', 'rouleur', 5.0, { form: 80, pcsRank: 27, teamStrength: 80 }),

    // Breakaway specialists
    mk('Ben Healy', 'EF Education', 'breakaway', 5.0, { form: 80, pcsRank: 30, teamStrength: 62, breakawayTendency: 80 }),
    mk('Mathieu Burgaudeau', 'TotalEnergies', 'breakaway', 3.0, { form: 70, pcsRank: 70, teamStrength: 50, breakawayTendency: 85 }),
    mk('Victor Campenaerts', 'Visma-LAB', 'breakaway', 3.5, { form: 72, pcsRank: 60, teamStrength: 90, breakawayTendency: 75 }),
    mk('Quinten Hermans', 'Alpecin-Deceuninck', 'breakaway', 3.0, { form: 69, pcsRank: 75, teamStrength: 82, breakawayTendency: 70 }),

    // Domestiques / value fillers
    mk('Tiesj Benoot', 'Visma-LAB', 'domestique', 3.5, { form: 72, pcsRank: 55, teamStrength: 90 }),
    mk('Nils Politt', 'UAE Emirates', 'domestique', 3.5, { form: 73, pcsRank: 52, teamStrength: 92 }),
    mk('Michal Kwiatkowski', 'INEOS', 'domestique', 4.0, { form: 74, pcsRank: 45, teamStrength: 80, breakawayTendency: 40 }),
    mk('Matteo Trentin', 'Tudor', 'domestique', 3.5, { form: 72, pcsRank: 58, teamStrength: 62, breakawayTendency: 35 }),
    mk('Mattias Skjelmose', 'Lidl-Trek', 'gc', 6.0, { form: 81, pcsRank: 17, teamStrength: 80, gcPosition: 9 }),
    mk('Kevin Vauquelin', 'Arkea', 'puncheur', 5.0, { form: 79, pcsRank: 29, teamStrength: 56, breakawayTendency: 45 }),
    mk('Oscar Onley', 'Picnic-PostNL', 'climber', 4.5, { form: 78, pcsRank: 32, teamStrength: 60 }),
    mk('Romain Bardet', 'Picnic-PostNL', 'climber', 4.0, { form: 75, pcsRank: 42, teamStrength: 60, breakawayTendency: 40 }),
    mk('Pello Bilbao', 'Bahrain', 'climber', 5.0, { form: 78, pcsRank: 31, teamStrength: 72, breakawayTendency: 35 }),
    mk('Simon Yates', 'Visma-LAB', 'climber', 5.5, { form: 80, pcsRank: 23, teamStrength: 90 }),
    mk('Maxim Van Gils', 'Red Bull-BORA', 'puncheur', 4.5, { form: 77, pcsRank: 36, teamStrength: 85, breakawayTendency: 40 }),
  ];
}
