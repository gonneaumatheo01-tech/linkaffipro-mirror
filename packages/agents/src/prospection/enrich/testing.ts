/**
 * Phase 31, chantier B — outils de test de l'Enrichisseur (aucun réseau). Jamais importé par le code de production.
 *
 * Date de référence des fixtures : `ENRICH_FIXTURE_NOW` = 2026-10-26T09:00:00Z (dates des posts calculées depuis elle :
 * passer `now: () => ENRICH_FIXTURE_NOW` ou une horloge simulée qui en part).
 *
 * Fixtures (`packages/agents/fixtures/prospection/`) : `tme/<nom>.html` (page t.me/<nom>), `tme-s/<nom>.html` et
 * `tme-s/<nom>.before-<id>.html` (aperçu t.me/s, 2e page), `linked/<hôte>_<chemin>.html` (page liée), `ai/<nom>.json`
 * (réponse Sonnet simulée), `ai/language-<nom>.json` (réponse Haiku de langue), `ai/invalid.txt`, `ai/invented-number.json`.
 *
 * Canaux et résultat attendu de `enrichProspect` :
 * | nom                  | contenu                                                        | statut attendu                      | raison / niveau attendu |
 * |----------------------|----------------------------------------------------------------|-------------------------------------|-------------------------|
 * | pronos_maxime        | FR pronos réel, 17 345 abonnés, 40 posts sur 2 pages, 1xbet + code MAXPRONO + Winamax, signature « Maxime », « Pub : @maxime_pub », chat @maxime_chat | ENRICHING + score enfilé | EU / FR, contact HIGH @maxime_pub, ROTATING → A attendu |
 * | calcio_vip_club      | IT VIP 49€/mese, Goldbet CALCIO10, linktr.ee/calciovip          | ENRICHING + score enfilé            | EU / IT, contacts MEDIUM (page liée : email, @calciovip_admin), EXCLUSIVE → B attendu |
 * | slots_kaiser         | DE casino slots, bet-at-home, « 12.4K subscribers » (arrondi)  | ENRICHING + score enfilé            | EU / DE, vertical CASINO, « Werbung: @kaiser_werbung » HIGH, EXCLUSIVE → A/B |
 * | apostas_portugal     | pt-PT : Primeira Liga, « desportivas », « equipa », Betano, Placard | ENRICHING + score enfilé       | EU / PT, ROTATING → B attendu |
 * | multi_bets_world     | même post en 5 langues, 22bet WORLD22                          | ENRICHING + score enfilé            | langue confirmée par Haiku, région UNKNOWN → C plafonné |
 * | fixed_matches_100    | « 100% sure fixed match », gains garantis, post d'injection     | ENRICHING + score enfilé            | riskFlags SCAM_FIXED_MATCHES + GUARANTEED_WINS → D par l'Évaluateur ; pas de graphe |
 * | no_preview_bets      | page sans « Preview channel », email dans la description       | ENRICHING + score enfilé            | tierReason « aperçu fermé : pas de posts lisibles », contact HIGH |
 * | groupe_paris_fr      | groupe 5 120 membres, « Admin : @paris_admin_fr »               | ENRICHING + score enfilé            | kind GROUP, aperçu fermé, contact HIGH |
 * | apuestas_mx_pro      | espagnol LatAm : Caliente, pesos, Liga MX, « ahorita »          | DISQUALIFIED (D)                    | « hors Europe : MX (…) », aucune lecture IA |
 * | palpites_brasil      | pt-BR : Brasileirão, R$, « esportivas », « galera », Estrelabet | DISQUALIFIED (D)                    | « hors Europe : BR (…) » |
 * | bot_odds_feed        | 250 310 abonnés, vues constantes, textes mécaniques, 2 pages    | DISQUALIFIED (D)                    | 3 signaux de faux + IA SUSPECT_BOT |
 * | repost_tips_all      | 100 % de posts transférés                                       | DISQUALIFIED (D)                    | « ne fait que transférer », authenticity REPOST |
 * | dead_pronos_2025     | dernier post il y a 40 jours                                    | DISQUALIFIED (D)                    | « abandonné : aucun post depuis 40 jours » |
 * | petit_prono_fr       | 912 abonnés, 40 à 70 vues par post                              | DISQUALIFIED (D)                    | « audience trop faible » |
 * | canal_introuvable    | page vide de Telegram (« Send Message »)                        | UNREADABLE                          | aucun canal public à ce nom |
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LlmProvider, LlmRequest } from "../../types";
import type { ProspectionWeb } from "../contract";

export const ENRICH_FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "prospection");
export const ENRICH_FIXTURE_NOW = new Date("2026-10-26T09:00:00Z");

/** Canaux des fixtures (voir le tableau en tête de fichier). */
export const ENRICH_FIXTURE_CHANNELS = [
  "pronos_maxime",
  "calcio_vip_club",
  "slots_kaiser",
  "apostas_portugal",
  "multi_bets_world",
  "fixed_matches_100",
  "no_preview_bets",
  "groupe_paris_fr",
  "apuestas_mx_pro",
  "palpites_brasil",
  "bot_odds_feed",
  "repost_tips_all",
  "dead_pronos_2025",
  "petit_prono_fr",
  "canal_introuvable",
] as const;

