/**
 * Phase 31, chantier D — textes de Kevin pour l'équipe Prospection (charte `docs/KEVIN-VOIX.md`, `voiceCheck` en CI)
 * et lectures pures des demandes du client : pays, thème, nom de canal, statut, offre (« Winamax, FR BE, CPA 120 »).
 * Aucun texte ne sort vers un tiers : Kevin n'écrit qu'à l'admin ou au groupe de l'équipe.
 */
import { countriesOf, plainLower } from "../analysts/kevin-texts";
import { countryLabel } from "../analysts/analysis-labels";
import { voiceTemplate, voiceVariants, type VoiceTable } from "../boss/voice";
import type { DealType, ProspectStatus, ProspectVertical } from "./contract";

export { countriesOf, countryLabel };

// ------------------------------------------------------------------------------------------------ libellés

export const PROSPECT_STATUS_WORDS: Readonly<Record<ProspectStatus, string>> = {
  DISCOVERED: "trouvé, pas encore lu",
  ENRICHING: "en cours de lecture",
  UNREADABLE: "illisible",
  ENRICH_FAILED: "lecture ratée",
  QUALIFIED: "à contacter",
  DISQUALIFIED: "écarté",
  CONTACTED: "contacté",
  RESPONDED: "a répondu",
  NEGOTIATING: "en négo",
  SIGNED: "signé",
  ACTIVE: "actif",
  CHURNED: "arrêté",
  SKIPPED: "pas intéressé",
  BLACKLISTED: "écarté pour de bon",
};

export const VERTICAL_WORDS: Readonly<Record<ProspectVertical, string>> = {
  SPORTS: "paris sportifs",
  CASINO: "casino",
  BOTH: "casino et paris",
  OTHER: "autre thème",
};

export const COMPETITION_WORDS: Readonly<Record<string, string>> = {
  FREE: "aucune marque",
  ROTATING: "plusieurs marques",
  EXCLUSIVE: "une marque fixe",
  OURS: "pousse déjà une de nos marques",
};

export const BREAKDOWN_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["audience", "audience"],
  ["engagement", "engagement"],
  ["fit", "adéquation"],
  ["openness", "ouverture"],
  ["competition", "concurrence"],
  ["reach", "joignabilité"],
  ["penalties", "pénalités"],
];

/** Vues lisibles : 850, 2,1k, 17k. */
export function compactNumber(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "?";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  const k = n / 1000;
  const s = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return `${s}k`;
}

export const pct = (x: number | null | undefined): string => (typeof x === "number" && Number.isFinite(x) ? `${Math.round(x * 100)} %` : "?");

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function countriesText(codes: readonly string[]): string {
  if (!codes.length) return "toute l'Europe";
  const names = codes.map(countryLabel);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

// ------------------------------------------------------------------------------------------------ lectures (pures)

/** Thème dit en français : casino, paris sportifs, ou les deux ; null si rien. */
export function verticalOf(raw: string | null | undefined): "CASINO" | "SPORTS" | "BOTH" | null {
  if (!raw) return null;
  const n = plainLower(raw);
  const casino = /\b(casino|casinos|slots?|machines? a sous|crash|aviator|roulette|blackjack|live casino|bonus)\b/.test(n);
  const sports = /\b(paris? sportifs?|paris|sports?|pronos?|pronostics?|tipsters?|bookmakers?|foot|football|tennis|basket|paris en ligne)\b/.test(n);
  if (casino && sports) return "BOTH";
  if (casino) return "CASINO";
  if (sports) return "SPORTS";
  return null;
}

/** Sous-types cités (« crash », « Aviator », « slots », « foot »…), en minuscules sans accents. */
export function subtypesOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const n = plainLower(raw);
  const out: string[] = [];
  for (const [re, key] of [
    [/\bcrash\b/, "crash"],
    [/\baviator\b/, "aviator"],
    [/\b(slots?|machines? a sous)\b/, "slots"],
    [/\broulette\b/, "roulette"],
    [/\blive\b/, "live"],
    [/\bbonus\b/, "bonus"],
    [/\b(streams?|streamers?|clips?)\b/, "streams"],
    [/\b(foot|football|soccer)\b/, "foot"],
    [/\btennis\b/, "tennis"],
    [/\bbasket(ball)?\b/, "basket"],
  ] as const)
    if (re.test(n) && !out.includes(key)) out.push(key);
  return out;
}

