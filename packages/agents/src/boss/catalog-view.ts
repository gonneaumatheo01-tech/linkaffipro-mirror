/**
 * Phase 33, chantier C — Kevin montre ce que font et vont faire les équipes, et présente chaque agent (lecture seule,
 * immédiat, gratuit sauf l'aperçu des matchs qui compte des appels de cotes : la réponse le dit). Les réponses sont
 * écrites par le code à partir des faits des vues (`orders/view/*`, aucun chiffre inventé), 8 lignes au plus puis
 * « Tu veux le détail ? » (paramètre `detail`). « Dis à l'agent X de … » n'est PAS ici : c'est un ordre (chantier B,
 * qui retrouve l'agent par `findAgent`).
 */
import { esc, nowOf } from "../admin/journal";
import { agentEntry, findAgent, type AgentEntry } from "../orders/agents-dict";
import { agentCard } from "../orders/agents-dict";
import { fitLines, isDaySlot, resolveDay, type DaySlot, type ViewResult } from "../orders/view/common";
import { pendingValidations, validationLines, viewDone } from "../orders/view/done";
import { viewMatches } from "../orders/view/matches";
import { viewPlan } from "../orders/view/plan";
import { viewScheduled } from "../orders/view/scheduled";
import { previewSportsPicks, viewSportsChannel } from "../orders/view/sports";
import { whyNothing } from "../orders/view/why";
import type { TeamKey } from "../types";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { bool, int, oneOf, str } from "./params";
import { askToChoose, channelRefs, resolveChannel, resolvePersona, resolveTeam, type ChannelRef } from "./resolve";
import { BOSS_READ_KEYS } from "./team/rights";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

const JOURS = ["aujourdhui", "demain", "apres_demain", "hier"] as const;
const MOMENTS = ["matin", "midi", "apres-midi", "soir", "nuit"] as const;

const jourField = oneOf("Jour : aujourdhui (défaut), demain, apres_demain ou hier", JOURS, true);
const dateField = str("Date précise AAAA-MM-JJ (facultatif, remplace « jour »)", { optional: true, maxLength: 10 });
const momentField = oneOf("Moment de la journée (facultatif) : matin, midi, apres-midi, soir, nuit", MOMENTS, true);
const detailField = bool("Vrai si l'admin a demandé le détail complet (« oui, le détail »)", true);

type DayP = { jour?: (typeof JOURS)[number]; date?: string; moment?: (typeof MOMENTS)[number]; detail?: boolean };

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const CATALOG_VIEW_VARIANTS = {
  more: ["Tu veux le détail ?", "Je t'envoie le reste ?", "Tu veux la suite ?"],
  mediaCaption: ["Média prévu", "Le média prévu"],
  noSports: ["Je n'ai aucun canal paris pour le moment.", "Aucun canal paris n'est réglé pour l'instant."],
  whichChannel: ["Quel canal ?", "Sur quel canal ?"],
  whyNone: ["Rien de bloqué : tout ce qui est prévu est en route.", "Je ne vois aucun blocage, tout suit son cours."],
  agentAmbiguous: voiceTemplate<{ name: string }>([{ name: "celui des heures" }], (p) => [`Plusieurs agents peuvent être « ${p.name} » :`, `« ${p.name} », ça peut être plusieurs agents :`]),
  agentUnknown: voiceTemplate<{ known: string }>([{ known: "Rédaction, Horaires, Cotes" }], (p) => [
    `Je ne connais pas cet agent. Par exemple : ${p.known}.`,
    `Je ne vois pas de qui tu parles. Par exemple : ${p.known}.`,
  ]),
  validationNone: ["Rien n'attend ta validation.", "Rien à valider pour l'instant.", "Tout est validé, rien en attente."],
} satisfies VoiceTable;

const V = CATALOG_VIEW_VARIANTS;
const MORE = V.more;

function chatKey(deps: BossDeps): string | null {
  const c = (deps as BossExecDeps).chat;
  return c ? c.chatId.toString() : null;
}

function dayOf(deps: BossDeps, p: DayP): string {
  return resolveDay(nowOf(deps), p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : (p.jour ?? null));
}

