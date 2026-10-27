/**
 * Phase 31, chantier A (Sourceur) : source A, annuaires de canaux et places de marché de pub.
 *
 * tgstat.com, telemetr.io, tlgrm.eu, telegramchannels.me et telega.io (place de marché : un canal qui vend ses posts
 * affiche un prix → `Candidate.marketplace`, preuve d'ouverture aux deals). Pour chaque canal listé : username, titre,
 * abonnés annoncés (indicatifs), catégorie, adresse de la fiche.
 *
 * Parseurs HTML purs, testés sur fixtures (`packages/agents/fixtures/prospection/directories/`). Balisage relevé le
 * 26 octobre 2026 : tgstat (liste `peer-item-box`) et telega.io (`channels-item`, prix dans `amount` ou dans les données
 * des formats) sur les vraies pages ; telemetr.io et telegramchannels.me répondaient 403 et tlgrm.eu ne répondait pas :
 * leur balisage est supposé et la page qui ne lui correspond pas lève `DIRECTORY_LAYOUT_CHANGED` (source en pause,
 * aucune donnée fausse). Lecture par `politeProspectFetch` (10 s par domaine, robots.txt, pause 24 h sur 403 / captcha).
 * Les API payantes des annuaires ne sont pas utilisées (option notée pour le client).
 */
import { geoSignals } from "../../dict";
import type { Candidate, DiscoveryLot, ProspectionDeps } from "../../contract";
import { cleanUsername } from "../normalize";
import { ProspectFetchError, pauseSource, politeProspectFetch, sourcePause, sourcePauseKey, type PoliteProspectDeps } from "../polite";
import { emptyFind, errorText, htmlText, parseCount, type SourceFindResult } from "./common";

export type DirectoryKey = "tgstat" | "telemetr" | "tlgrm" | "telegramchannels" | "telega";

export type DirectoryListing = {
  username: string;
  title: string | null;
  subscribers: number | null;
  category: string | null;
  ficheUrl: string;
  marketplace: { url: string; price: string | null } | null;
};

/** La page ne ressemble plus à ce que le parseur connaît : pas de données fausses, la source passe en pause. */
export class DirectoryLayoutError extends Error {
  readonly code = "DIRECTORY_LAYOUT_CHANGED" as const;
  readonly directory: DirectoryKey;
  constructor(directory: DirectoryKey, detail: string) {
    super(`DIRECTORY_LAYOUT_CHANGED : la page de ${directory} a changé de structure (${detail}).`);
    this.name = "DirectoryLayoutError";
    this.directory = directory;
  }
}

type Directory = {
  key: DirectoryKey;
  host: string;
  label: string;
  /** Pages à lire pour un lot (verticale, langues, pays). */
  pages(lot: DiscoveryLot): string[];
  parse(html: string, pageUrl: string): DirectoryListing[];
};

const abs = (href: string, base: string) => {
  try {
    return new URL(href.replace(/&amp;/g, "&"), base).toString();
  } catch {
    return href;
  }
};

/** Découpe une page en blocs qui commencent par `marker` (le premier morceau, avant le premier bloc, est écarté). */
function blocks(html: string, marker: RegExp): string[] {
  const idx: number[] = [];
  for (const m of html.matchAll(new RegExp(marker.source, marker.flags.includes("g") ? marker.flags : `${marker.flags}g`))) idx.push(m.index!);
  return idx.map((start, i) => html.slice(start, idx[i + 1] ?? Math.min(html.length, start + 60_000)));
}

const first = (s: string, re: RegExp): string | null => s.match(re)?.[1] ?? null;

// ---------------------------------------------------------------- tgstat.com

