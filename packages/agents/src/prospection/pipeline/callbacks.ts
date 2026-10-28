/**
 * Phase 31, chantier C — boutons sous les messages de Kevin (`prospect:<id>:<action>`) et question du montant après
 * « 🤝 Signé ». Le chantier D branche `handleProspectCallback` dans le webhook et `answerPendingDeal` dans le chemin
 * rapide de Kevin.
 *
 * Droits : l'admin (`Setting admin.telegramUserId`) et les membres de l'équipe présentés comme ADMIN ou MANAGER ; un
 * membre simple (MEMBER) ou un inconnu ne peut rien changer (`isAllowed` injectable pour un autre contrôle).
 *
 * Actions : contacté → CONTACTED ; signé → boutons CPA / Revshare / Hybride ; deal_* → question du montant
 * (`Setting prospection.pending_deal.<chatId>`, 30 minutes) ; dossier → dossier stocké, sinon fabriqué (dans les
 * plafonds) ; plus tard → reste à contacter, revient dans 7 jours ; pas intéressé → SKIPPED ; rappels : relancé
 * (prochain rappel dans `reminder_days`), 3 jours, abandon → SKIPPED.
 */
import { esc } from "../../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../../boss/voice";
import type { AdminButton } from "../../types";
import { PROSPECTION_SETTINGS, type DealType, type ProspectionDeps, type ProspectStatus } from "../contract";
import { buildDossier, dossierAllowance, dossierMessage, requestDossierDelivery, type DossierDeps } from "../score/dossier";
import { formatEur, handleOf } from "../score/format";
import { numberSetting, objectOf, prospectionNow, rawProspectionSetting } from "../score/settings";
import { dealButtons, parseProspectCallback } from "./cards";
import { snoozeProspect, transitionProspect } from "./status";
import { askLinkAffiId } from "../learn/link";

export const PENDING_DEAL_PREFIX = "prospection.pending_deal.";
export const PENDING_DEAL_TTL_MS = 30 * 60_000;
export const LATER_DAYS = 7;
export const SNOOZE_REMINDER_DAYS = 3;

const NBSP = "\u00a0";
type H = { handle: string };
const H_SAMPLES: H[] = [{ handle: "@pronos_fr" }, { handle: "Casino Italia" }];
type Deal = { handle: string; deal: string };

/** Textes de Kevin des boutons (charte `docs/KEVIN-VOIX.md`). Les toasts restent courts (200 caractères au plus). */
export const PROSPECT_CALLBACK_VARIANTS = {
  contacted: voiceTemplate<H>(H_SAMPLES, (p) => [`Noté : ${p.handle} contacté ✅`, `${p.handle} passe en contacté ✅`]),
  signedAsk: voiceTemplate<H>(H_SAMPLES, (p) => [`Bravo ! Quel type de deal avec ${p.handle} ?`, `Top. Tu as signé ${p.handle} sur quel type de deal ?`]),
  askCpa: voiceTemplate<H>(H_SAMPLES, (p) => [`Combien par joueur pour ${p.handle} ? Écris juste le montant, par exemple 100.`, `Quelle CPA pour ${p.handle} ? Un montant en euros suffit, par exemple 100.`]),
  askRevshare: voiceTemplate<H>(H_SAMPLES, (p) => [`Quel pourcentage pour ${p.handle} ? Écris par exemple 30 %.`, `Revshare à combien pour ${p.handle} ? Par exemple 30 %.`]),
  askHybrid: voiceTemplate<H>(H_SAMPLES, (p) => [`Quel hybride pour ${p.handle} ? Écris par exemple 50 + 15 %.`, `Hybride à combien pour ${p.handle} ? Par exemple 50 + 15 %.`]),
  signedDone: voiceTemplate<Deal>(
    [
      { handle: "@pronos_fr", deal: `CPA 100${NBSP}€` },
      { handle: "Casino Italia", deal: `hybride 50${NBSP}€ + 15${NBSP}%` },
    ],
    (p) => [`C'est noté : ${p.handle} signé en ${p.deal} ✅`, `${p.handle} signé en ${p.deal}, c'est enregistré ✅`],
  ),
  dealNotUnderstood: ["Je n'ai pas compris le montant. Écris par exemple 100, 30 % ou 50 + 15 %.", "Il me faut un montant : 100, 30 % ou 50 + 15 % par exemple."],
  later: voiceTemplate<H>(H_SAMPLES, (p) => [`Ok, je te remontre ${p.handle} dans 7 jours.`, `${p.handle} revient dans ta liste dans 7 jours.`]),
  no: voiceTemplate<H>(H_SAMPLES, (p) => [`Ok, je ne te montre plus ${p.handle}.`, `${p.handle} sort de ta liste.`]),
  relaunched: voiceTemplate<H>(H_SAMPLES, (p) => [`Noté, je te redemande pour ${p.handle} dans quelques jours.`, `Ok pour ${p.handle}, je reviens vers toi si rien ne bouge.`]),
  snooze3: voiceTemplate<H>(H_SAMPLES, (p) => [`Ok, je te reparle de ${p.handle} dans 3 jours.`, `Je te relance pour ${p.handle} dans 3 jours.`]),
  abandon: voiceTemplate<H>(H_SAMPLES, (p) => [`Ok, on laisse tomber ${p.handle}.`, `${p.handle} est abandonné, je ne t'en parle plus.`]),
  dossierWait: voiceTemplate<H>(H_SAMPLES, (p) => [`Je prépare le dossier de ${p.handle}, je te l'envoie dès qu'il est prêt.`, `Le dossier de ${p.handle} arrive, je te l'envoie dès qu'il est prêt.`]),
  dossierNo: voiceTemplate<{ handle: string; reason: string }>(
    [{ handle: "@pronos_fr", reason: "plafond de 30 dossiers par semaine atteint" }],
    (p) => [`Pas de dossier pour ${p.handle} : ${p.reason}. Sa fiche garde la raison du niveau.`, `Je ne peux pas faire le dossier de ${p.handle} : ${p.reason}.`],
  ),
  dossierSent: ["Le dossier est juste en dessous.", "Dossier envoyé juste en dessous."],
  notAllowed: ["Ça, c'est l'admin qui décide.", "Seul l'admin peut changer ça."],
  unknown: ["Ce canal n'est plus dans la liste.", "Je ne retrouve plus ce canal."],
  refused: voiceTemplate<{ reason: string }>([{ reason: "ce canal est à ne plus montrer" }], (p) => [`Je ne peux pas : ${p.reason}.`, `Pas possible : ${p.reason}.`]),
} satisfies VoiceTable;

