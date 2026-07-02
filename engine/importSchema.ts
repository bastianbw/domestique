// ── Import-block parsing & tolerant name matching (§9) ───────────────────────
// The Phase-2 daily bridge: free Claude-in-chat emits one JSON block; the app
// parses it here. Rider-name matching is normalised + fuzzy so minor spelling
// differences from PCS don't break the import, and unmatched names are reported.

import type {
  ImportBlock,
  StageResultBlock,
  OddsBlock,
  StartlistBlock,
  WeatherBlock,
  NewsBlock,
  FeaturesBlock,
  Rider,
} from './types';

/** Normalise a rider name for matching: lowercase, strip accents & punctuation. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised name with its tokens sorted — for order-insensitive matching. */
export function sortTokens(normalized: string): string {
  return normalized.split(' ').filter(Boolean).sort().join(' ');
}

/** Levenshtein distance (small strings, fine to compute directly). */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export interface NameMatch {
  riderId: string | null;
  score: number; // 0..1, 1 = exact normalised match
}

/**
 * Match an imported name against the roster. Tries exact normalised match,
 * then last-name match, then fuzzy distance. Returns best candidate + score.
 */
export function matchRider(name: string, roster: Rider[]): NameMatch {
  const target = normalizeName(name);
  if (!target) return { riderId: null, score: 0 };

  const targetSorted = sortTokens(target);

  let best: NameMatch = { riderId: null, score: 0 };
  for (const r of roster) {
    const cand = normalizeName(r.name);
    let score = 0;
    if (cand === target) {
      score = 1;
    } else if (sortTokens(cand) === targetSorted) {
      // same words in any order — e.g. PCS "Pogacar Tadej" vs "Tadej Pogacar"
      score = 0.98;
    } else {
      // last-name token overlap
      const tTokens = target.split(' ');
      const cTokens = cand.split(' ');
      const lastEqual = tTokens[tTokens.length - 1] === cTokens[cTokens.length - 1];
      // also treat a shared token (e.g. distinctive surname) as a strong signal
      const shared = cTokens.some((t) => t.length > 2 && tTokens.includes(t));
      const dist = levenshtein(cand, target);
      const maxLen = Math.max(cand.length, target.length);
      const fuzzy = 1 - dist / maxLen;
      score = lastEqual || shared ? Math.max(fuzzy, 0.85) : fuzzy;
    }
    if (score > best.score) best = { riderId: r.id, score };
  }
  // Require a reasonable confidence to claim a match.
  if (best.score < 0.6) return { riderId: null, score: best.score };
  return best;
}

export interface ParseResult<T> {
  ok: boolean;
  block?: T;
  errors: string[];
}

/** Parse a raw pasted string into a validated import block. */
export function parseImportBlock(raw: string): ParseResult<ImportBlock> {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: ['Not valid JSON. Paste one block, e.g. {"type":"stageResult",...}'] };
  }
  return validateBlock(json);
}

/**
 * Validate an already-parsed block object (used both for a single pasted block
 * and for each element of an array — the collector publishes `[result, weather]`).
 */
export function validateBlock(json: any): ParseResult<ImportBlock> {
  if (!json || typeof json !== 'object') {
    return { ok: false, errors: ['Block must be a JSON object.'] };
  }
  switch (json.type) {
    case 'stageResult':
      return validateStageResult(json);
    case 'odds':
      return validateOdds(json);
    case 'startlist':
      return validateStartlist(json);
    case 'weather':
      return validateWeather(json);
    case 'news':
      return validateNews(json);
    case 'features':
      return validateFeatures(json);
    default:
      return { ok: false, errors: [`Unknown block type "${json.type}". Expected stageResult | odds | startlist | weather | news | features.`] };
  }
}

