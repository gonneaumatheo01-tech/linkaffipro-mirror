/**
 * Phase 31, chantier C — « Top du jour » (section 5 du prompt).
 *
 * Choix (`buildDailyTop`, sans envoi) : les QUALIFIED jamais présentés, ou revenus d'un « Plus tard » échu, ou
 * présentés il y a plus de 7 jours sans action et une seule fois (trace `ProspectEvent` PRESENTED) ; `snoozedUntil`
 * passé ; région EU seulement (NON_EU si le périmètre a été élargi et que le pays y est ; jamais une région inconnue ni
 * un vendeur de matchs truqués) ; triés niveau → score → cocitations ; mélange des pays et des verticales (pas plus de
 * 40 % du même pays ni 70 % de la même verticale tant que d'autres existent, puis complément) ; un prospect déjà
 * présenté aujourd'hui n'est jamais repris (« encore 10 »).
 *
 * Envoi (`sendDailyTop`) : TOUT le texte (en-tête + cartes) passe par le QA Global (`KEVIN_RESPONSE`) ; refus ou QA en
 * panne → rien n'est envoyé et Kevin le dit par un texte fixe ; sinon un message d'en-tête puis un message par
 * prospect avec ses boutons, `presentedAt` posé à l'envoi.
 */
import { pick, voiceTemplate, type VoiceTable } from "../../boss/voice";
import { qaGate } from "../../qa-gates/gate";
import type { QaDeps } from "../../qa/contract";
import { parisDay } from "../../rules/time";
import type { AdminButton } from "../../types";
import { PROSPECTION_LIMITS, PROSPECTION_SETTINGS, PROSPECTION_TEAM_KEY, type ProspectionDeps, type ProspectTier, type ProspectVertical } from "../contract";
import { DAY_MS, loadCountriesScope, numberSetting, prospectionNow, regionVisible, stringArray } from "../score/settings";
import { maskPublicContactsForQa } from "../score/format";
import { activeOffers, contactsOf, type OfferRow, type ProspectRow } from "../score/store";
import { prospectCardButtons, renderProspectCard } from "./cards";

export type DailyTopScope = "morning" | "on_demand";
export type DailyTopItem = {
  prospectId: string;
  html: string;
  buttons: AdminButton[][];
  /** Contacts publics de la carte (masqués dans la copie vérifiée par le QA Global, voir `maskPublicContactsForQa`). */
  contacts?: Array<{ type: string; value: string }>;
};
export type DailyTop = { header: string; items: DailyTopItem[] };

const TIER_RANK: Record<ProspectTier, number> = { A: 0, B: 1, C: 2, D: 3 };

type HeaderSample = { n: number; tiers: string; countries: string };

/** Textes de Kevin du Top du jour (charte `docs/KEVIN-VOIX.md`). */
export const DAILY_TOP_VARIANTS = {
  headerMorning: voiceTemplate<HeaderSample>(
    [
      { n: 10, tiers: "4 A, 6 B", countries: "3 FR, 2 IT, 2 ES, 2 DE, 1 PT" },
      { n: 1, tiers: "1 A", countries: "1 FR" },
    ],
    (p) => [
      `${p.n} ${p.n > 1 ? "canaux" : "canal"} à contacter — ${p.tiers} — ${p.countries}`,
      `Ta liste du jour : ${p.n} ${p.n > 1 ? "canaux" : "canal"} — ${p.tiers} — ${p.countries}`,
    ],
  ),
  headerOnDemand: voiceTemplate<HeaderSample>(
    [
      { n: 10, tiers: "2 A, 8 B", countries: "4 FR, 3 IT, 3 PL" },
      { n: 2, tiers: "2 C", countries: "1 DE, 1 AT" },
    ],
    (p) => [`Encore ${p.n} ${p.n > 1 ? "canaux" : "canal"} — ${p.tiers} — ${p.countries}`, `${p.n} de plus à regarder — ${p.tiers} — ${p.countries}`],
  ),
  emptyMorning: ["Rien de nouveau à te montrer aujourd'hui.", "Pas de nouveau canal à contacter ce matin."],
  emptyOnDemand: ["Je n'ai plus de canal à te montrer pour l'instant.", "C'est tout pour l'instant, je te montre les suivants dès qu'ils sont prêts."],
  qaRejected: [
    "La liste du jour n'a pas passé la vérification, je ne l'envoie pas. Je la refais au prochain passage.",
    "Je garde la liste du jour : la vérification l'a bloquée. Je la refais au prochain passage.",
  ],
  qaUnavailable: [
    "La vérification ne répond pas, je n'envoie pas la liste du jour pour l'instant.",
    "Je ne peux pas faire vérifier la liste du jour en ce moment, je ne l'envoie pas.",
  ],
} satisfies VoiceTable;