export type ProspectCallbackReply = { toast: string; reply?: { html: string; buttons?: AdminButton[][] } };

export type ProspectCallbackDeps = DossierDeps & {
  /** Contrôle des droits imposé (tests, autre canal) ; sinon admin ou membre ADMIN / MANAGER. */
  isAllowed?: (actorTelegramId: string | null, chatId: string) => Promise<boolean> | boolean;
};

/** La personne peut-elle changer le pipeline ? Admin, ou membre présenté ADMIN / MANAGER. */
export async function canActOnProspects(deps: ProspectCallbackDeps, actorTelegramId: string | null, chatId: string): Promise<boolean> {
  if (deps.isAllowed) return !!(await deps.isAllowed(actorTelegramId, chatId));
  const admin = await deps.prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  const adminId = typeof admin?.value === "string" ? admin.value : null;
  const actor = actorTelegramId ?? (chatId && !chatId.startsWith("-") ? chatId : null);
  if (!actor || !/^\d+$/.test(actor)) return false;
  if (adminId && actor === adminId) return true;
  try {
    const m = (await deps.prisma.teamMember.findUnique({ where: { telegramUserId: BigInt(actor) } })) as { role?: string; removedAt?: Date | null } | null;
    return !!m && !m.removedAt && (m.role === "ADMIN" || m.role === "MANAGER");
  } catch {
    return false;
  }
}

const toastOf = (s: string) => s.replace(/<[^>]*>/g, "").slice(0, 190);

type PendingDeal = { prospectId: string; dealType: DealType; at: string };

async function readPendingDeal(deps: ProspectionDeps, chatId: string): Promise<PendingDeal | null> {
  const v = objectOf(await rawProspectionSetting(deps, `${PENDING_DEAL_PREFIX}${chatId}`));
  if (typeof v.prospectId !== "string" || typeof v.at !== "string" || !["CPA", "REVSHARE", "HYBRID"].includes(String(v.dealType))) return null;
  return { prospectId: v.prospectId, dealType: v.dealType as DealType, at: v.at };
}

async function clearPendingDeal(deps: ProspectionDeps, chatId: string): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: `${PENDING_DEAL_PREFIX}${chatId}` } });
}

