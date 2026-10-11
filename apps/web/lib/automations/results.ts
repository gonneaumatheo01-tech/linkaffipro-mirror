/**
 * Résultats d'une relance depuis le début (fiche d'une relance, cartes) : fonctions pures, testées dans results.test.ts ;
 * la lecture en base est `loadRuleResults` (queries.ts).
 *
 * Définitions (une seule, pour toutes les relances) :
 * - envoyés : messages privés de la relance remis par Telegram (`OutboundMessage` kind AUTOMATION, statut SENT,
 *   `automationRuleId`) ; les essais « Tester sur moi » (kind TEST) ne comptent pas. Le rattachement d'un message à sa
 *   relance existe depuis la phase 10 : les messages plus anciens ne sont pas comptés ici (le compteur de la semaine
 *   des cartes, lui, lit le journal des exécutions) ;
 * - clics : clics sur les boutons « Offre (campagne) » de la relance (liens `TrackingLink` rattachés à la relance, une
 *   ligne `Click` par clic, hors robots), comptés seulement pour un membre qui avait déjà reçu la relance pour de vrai
 *   (premier message AUTOMATION remis) : les clics des essais « Tester sur moi », qui utilisent le même lien, ne
 *   comptent pas ; personnes : membres distincts parmi ces clics ;
 * - inscriptions et premiers dépôts : joueurs rattachés par leur identifiant de suivi à un clic compté sur ces boutons
 *   (donc nos joueurs par définition), comme les résultats d'un message à un groupe ;
 * - gains = commissions − dépense pub (`gainsOf`, packages/core/src/commissions.ts, même règle partout) ; une relance
 *   n'a pas de dépense pub, donc gains = commissions. Commissions d'un joueur : somme de ses événements de commission
 *   (`PlayerEvent` CPA, positif, et CPA_REVERSAL, négatif : une commission annulée se retire), les mêmes que ceux des
 *   statistiques journalières (écrits par la synchro Link Affi). La part de revenu du casino (revshare) n'existe chez
 *   Link Affi qu'en total par offre et par jour : elle ne peut pas être attribuée à une relance.
 */
import { commissionsOf, gainsOf } from "@linkaffipro/core";
import { fmtDateShort } from "@/lib/format";

export type RuleResults = {
  sent: number;
  clicks: number;
  clickers: number;
  registrations: number;
  ftds: number;
  commissions: number;
  /** Commissions − dépense pub (0 pour une relance). */
  gains: number;
};

export const EMPTY_RESULTS: RuleResults = {
  sent: 0,
  clicks: 0,
  clickers: 0,
  registrations: 0,
  ftds: 0,
  commissions: 0,
  gains: 0,
};

/** Clic sur un bouton Offre d'une relance : qui (membre) et quand. */
export type ResultClick = { ruleId: string; memberId: string | null; at: Date };

/** Premier message réel (kind AUTOMATION, remis) de la relance à un membre. */
export type ResultFirstSend = { ruleId: string; memberId: string; at: Date };

/** Joueur venu d'une relance, avec son clic d'origine et ses commissions. */
export type ResultPlayer = {
  ruleId: string;
  clickMemberId: string | null;
  clickAt: Date;
  ftdAt: Date | null;
  /** Montants des événements de commission (CPA créditée > 0, CPA annulée < 0). */
  commissionEvents: number[];
};

/** Commission d'un joueur : somme de ses événements de commission (une annulation retire le crédit). */
export function playerCommission(p: Pick<ResultPlayer, "commissionEvents">): number {
  return p.commissionEvents.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
}

