/**
 * Phase 29, chantier C — textes de Kevin pour l'équipe Analystes (voix `docs/KEVIN-VOIX.md`, contrôlée par
 * `boss/voice.test.ts`) et lectures pures des demandes du client : marché, pays, plateforme, sources citées, réponse
 * bornée à 20 lignes avec ses sources et, dès qu'on parle de règles, la phrase fixe `LEGAL_DISCLAIMER`.
 * Aucune base, aucun réseau : tout est pur ici.
 */
import { esc } from "../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { COUNTRY_LABELS } from "./analysis-labels";
import { isRiskLevel, riskRank } from "./citations";
import { ANALYSTS_LIMITS, LEGAL_DISCLAIMER, type CompliancePlatform, type Market, type RiskLevel, type SourceRef } from "./contract";

// ------------------------------------------------------------------------------------------------ libellés

/** Risque en français (jamais le code anglais). */
export const RISK_WORDS: Readonly<Record<RiskLevel, string>> = { LOW: "faible", MEDIUM: "moyen", HIGH: "élevé", BAN: "bannissement" };

export const riskAtLeast = (r: string, min: RiskLevel): boolean => isRiskLevel(r) && riskRank(r) >= riskRank(min);

/** Pays européens en français (nom courant → code ISO). */
const COUNTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["france", "FR"],
  ["belgique", "BE"],
  ["luxembourg", "LU"],
  ["suisse", "CH"],
  ["allemagne", "DE"],
  ["autriche", "AT"],
  ["espagne", "ES"],
  ["italie", "IT"],
  ["portugal", "PT"],
  ["pays-bas", "NL"],
  ["pays bas", "NL"],
  ["hollande", "NL"],
  ["pologne", "PL"],
  ["suede", "SE"],
  ["norvege", "NO"],
  ["danemark", "DK"],
  ["finlande", "FI"],
  ["tchequie", "CZ"],
  ["republique tcheque", "CZ"],
  ["roumanie", "RO"],
  ["grece", "GR"],
  ["hongrie", "HU"],
  ["bulgarie", "BG"],
  ["croatie", "HR"],
  ["slovaquie", "SK"],
  ["slovenie", "SI"],
  ["estonie", "EE"],
  ["lettonie", "LV"],
  ["lituanie", "LT"],
  ["irlande", "IE"],
  ["royaume-uni", "GB"],
  ["royaume uni", "GB"],
  ["angleterre", "GB"],
  ["malte", "MT"],
  ["chypre", "CY"],
];

/** Texte sans accents, en minuscules (lecture des demandes). */
export function plainLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Marché dit en français (« casino », « paris sportifs », « dating »…), ou null. */
export function marketOf(raw: string | null | undefined): Market | null {
  if (!raw) return null;
  const n = plainLower(raw);
  if (/\b(casino|casinos|slots?|machines? a sous|roulette|blackjack|igaming)\b/.test(n)) return "CASINO";
  if (/\b(paris? sportifs?|sports?|betting|paris|pronos?|foot|football|tennis)\b/.test(n)) return "SPORTS";
  if (/\b(dating|rencontres?|tinder|appli de rencontre|sites? de rencontre)\b/.test(n)) return "DATING";
  return null;
}

/** Pays cités (noms français ou codes ISO), dans l'ordre de la phrase, sans doublon. */
export function countriesOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const n = ` ${plainLower(raw).replace(/[,;/+&]/g, " ")} `;
  const found: Array<{ at: number; code: string }> = [];
  for (const [name, code] of COUNTRY_NAMES) {
    const at = n.search(new RegExp(`[^a-z]${name.replace(/[-\s]/g, "[-\\s]")}[^a-z]`));
    if (at >= 0) found.push({ at, code });
  }
  for (const m of raw.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1]!;
    if (code in COUNTRY_LABELS && code !== "ALL") found.push({ at: m.index ?? 0, code });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.code))];
}

/** Plateforme publicitaire citée, ou null. */
export function platformOf(raw: string | null | undefined): CompliancePlatform | null {
  if (!raw) return null;
  const n = ` ${plainLower(raw)} `;
  if (/[^a-z](meta|facebook|instagram|fb|insta)[^a-z]/.test(n)) return "META";
  if (/[^a-z](tiktok|tik tok)[^a-z]/.test(n)) return "TIKTOK";
  if (/[^a-z](google|youtube|adwords)[^a-z]/.test(n)) return "GOOGLE";
  if (/[^a-z](snap|snapchat)[^a-z]/.test(n)) return "SNAP";
  if (/[^a-z](twitter|x\.com)[^a-z]/.test(n) || /[^a-z]sur x[^a-z]/.test(n)) return "X";
  if (/[^a-z]telegram[^a-z]/.test(n)) return "TELEGRAM";
  return null;
}