function slotOf(p: DayP): DaySlot | null {
  return isDaySlot(p.moment) ? p.moment : null;
}

/** Réponse de Kevin à partir d'une vue : 8 lignes au plus (sinon « Tu veux le détail ? »), HTML échappé. */
export function viewReply(deps: BossDeps, key: string, r: ViewResult, detail = false): BossReply {
  const fit = fitLines(r.lines, detail, pick(MORE, `view.more.${key}`, chatKey(deps)));
  const reply: BossReply = { reply: fit.lines.map(esc).join("\n") };
  if (r.buttons?.length) reply.buttons = r.buttons;
  const media = r.mediaAssetIds ?? [];
  if (media.length) {
    const chat = (deps as BossExecDeps).chat;
    reply.followUp = async () => {
      for (const id of media) {
        try {
          if (chat && chat.type === "group" && deps.admin?.sendTo) await deps.admin.sendTo(chat.chatId, pick(V.mediaCaption, "view.media", chatKey(deps)), { mediaAssetId: id });
          else await deps.admin?.send(pick(V.mediaCaption, "view.media", chatKey(deps)), { mediaAssetId: id });
        } catch (err) {
          deps.logger?.warn({ err: (err as Error).message }, "[boss] vignette non envoyée");
        }
      }
    };
  }
  return reply;
}

type Scope = { channel: ChannelRef | null; team: TeamKey | null };

/** Canal (prénom de persona compris), sinon équipe, sinon tout. Rend une réponse si un nom ne se retrouve pas. */
async function scopeOf(deps: BossDeps, actionKey: string, params: Record<string, unknown>, opts: { team?: TeamKey | null } = {}): Promise<Scope | { reply: BossReply }> {
  const canal = typeof params.canal === "string" ? params.canal : undefined;
  if (canal) {
    const r = await resolveChannel(deps, { actionKey, params, field: "canal" }, canal, { team: opts.team ?? null });
    if (!r.ok) return { reply: r.reply };
    return { channel: r.value, team: r.value.team };
  }
  const equipe = typeof params.equipe === "string" ? params.equipe : undefined;
  if (equipe) {
    const t = resolveTeam(equipe, { allowAll: true });
    if (!t.ok) return { reply: t.reply };
    return { channel: null, team: t.value === "all" ? null : t.value };
  }
  return { channel: null, team: opts.team ?? null };
}

const isReply = (x: unknown): x is { reply: BossReply } => !!x && typeof x === "object" && "reply" in x && !("channel" in x);

// ----------------------------------------------------------------------------------------------- voir_plan

type PlanP = DayP & { canal?: string; equipe?: string; jours?: number };

export const voirPlan = defineAction<PlanP>({
  key: "voir_plan",
  description: "Dire ce qui est prévu sur un canal, une équipe ou partout (combien, quand, quel format, quelle persona, ordres en cours), pour un ou plusieurs jours",
  theme: "equipes",
  cls: "immediate",
  spec: {
    canal: str("Canal, ou prénom de sa persona (facultatif)", { optional: true }),
    equipe: str("Équipe (facultatif ; « tout » pour toutes)", { optional: true }),
    jour: jourField,
    date: dateField,
    jours: int("Nombre de jours à partir du jour demandé (1 à 7)", 1, 7, true),
    detail: detailField,
  },
  async execute(deps, p) {
    const s = await scopeOf(deps, "voir_plan", p);
    if (isReply(s)) return s.reply;
    const day = dayOf(deps, p);
    if (s.channel?.team === "sports" && (p.jours ?? 1) === 1) return viewReply(deps, "voir_plan", await viewSportsChannel(deps, s.channel.id, day), p.detail);
    const r = await viewPlan(deps, { channelId: s.channel?.id ?? null, teamKey: s.team, all: !s.channel && !s.team, day, days: p.jours ?? 1 });
    return viewReply(deps, "voir_plan", r, p.detail);
  },
});

// ------------------------------------------------------------------------------------------ voir_programme

type ProgP = DayP & { canal?: string; equipe?: string; persona?: string; medias?: boolean };