/** tgstat : blocs `peer-item-box`, lien `…tgstat.com/channel/@nom`, titre `font-16`, « <b>2 091 922</b> subscribers ». */
export function parseTgstatList(html: string, pageUrl: string): DirectoryListing[] {
  if (!/lm-list-container|peer-item-box/.test(html)) throw new DirectoryLayoutError("tgstat", "liste introuvable");
  const category = first(pageUrl, /tgstat\.com\/(?:[a-z]{2}\/)?([a-z-]+)/i);
  const out: DirectoryListing[] = [];
  const items = blocks(html, /class="[^"]*peer-item-box/);
  for (const b of items) {
    const href = first(b, /href="((?:https?:)?\/\/[a-z.]*tgstat\.[a-z]+\/channel\/@[A-Za-z0-9_]+)\/?"/i) ?? first(b, /href="(\/channel\/@[A-Za-z0-9_]+)\/?"/i);
    // Un canal privé est listé par un identifiant (« /channel/AAAA… ») : pas de username public, on passe.
    const username = cleanUsername(href?.match(/@([A-Za-z0-9_]+)/)?.[1]);
    if (!href || !username) continue;
    out.push({
      username,
      title: htmlText(first(b, /<div class="font-16[^"]*">([\s\S]*?)<\/div>/)) || null,
      subscribers: parseCount(first(b, /<b>([\d\s\u00a0.,]+)<\/b>\s*(?:subscribers|members|abonnés|подписчик|участник)/i)),
      category,
      ficheUrl: abs(href, "https://tgstat.com/"),
      marketplace: null,
    });
  }
  if (items.length && !out.length && !/\/channel\/[A-Za-z0-9_-]+/.test(html)) throw new DirectoryLayoutError("tgstat", "aucun canal lisible");
  return out;
}

// ---------------------------------------------------------------- telemetr.io