/** Adresse web citée dans une phrase (« ajoute ce forum https://… », « ajoute blackhatworld.com »), ou null. */
export function urlIn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const full = /https?:\/\/[^\s<>"«»]+/i.exec(raw);
  if (full) return full[0].replace(/[)\].,;:!?»"']+$/u, "");
  const bare = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s<>"«»]*)?/i.exec(raw);
  return bare ? `https://${bare[1]!.toLowerCase()}${(bare[2] ?? "").replace(/[)\].,;:!?»"']+$/u, "")}` : null;
}

/** Nom lisible d'une source à partir de son adresse (« blackhatworld.com »). */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

// ------------------------------------------------------------------------------------------------ sources et réponse

/** « 25 oct. » (Paris) d'une date ISO ; null si illisible. */
export function shortDate(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
}

/** Une source visible : « https://… (25 oct.) ». */
export function sourceText(s: SourceRef): string {
  const when = shortDate(s.date);
  return `${s.url}${when ? ` (${when})` : ""}`;
}

/** Lignes des sources citées (3 au plus, sans doublon), HTML échappé. */
export function sourcesLines(sources: readonly SourceRef[], max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sources) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(esc(sourceText(s)));
    if (out.length >= max) break;
  }
  if (!out.length) return [];
  return [`${pick(ANALYSTS_KEVIN_VARIANTS.sourcesHead, "analysts.sources.head")} ${out.join(" ; ")}`];
}

/**
 * Réponse prête à envoyer : 20 lignes au plus (la fin est coupée, la phrase fixe et les sources restent), sources
 * visibles, `LEGAL_DISCLAIMER` quand on parle de règles (une seule fois). `body` est déjà en HTML.
 */
export function boundedAnswer(body: string, opts: { sources?: readonly SourceRef[]; rules?: boolean; maxLines?: number } = {}): string {
  const tail: string[] = [];
  const srcLines = opts.sources?.length && !/https?:\/\//.test(body) ? sourcesLines(opts.sources) : [];
  tail.push(...srcLines);
  // La phrase fixe déjà dans le texte part en fin de réponse (jamais coupée avec la fin d'une réponse trop longue).
  const hadDisclaimer = body.includes(LEGAL_DISCLAIMER);
  if (opts.rules || hadDisclaimer) tail.push(esc(LEGAL_DISCLAIMER));
  const lines = body
    .split("\n")
    .flatMap((l) => {
      if (!hadDisclaimer || !l.includes(LEGAL_DISCLAIMER)) return [l.trimEnd()];
      const rest = l.split(LEGAL_DISCLAIMER).join("").trimEnd();
      return rest.trim() ? [rest] : [];
    })
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1]!.trim()));
  if (hadDisclaimer) while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const room = Math.max(1, Math.min(ANALYSTS_LIMITS.answerMaxLines, opts.maxLines ?? ANALYSTS_LIMITS.answerMaxLines) - tail.length);
  const kept = lines.length > room ? [...lines.slice(0, room - 1), pick(ANALYSTS_KEVIN_VARIANTS.cut, "analysts.cut")] : lines;
  return [...kept, ...tail].join("\n").trim();
}

// ------------------------------------------------------------------------------------------------ variantes

