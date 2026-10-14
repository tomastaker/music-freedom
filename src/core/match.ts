import type { Track } from "./track";

export type MatchLevel = "isrc" | "high" | "medium";
export type Match = { level: MatchLevel; candidate: Track };

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const NOISE_WORDS =
  "featuring|feat|ft|with|prod|remaster|remastered|mono|stereo|radio edit|single version|album version|explicit|bonus track";
// Пометки, которые сервисы пишут по-разному: в скобках, после « - » или в отдельном поле версии.
// «Live», «Acoustic», «Remix» не убираются: это другая запись, а не другая подпись к той же.
const BRACKETED_NOISE = new RegExp(String.raw`[([][^)\]]*\b(?:${NOISE_WORDS})\b[^)\]]*[)\]]`, "gi");
const DASH_NOISE = new RegExp(String.raw`\s-\s[^-]*\b(?:${NOISE_WORDS})\b.*$`, "i");
const BARE_FEAT = /\s(?:featuring|feat\.?|ft\.)\s.*$/i;

export function normalize(text: string): string {
  const cleaned = text.replace(BRACKETED_NOISE, " ").replace(DASH_NOISE, " ").replace(BARE_FEAT, " ");
  // Транслитерация до NFKD: иначе «й» распадётся на «и» с диакритикой.
  const latin = [...cleaned.toLowerCase()].map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch).join("");
  const plain = latin
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ");
  return plain.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Название вместе с версией: Spotify пишет версию в названии, Яндекс в отдельном поле. */
const fullTitle = (t: Track) => normalize(t.version ? `${t.title} (${t.version})` : t.title);

function sameArtist(a: Track, b: Track): boolean {
  const left = a.artists.map(normalize).filter(Boolean);
  const right = new Set(b.artists.map(normalize).filter(Boolean));
  return left.some(
    (name) => right.has(name) || [...right].some((other) => other.includes(name) || name.includes(other)),
  );
}

/** Сравнивает трек-источник с кандидатом из другого сервиса. */
export function compare(source: Track, candidate: Track): MatchLevel | null {
  if (source.isrc && candidate.isrc && source.isrc.toUpperCase() === candidate.isrc.toUpperCase()) return "isrc";
  if (fullTitle(source) !== fullTitle(candidate) || !sameArtist(source, candidate)) return null;
  const durationDiff = Math.abs(source.durationMs - candidate.durationMs);
  if (durationDiff <= 3000) return "high";
  return durationDiff <= 15000 ? "medium" : null;
}

const RANK: Record<MatchLevel, number> = { isrc: 3, high: 2, medium: 1 };

export function bestMatch(source: Track, candidates: Track[]): Match | null {
  let best: Match | null = null;
  for (const candidate of candidates) {
    const level = compare(source, candidate);
    if (level && (!best || RANK[level] > RANK[best.level])) best = { level, candidate };
  }
  return best;
}

/** Библиотека, в которой быстро ищется уже имеющийся трек: по ISRC или по нормализованному названию. */
export class LibraryIndex {
  private readonly byIsrc = new Map<string, Track>();
  private readonly byTitle = new Map<string, Track[]>();

  constructor(tracks: Track[]) {
    for (const track of tracks) {
      if (track.isrc) this.byIsrc.set(track.isrc.toUpperCase(), track);
      const key = fullTitle(track);
      this.byTitle.set(key, [...(this.byTitle.get(key) ?? []), track]);
    }
  }

  find(source: Track): Match | null {
    const byIsrc = source.isrc && this.byIsrc.get(source.isrc.toUpperCase());
    if (byIsrc) return { level: "isrc", candidate: byIsrc };
    return bestMatch(source, this.byTitle.get(fullTitle(source)) ?? []);
  }
}