/** Résultats par relance (clé : identifiant de la règle ; une relance sans rien a des zéros). */
export function ruleResults(
  ruleIds: readonly string[],
  data: {
    sent: ReadonlyArray<{ ruleId: string; count: number }>;
    firstSends: readonly ResultFirstSend[];
    clicks: readonly ResultClick[];
    players: readonly ResultPlayer[];
  },
): Record<string, RuleResults> {
  const out: Record<string, RuleResults> = {};
  for (const id of ruleIds) out[id] = { ...EMPTY_RESULTS };
  for (const s of data.sent) if (out[s.ruleId]) out[s.ruleId]!.sent += s.count;
  // Un clic compte si son membre avait déjà reçu la relance pour de vrai (sinon : essai, ou clic sans membre).
  const firstSend = new Map<string, number>();
  for (const f of data.firstSends) {
    const key = `${f.ruleId}\u0000${f.memberId}`;
    const t = f.at.getTime();
    if (!firstSend.has(key) || t < firstSend.get(key)!) firstSend.set(key, t);
  }
  const counted = (ruleId: string, memberId: string | null, at: Date) => {
    if (!memberId) return false;
    const t = firstSend.get(`${ruleId}\u0000${memberId}`);
    return t !== undefined && t <= at.getTime();
  };
  const clickers = new Map<string, Set<string>>();
  for (const c of data.clicks) {
    const r = out[c.ruleId];
    if (!r || !counted(c.ruleId, c.memberId, c.at)) continue;
    r.clicks++;
    const set = clickers.get(c.ruleId) ?? new Set<string>();
    set.add(c.memberId!);
    clickers.set(c.ruleId, set);
  }
  for (const [ruleId, set] of clickers) out[ruleId]!.clickers = set.size;
  for (const p of data.players) {
    const r = out[p.ruleId];
    if (!r || !counted(p.ruleId, p.clickMemberId, p.clickAt)) continue;
    r.registrations++;
    if (p.ftdAt) r.ftds++;
    r.commissions += playerCommission(p);
  }
  for (const r of Object.values(out)) {
    // CPA nette seulement (aucune part de revshare attribuable), aucune dépense pub.
    r.commissions = commissionsOf(r.commissions, 0);
    r.gains = gainsOf(r.commissions, 0);
  }
  return out;
}

/** Vrai si la relance a au moins un résultat à montrer (sinon, une phrase « rien pour l'instant »). */
export function hasResults(r: RuleResults | undefined | null): boolean {
  return !!r && (r.sent > 0 || r.clicks > 0 || r.registrations > 0 || r.commissions !== 0);
}

/**
 * Vrai s'il faut montrer clics, inscriptions, premiers dépôts et gains : la relance a un bouton « Offre (campagne) »,
 * ou des résultats en sont déjà venus (bouton retiré depuis). Sinon ces chiffres resteraient à zéro pour toujours.
 */
export function showsAttribution(r: RuleResults, hasOfferButton: boolean): boolean {
  return hasOfferButton || r.clicks > 0 || r.registrations > 0 || r.commissions !== 0;
}

/**
 * Début des résultats d'une relance : les messages ne sont rattachés à leur relance que depuis la phase 10
 * (`trackingStart`, date de la mise à jour de la base). Une relance plus ancienne est comptée depuis cette date ;
 * null = depuis le début (relance créée après, ou date inconnue).
 */
export function resultsSince(ruleCreatedAt: Date, trackingStart: Date | null): Date | null {
  return trackingStart && ruleCreatedAt.getTime() < trackingStart.getTime() ? trackingStart : null;
}

/** « Depuis le début » ou « Depuis le 11 oct. » (date de Paris). */
export function resultsSinceLabel(since: Date | null, now: Date = new Date()): string {
  return since ? `Depuis le ${fmtDateShort(since, now)}` : "Depuis le début";
}

/** Phrase sous les résultats d'une relance plus ancienne que le suivi par relance (null sinon). */
export function resultsSinceNote(since: Date | null, now: Date = new Date()): string | null {
  return since
    ? `Les messages envoyés avant le ${fmtDateShort(since, now)} ne sont pas comptés.`
    : null;
}

const plural = (n: number, one: string, many: string) => (Math.abs(n) >= 2 ? many : one);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

/**
 * Résultats en morceaux « chiffre + mot » (« 12 envoyés », « 3 premiers dépôts », « 50 € de gains »), pour une ligne
 * de carte. `money` : format du montant des gains (vrai signe moins, arrondi de l'écran). `attribution: false`
 * (relance sans bouton Offre, voir `showsAttribution`) : les envoyés seulement.
 */
export function resultsParts(
  r: RuleResults,
  money: (n: number) => string,
  opts: { attribution?: boolean } = {},
): Array<{ figure: string; words: string }> {
  const sent = { figure: num(r.sent), words: plural(r.sent, "envoyé", "envoyés") };
  if (opts.attribution === false) return [sent];
  return [
    sent,
    { figure: num(r.clicks), words: plural(r.clicks, "clic", "clics") },
    { figure: num(r.registrations), words: plural(r.registrations, "inscription", "inscriptions") },
    { figure: num(r.ftds), words: plural(r.ftds, "premier dépôt", "premiers dépôts") },
    { figure: money(r.gains), words: "de gains" },
  ];
}

/** Même chose en une phrase (« 12 envoyés · 7 clics · … »). */
export function resultsSentence(
  r: RuleResults,
  money: (n: number) => string,
  opts: { attribution?: boolean } = {},
): string {
  return resultsParts(r, money, opts)
    .map((p) => `${p.figure} ${p.words}`)
    .join(" · ");
}