/** Le prospect peut-il être présenté maintenant ? `presentedCount` : nombre de PRESENTED déjà faits. Pur. */
export function presentable(p: Pick<ProspectRow, "presentedAt" | "snoozedUntil">, presentedCount: number, now: Date): boolean {
  if (p.snoozedUntil && p.snoozedUntil.getTime() > now.getTime()) return false;
  if (!p.presentedAt) return true;
  // Revenu d'un « Plus tard » posé après la dernière présentation.
  if (p.snoozedUntil && p.snoozedUntil.getTime() > p.presentedAt.getTime()) return true;
  // Présenté il y a plus de 7 jours sans action : une seule nouvelle présentation.
  return now.getTime() - p.presentedAt.getTime() > PROSPECTION_LIMITS.representAfterDays * DAY_MS && presentedCount < 2;
}

export function sortForTop<T extends Pick<ProspectRow, "tier" | "score" | "cocitationCount">>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => (TIER_RANK[a.tier ?? "D"] ?? 3) - (TIER_RANK[b.tier ?? "D"] ?? 3) || (b.score ?? 0) - (a.score ?? 0) || (b.cocitationCount ?? 0) - (a.cocitationCount ?? 0),
  );
}

const countryOf = (p: Pick<ProspectRow, "countries">) => stringArray(p.countries)[0]?.toUpperCase() ?? "?";
const verticalOf = (v: ProspectVertical) => (v === "CASINO" ? "CASINO" : v === "SPORTS" ? "SPORTS" : "BOTH");

/**
 * Mélange : premier passage avec un plafond par pays (40 % de la liste, 1 au moins) et par verticale (70 %), seulement
 * s'il existe d'autres pays / verticales ; deuxième passage : complément dans l'ordre. Pur.
 */
export function mixTop<T extends Pick<ProspectRow, "countries" | "vertical">>(sorted: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  const countries = new Set(sorted.map(countryOf));
  const verticals = new Set(sorted.map((p) => verticalOf(p.vertical)));
  const countryCap = countries.size > 1 ? Math.max(1, Math.floor(count * 0.4)) : count;
  const verticalCap = verticals.size > 1 ? Math.max(1, Math.ceil(count * 0.7)) : count;
  const picked: T[] = [];
  const byCountry = new Map<string, number>();
  const byVertical = new Map<string, number>();
  for (const p of sorted) {
    if (picked.length >= count) break;
    const c = countryOf(p);
    const v = verticalOf(p.vertical);
    if ((byCountry.get(c) ?? 0) >= countryCap || (byVertical.get(v) ?? 0) >= verticalCap) continue;
    picked.push(p);
    byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    byVertical.set(v, (byVertical.get(v) ?? 0) + 1);
  }
  for (const p of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  // Ordre final : niveau puis score (le mélange ne change que la sélection).
  return sortForTop(picked as unknown as Array<T & Pick<ProspectRow, "tier" | "score" | "cocitationCount">>) as unknown as T[];
}

function countsText(values: readonly string[], order?: readonly string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  const entries = [...m.entries()];
  entries.sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0])));
  return entries.map(([k, n]) => `${n} ${k}`).join(", ");
}

