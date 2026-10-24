/**
 * Phase 26 (chantier C) — « aide » du Boss : ce qu'il sait faire, groupé par thème, depuis les descriptions du
 * catalogue fermé (une seule source : ajouter une action au catalogue l'ajoute à l'aide), puis 5 exemples de phrases.
 * 25 lignes au plus, HTML Telegram échappé. Pur.
 */
import { esc } from "../admin/journal";
import type { BossAction, BossTheme } from "./contract";

export const BOSS_HELP_MAX_LINES = 25;

/** Titres des thèmes, dans l'ordre d'affichage. */
export const BOSS_THEME_LABELS: Record<BossTheme, string> = {
  guide: "Démarrer",
  etat: "État",
  chiffres: "Chiffres",
  demandes: "Demandes et validations",
  equipes: "Équipes",
  canaux: "Canaux",
  rencontres: "Rencontres",
  casino: "Casino",
  paris: "Paris sportifs",
  algorithme: "Algorithme",
  ads: "Pubs",
  tests: "Essais",
};

export const BOSS_HELP_EXAMPLES = [
  "mets le casino en pause",
  "combien j'ai dépensé ce mois ?",
  "passe le dating en vrai",
  "qu'est-ce qui attend ma réponse ?",
  "commencer",
] as const;

/** Une ligne de description ramenée à un fragment (« Met une équipe en pause. » → « met une équipe en pause »). */
function fragment(description: string): string {
  const d = description.trim().replace(/[.;:!\s]+$/u, "");
  return d.charAt(0).toLocaleLowerCase("fr-FR") + d.slice(1);
}

/** Longueur visée d'une ligne de thème (au-delà, « … » et la suite reste dans le catalogue). */
const MAX_LINE_CHARS = 220;

export function bossHelpText(catalog: readonly Pick<BossAction, "key" | "description" | "theme">[], name = "Kevin"): string {
  const byTheme = new Map<BossTheme, string[]>();
  for (const a of catalog) {
    if (!a.description?.trim()) continue;
    const list = byTheme.get(a.theme) ?? [];
    const f = fragment(a.description);
    if (f && !list.includes(f)) list.push(f);
    byTheme.set(a.theme, list);
  }
  const head = `🧭 <b>Ce que je sais faire</b> — écris-moi comme tu parles (texte ou vocal), ${esc(name)} s'occupe du reste.`;
  const examples = ["<b>Par exemple</b> :", ...BOSS_HELP_EXAMPLES.map((e) => `• « ${esc(e)} »`)];
  const room = BOSS_HELP_MAX_LINES - 1 - examples.length;
  const themes: string[] = [];
  for (const theme of Object.keys(BOSS_THEME_LABELS) as BossTheme[]) {
    const list = byTheme.get(theme);
    if (!list?.length) continue;
    let line = `<b>${esc(BOSS_THEME_LABELS[theme])}</b> : `;
    const parts: string[] = [];
    for (const f of list) {
      const next = [...parts, f].join(" · ");
      if (parts.length && next.length > MAX_LINE_CHARS) {
        parts.push("…");
        break;
      }
      parts.push(f);
    }
    line += esc(parts.join(" · "));
    themes.push(line);
  }
  // Plus de thèmes que de place : les derniers sont regroupés en une ligne.
  if (themes.length > room) {
    const kept = themes.slice(0, room - 1);
    const rest = (Object.keys(BOSS_THEME_LABELS) as BossTheme[])
      .filter((t) => byTheme.get(t)?.length)
      .slice(room - 1)
      .map((t) => BOSS_THEME_LABELS[t]);
    themes.splice(0, themes.length, ...kept, `<b>Aussi</b> : ${esc(rest.join(", "))}`);
  }
  return [head, ...themes, ...examples].slice(0, BOSS_HELP_MAX_LINES).join("\n");
}
