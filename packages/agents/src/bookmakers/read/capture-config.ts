/**
 * Phase 35 : la capture d'écran (agent Capture, phase 23) d'un pari lu sur un site du client retrouve le marché par la
 * recette `dom` APPRISE du site (règle 5 : plus de sélecteurs figés), avec l'adresse de la fiche du match lue par le
 * lecteur (`BookmakerEvent.url`). Connexion, bannière de cookies et recherche gardent les sélecteurs génériques de la
 * phase 23 (ou ceux du site s'il en a). Domaines permis : ceux du site et de sa recette validée. Règles pures.
 */
import type { BookmakerConfig, BookmakerSelectors } from "../../providers/screenshot/adapter";
import { BOOKMAKER_CONFIGS, bookmakerKey } from "../../providers/screenshot/adapters";
import { SPORTAZA_CONFIG } from "../../providers/screenshot/sportaza";
import type { DomStep } from "../contract";
import { candidateSelector } from "../transport/server";
import { allowedHostsOf } from "./core";
import type { ReadSite } from "./deps";
import type { ActiveRecipe } from "./recipe";

/** Candidats d'une étape → liste de sélecteurs séparés par des virgules (dernier bon d'abord) ; "" si aucun. */
export function stepSelector(step: DomStep | undefined | null): string {
  if (!step?.candidates?.length) return "";
  const order = typeof step.lastGood === "number" && step.lastGood >= 0 && step.lastGood < step.candidates.length ? [step.lastGood, ...step.candidates.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...step.candidates.keys()];
  const out: string[] = [];
  for (const i of order) {
    const s = candidateSelector(step.candidates[i]!);
    // Les sélecteurs « role= » / « text= » de Playwright ne se combinent pas par virgule : CSS seulement.
    if (s && !/^(role|text)=/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.join(", ");
}

/** Sélecteur CSS « simple » (un seul élément, sans combinateur) : utilisable dans `:has(> …)`. */
const SIMPLE = /^[a-zA-Z0-9_\-.#[\]="'^$*|: ]+$/;
function isSimpleCompound(css: string): boolean {
  return SIMPLE.test(css) && !/\s/.test(css.replace(/\[[^\]]*\]/g, "").trim());
}

/**
 * Bloc d'un marché : le PARENT direct du titre de marché qui contient aussi une sélection (jamais un ancêtre plus
 * large qui mêlerait plusieurs marchés). Titre décrit autrement que par un sélecteur simple : pas de bloc (repli).
 */
export function marketBlockSelector(name: DomStep, selection: DomStep): string {
  const sel = stepSelector(selection).split(", ").filter(Boolean)[0];
  if (!sel) return "";
  const out: string[] = [];
  for (const c of name.candidates) {
    if (!c.css || c.text || c.role || !isSimpleCompound(c.css)) continue;
    out.push(`:is(section, div, article, li, ul, table, tbody, fieldset):has(> ${c.css}):has(${sel})`);
  }
  return out.join(", ");
}

/** Configuration de capture tirée de la recette ; null si la recette n'a pas de méthode `dom` utilisable. */
export function recipeCaptureConfig(site: Pick<ReadSite, "key" | "label" | "baseUrl">, recipe: ActiveRecipe): BookmakerConfig | null {
  const dom = recipe.dom;
  if (!dom || !site.baseUrl) return null;
  const block = marketBlockSelector(dom.market.name, dom.market.selection);
  const title = stepSelector(dom.market.name);
  const row = stepSelector(dom.market.selection);
  const odds = stepSelector(dom.market.odds);
  if (!block || !title || !row || !odds) return null;
  const base = BOOKMAKER_CONFIGS[bookmakerKey(site.key)] ?? SPORTAZA_CONFIG;
  const selectors: BookmakerSelectors = {
    ...base.selectors,
    marketTab: stepSelector(dom.marketTab) || base.selectors.marketTab,
    marketBlock: block,
    marketTitle: title,
    selectionRow: row,
    selectionOdds: odds,
    sportsbookFrame: "",
  };
  return {
    key: bookmakerKey(site.key),
    label: site.label,
    baseUrl: site.baseUrl,
    loginUrl: null,
    searchUrl: null,
    allowedHosts: allowedHostsOf(site, recipe),
    stepTimeoutMs: base.stepTimeoutMs,
    selectors,
  };
}