export const voirProgramme = defineAction<ProgP>({
  key: "voir_programme",
  description: "Montrer les posts déjà programmés ou en préparation (heure, état, début du texte), sur un canal, une persona, une équipe ou partout",
  theme: "equipes",
  cls: "immediate",
  spec: {
    canal: str("Canal, ou prénom de sa persona (facultatif)", { optional: true }),
    equipe: str("Équipe (facultatif)", { optional: true }),
    persona: str("Prénom de la persona (facultatif)", { optional: true }),
    jour: jourField,
    date: dateField,
    moment: momentField,
    medias: bool("Vrai si l'admin veut voir les médias (vignettes)", true),
    detail: detailField,
  },
  async execute(deps, p) {
    let personaId: string | null = null;
    let personaName: string | null = null;
    if (p.persona && !p.canal) {
      const r = await resolvePersona(deps, { actionKey: "voir_programme", params: p, field: "persona" }, p.persona);
      if (!r.ok) return r.reply;
      personaId = r.value.id;
      personaName = r.value.name;
    }
    const s = await scopeOf(deps, "voir_programme", p);
    if (isReply(s)) return s.reply;
    const day = dayOf(deps, p);
    const slot = slotOf(p);
    if (s.channel?.team === "sports" && !slot) return viewReply(deps, "voir_programme", await viewSportsChannel(deps, s.channel.id, day), p.detail);
    const r = await viewScheduled(deps, { channelId: s.channel?.id ?? null, teamKey: s.channel ? null : s.team, personaId, day, slot, withMedia: p.medias === true });
    if (r.items.length) return viewReply(deps, "voir_programme", r, p.detail);
    // Rien de créé : ce que le Grand Chef ferait (plan joué à blanc).
    const plan = await viewPlan(deps, { channelId: s.channel?.id ?? null, teamKey: s.channel ? null : s.team, all: !s.channel && !s.team, day });
    let planLines = plan.lines;
    let shown = plan.entries.length;
    if (personaName) {
      // Plan des seuls canaux de cette persona (un plan par canal : en-tête avec le jour, équipe du canal seulement).
      const ids = [...new Set(plan.entries.filter((e) => e.persona === personaName).map((e) => e.channelId))];
      planLines = [];
      for (const id of ids) planLines.push(...(await viewPlan(deps, { channelId: id, day })).lines);
      shown = ids.length;
    }
    const lines = [r.lines[0]!, ...(shown ? planLines : [])];
    return viewReply(deps, "voir_programme", { facts: { ...r.facts, plan: plan.facts }, lines }, p.detail);
  },
});

// ------------------------------------------------------------------------------------- voir_paris_du_canal

type BetsP = DayP & { canal?: string };

export const voirParisDuCanal = defineAction<BetsP>({
  key: "voir_paris_du_canal",
  description: "Dire ce que l'équipe Paris sportifs va poster sur un canal : catégories, paris par jour, prochain passage, paris déjà choisis ou publiés",
  theme: "paris",
  cls: "immediate",
  spec: { canal: str("Canal (facultatif s'il n'y a qu'un canal paris)", { optional: true }), jour: jourField, date: dateField, detail: detailField },
  async execute(deps, p) {
    const ch = await sportsChannel(deps, "voir_paris_du_canal", p);
    if ("reply" in ch) return ch.reply;
    return viewReply(deps, "voir_paris_du_canal", await viewSportsChannel(deps, ch.id, dayOf(deps, p)), p.detail);
  },
});

/** Canal paris : nommé, sinon le seul canal paris (le canal Test compte s'il n'y en a pas d'autre). */
async function sportsChannel(deps: BossDeps, actionKey: string, p: { canal?: string }): Promise<ChannelRef | { reply: BossReply }> {
  if (p.canal) {
    const r = await resolveChannel(deps, { actionKey, params: p, field: "canal" }, p.canal);
    return r.ok ? r.value : { reply: r.reply };
  }
  const refs = await channelRefs(deps, "sports");
  const real = refs.filter((c) => c.team === "sports");
  if (real.length === 1) return real[0]!;
  if (!refs.length) return { reply: { reply: pick(V.noSports, "view.nosports", chatKey(deps)) } };
  return { reply: await askToChoose(deps, { actionKey, params: p, field: "canal", question: pick(V.whichChannel, "view.which", chatKey(deps)), options: refs.slice(0, 9).map((c) => ({ label: c.name, value: `id:${c.id}` })) }) };
}