/** telemetr : cartes `data-channel-card`, username `channel-card__username`, abonnés `channel-card__subscribers`. */
export function parseTelemetrList(html: string, pageUrl: string): DirectoryListing[] {
  if (!/data-channel-card|channels-catalog/.test(html)) throw new DirectoryLayoutError("telemetr", "catalogue introuvable");
  const out: DirectoryListing[] = [];
  for (const b of blocks(html, /<div[^>]+data-channel-card/)) {
    const username = cleanUsername(htmlText(first(b, /class="channel-card__username"[^>]*>([\s\S]*?)</)));
    const href = first(b, /href="([^"]*\/channels\/[^"]+)"/);
    if (!username || !href) continue;
    out.push({
      username,
      title: htmlText(first(b, /class="channel-card__name"[^>]*>([\s\S]*?)<\/a>/)) || null,
      subscribers: parseCount(htmlText(first(b, /class="channel-card__subscribers"[^>]*>([\s\S]*?)</))),
      category: htmlText(first(b, /class="channel-card__category"[^>]*>([\s\S]*?)</)) || null,
      ficheUrl: abs(href, pageUrl),
      marketplace: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- tlgrm.eu

/** tlgrm : `channels-list`, cartes `channel-card` vers `/channels/@nom`. */
export function parseTlgrmList(html: string, pageUrl: string): DirectoryListing[] {
  if (!/class="[^"]*channels-list/.test(html)) throw new DirectoryLayoutError("tlgrm", "liste introuvable");
  const category = first(pageUrl, /\/channels\/([a-z-]+)/i);
  const out: DirectoryListing[] = [];
  for (const b of blocks(html, /<a[^>]+class="[^"]*channel-card[ "]/)) {
    const href = first(b, /href="([^"]*\/channels\/@[A-Za-z0-9_]+)"/);
    const username = cleanUsername(href?.match(/@([A-Za-z0-9_]+)/)?.[1]);
    if (!href || !username) continue;
    out.push({
      username,
      title: htmlText(first(b, /class="channel-card__title"[^>]*>([\s\S]*?)<\/div>/)) || null,
      subscribers: parseCount(htmlText(first(b, /class="channel-card__subscribers"[^>]*>([\s\S]*?)<\/div>/))),
      category,
      ficheUrl: abs(href, pageUrl),
      marketplace: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- telegramchannels.me

/** telegramchannels.me : `channels-grid`, cartes `card channel` vers `/channels/<nom>`, « 12.3K members ». */
export function parseTelegramChannelsMeList(html: string, pageUrl: string): DirectoryListing[] {
  if (!/class="[^"]*channels-grid/.test(html)) throw new DirectoryLayoutError("telegramchannels", "grille introuvable");
  const out: DirectoryListing[] = [];
  for (const b of blocks(html, /<div class="card channel/)) {
    const href = first(b, /href="((?:https?:\/\/telegramchannels\.me)?\/channels\/[A-Za-z0-9_]+)\/?"/);
    const username = cleanUsername(href?.split("/").pop());
    if (!href || !username) continue;
    out.push({
      username,
      title: htmlText(first(b, /class="channel-title"[^>]*>([\s\S]*?)<\/h3>/)) || null,
      subscribers: parseCount(htmlText(first(b, /class="members"[^>]*>([\s\S]*?)</))),
      category: htmlText(first(b, /class="category"[^>]*>([\s\S]*?)</)) || null,
      ficheUrl: abs(href, pageUrl),
      marketplace: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- telega.io (place de marché)

/** Prix d'un post sur telega.io : montant affiché non nul, sinon premier `price_without_discount` des formats. */
export function telegaPrice(block: string): string | null {
  for (const m of block.matchAll(/<span class="b-rub">([^<]*)<\/span><span class='amount[^']*'>([\d\s.,]+)<\/span>/g)) {
    const amount = Number(m[2]!.replace(/\s/g, "").replace(",", "."));
    if (amount > 0) return `${m[2]!.trim()} ${m[1]!.trim() || "$"}`;
  }
  const raw = block.match(/price_without_discount(?:&quot;|")\s*:\s*(?:&quot;|")([\d.]+)(?:&quot;|")/);
  if (raw && Number(raw[1]) > 0) {
    const cur = first(block, /<span class="b-rub">([^<]*)<\/span>/)?.trim() || "$";
    return `${Number(raw[1])} ${cur}`;
  }
  return null;
}

/** telega.io : blocs `channels-item`, fiche `/channels/<nom>/card`, titre `channel_title`, `data-count` = abonnés. */
export function parseTelegaList(html: string, pageUrl: string): DirectoryListing[] {
  if (!/class="channels-item[ "]/.test(html)) {
    if (/class="[^"]*channels-list|catalog-empty|nothing-found/.test(html)) return [];
    throw new DirectoryLayoutError("telega", "catalogue introuvable");
  }
  const out: DirectoryListing[] = [];
  for (const b of blocks(html, /<div class="channels-item[ "]/)) {
    const name = first(b, /href="\/channels\/([A-Za-z0-9_]+)\/card/);
    const username = cleanUsername(name);
    if (!username || !name) continue;
    const ficheUrl = abs(`/channels/${name}/card`, pageUrl.startsWith("http") ? pageUrl : "https://telega.io/");
    out.push({
      username,
      title: htmlText(first(b, /<a class="channel_title"[^>]*>([\s\S]*?)<\/a>/)) || null,
      subscribers: parseCount(first(b, /channel-users-count[^"]*"[^>]*data-count="(\d+)"/) ?? first(b, /data-count="(\d+)"/)),
      category: htmlText(first(b, /<div class="crop-text">([\s\S]*?)<\/div>/)) || null,
      ficheUrl,
      marketplace: { url: ficheUrl, price: telegaPrice(b) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- catalogue des annuaires

const CAT = {
  tgstat: { SPORTS: "sport", CASINO: "gambling" },
  telemetr: { SPORTS: "sport", CASINO: "gambling" },
  tlgrm: { SPORTS: "sport", CASINO: "gambling" },
  telegramchannels: { SPORTS: "sports", CASINO: "gambling" },
  telega: { SPORTS: "sport", CASINO: "gambling" },
} as const;

/** Nom anglais d'un pays en adresse (« czech-republic ») ; « global » sans pays. */
function countrySlugs(lot: DiscoveryLot): string[] {
  const g = geoSignals().countries;
  const slugs = (lot.countries ?? []).map((c) => g[c.toUpperCase()]?.nameEn.replace(/\s+/g, "-")).filter((s): s is string => !!s);
  return slugs.length ? slugs : ["global"];
}

/** Au plus 4 langues par lot (rotation de la nuit). */
const langsOf = (lot: DiscoveryLot) => [...new Set(lot.languages.map((l) => l.toLowerCase()))].slice(0, 4);

export const DIRECTORIES: Record<DirectoryKey, Directory> = {
  tgstat: { key: "tgstat", host: "tgstat.com", label: "TGStat", pages: (lot) => [`https://tgstat.com/${CAT.tgstat[lot.vertical]}`], parse: parseTgstatList },
  telemetr: {
    key: "telemetr",
    host: "telemetr.io",
    label: "Telemetr",
    pages: (lot) => countrySlugs(lot).map((c) => `https://telemetr.io/en/catalog/${c}/${CAT.telemetr[lot.vertical]}`),
    parse: parseTelemetrList,
  },
  tlgrm: { key: "tlgrm", host: "tlgrm.eu", label: "tlgrm.eu", pages: (lot) => [`https://tlgrm.eu/channels/${CAT.tlgrm[lot.vertical]}`], parse: parseTlgrmList },
  telegramchannels: {
    key: "telegramchannels",
    host: "telegramchannels.me",
    label: "TelegramChannels.me",
    pages: (lot) => {
      const langs = langsOf(lot);
      const base = `https://telegramchannels.me/channels?category=${CAT.telegramchannels[lot.vertical]}`;
      return langs.length ? langs.map((l) => `${base}&lang=${l}`) : [base];
    },
    parse: parseTelegramChannelsMeList,
  },
  telega: {
    key: "telega",
    host: "telega.io",
    label: "telega.io",
    pages: (lot) => {
      const langs = langsOf(lot);
      const base = `https://telega.io/catalog?category=${CAT.telega[lot.vertical]}`;
      return langs.length ? langs.map((l) => `${base}&language=${l}`) : [base];
    },
    parse: parseTelegaList,
  },
};

export const DIRECTORY_KEYS = Object.keys(DIRECTORIES) as DirectoryKey[];

export function listingToCandidate(l: DirectoryListing, dir: DirectoryKey, lot: DiscoveryLot): Candidate {
  return {
    url: `https://t.me/${l.username}`,
    sourceType: "DIRECTORY",
    sourceDetail: l.ficheUrl,
    title: l.title,
    announcedSubscribers: l.subscribers,
    category: l.category ? `${dir}:${l.category}` : dir,
    marketplace: l.marketplace,
    vertical: lot.vertical,
    language: null,
  };
}

/** Lit les annuaires d'un lot ; un annuaire en pause, bloqué ou changé n'arrête pas les autres. */
export async function findDirectoryCandidates(deps: ProspectionDeps & PoliteProspectDeps, lot: DiscoveryLot, only?: DirectoryKey[]): Promise<SourceFindResult> {
  const res = emptyFind(`annuaires ${lot.vertical} ${langsOf(lot).join(",") || "toutes langues"}${lot.countries?.length ? ` ${lot.countries.join(",")}` : ""}`);
  const keys = only ?? DIRECTORY_KEYS;
  let pausedCount = 0;
  let earliest: Date | null = null;
  const notePause = (until: string | Date) => {
    pausedCount++;
    const d = new Date(until);
    if (!earliest || d < earliest) earliest = d;
  };
  for (const key of keys) {
    const dir = DIRECTORIES[key];
    const pauseKey = sourcePauseKey("directory", dir.host);
    const paused = await sourcePause(deps, pauseKey);
    if (paused) {
      notePause(paused.until);
      res.errors.push(`${dir.label} en pause jusqu'au ${paused.until} (${paused.reason}).`);
      continue;
    }
    for (const page of dir.pages(lot)) {
      let body: string;
      try {
        const r = await politeProspectFetch(deps, page, { kind: "directory" });
        if (r.status === 404) {
          res.errors.push(`${dir.label} : page absente (${page}).`);
          continue;
        }
        if (r.status < 200 || r.status >= 300) {
          res.errors.push(`${dir.label} : réponse ${r.status} (${page}).`);
          continue;
        }
        body = r.body;
      } catch (err) {
        res.errors.push(`${dir.label} : ${errorText(err)}`);
        if (err instanceof ProspectFetchError && (err.code === "blocked" || err.code === "paused")) {
          const p = await sourcePause(deps, pauseKey);
          if (p) notePause(p.until);
          break;
        }
        continue;
      }
      try {
        for (const l of dir.parse(body, page)) res.candidates.push(listingToCandidate(l, key, lot));
      } catch (err) {
        if (err instanceof DirectoryLayoutError) {
          const { until } = await pauseSource(deps, pauseKey, err.message);
          notePause(until);
          res.errors.push(err.message);
          break;
        }
        res.errors.push(`${dir.label} : ${errorText(err)}`);
      }
    }
  }
  if (pausedCount >= keys.length) {
    res.paused = true;
    res.pausedUntil = earliest;
  }
  return res;
}