export async function handleProspectCallback(
  deps: ProspectCallbackDeps,
  input: { data: string; chatId: string; actorTelegramId: string | null },
): Promise<ProspectCallbackReply | null> {
  const parsed = parseProspectCallback(input.data);
  if (!parsed) return input.data.startsWith("prospect:") ? { toast: pick(PROSPECT_CALLBACK_VARIANTS.unknown, "prospect.cb.unknown", input.chatId) } : null;
  const chat = input.chatId;
  if (!(await canActOnProspects(deps, input.actorTelegramId, chat))) return { toast: pick(PROSPECT_CALLBACK_VARIANTS.notAllowed, "prospect.cb.notAllowed", chat) };
  const p = (await deps.prisma.prospect.findUnique({ where: { id: parsed.prospectId } })) as { id: string; username: string | null; title: string; status: ProspectStatus; dossier: string | null } | null;
  if (!p) return { toast: pick(PROSPECT_CALLBACK_VARIANTS.unknown, "prospect.cb.unknown", chat) };
  const handle = esc(handleOf(p));
  const V = PROSPECT_CALLBACK_VARIANTS;
  const say = (entry: readonly string[], key: string) => pick(entry, `prospect.cb.${key}`, chat);
  const refused = (reason: string) => ({ toast: toastOf(say(V.refused({ reason }), "refused")) });
  const go = async (to: ProspectStatus, key: keyof typeof V, payload: Record<string, unknown> = {}) => {
    const r = await transitionProspect(deps, p.id, to, { by: "client", payload: { via: "telegram", button: parsed.action, actor: input.actorTelegramId, ...payload } });
    if (!r.ok) return refused(r.reason);
    return { toast: toastOf(say((V[key] as (x: H) => readonly string[])({ handle }), key)) };
  };

  switch (parsed.action) {
    case "contacted":
      return go("CONTACTED", "contacted");
    case "no":
      return go("SKIPPED", "no");
    case "abandon":
      return go("SKIPPED", "abandon", { reason: "abandon" });
    case "signed": {
      if (p.status === "BLACKLISTED") return refused("ce canal est à ne plus montrer");
      const text = say(V.signedAsk({ handle }), "signedAsk");
      return { toast: toastOf(text), reply: { html: text, buttons: dealButtons(p.id) } };
    }
    case "deal_cpa":
    case "deal_revshare":
    case "deal_hybrid": {
      const dealType: DealType = parsed.action === "deal_cpa" ? "CPA" : parsed.action === "deal_revshare" ? "REVSHARE" : "HYBRID";
      const value = { prospectId: p.id, dealType, at: prospectionNow(deps).toISOString() };
      const key = `${PENDING_DEAL_PREFIX}${chat}`;
      await deps.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      const ask = dealType === "CPA" ? V.askCpa : dealType === "REVSHARE" ? V.askRevshare : V.askHybrid;
      const text = say(ask({ handle }), `ask.${dealType}`);
      return { toast: toastOf(text), reply: { html: text } };
    }
    case "later": {
      const r = await snoozeProspect(deps, p.id, LATER_DAYS, "client");
      if (!r.ok) return refused(r.reason);
      return { toast: toastOf(say(V.later({ handle }), "later")) };
    }
    case "snooze3": {
      const r = await snoozeProspect(deps, p.id, SNOOZE_REMINDER_DAYS, "client");
      if (!r.ok) return refused(r.reason);
      return { toast: toastOf(say(V.snooze3({ handle }), "snooze3")) };
    }
    case "relaunched": {
      const days = await numberSetting(deps, PROSPECTION_SETTINGS.reminderDays.key, PROSPECTION_SETTINGS.reminderDays.value);
      const r = await snoozeProspect(deps, p.id, days, "client");
      if (!r.ok) return refused(r.reason);
      await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "REMINDER", payload: { answer: "relaunched", by: "client" }, createdAt: prospectionNow(deps) } });
      return { toast: toastOf(say(V.relaunched({ handle }), "relaunched")) };
    }
    case "dossier": {
      if (p.dossier) {
        const html = dossierMessage(handle, p.dossier, chat);
        return { toast: toastOf(say(V.dossierSent, "dossierSent")), reply: { html } };
      }
      const blocked = await dossierAllowance(deps);
      if (blocked) {
        const text = say(V.dossierNo({ handle, reason: blocked }), "dossierNo");
        return { toast: toastOf(text), reply: { html: text } };
      }
      if (deps.prospection?.enqueue) {
        await requestDossierDelivery(deps, p.id, chat);
        await deps.prospection.enqueue({ type: "prospection.dossier", prospectId: p.id }, { jobId: `prospection-dossier-${p.id}`, priority: 1 });
        const text = say(V.dossierWait({ handle }), "dossierWait");
        return { toast: toastOf(text), reply: { html: text } };
      }
      const r = await buildDossier(deps, p.id);
      if (r.ok) return { toast: toastOf(say(V.dossierSent, "dossierSent")), reply: { html: dossierMessage(handle, r.dossier, chat) } };
      const text = say(V.dossierNo({ handle, reason: r.reason }), "dossierNo");
      return { toast: toastOf(text), reply: { html: text } };
    }
  }
}

// ————— Montant après « Signé » —————