// ------------------------------------------------------------------------------------------- apercu_matchs

export const apercuMatchs = defineAction<BetsP>({
  key: "apercu_matchs",
  description: "Montrer les matchs et paris que l'équipe Paris retiendrait maintenant sur un canal, sans rien publier (compte des appels de cotes)",
  theme: "paris",
  cls: "immediate",
  spec: { canal: str("Canal paris (facultatif s'il n'y en a qu'un)", { optional: true }), jour: jourField, date: dateField, detail: detailField },
  async execute(deps, p) {
    const ch = await sportsChannel(deps, "apercu_matchs", p);
    if ("reply" in ch) return ch.reply;
    return viewReply(deps, "apercu_matchs", await previewSportsPicks(deps, ch.id, dayOf(deps, p)), p.detail);
  },
});

// ---------------------------------------------------------------------------------- voir_matchs_bookmaker

type BookP = DayP & { bookmaker: string; sport?: string };

export const voirMatchsBookmaker = defineAction<BookP>({
  key: "voir_matchs_bookmaker",
  description: "Lister les matchs proposés par un bookmaker pour un jour (par ligue, avec le nombre de marchés), quand je peux le lire sans deviner",
  theme: "paris",
  cls: "immediate",
  spec: {
    bookmaker: str("Nom du bookmaker (Sportaza, 5Gringos, bet365…)", { maxLength: 60 }),
    jour: jourField,
    date: dateField,
    moment: momentField,
    sport: str("Sport (foot par défaut, basket, tennis…)", { optional: true, maxLength: 40 }),
    detail: detailField,
  },
  async execute(deps, p) {
    const r = await viewMatches(deps, { bookmaker: p.bookmaker, day: dayOf(deps, p), slot: slotOf(p), sport: p.sport ?? null });
    return viewReply(deps, "voir_matchs_bookmaker", r, p.detail);
  },
});

// ----------------------------------------------------------------------------------------------- voir_fait

type DoneP = DayP & { canal?: string; equipe?: string };

export const voirFait = defineAction<DoneP>({
  key: "voir_fait",
  description: "Dire ce qui est parti aujourd'hui ou hier (vues à 1 h), ce qui attend une validation et ce qui a raté, avec la raison",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: str("Canal (facultatif)", { optional: true }), equipe: str("Équipe (facultatif)", { optional: true }), jour: jourField, date: dateField, detail: detailField },
  async execute(deps, p) {
    const s = await scopeOf(deps, "voir_fait", p);
    if (isReply(s)) return s.reply;
    const r = await viewDone(deps, { channelId: s.channel?.id ?? null, teamKey: s.channel ? null : s.team, day: dayOf(deps, p) });
    return viewReply(deps, "voir_fait", r, p.detail);
  },
});

// ------------------------------------------------------------------------------------------- pourquoi_rien

type WhyP = DayP & { canal?: string };

export const pourquoiRien = defineAction<WhyP>({
  key: "pourquoi_rien",
  description: "Trouver pourquoi rien n'est sorti sur un canal (ou partout) à un moment donné, et dire comment le débloquer",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: str("Canal (facultatif : tous les canaux suivis)", { optional: true }), jour: jourField, date: dateField, moment: momentField, detail: detailField },
  async execute(deps, p) {
    const day = dayOf(deps, p);
    const slot = slotOf(p);
    if (p.canal) {
      const r = await resolveChannel(deps, { actionKey: "pourquoi_rien", params: p, field: "canal" }, p.canal);
      if (!r.ok) return r.reply;
      return viewReply(deps, "pourquoi_rien", await whyNothing(deps, { channelId: r.value.id, day, slot }), p.detail);
    }
    const plan = await viewPlan(deps, { all: true, day });
    const ids = [...new Set(plan.entries.filter((e) => !e.isTest).map((e) => e.channelId))].slice(0, 8);
    const found = [];
    for (const id of ids) {
      const w = await whyNothing(deps, { channelId: id, day, slot });
      if (w.cause !== "a_venir") found.push(w);
    }
    if (!found.length)
      return { reply: pick(V.whyNone, "view.why.none", chatKey(deps)) };
    const lines = found.slice(0, 4).map((w) => `${String(w.facts.canal)} : ${w.lines[0]}`);
    const lever = found[0]!.findings[0]?.lever;
    if (lever) lines.push(lever);
    return viewReply(deps, "pourquoi_rien", { facts: { canaux: found.map((w) => w.facts) }, lines }, p.detail);
  },
});