function validateStageResult(json: any): ParseResult<StageResultBlock> {
  const errors: string[] = [];
  if (typeof json.stage !== 'number') errors.push('stageResult needs a numeric "stage".');
  if (!Array.isArray(json.results)) errors.push('stageResult needs a "results" array.');
  else {
    json.results.forEach((r: any, i: number) => {
      if (typeof r.rider !== 'string') errors.push(`results[${i}] missing "rider".`);
      if (typeof r.pos !== 'number') errors.push(`results[${i}] missing numeric "pos".`);
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: json as StageResultBlock, errors: [] };
}

function validateOdds(json: any): ParseResult<OddsBlock> {
  const errors: string[] = [];
  if (typeof json.stage !== 'number') errors.push('odds block needs a numeric "stage".');
  if (!Array.isArray(json.odds)) errors.push('odds block needs an "odds" array.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: json as OddsBlock, errors: [] };
}

function validateStartlist(json: any): ParseResult<StartlistBlock> {
  const errors: string[] = [];
  if (!Array.isArray(json.riders)) errors.push('startlist block needs a "riders" array.');
  else if (json.riders.length === 0) errors.push('startlist "riders" is empty.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: json as StartlistBlock, errors: [] };
}

function validateWeather(json: any): ParseResult<WeatherBlock> {
  if (typeof json.stage !== 'number') return { ok: false, errors: ['weather block needs a numeric "stage".'] };
  return { ok: true, block: json as WeatherBlock, errors: [] };
}

function validateNews(json: any): ParseResult<NewsBlock> {
  const errors: string[] = [];
  if (!Array.isArray(json.items)) errors.push('news block needs an "items" array.');
  else json.items.forEach((it: any, i: number) => {
    if (typeof it.rider !== 'string') errors.push(`items[${i}] missing "rider".`);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: json as NewsBlock, errors: [] };
}

function validateFeatures(json: any): ParseResult<FeaturesBlock> {
  const errors: string[] = [];
  if (!Array.isArray(json.riders)) errors.push('features block needs a "riders" array.');
  else json.riders.forEach((r: any, i: number) => {
    if (typeof r.rider !== 'string') errors.push(`riders[${i}] missing "rider".`);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, block: json as FeaturesBlock, errors: [] };
}

/**
 * Flexible free-text / CSV start-list parser (for the Stages & Data page).
 * Accepts lines like "Jasper Philipsen, Alpecin, sprinter, 9.5M" or tab/semly
 * separated. Returns parsed rows + warnings.
 */
export function parseStartlistText(text: string): {
  riders: StartlistBlock['riders'];
  warnings: string[];
} {
  const warnings: string[] = [];
  const riders: StartlistBlock['riders'] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    if (/^name[ ,;\t]+team/i.test(line)) continue; // header
    const parts = line.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length < 4) {
      warnings.push(`Line ${i + 1}: expected at least name, team, archetype, price.`);
      continue;
    }
    const [name, team, archetype, priceRaw, formRaw, rankRaw] = parts;
    const price = parsePrice(priceRaw);
    if (price === null) { warnings.push(`Line ${i + 1}: cannot read price "${priceRaw}".`); continue; }
    riders.push({
      name, team,
      archetype: archetype.toLowerCase() as any,
      price,
      form: formRaw ? Number(formRaw) : undefined,
      pcsRank: rankRaw ? Number(rankRaw) : undefined,
    });
  }
  return { riders, warnings };
}

/**
 * Parse a price into DKK, tolerant of European/Holdet formats:
 *   "9.5M", "9,5 mio", "9500000", "9.500.000", "9 500 000", "9,5", "kr 9.5M".
 * Thousands separators (dot/space between 3-digit groups) are stripped; a lone
 * comma/dot is a decimal. Bare numbers < 1000 are read as millions.
 */
export function parsePrice(raw: string): number | null {
  if (!raw) return null;
  let s = raw.toLowerCase().replace(/\s|kr\.?|dkk/g, '').trim();
  let unit: '' | 'M' | 'K' = '';
  if (/(mio|m)$/.test(s)) { unit = 'M'; s = s.replace(/(mio|m)$/, ''); }
  else if (/k$/.test(s)) { unit = 'K'; s = s.replace(/k$/, ''); }
  // "9.500.000" / "9,500,000" / "9.500,50" → strip thousands separators.
  if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(s)) {
    const dec = s.match(/[.,]\d{1,2}$/); // trailing 1-2 digit group = decimal
    s = dec ? s.slice(0, dec.index).replace(/[.,]/g, '') + '.' + dec[0].slice(1)
            : s.replace(/[.,]/g, '');
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (unit === 'M') return Math.round(n * 1_000_000);
  if (unit === 'K') return Math.round(n * 1_000);
  return n < 1000 ? Math.round(n * 1_000_000) : Math.round(n);
}