export const ANALYSTS_KEVIN_VARIANTS = {
  sourcesHead: ["Sources :", "D'où ça vient :"],
  cut: ["La suite est sur le site, dans Agents → Analyses.", "Le reste est sur le site (Agents → Analyses)."],
  deferred: [
    "Je regarde, je te réponds dans une minute.",
    "Je me renseigne, je te réponds dans une minute.",
  ],
  deferredBriefing: [
    "Je prépare le point, je te l'envoie dans une minute.",
    "Je m'en occupe, tu as le point dans une minute.",
  ],
  disabled: [
    "La veille du marché est coupée pour le moment. Tu peux la rallumer dans Agents → Analyses.",
    "L'analyse du marché est en pause. Elle se rallume dans Agents → Analyses.",
  ],
  noAnswer: [
    "Je n'ai pas réussi à répondre cette fois. Repose ta question dans un moment ?",
    "Ma réponse n'est pas passée. Tu me la reposes dans un moment ?",
  ],
  budget: [
    "Le plafond du mois de l'analyse du marché est atteint, je ne peux plus chercher avant le 1er.",
    "J'ai atteint le plafond du mois pour l'analyse du marché. Ça repart le 1er du mois.",
  ],
  noData: voiceTemplate<{ what: string }>([{ what: "le casino en France" }], (p) => [
    `Je n'ai encore rien relevé de sûr pour ${p.what}. Je te préviens dès que la veille trouve quelque chose.`,
    `Rien de vérifié pour ${p.what} pour le moment. La veille continue, je te dis dès que j'ai du concret.`,
  ]),
  trendsHead: voiceTemplate<{ what: string; days: number }>([{ what: "le casino", days: 7 }], (p) => [
    `Ce qui ressort sur ${p.what} ces ${p.days} derniers jours :`,
    `Les tendances sur ${p.what} depuis ${p.days} jours :`,
  ]),
  rulesHead: voiceTemplate<{ what: string; risk: string }>([{ what: "Meta, casino, France", risk: "élevé" }], (p) => [
    `Règles relevées pour ${p.what}, risque le plus haut : ${p.risk}.`,
    `Pour ${p.what}, le risque le plus haut que je vois : ${p.risk}.`,
  ]),
  noRules: voiceTemplate<{ what: string }>([{ what: "TikTok, dating, Espagne" }], (p) => [
    `Je n'ai pas encore de règle relevée pour ${p.what}. Je te préviens si la veille en trouve une.`,
    `Aucune règle relevée pour ${p.what} pour le moment. Je te dis si ça change.`,
  ]),
  unverified: ["non vérifiée, une seule source", "une seule source, pas encore vérifiée"],
  alertsHead: ["Les alertes du moment :", "Ce qui demande ton attention en ce moment :"],
  noAlerts: [
    "Aucune alerte en ce moment : rien de risqué relevé ces 7 derniers jours.",
    "Rien d'alarmant ces 7 derniers jours, aucune alerte en cours.",
  ],
  sourcesList: voiceTemplate<{ active: number; inactive: number }>([{ active: 12, inactive: 2 }], (p) => [
    `Je surveille ${p.active} source${p.active > 1 ? "s" : ""}${p.inactive ? `, ${p.inactive} en attente ou coupée${p.inactive > 1 ? "s" : ""}` : ""} :`,
    `${p.active} source${p.active > 1 ? "s" : ""} suivie${p.active > 1 ? "s" : ""}${p.inactive ? ` et ${p.inactive} à l'arrêt` : ""} :`,
  ]),
  noSources: [
    "Je ne surveille aucune source pour le moment. La liste de départ se pose au premier passage de la veille.",
    "Aucune source suivie pour l'instant : la veille pose sa liste de départ à son premier passage.",
  ],
  sourceAsk: ["Donne-moi l'adresse de la source, par exemple « ajoute https://www.blackhatworld.com ».", "Il me faut l'adresse du forum ou du site, par exemple « ajoute blackhatworld.com »."],
  sourceAdded: voiceTemplate<{ name: string; url: string }>([{ name: "blackhatworld.com", url: "https://www.blackhatworld.com" }], (p) => [
    `J'ai noté ${p.name} (${p.url}), pas encore suivie. Je l'ajoute à ma veille ?`,
    `${p.name} (${p.url}) est notée, en attente. Je la mets dans ma veille ?`,
  ]),
  sourceAlready: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [`${p.name} est déjà dans ma veille.`, `Je suis déjà ${p.name}.`]),
  sourceActivated: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [
    `C'est fait, ${p.name} est dans ma veille. Première lecture dans l'heure.`,
    `${p.name} est ajoutée à ma veille, je la lis dans l'heure.`,
  ]),
  sourceKept: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [
    `D'accord, je laisse ${p.name} de côté.`,
    `Ok, ${p.name} reste hors de ma veille.`,
  ]),
  sourceRemoved: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [
    `C'est fait, je ne surveille plus ${p.name}.`,
    `${p.name} est retirée de ma veille.`,
  ]),
  sourceUnknown: voiceTemplate<{ name: string }>([{ name: "reddit" }], (p) => [
    `Je ne trouve pas de source « ${p.name} » dans ma veille.`,
    `Aucune source « ${p.name} » dans ma liste.`,
  ]),
  sourceMany: voiceTemplate<{ list: string }>([{ list: "Reddit r/gambling, Reddit r/sportsbetting" }], (p) => [
    `Plusieurs sources se ressemblent : ${p.list}. Laquelle ?`,
    `J'en vois plusieurs : ${p.list}. Tu parles de laquelle ?`,
  ]),
  confirmRemove: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [`Retirer ${p.name} de ma veille ?`, `Je ne surveille plus ${p.name} ?`]),
  confirmActivate: voiceTemplate<{ name: string }>([{ name: "blackhatworld.com" }], (p) => [`Ajouter ${p.name} à ma veille ?`, `Je mets ${p.name} dans ma veille ?`]),
  discovered: voiceTemplate<{ name: string; url: string }>([{ name: "AffLift", url: "https://afflift.com" }], (p) => [
    `J'ai trouvé un nouveau forum intéressant : ${p.name} (${p.url}). Je l'ajoute à ma veille ?`,
    `Nouvelle source repérée : ${p.name} (${p.url}). Je la mets dans ma veille ?`,
  ]),
  discoveredYes: ["Oui, ajoute-la", "Oui, suis-la"],
  sourceDown: voiceTemplate<{ name: string; n: number }>([{ name: "Reddit r/gambling", n: 5 }], (p) => [
    `⚠️ Je n'arrive plus à lire ${p.name} : ${p.n} échecs de suite. Je l'ai mise de côté, tu peux la rallumer dans Agents → Analyses.`,
    `⚠️ ${p.name} ne répond plus depuis ${p.n} essais. Je ne la lis plus pour le moment ; elle se rallume dans Agents → Analyses.`,
  ]),
  entryAlert: voiceTemplate<{ summary: string; url: string }>([{ summary: "TikTok coupe des comptes qui montrent des gains de casino en France", url: "https://www.blackhatworld.com/threads/123" }], (p) => [
    `⚠️ À surveiller : ${p.summary}. Source : ${p.url}. Vérifie tes campagnes en cours.`,
    `⚠️ Signal à surveiller : ${p.summary}. Source : ${p.url}. Regarde tes campagnes.`,
  ]),
  choiceHead: ["Mes propositions :", "Ce que je te propose :"],
  choiceTail: [
    "Réponds par les numéros (« applique 2 ») pour les garder. Je ne touche à rien chez Meta, TikTok ni sur les canaux : c'est toi qui fais.",
    "Dis-moi les numéros à garder (« applique 1 et 3 »). Rien ne change chez Meta, TikTok ni sur les canaux : je recommande, tu décides.",
  ],
  noProposals: ["Je n'ai pas de proposition en attente. Demande-moi par exemple « quel type de pub pour le dating en Espagne ? ».", "Aucune proposition ouverte pour le moment."],
  badNumbers: voiceTemplate<{ max: number }>([{ max: 3 }], (p) => [
    `Je n'ai que ${p.max} proposition${p.max > 1 ? "s" : ""}. Réponds par exemple « applique 1 ».`,
    `Choisis un numéro entre 1 et ${p.max}, par exemple « applique 1 ».`,
  ]),
  accepted: voiceTemplate<{ list: string }>([{ list: "2 (vidéo UGC courte avec témoignage)" }], (p) => [
    `Noté, tu gardes ${p.list}. Je n'ai rien changé chez Meta, TikTok ni sur les canaux : à toi de jouer.`,
    `C'est noté pour ${p.list}. Rien n'a bougé chez Meta, TikTok ni sur les canaux, c'est toi qui fais.`,
  ]),
  confirmAccept: voiceTemplate<{ nums: string }>([{ nums: "2" }], (p) => [`Garder la proposition ${p.nums} de l'analyse du marché ?`, `Je note la proposition ${p.nums} comme gardée ?`]),
  weeklyNone: [
    "Pas de rapport du marché cette semaine : la veille n'a rien relevé de sûr.",
    "Rien de solide relevé cette semaine, pas de rapport du marché.",
  ],
  seeSite: ["Détail complet sur le site, dans Agents → Analyses.", "Tout le détail est sur le site (Agents → Analyses)."],
} satisfies VoiceTable;