// --------------------------------------------------------------------------------------------- fiche_agent

type AgentP = DayP & { agent: string; canal?: string };

export const ficheAgent = defineAction<AgentP>({
  key: "fiche_agent",
  description: "Présenter un agent par son nom : ce qu'il fait, ce qu'il a fait aujourd'hui, ce qu'il va faire, ses réglages, ce qu'il conseille",
  theme: "equipes",
  cls: "immediate",
  spec: {
    agent: str("Nom de l'agent tel que dit par l'admin (« Rédaction », « celui des heures », « l'agent des paris »)", { maxLength: 80 }),
    canal: str("Canal (facultatif)", { optional: true }),
    jour: jourField,
    date: dateField,
    moment: momentField,
    detail: detailField,
  },
  async execute(deps, p) {
    let agent: AgentEntry | null = p.agent.startsWith("id:") ? agentEntry(p.agent.slice(3)) : null;
    if (!agent) {
      const f = findAgent(p.agent);
      if (f.status === "ambiguous")
        return askToChoose(deps, { actionKey: "fiche_agent", params: p, field: "agent", question: pick(V.agentAmbiguous({ name: p.agent }), "view.agent.ambiguous", chatKey(deps)), options: f.candidates.map((c) => ({ label: c.label, value: `id:${c.key}` })) });
      if (f.status === "unknown")
        return { reply: esc(pick(V.agentUnknown({ known: f.known.slice(5, 12).join(", ") }), "view.agent.unknown", chatKey(deps))) };
      agent = f.agent;
    }
    let channelId: string | null = null;
    if (p.canal) {
      const r = await resolveChannel(deps, { actionKey: "fiche_agent", params: p, field: "canal" }, p.canal);
      if (!r.ok) return r.reply;
      channelId = r.value.id;
    }
    const card = await agentCard(deps, agent.key, { channelId, day: dayOf(deps, p), slot: slotOf(p) });
    return viewReply(deps, "fiche_agent", card, p.detail);
  },
});

// -------------------------------------------------------------------------------- qu_attend_ma_validation

type Empty = Record<string, never>;

export const quAttendMaValidation = defineAction<Empty>({
  key: "qu_attend_ma_validation",
  description: "Montrer ce qui attend ta validation, avec les boutons pour publier, corriger ou refuser",
  theme: "demandes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const { rows, buttons } = await pendingValidations(deps);
    if (!rows.length) return { reply: pick(V.validationNone, "view.validation.none", chatKey(deps)) };
    return viewReply(deps, "qu_attend_ma_validation", { facts: { total: rows.length, numeros: rows.map((r) => r.number) }, lines: validationLines(rows), buttons });
  },
});

export const VIEW_ACTIONS: BossAction[] = [
  voirPlan,
  voirProgramme,
  voirParisDuCanal,
  apercuMatchs,
  voirMatchsBookmaker,
  voirFait,
  pourquoiRien,
  ficheAgent,
  quAttendMaValidation,
] as unknown as BossAction[];

/** Lecture seule : permise aux membres présentés (ajout aux lectures de `team/rights.ts`). */
export const VIEW_ACTION_KEYS = VIEW_ACTIONS.map((a) => a.key);
for (const k of VIEW_ACTION_KEYS) BOSS_READ_KEYS.add(k);