/**
 * Lit « 100 », « 100 € », « 30 % », « 50 + 15 % » (EUR). Deux nombres → hybride (le nombre suivi de % est le
 * revshare) ; un nombre avec % → revshare ; un nombre seul → le type choisi par le bouton. Null si illisible. Pur.
 */
export function parseDealAmount(text: string, chosen: DealType): { dealType: DealType; dealTerms: { cpa?: number; revshare?: number; currency: "EUR" } } | null {
  const t = text.replace(/\u00a0|\u202f/g, " ").trim();
  if (t.length > 60) return null;
  const re = /(\d+(?:[.,]\d+)?)\s*(%|€|eur(?:os?)?|e\b)?/giu;
  const nums: Array<{ v: number; pct: boolean }> = [];
  for (let m = re.exec(t); m; m = re.exec(t)) nums.push({ v: Number(m[1]!.replace(",", ".")), pct: m[2] === "%" });
  if (!nums.length || nums.length > 2 || nums.some((n) => !Number.isFinite(n.v) || n.v <= 0)) return null;
  if (nums.length === 2) {
    const rs = nums.find((n) => n.pct) ?? nums[1]!;
    const cpa = nums.find((n) => n !== rs)!;
    if (cpa.pct || rs.v > 100) return null;
    return { dealType: "HYBRID", dealTerms: { cpa: cpa.v, revshare: rs.v, currency: "EUR" } };
  }
  const n = nums[0]!;
  if (n.pct || chosen === "REVSHARE") return n.v > 100 ? null : { dealType: "REVSHARE", dealTerms: { revshare: n.v, currency: "EUR" } };
  if (chosen === "HYBRID") return null;
  return { dealType: "CPA", dealTerms: { cpa: n.v, currency: "EUR" } };
}

function dealWords(dealType: DealType, terms: { cpa?: number; revshare?: number }): string {
  if (dealType === "HYBRID") return `hybride ${formatEur(terms.cpa ?? 0)} + ${terms.revshare}${NBSP}%`;
  if (dealType === "REVSHARE") return `revshare ${terms.revshare}${NBSP}%`;
  return `CPA ${formatEur(terms.cpa ?? 0)}`;
}

/**
 * Réponse à la question du montant (moins de 30 minutes après le bouton) : SIGNED avec `dealType` / `dealTerms` et une
 * ligne de confirmation. Null s'il n'y a pas de question en attente (Kevin traite alors le message normalement).
 */
export async function answerPendingDeal(deps: ProspectionDeps, chatId: string, text: string): Promise<string | null> {
  const pending = await readPendingDeal(deps, chatId);
  if (!pending) return null;
  const now = prospectionNow(deps);
  if (now.getTime() - Date.parse(pending.at) > PENDING_DEAL_TTL_MS) {
    await clearPendingDeal(deps, chatId);
    return null;
  }
  const deal = parseDealAmount(text, pending.dealType);
  if (!deal) {
    // Pas un montant : si le message ne contient aucun chiffre, ce n'est pas une réponse (Kevin le traite).
    if (!/\d/.test(text)) return null;
    return pick(PROSPECT_CALLBACK_VARIANTS.dealNotUnderstood, "prospect.deal.notUnderstood", chatId);
  }
  const p = (await deps.prisma.prospect.findUnique({ where: { id: pending.prospectId } })) as { id: string; username: string | null; title: string; status: ProspectStatus } | null;
  await clearPendingDeal(deps, chatId);
  if (!p) return pick(PROSPECT_CALLBACK_VARIANTS.unknown, "prospect.cb.unknown", chatId);
  const handle = esc(handleOf(p));
  if (p.status === "SIGNED" || p.status === "ACTIVE") {
    await deps.prisma.prospect.update({ where: { id: p.id }, data: { dealType: deal.dealType, dealTerms: deal.dealTerms } });
    await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "STATUS_CHANGED", payload: { from: p.status, to: p.status, by: "client", dealType: deal.dealType, dealTerms: deal.dealTerms, via: "telegram" }, createdAt: now } });
  } else {
    const r = await transitionProspect(deps, p.id, "SIGNED", { by: "client", dealType: deal.dealType, dealTerms: deal.dealTerms, payload: { via: "telegram" } });
    if (!r.ok) return pick(PROSPECT_CALLBACK_VARIANTS.refused({ reason: r.reason }), "prospect.cb.refused", chatId);
  }
  const done = pick(PROSPECT_CALLBACK_VARIANTS.signedDone({ handle, deal: dealWords(deal.dealType, deal.dealTerms) }), "prospect.deal.done", chatId);
  // Phase 32 : à la signature, Kevin demande l'identifiant Link Affi (rattachement des vrais résultats).
  const ask = await askLinkAffiId(deps as never, p.id, { chatKey: chatId }).catch(() => null);
  return ask ? `${done}\n${ask.text}` : done;
}