export async function buildDailyTop(deps: ProspectionDeps, opts: { count: number; now: Date; chatScope?: DailyTopScope }): Promise<DailyTop> {
  const now = opts.now;
  const scope = opts.chatScope ?? "morning";
  const countriesScope = await loadCountriesScope(deps);
  const rows = (await deps.prisma.prospect.findMany({ where: { status: "QUALIFIED", tier: { in: ["A", "B", "C"] } } })) as unknown as ProspectRow[];
  const visible = rows.filter(
    (p) => regionVisible(p, countriesScope, { allowUnknown: false }) && !stringArray(p.riskFlags).includes("SCAM_FIXED_MATCHES") && (p.snoozedUntil === null || p.snoozedUntil.getTime() <= now.getTime()),
  );
  const presentedIds = visible.filter((p) => p.presentedAt).map((p) => p.id);
  const counts = new Map<string, number>();
  if (presentedIds.length) {
    const events = (await deps.prisma.prospectEvent.findMany({ where: { type: "PRESENTED", prospectId: { in: presentedIds } } })) as Array<{ prospectId: string }>;
    for (const e of events) counts.set(e.prospectId, (counts.get(e.prospectId) ?? 0) + 1);
  }
  const today = parisDay(now);
  const eligible = visible.filter((p) => presentable(p, counts.get(p.id) ?? 0, now) && !(p.presentedAt && parisDay(p.presentedAt) === today));
  const chosen = mixTop(sortForTop(eligible), Math.max(0, Math.min(50, Math.round(opts.count))));

  const offers = await activeOffers(deps);
  const offerById = new Map<string, OfferRow>(offers.map((o) => [o.id, o]));
  const items: DailyTopItem[] = [];
  for (const p of chosen) {
    const contacts = await contactsOf(deps, p.id);
    items.push({
      prospectId: p.id,
      html: renderProspectCard(p, contacts, p.matchedOfferId ? (offerById.get(p.matchedOfferId) ?? null) : null, now),
      buttons: prospectCardButtons(p.id),
      contacts: contacts.map((c) => ({ type: c.type, value: c.value })),
    });
  }

  let header: string;
  if (!chosen.length) header = pick(scope === "morning" ? DAILY_TOP_VARIANTS.emptyMorning : DAILY_TOP_VARIANTS.emptyOnDemand, `prospection.top.empty.${scope}`);
  else {
    const sample: HeaderSample = { n: chosen.length, tiers: countsText(chosen.map((p) => p.tier ?? "?"), ["A", "B", "C", "D", "?"]), countries: countsText(chosen.map(countryOf)) };
    header = pick((scope === "morning" ? DAILY_TOP_VARIANTS.headerMorning : DAILY_TOP_VARIANTS.headerOnDemand)(sample), `prospection.top.header.${scope}`);
  }
  return { header, items };
}

export async function sendDailyTop(
  deps: ProspectionDeps & QaDeps,
  opts: { count?: number; now?: Date; chatScope?: DailyTopScope } = {},
): Promise<{ sent: number; qaBlocked: boolean }> {
  const now = opts.now ?? prospectionNow(deps);
  const scope = opts.chatScope ?? "morning";
  if (!deps.admin) return { sent: 0, qaBlocked: false };
  const count = opts.count ?? (await numberSetting(deps, PROSPECTION_SETTINGS.dailyTopCount.key, PROSPECTION_SETTINGS.dailyTopCount.value));
  const top = await buildDailyTop(deps, { count, now, chatScope: scope });
  if (!top.items.length) {
    // Phrase fixe de Kevin (hors du QA, comme ses autres textes fixes).
    await deps.admin.send(top.header);
    return { sent: 0, qaBlocked: false };
  }

  const text = [top.header, ...top.items.map((i) => i.html)].join("\n\n");
  const gate = await qaGate(deps, {
    contentType: "KEVIN_RESPONSE",
    contentId: `prospection-top:${parisDay(now)}:${scope}:${top.items.length}`,
    teamKey: PROSPECTION_TEAM_KEY,
    // `prospectIds` : identifiants masqués par le QA sans compter comme une fuite ; e-mails de contact publics masqués.
    content: maskPublicContactsForQa({ text, prospectIds: top.items.map((i) => i.prospectId) }, top.items.flatMap((i) => i.contacts ?? [])),
  });
  if (gate.kind !== "approved") {
    await deps.admin.send(pick(gate.kind === "unavailable" ? DAILY_TOP_VARIANTS.qaUnavailable : DAILY_TOP_VARIANTS.qaRejected, `prospection.top.qa.${gate.kind}`));
    return { sent: 0, qaBlocked: true };
  }

  await deps.admin.send(top.header);
  let sent = 0;
  for (const [rank, item] of top.items.entries()) {
    const res = await deps.admin.send(item.html, { buttons: item.buttons });
    if (!res) continue;
    sent++;
    await deps.prisma.prospect.update({ where: { id: item.prospectId }, data: { presentedAt: now } });
    await deps.prisma.prospectEvent.create({ data: { prospectId: item.prospectId, type: "PRESENTED", payload: { scope, rank: rank + 1, messageId: res.messageId, by: "system" }, createdAt: now } });
  }
  return { sent, qaBlocked: false };
}
