/**
 * Phase 26, section 4 — lecture par le code des paramètres d'une présentation (pur) : équipes et natures en liste
 * libre (« casino, paris », « vidéos et clés »), date d'absence (« lundi », « demain », « 26/10 », « 2026-10-26 »).
 */
import { normalizeText } from "../../human/answer";
import { addDaysToDay, parisDay, parisDayStart, parisWeekday } from "../../rules/time";
import type { TeamMemberKind, TeamMemberTeam } from "../contract";
import { teamOf } from "../resolve";

function pieces(raw: string): string[] {
  return normalizeText(raw)
    .split(/\s*(?:,|;|\/|\+|&|\bet\b|\bou\b)\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ADS = new Set(["ads", "pub", "pubs", "publicite", "publicites", "meta", "tiktok", "agent ads"]);

/** « casino, paris sportifs » → `["casino", "sports"]` ; mot inconnu → erreur (pur). */
export function parseTeamList(raw: string | undefined): { ok: true; teams: TeamMemberTeam[] } | { ok: false; error: string } {
  if (!raw?.trim()) return { ok: true, teams: [] };
  const out = new Set<TeamMemberTeam>();
  for (const p of pieces(raw)) {
    if (["toutes", "tout", "toutes les equipes", "tous"].includes(p)) return { ok: true, teams: [] };
    if (ADS.has(p)) {
      out.add("ads");
      continue;
    }
    const t = teamOf(p);
    if (!t || t === "all") return { ok: false, error: `équipe inconnue : ${p}` };
    out.add(t);
  }
  return { ok: true, teams: [...out] };
}

const KIND_WORDS: ReadonlyArray<readonly [RegExp, TeamMemberKind]> = [
  [/^(medias?|videos?|photos?|images?|visuels?|contenus?|captures?|rushs?|sources?)$/u, "media"],
  [/^(cles?|keys?|secrets?|mots? de passe|mdp|identifiants?|jetons?|tokens?|comptes?|acces)$/u, "secret"],
  [/^(choix|questions?|decisions?|reponses?|reglages?|cotes?)$/u, "choice"],
  [/^(validations?|valider|posts? a valider|relectures?|posts?)$/u, "validation"],
];

/** « vidéos et clés » → `["media", "secret"]` ; mot inconnu → ignoré (pur). */
export function parseKindList(raw: string | undefined): TeamMemberKind[] {
  if (!raw?.trim()) return [];
  const out = new Set<TeamMemberKind>();
  for (const p of pieces(raw)) {
    const words = p.replace(/^(les |des |la |le |l')/u, "");
    const hit = KIND_WORDS.find(([re]) => re.test(words));
    if (hit) out.add(hit[1]);
  }
  return [...out];
}

const WEEKDAYS: Record<string, number> = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };

/**
 * Date de retour (minuit de Paris du jour où la personne est de nouveau là) : « lundi » = le prochain lundi,
 * « demain », « 26/10 » (année en cours, ou suivante si la date est passée), « 2026-10-26 ». null si illisible (pur).
 */
export function parseReturnDate(raw: string | undefined, now: Date): Date | null {
  if (!raw?.trim()) return null;
  const n = normalizeText(raw).replace(/^(jusqu'?(a|au)|le|au|retour)\s+/u, "").replace(/\s+(prochain|matin|soir)$/u, "").trim();
  const today = parisDay(now);
  if (n === "demain") return parisDayStart(addDaysToDay(today, 1));
  if (n === "apres-demain" || n === "apres demain") return parisDayStart(addDaysToDay(today, 2));
  const first = n.split(" ")[0]!;
  if (WEEKDAYS[first]) {
    const wd = parisWeekday(now);
    let diff = (WEEKDAYS[first] - wd + 7) % 7;
    if (diff === 0) diff = 7;
    return parisDayStart(addDaysToDay(today, diff));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n);
  if (iso) return parisDayStart(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(n);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    const pad = (x: number) => String(x).padStart(2, "0");
    let day = `${y}-${pad(m)}-${pad(d)}`;
    if (!dm[3] && day <= today) {
      y += 1;
      day = `${y}-${pad(m)}-${pad(d)}`;
    }
    return parisDayStart(day);
  }
  const named = /^(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)$/u.exec(n);
  if (named) {
    const months = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
    return parseReturnDate(`${named[1]}/${months.indexOf(named[2]!) + 1}`, now);
  }
  return null;
}
