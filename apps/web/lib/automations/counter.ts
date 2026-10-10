/**
 * Compteur des cartes de relances : « envoyé à N personnes cette semaine, M ont cliqué » (fonction pure).
 *
 * Définition (la même pour toutes les relances) :
 * - fenêtre : les 7 derniers jours glissants (maintenant − 7 × 24 h → maintenant) ;
 * - N « envoyé à » : membres distincts dont une exécution de la relance a remis au moins un message au bot pendant
 *   la fenêtre (entrée réussie du journal de type « envoyer un message », « message du bot » ou « proposer un
 *   canal », datée dans la fenêtre). Les essais « Tester sur moi » ne comptent pas (contexte `test`) ;
 * - M « ont cliqué » : parmi ces N membres, ceux qui ont cliqué sur une offre (clic avec identifiant de suivi, hors
 *   robots : même règle que la condition « A cliqué une offre » du moteur) après leur premier message de la
 *   relance dans la fenêtre.
 * « Remis au bot » : le message est entré dans la file d'envoi Telegram ; un membre qui a bloqué le bot entre-temps
 * est quand même compté.
 */

export const COUNTER_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** Types d'entrées du journal qui écrivent au membre. */
export const COUNTED_SEND_TYPES: readonly string[] = [
  "send_message",
  "send_sequence",
  "suggest_channel",
];

export type CounterRun = { ruleId: string; memberId: string; context: unknown; log: unknown };
export type CounterClick = { memberId: string | null; createdAt: Date };
export type RuleCounter = { sent: number; clicked: number };

/** Début de la fenêtre du compteur. */
export function counterSince(now: Date): Date {
  return new Date(now.getTime() - COUNTER_WINDOW_DAYS * DAY_MS);
}

/** Vrai pour une exécution « Tester sur moi ». */
export function isTestRun(context: unknown): boolean {
  return !!context && typeof context === "object" && (context as { test?: unknown }).test === true;
}

/** Date du premier message remis au membre par cette exécution, à partir de `since` (null : aucun). */
export function firstSendAt(log: unknown, since: Date): Date | null {
  if (!Array.isArray(log)) return null;
  let first: Date | null = null;
  for (const e of log) {
    if (!e || typeof e !== "object") continue;
    const entry = e as { type?: unknown; ok?: unknown; at?: unknown };
    if (
      entry.ok !== true ||
      typeof entry.type !== "string" ||
      !COUNTED_SEND_TYPES.includes(entry.type)
    )
      continue;
    const at = typeof entry.at === "string" ? new Date(entry.at) : null;
    if (!at || Number.isNaN(at.getTime()) || at < since) continue;
    if (!first || at < first) first = at;
  }
  return first;
}

/** Compteurs par relance (clé : identifiant de la règle). Une relance sans envoi n'apparaît pas. */
export function weeklyCounters(
  runs: readonly CounterRun[],
  clicks: readonly CounterClick[],
  now: Date,
): Record<string, RuleCounter> {
  const since = counterSince(now);
  // Premier message de chaque relance à chaque membre.
  const sentAt = new Map<string, Map<string, Date>>();
  for (const run of runs) {
    if (isTestRun(run.context)) continue;
    const at = firstSendAt(run.log, since);
    if (!at || at > now) continue;
    const perMember = sentAt.get(run.ruleId) ?? new Map<string, Date>();
    const prev = perMember.get(run.memberId);
    if (!prev || at < prev) perMember.set(run.memberId, at);
    sentAt.set(run.ruleId, perMember);
  }
  const clicksByMember = new Map<string, Date[]>();
  for (const c of clicks) {
    if (!c.memberId) continue;
    clicksByMember.set(c.memberId, [...(clicksByMember.get(c.memberId) ?? []), c.createdAt]);
  }
  const out: Record<string, RuleCounter> = {};
  for (const [ruleId, perMember] of sentAt) {
    let clicked = 0;
    for (const [memberId, at] of perMember) {
      if ((clicksByMember.get(memberId) ?? []).some((d) => d >= at && d <= now)) clicked++;
    }
    out[ruleId] = { sent: perMember.size, clicked };
  }
  return out;
}

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

/** Phrase du compteur : « Envoyé à 12 personnes cette semaine, 3 ont cliqué. » */
export function counterSentence(c: RuleCounter | undefined | null): string {
  if (!c || c.sent === 0) return "Rien envoyé ces 7 derniers jours.";
  const who = `Envoyé à ${fmt(c.sent)} personne${c.sent > 1 ? "s" : ""} cette semaine`;
  const clicked =
    c.clicked === 0
      ? "personne n'a cliqué"
      : `${fmt(c.clicked)} ${c.clicked > 1 ? "ont" : "a"} cliqué`;
  return `${who}, ${clicked}.`;
}
