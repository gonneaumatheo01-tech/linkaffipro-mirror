/**
 * Phase 29, chantier B — contrôles par le code des textes de la Compliance, du Stratège et du Rapporteur (purs) :
 * - adresses : toute adresse citée doit venir des entrées / règles fournies, sinon elle est retirée (règle 1) ;
 * - sources différentes : deux domaines distincts (un forum et la page officielle) = règle vérifiée ;
 * - pas d'avis juridique (règle 2) : une phrase « c'est légal / illégal », « tu as le droit »… est retirée et remplacée
 *   par une phrase fixe qui renvoie à ce que fait la plateforme ;
 * - contournement honnête seulement (camouflage, faux compte, compte de secours… refusés) ;
 * - risque le plus prudent ; découpe des phrases trop longues (voix de Kevin : 30 mots au plus).
 */
import type { RiskLevel } from "./contract";

/** Adresse ramenée à une forme comparable (minuscules pour l'hôte, sans « www. », sans fragment, sans « / » final). */
export function normalizeUrl(raw: string): string {
  const s = raw.trim().replace(/[)\].,;:!?»"']+$/u, "");
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return s.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[#].*$/, "").replace(/\/+$/, "");
  }
}

/** Domaine d'une adresse (sans « www. »), ou null. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Adresses d'un texte (http / https). */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"«»]+/giu)].map((m) => m[0].replace(/[)\].,;:!?»"']+$/u, ""));
}

/** Ensemble d'adresses connues (formes normalisées). */
export function knownUrlSet(urls: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const u of urls) if (u && /^https?:\/\//i.test(u.trim())) out.add(normalizeUrl(u));
  return out;
}

export const isKnownUrl = (url: string, known: ReadonlySet<string>) => known.has(normalizeUrl(url));

/**
 * Retire d'un texte les adresses inconnues. Une ligne qui ne citait QUE des adresses inventées est retirée en entier
 * (son affirmation n'a plus de source) ; une ligne qui cite aussi une vraie adresse garde la vraie seulement.
 */
export function stripUnknownUrls(text: string, known: ReadonlySet<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const urls = urlsIn(line);
    if (!urls.length) {
      out.push(line);
      continue;
    }
    const bad = urls.filter((u) => !isKnownUrl(u, known));
    if (!bad.length) {
      out.push(line);
      continue;
    }
    removed.push(...bad);
    if (bad.length === urls.length) continue;
    let l = line;
    for (const b of bad) l = l.split(b).join("");
    out.push(l.replace(/\(\s*\)|\[\s*\]/g, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trimEnd());
  }
  return { text: out.join("\n"), removed };
}

/** Nombre de domaines distincts parmi des adresses (vérification croisée : 2 au moins = vérifiée). */
export function distinctSources(urls: Iterable<string>): number {
  const hosts = new Set<string>();
  for (const u of urls) {
    const h = hostOf(u);
    if (h) hosts.add(h);
  }
  return hosts.size;
}

// --------------------------------------------------------------------------------------------- avis juridique

const W = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, "iu");

/** Formules d'avis juridique (refusées : l'équipe décrit les plateformes, pas la loi). */
export const LEGAL_ADVICE_PATTERNS: readonly RegExp[] = [
  W("(c'est|c’est|ce n'est pas|ce n’est pas|est|sont|reste|restent|serait|seraient|devient|deviennent)\\s+(tout à fait\\s+|parfaitement\\s+|totalement\\s+|entièrement\\s+)?(il)?légale?s?"),
  W("illégale?s?|illégalement|illégalité"),
  W("en toute légalité|légalement (autorisée?s?|permise?s?|interdite?s?)|autorisée?s? par la loi|interdite?s? par la loi|la loi (te |vous |nous )?(permet|autorise|interdit)"),
  W("(tu as|vous avez|on a|nous avons) (tout à fait |parfaitement )?le droit"),
  W("aucun risque juridique|sans risque juridique|risque pénal|tu risques? (une amende|la prison|des poursuites)"),
];

/** Phrase de remplacement d'une phrase juridique (fixe, conforme à la voix de Kevin). */
export const LEGAL_REWRITE_SENTENCE = "Pour la loi, je ne donne pas d'avis : je regarde seulement ce que fait la plateforme.";

export function hasLegalAdvice(text: string): boolean {
  return LEGAL_ADVICE_PATTERNS.some((re) => re.test(text));
}