/** Nom d'un canal public (sans @, minuscules) tiré de « @x », « t.me/x », « https://t.me/s/x » ; sinon null. */
export function usernameOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const link = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?=$|[/?#\s.,;:!)])/i.exec(t);
  if (link && !/^(joinchat|addlist|share|c|s)$/i.test(link[1]!)) return link[1]!.toLowerCase();
  const at = /(?:^|[\s(«"'])@([A-Za-z][A-Za-z0-9_]{3,31})\b/.exec(` ${t}`);
  if (at) return at[1]!.toLowerCase();
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(t)) return t.toLowerCase();
  return null;
}

/** Lien d'invitation privé (`t.me/+…`, `joinchat`) : jamais ouvert. */
export function isPrivateInviteLink(raw: string | null | undefined): boolean {
  return !!raw && /(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)/i.test(raw);
}

/** Lien ou nom de canal trouvé dans un texte (`t.me/…` d'abord, puis `@nom`) ; null sinon. */
export function channelRefIn(text: string | null | undefined): { url: string; username: string | null; private: boolean } | null {
  if (!text) return null;
  const invite = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/i.exec(text);
  if (invite) return { url: invite[0].startsWith("http") ? invite[0] : `https://${invite[0]}`, username: null, private: true };
  const u = usernameOf(text.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?[A-Za-z0-9_]+/i)?.[0] ?? null) ?? usernameOf(text.match(/@[A-Za-z][A-Za-z0-9_]{3,31}/)?.[0] ?? null);
  return u ? { url: `https://t.me/${u}`, username: u, private: false } : null;
}

export type StatusWord = "contacte" | "repondu" | "negocie" | "signe" | "actif" | "arrete" | "ignore" | "blacklist" | "plus_tard" | "relance";

export const STATUS_OF_WORD: Readonly<Record<Exclude<StatusWord, "plus_tard" | "relance">, ProspectStatus>> = {
  contacte: "CONTACTED",
  repondu: "RESPONDED",
  negocie: "NEGOTIATING",
  signe: "SIGNED",
  actif: "ACTIVE",
  arrete: "CHURNED",
  ignore: "SKIPPED",
  blacklist: "BLACKLISTED",
};

/** Statut dit en français courant (« j'ai contacté », « a répondu », « on négocie », « a signé »…) ; null sinon. */
export function statusWordOf(raw: string | null | undefined): StatusWord | null {
  if (!raw) return null;
  const n = plainLower(raw);
  if (/\bblack ?list/.test(n) || /plus jamais/.test(n)) return "blacklist";
  if (/plus tard|rappelle[- ]moi|dans \d+ jours/.test(n)) return "plus_tard";
  if (/\brelance/.test(n)) return "relance";
  if (/\bsign(e|é|er|ée)\b/.test(n) || /\ba signe\b/.test(n)) return "signe";
  if (/negoci|nego\b|en nego/.test(n)) return "negocie";
  if (/a repondu|repondu|m'a repondu|reponse de/.test(n)) return "repondu";
  if (/\b(est )?actif\b|produit des resultats|ramene des joueurs/.test(n)) return "actif";
  if (/a arrete|arrete|a lache|ne bosse plus/.test(n)) return "arrete";
  if (/\bignore|pas interess|laisse tomber|passe\b/.test(n)) return "ignore";
  if (/contact(e|é)|ecrit a|j'ai ecrit|ecrit\b|message a/.test(n)) return "contacte";
  return null;
}

export type ParsedDeal = { dealType: DealType | null; cpa: number | null; revshare: number | null };

/** « CPA 100 », « 120 € de CPA », « revshare 30 % », « hybride 50 + 15 % » (pur). */
export function parseDeal(raw: string | null | undefined): ParsedDeal {
  const out: ParsedDeal = { dealType: null, cpa: null, revshare: null };
  if (!raw) return out;
  const n = plainLower(raw).replace(/,(\d)/g, ".$1");
  const num = (s: string | undefined) => (s === undefined ? null : Number(s));
  const cpa = /cpa\s*(?:de|a|:)?\s*(\d{1,5}(?:\.\d{1,2})?)/.exec(n) ?? /(\d{1,5}(?:\.\d{1,2})?)\s*(?:€|eur|euros?)?\s*(?:de\s+)?cpa/.exec(n);
  const rev = /(?:rev(?:enue)?\s*-?\s*share|revshare|rs|part du revenu)\s*(?:de|a|:)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%?/.exec(n) ?? /(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:de\s+)?(?:rev(?:enue)?\s*-?\s*share|revshare|rs)/.exec(n);
  out.cpa = num(cpa?.[1]);
  out.revshare = num(rev?.[1]);
  const hybrid = /hybride|hybrid/.test(n);
  if (hybrid) {
    if (out.cpa === null || out.revshare === null) {
      const nums = [...n.matchAll(/(\d{1,5}(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
      if (out.cpa === null && nums.length) out.cpa = nums[0]!;
      if (out.revshare === null && nums.length > 1) out.revshare = nums[1]!;
    }
    out.dealType = "HYBRID";
  } else if (out.cpa !== null && out.revshare !== null) out.dealType = "HYBRID";
  else if (out.cpa !== null) out.dealType = "CPA";
  else if (out.revshare !== null) out.dealType = "REVSHARE";
  else if (/\bcpa\b/.test(n)) out.dealType = "CPA";
  else if (/rev(?:enue)?\s*-?\s*share|revshare/.test(n)) out.dealType = "REVSHARE";
  return out;
}

export type ParsedOffer = {
  brand: string | null;
  countries: string[];
  vertical: "CASINO" | "SPORTS" | "BOTH";
  dealTypes: { cpa?: number; revshare?: number; hybrid?: { cpa: number; revshare: number } };
};

/** « ajoute une offre : Winamax, FR BE, CPA 120 » → marque, pays, thème, montants (pur). */
export function parseOfferText(raw: string): ParsedOffer {
  const body = raw.replace(/^\s*(?:ajoute|ajouter|nouvelle|cree|crée)?\s*(?:une\s+)?offre\s*:?\s*/i, "").trim();
  const parts = body.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
  const deal = parseDeal(body);
  let brand: string | null = null;
  for (const p of parts) {
    const n = plainLower(p);
    if (countriesOf(p).length && !/[a-z]{5,}/.test(n.replace(/\b(france|belgique|suisse|allemagne|autriche|espagne|italie|portugal|pologne|suede|norvege|danemark|finlande|grece|roumanie|hongrie|bulgarie|croatie|irlande|malte|chypre|luxembourg|tchequie|slovaquie|slovenie|estonie|lettonie|lituanie|hollande|angleterre)\b/g, ""))) continue;
    if (/\b(cpa|rev|revshare|hybride|hybrid)\b|%|€/.test(n)) continue;
    if (/^(casino|paris( sportifs)?|sports?|les deux)$/.test(n)) continue;
    brand = p.replace(/\s*\((?:casino|paris[^)]*)\)\s*$/i, "").replace(/^["«“']|["»”']$/g, "").trim().slice(0, 60) || null;
    if (brand) break;
  }
  const dealTypes: ParsedOffer["dealTypes"] = {};
  if (deal.dealType === "HYBRID" && deal.cpa !== null && deal.revshare !== null) dealTypes.hybrid = { cpa: deal.cpa, revshare: deal.revshare };
  else {
    if (deal.cpa !== null) dealTypes.cpa = deal.cpa;
    if (deal.revshare !== null) dealTypes.revshare = deal.revshare;
  }
  return { brand, countries: countriesOf(body), vertical: verticalOf(body) ?? "BOTH", dealTypes };
}

/** « CPA 120 € », « revshare 30 % », « hybride 50 € + 15 % ». */
export function dealText(dealTypes: unknown): string {
  const d = (dealTypes && typeof dealTypes === "object" ? dealTypes : {}) as { cpa?: unknown; revshare?: unknown; hybrid?: { cpa?: unknown; revshare?: unknown } };
  const parts: string[] = [];
  if (typeof d.cpa === "number") parts.push(`CPA ${d.cpa} €`);
  if (typeof d.revshare === "number") parts.push(`revshare ${d.revshare} %`);
  if (d.hybrid && typeof d.hybrid.cpa === "number" && typeof d.hybrid.revshare === "number") parts.push(`hybride ${d.hybrid.cpa} € + ${d.hybrid.revshare} %`);
  return parts.join(", ") || "montant à préciser";
}

// ------------------------------------------------------------------------------------------------ textes fixes

const P1 = { name: "@pronos_fr", count: 3, what: "casino en Pologne" };
const P2 = { name: "@slots_it", count: 1, what: "paris sportifs en Grèce" };

export const PROSPECTION_KEVIN_VARIANTS = {
  disabled: [
    "La prospection est en pause pour le moment. Écris « reprends la prospection » pour la relancer.",
    "La recherche d'affiliés est coupée en ce moment. Tu me dis « reprends la prospection » quand tu veux ?",
  ],
  paused: ["Ok, la prospection est en pause. Plus de recherche ni de liste du matin jusqu'à ce que tu me dises « reprends ».", "C'est en pause. Je ne cherche plus rien et je ne t'envoie plus de liste tant que tu ne dis pas « reprends »."],
  resumed: ["C'est reparti, je recommence à chercher des canaux. La prochaine liste arrive demain matin.", "Ok, la prospection tourne de nouveau. Tu auras la liste demain matin."],
  alreadyPaused: ["La prospection est déjà en pause.", "C'est déjà en pause de mon côté."],
  alreadyRunning: ["La prospection tourne déjà.", "C'est déjà en route de mon côté."],
  topQueued: ["Je te prépare la liste, elle arrive dans une minute.", "Je sors les prochains canaux, tu les as dans une minute."],
  topNone: [
    "Plus de nouveau canal à te montrer pour l'instant. Je continue de chercher, je t'en remets demain matin.",
    "Je n'ai pas d'autre canal prêt pour le moment. La recherche continue, la prochaine liste arrive demain matin.",
  ],
  topMore: voiceTemplate([{ count: 1 }, { count: 10 }], (p) => [
    `${plural(p.count, "canal de plus", "canaux de plus")}. Tu me dis « encore 10 » pour la suite ?`,
    `Ça fait ${plural(p.count, "canal de plus", "canaux de plus")}. Écris « encore 10 » si tu en veux d'autres.`,
  ]),
  noOffer: [
    "Je n'ai pas encore ton offre, alors j'ai classé sur l'Europe et le thème seulement. Écris « ajoute une offre : Winamax, FR BE, CPA 120 » pour l'affiner.",
    "Pas encore d'offre enregistrée : le classement tient compte de l'Europe et du thème seulement. Tu me donnes ton offre ? Par exemple « ajoute une offre : Winamax, FR BE, CPA 120 ».",
  ],
  unknownChannel: voiceTemplate([{ name: "@pronos_fr" }], (p) => [
    `Je ne connais pas ${p.name} dans mes prospects. Tu veux que je l'ajoute ? Écris « ajoute t.me/${p.name.replace(/^@/, "")} ».`,
    `${p.name} n'est pas dans ma liste. Écris « ajoute t.me/${p.name.replace(/^@/, "")} » et je le regarde.`,
  ]),
  askChannel: ["De quel canal tu parles ? Donne-moi son @nom ou son lien t.me.", "Il me manque le canal : tu me donnes son @nom ou son lien t.me ?"],
  statusDone: voiceTemplate(
    [
      { name: "@pronos_fr", what: "contacté" },
      { name: "@slots_it", what: "signé (CPA 100 €)" },
    ],
    (p) => [`C'est noté : ${p.name} passe en ${p.what}.`, `Fait, ${p.name} est maintenant ${p.what}.`],
  ),
  snoozed: voiceTemplate([{ name: "@pronos_fr", days: 7 }], (p) => [`Ok, je te reparle de ${p.name} dans ${plural(p.days, "jour")}.`, `C'est noté, ${p.name} revient dans ${plural(p.days, "jour")}.`]),
  statusRefused: voiceTemplate([{ name: "@pronos_fr", from: "à contacter", to: "signé" }], (p) => [
    `Je ne peux pas passer ${p.name} de « ${p.from} » à « ${p.to} » directement. Tu me dis d'abord où ça en est ?`,
    `${p.name} est « ${p.from} », je ne peux pas le mettre « ${p.to} » d'un coup. Tu me dis l'étape d'avant ?`,
  ]),
  confirmBlacklist: voiceTemplate([{ name: "@pronos_fr" }], (p) => [`J'écarte ${p.name} pour de bon, je ne te le montre plus jamais ?`, `${p.name} ne revient plus jamais dans tes listes, c'est bien ça ?`]),
  noteDone: voiceTemplate([{ name: "@pronos_fr" }], (p) => [`Note ajoutée sur ${p.name}.`, `C'est noté sur la fiche de ${p.name}.`]),
  noteEmpty: ["Ta note est vide. Tu me redis ce que je dois noter ?", "Je n'ai rien à noter. Tu me réécris la note ?"],
  addQueued: voiceTemplate([{ name: "@pronos_fr" }], (p) => [`Je regarde ${p.name} en premier, je te dis ce que j'en pense dès que c'est lu.`, `C'est parti pour ${p.name}. Je le lis tout de suite et je te dis quand c'est prêt.`]),
  addKnown: voiceTemplate([{ name: "@pronos_fr", status: "à contacter" }], (p) => [`${p.name} est déjà dans ma liste (${p.status}). Écris « détail ${p.name} » pour sa fiche.`, `Je connais déjà ${p.name}, il est ${p.status}. Tu veux sa fiche ? Écris « détail ${p.name} ».`]),
  addPrivate: [
    "C'est un lien d'invitation privé : je ne l'ouvre jamais, il faudrait rejoindre le canal. Tu as son @nom public ?",
    "Ce lien est privé, je ne peux pas le lire sans rejoindre, et je ne rejoins rien. Tu me donnes plutôt son @nom ?",
  ],
  addNoLink: ["Il me faut le lien du canal (t.me/…) ou son @nom pour l'ajouter.", "Donne-moi le lien t.me ou le @nom du canal, et je l'ajoute."],
  ready: voiceTemplate(
    [
      { name: "@pronos_fr", tier: "A", score: 74, reason: "2,1k vues par post, France, contact direct" },
      { name: "@slots_it", tier: "C", score: 38, reason: "audience faible" },
    ],
    (p) => [
      `${p.name} est lu : niveau ${p.tier}, ${p.score}/100. ${p.reason}. Écris « détail ${p.name} » pour la fiche.`,
      `C'est prêt pour ${p.name} : ${p.score}/100, niveau ${p.tier}. ${p.reason}. Sa fiche avec « détail ${p.name} ».`,
    ],
  ),
  readyOut: voiceTemplate([{ name: "@pronos_fr", reason: "audience hors d'Europe" }], (p) => [`J'ai lu ${p.name}, je l'écarte : ${p.reason}.`, `${p.name} est lu, mais il ne passe pas : ${p.reason}.`]),
  readyUnreadable: voiceTemplate([{ name: "@pronos_fr" }], (p) => [`Je n'arrive pas à lire ${p.name} : la page est introuvable ou l'aperçu est fermé.`, `${p.name} ne se lit pas de l'extérieur, page introuvable ou aperçu coupé.`]),
  readyFailed: voiceTemplate([{ name: "@pronos_fr" }], (p) => [`La lecture de ${p.name} a raté deux fois. Je le laisse de côté pour l'instant.`, `Je n'ai pas réussi à lire ${p.name} après deux essais, je le mets de côté.`]),
  searchQueued: voiceTemplate([P1, P2], (p) => [
    `C'est lancé, je cherche des canaux ${p.what}. Je te préviens dès que les premiers bons arrivent.`,
    `Je m'en occupe : recherche de canaux ${p.what}. Je te dis quand j'ai les premiers bons.`,
  ]),
  searchNeedVertical: ["Tu cherches du casino ou des paris sportifs ?", "Plutôt casino ou paris sportifs ?"],
  searchFirst: voiceTemplate([P1, P2], (p) => [
    `Premiers résultats pour ${p.what} : ${plural(p.count, "canal bon à contacter", "canaux bons à contacter")}. Écris « prospects ${p.what} » pour les voir.`,
    `J'ai ${plural(p.count, "premier canal", "premiers canaux")} à contacter pour ${p.what}. Tu les vois avec « prospects ${p.what} ».`,
  ]),
  searchNothing: voiceTemplate([P1], (p) => [
    `Rien de bon trouvé pour ${p.what} en une semaine. Tu veux que je cherche ailleurs ?`,
    `Une semaine de recherche sur ${p.what}, et rien qui vaille le coup. On essaie un autre pays ?`,
  ]),
  noResults: ["Aucun canal ne correspond pour l'instant.", "Rien qui colle à ta demande pour le moment."],
  listHead: voiceTemplate(
    [
      { count: 3, what: "en France, casino" },
      { count: 12, what: "" },
    ],
    (p) => [`${plural(p.count, "canal", "canaux")}${p.what ? ` ${p.what}` : ""} :`, `J'en ai ${p.count}${p.what ? ` ${p.what}` : ""} :`],
  ),
  listMore: voiceTemplate([{ more: 4, url: "https://app.linkaffipro.com/agents/prospection" }], (p) => [`Et ${p.more} autres sur la page Prospection : ${p.url}`, `${p.more} de plus sur le site : ${p.url}`]),
  relancesNone: ["Personne à relancer aujourd'hui ✅", "Aucune relance à faire pour l'instant ✅"],
  relancesHead: voiceTemplate([{ count: 2 }], (p) => [`${plural(p.count, "canal", "canaux")} à relancer :`, `À relancer, ${p.count} :`]),
  offersNone: [
    "Tu n'as pas encore d'offre. Écris par exemple « ajoute une offre : Winamax, FR BE, CPA 120 ».",
    "Aucune offre enregistrée. Tu m'en donnes une ? Par exemple « ajoute une offre : Winamax, FR BE, CPA 120 ».",
  ],
  offersHead: voiceTemplate([{ count: 2 }], (p) => [`Tes offres (${p.count}) :`, `${plural(p.count, "offre active", "offres actives")} :`]),
  offerAdded: voiceTemplate([{ brand: "Winamax", countries: "France et Belgique", deal: "CPA 120 €" }], (p) => [
    `Offre ${p.brand} ajoutée : ${p.countries}, ${p.deal}. Je m'en sers dès le prochain classement.`,
    `C'est noté, ${p.brand} pour ${p.countries}, ${p.deal}. Le classement en tient compte dès maintenant.`,
  ]),
  offerNeedBrand: ["Il me manque la marque. Par exemple « ajoute une offre : Winamax, FR BE, CPA 120 ».", "Quelle marque ? Écris par exemple « ajoute une offre : Winamax, FR BE, CPA 120 »."],
  offerNeedCountries: voiceTemplate([{ brand: "Winamax" }], (p) => [`Pour ${p.brand}, quels pays tu acceptes ? Par exemple « FR BE ».`, `Il me manque les pays de ${p.brand}, par exemple « FR BE ».`]),
  offerDisabled: voiceTemplate([{ brand: "Winamax" }], (p) => [`Offre ${p.brand} désactivée, je ne m'en sers plus pour classer.`, `${p.brand} est retirée de tes offres actives.`]),
  offerUnknown: voiceTemplate([{ brand: "Winamax" }], (p) => [`Je ne trouve pas d'offre ${p.brand} active.`, `Aucune offre active au nom de ${p.brand}.`]),
  exportLink: voiceTemplate([{ url: "https://app.linkaffipro.com/agents/prospection?export=csv", count: 120 }], (p) => [
    `${plural(p.count, "prospect", "prospects")} dans l'export, à télécharger sur le site : ${p.url}`,
    `L'export est prêt sur le site, ${plural(p.count, "ligne", "lignes")} : ${p.url}`,
  ]),
  memberRefused: ["Ça, c'est l'admin qui le change. Je lui transmets si tu veux ?", "Seul l'admin met à jour les prospects. Tu veux que je lui passe le message ?"],
  buttonNotYours: ["Seul l'admin met à jour les prospects.", "Ce bouton est réservé à l'admin."],
  complexNoData: ["Je n'ai pas encore assez de canaux notés pour comparer. Je te redis ça quand la recherche aura tourné.", "Pas assez de prospects notés pour répondre. Je reviens vers toi quand j'en aurai plus."],
  complexHeld: ["Je préfère vérifier avant de te répondre, je reviens vers toi.", "Je revérifie mes chiffres avant de te répondre, je reviens vers toi."],
  avocat: ["Le casino en ligne est encadré dans ce pays : vérifie avec un avocat avant de signer.", "Ce pays a des règles strictes sur le casino en ligne, vérifie avec un avocat avant de t'engager."],
  offerQuestionBrand: ["Pour bien classer les canaux, il me faut ton offre. Quelle marque tu proposes aux affiliés ? Réponds « plus tard » pour passer."],
  offerQuestionCountries: ["Quels pays tu acceptes pour cette offre ? Par exemple « FR BE CH ». Réponds « plus tard » pour passer."],
  offerQuestionDeal: ["Tu proposes du CPA, du revshare, ou les deux ? Par exemple « CPA 100 » ou « revshare 30 % ». Réponds « plus tard » pour passer."],
  offerSetupSkipped: ["Sans marque, je ne crée pas d'offre. Tu pourras me la donner plus tard : « ajoute une offre : Winamax, FR BE, CPA 120 »."],
} satisfies VoiceTable;

/** Listes demandées par le client (prospects, relances, offres) : puces et longueur permises. */
export const LIST_RULES = { allowList: true, allowLong: true } as const;
export const listVariants = (lines: readonly string[]) => voiceVariants(lines, LIST_RULES);