export function readEnrichFixture(rel: string): string {
  return readFileSync(join(ENRICH_FIXTURES_DIR, rel), "utf8");
}

const maybe = (rel: string): string | null => {
  const p = join(ENRICH_FIXTURES_DIR, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

export type FixtureWeb = ProspectionWeb & { calls: string[] };

/**
 * Faux `ProspectionWeb` qui sert les fixtures par adresse :
 * - `https://t.me/<nom>` → `tme/<nom>.html` ;
 * - `https://t.me/s/<nom>` → `tme-s/<nom>.html`, `?before=<id>` → `tme-s/<nom>.before-<id>.html` ; un canal qui a une
 *   page mais pas d'aperçu → redirection vers `https://t.me/<nom>` (comme Telegram) ;
 * - toute autre adresse → `linked/<hôte>_<chemin>.html` ; `robots.txt` et adresses inconnues → 404.
 * `extra` : réponses imposées par adresse (prioritaires). Garde chaque adresse demandée dans `calls`.
 */
export function fixtureWeb(extra: Record<string, { status?: number; body: string; finalUrl?: string }> = {}): FixtureWeb {
  const calls: string[] = [];
  return {
    calls,
    async fetchText(url) {
      calls.push(url);
      const forced = extra[url];
      if (forced) return { status: forced.status ?? 200, body: forced.body, finalUrl: forced.finalUrl ?? url };
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return { status: 404, body: "", finalUrl: url };
      if (/^(t\.me|telegram\.me)$/.test(u.hostname)) {
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === "s" && parts[1]) {
          const before = u.searchParams.get("before");
          const body = maybe(`tme-s/${parts[1]}${before ? `.before-${before}` : ""}.html`);
          if (body) return { status: 200, body, finalUrl: url };
          if (maybe(`tme/${parts[1]}.html`) && !before) return { status: 200, body: maybe(`tme/${parts[1]}.html`)!, finalUrl: `https://t.me/${parts[1]}` };
          return { status: 404, body: "", finalUrl: url };
        }
        const body = parts[0] ? maybe(`tme/${parts[0]}.html`) : null;
        return body ? { status: 200, body, finalUrl: url } : { status: 404, body: "", finalUrl: url };
      }
      const file = `linked/${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").replace(/\//g, "_")}.html`;
      const body = maybe(file);
      return body ? { status: 200, body, finalUrl: url } : { status: 404, body: "", finalUrl: url };
    },
    async search() {
      return [];
    },
  };
}

export type FakeProspectionLlm = LlmProvider & { calls: LlmRequest[] };

/**
 * Fausse IA de l'Enrichisseur. Clés de `map` : nom du canal (lecture Sonnet, repéré par « (https://t.me/<nom>) »
 * dans la demande) ou `lang:<nom>` (confirmation de langue Haiku, repérée par « Canal : @<nom> »). Valeur : texte ou
 * liste de textes rendus l'un après l'autre (le dernier se répète). Par défaut, `defaultFixtureResponses()`.
 * Clé absente → exception (« IA en panne »). 2 centimes par appel.
 */
export function fakeProspectionLlm(map: Record<string, string | string[]> = defaultFixtureResponses(), costCents = 2): FakeProspectionLlm {
  const calls: LlmRequest[] = [];
  const used = new Map<string, number>();
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const name = /\(https:\/\/t\.me\/([A-Za-z0-9_]+)\)/.exec(req.user)?.[1] ?? null;
      const langName = /Canal : @([A-Za-z0-9_?]+)/.exec(req.user)?.[1] ?? null;
      const key = req.model.includes("haiku") ? `lang:${langName}` : (name ?? "");
      const v = map[key];
      if (v === undefined) throw new Error(`pas de réponse simulée pour ${key}`);
      const list = Array.isArray(v) ? v : [v];
      const i = used.get(key) ?? 0;
      used.set(key, i + 1);
      return { text: list[Math.min(i, list.length - 1)]!, costCents };
    },
  };
}

/** Réponses des fixtures `ai/` par canal. */
export function defaultFixtureResponses(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ENRICH_FIXTURE_CHANNELS) {
    const body = maybe(`ai/${name}.json`);
    if (body) out[name] = body;
    const lang = maybe(`ai/language-${name}.json`);
    if (lang) out[`lang:${name}`] = lang;
  }
  return out;
}