/**
 * Retire les phrases d'avis juridique et met à leur place (une seule fois par texte) la phrase fixe. Rend le texte
 * réécrit et les phrases retirées. `replacement: null` : phrases retirées sans remplacement (texte d'une règle).
 */
export function sanitizeLegal(text: string, opts: { replacement?: string | null } = {}): { text: string; removed: string[] } {
  const replacement = opts.replacement === undefined ? LEGAL_REWRITE_SENTENCE : opts.replacement;
  const removed: string[] = [];
  let replaced = false;
  const lines = text.split("\n").map((line) => {
    if (!hasLegalAdvice(line)) return line;
    // Découpe en phrases en gardant les adresses entières.
    const parts = line.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [line];
    const kept: string[] = [];
    for (const p of parts) {
      if (hasLegalAdvice(p)) {
        removed.push(p.trim());
        if (replacement && !replaced) {
          kept.push(` ${replacement}`);
          replaced = true;
        }
      } else kept.push(p);
    }
    return kept.join("").replace(/\s{2,}/g, " ").trim();
  });
  const original = text.split("\n");
  return { text: lines.filter((l, i) => l.trim() || !original[i]!.trim()).join("\n").trim(), removed };
}

// ------------------------------------------------------------------------------------------- contournement

/** Contournements refusés (malhonnêtes ou contraires aux règles de la plateforme). */
const DISHONEST_WORKAROUND = W(
  "cloak\\p{L}*|camoufl\\p{L}*|masqu\\p{L}*|cach(er|é|ée|és|ées)|faux comptes?|comptes? de secours|comptes? achetés?|comptes? lou[ée]s?|multi-?comptes?|redirection (cachée|masquée)|page blanche|white ?page|contourner (la )?(modération|vérification|détection|revue)|tromper|déjouer|leurrer|éviter la détection|échapper à la (revue|modération|détection)|vpn|proxy",
);

/** Un contournement honnête et permis (null sinon) ; avis juridique retiré. */
export function honestWorkaround(v: unknown, max = 400): string | null {
  const s = cleanLine(v, max);
  if (!s || DISHONEST_WORKAROUND.test(s)) return null;
  const legal = sanitizeLegal(s, { replacement: null }).text.trim();
  return legal || null;
}

// ------------------------------------------------------------------------------------------------- risque

export const RISK_ORDER: readonly RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "BAN"];
export const riskRank = (r: RiskLevel) => RISK_ORDER.indexOf(r);
/** Le risque le plus prudent. */
export const maxRisk = (...list: RiskLevel[]): RiskLevel => list.reduce((a, b) => (riskRank(b) > riskRank(a) ? b : a), "LOW" as RiskLevel);
export const isRiskLevel = (v: unknown): v is RiskLevel => typeof v === "string" && (RISK_ORDER as readonly string[]).includes(v);
export const RISK_LABELS: Readonly<Record<RiskLevel, string>> = { LOW: "faible", MEDIUM: "moyen", HIGH: "élevé", BAN: "BAN" };

// --------------------------------------------------------------------------------------------------- texte

/** Texte d'une ligne : sans caractères de contrôle ni balises, espaces resserrés, coupé à `max`. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Coupe chaque phrase à `maxWords` mots (« … » en fin de phrase coupée) ; garde les adresses entières. */
export function clipSentences(text: string, maxWords = 28): string {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [text];
  return parts
    .map((p) => {
      const words = p.trim().split(/\s+/).filter(Boolean);
      const counted = words.filter((w) => /[\p{L}\p{N}]/u.test(w) && !/^https?:\/\//i.test(w));
      if (counted.length <= maxWords) return p.trim();
      const out: string[] = [];
      let n = 0;
      for (const w of words) {
        if (/[\p{L}\p{N}]/u.test(w) && !/^https?:\/\//i.test(w)) n++;
        if (n > maxWords) break;
        out.push(w);
      }
      return `${out.join(" ").replace(/[,;:]$/, "")}…`;
    })
    .filter(Boolean)
    .join(" ");
}

/** Texte court : `maxChars` au plus, coupé au dernier espace, « … » si coupé. */
export function shorten(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars - 1);
  const i = cut.lastIndexOf(" ");
  return `${(i > maxChars * 0.6 ? cut.slice(0, i) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

/** Échappe un texte pour le HTML Telegram. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
