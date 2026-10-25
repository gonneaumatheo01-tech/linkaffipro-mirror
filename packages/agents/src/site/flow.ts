/**
 * Phase 34, chantier A — déroulé d'une opération du site demandée à Kevin (« tout par Kevin »). Ordre :
 * 1. droits (règle 2) : l'admin en privé peut tout ; un membre du groupe a le rôle de son équipe ramené au rôle du
 *    site (ADMIN → ADMIN, MANAGER → MANAGER, MEMBER → lecture seulement) ; une personne inconnue n'obtient rien ;
 * 2. secret (règle 4) : jamais dans le groupe (« envoie-le-moi en privé ») ; en privé, chaque champ secret est demandé
 *    par une demande SECRET (rangée chiffrée, message effacé, jamais envoyé à l'IA ni journalisé) ;
 * 3. entrées Telegram (chantier F) : message transféré → `params.content`, document → `params.file` ;
 * 4. essai à blanc (`dryRun`) par les mêmes fonctions que le site ; une valeur manquante → UNE question de collègue,
 *    ou des boutons de choix (`bsk:<id>:<n>`) quand le schéma a une liste de valeurs ou que l'erreur en cite peu ;
 * 5. confirmation selon `confirm` : `yes` = OUI / NON ; `delete` = récapitulatif + ce qui disparaît + le mot exact
 *    SUPPRIMER (un « oui » ne suffit pas, aucun bouton OUI) ; `send` = l'aperçu EXACT tel qu'il partira + le nombre
 *    de destinataires + OUI ;
 * 6. exécution → message du site traduit en phrase de collègue. L'`AuditLog` est écrit par le cœur côté site
 *    (`via: "TELEGRAM"`) : Kevin n'en écrit pas un second.
 */
import { randomUUID } from "node:crypto";
import { adminTelegramId, esc, nowOf, readSetting, telegramActorUserId, writeSetting } from "../admin/journal";
import type { BossChat, BossDeps, BossReply, BossSpeaker, BossTeamInput } from "./../boss/contract";
import { BOSS_CALLBACK_PREFIX } from "../boss/contract";
import { CONFIRM_VARIANTS, clearBossPending, confirmTail, createBossPending, readBossPending } from "../boss/confirm";
import type { BossTurnStatus } from "../boss/memory";
import { adminFirstName, findTeamMember } from "../boss/team/members";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { readSecret, secretLabel, secretSettingKey } from "../human/secrets";
import type { AdminButton } from "../types";
import { DELETE_CONFIRM_WORD, type SiteOpActor, type SiteOpConfirm, type SiteOpMeta, type SiteOpPreview, type SiteOpResult } from "./contract";
import { colleagueError, colleagueMessage } from "./errors";
import { choicesFor } from "./choices";

export { choicesFor } from "./choices";
import { peekDocument, peekForwarded, takeDocument, takeForwarded } from "./inputs";
import {
  SITE_CHOICE_PREFIX,
  SITE_FLOW_SETTING_PREFIX,
  SITE_FLOW_TTL_MS,
  SITE_OP_ACTION,
  SITE_OP_DELETE_ACTION,
  SITE_SECRET_ANSWER_ACTION,
  SITE_SECRET_KEY_PREFIX,
} from "./keys";
import { siteOp } from "./registry";

export const SITE_FLOW_VARIANTS = {
  privateOnly: [
    "Ça, envoie-le-moi en privé, jamais ici : je l'effacerais.",
    "Pas dans le groupe : écris-moi en privé pour ça, je te demande le secret là-bas.",
  ],
  secretAsked: voiceTemplate<{ label: string }>([{ label: "le jeton" }, { label: "la clé" }], (p) => [
    `Je te demande ${p.label} juste au-dessus. Réponds à ce message, je l'efface dès que c'est rangé.`,
    `Réponds à ma question juste au-dessus avec ${p.label}. Je l'efface dès que c'est rangé.`,
  ]),
  secretQueued: voiceTemplate<{ label: string }>([{ label: "le jeton" }], (p) => [
    `Je te demande ${p.label} juste après la question en cours.`,
    `Une question attend déjà ta réponse : je te demande ${p.label} juste après.`,
  ]),
  notAllowed: voiceTemplate<{ name: string }>([{ name: "Mathéo" }, { name: "l'admin" }], (p) => [`Ça, c'est ${p.name} qui décide.`, `Là, c'est ${p.name} qui décide, pas moi.`]),
  readOnly: voiceTemplate<{ name: string }>([{ name: "Mathéo" }], (p) => [
    `Toi tu peux regarder, mais pas changer ça. C'est ${p.name} qui décide.`,
    `Tu peux consulter, pas modifier. Pour ça, c'est ${p.name}.`,
  ]),
  unavailable: [
    "Je n'arrive pas à joindre le site pour l'instant. Tu réessaies dans une minute ?",
    "Le site ne me répond pas là. On réessaie dans une minute ?",
  ],
  expired: ["Trop tard, ça a expiré. Tu me redemandes ?", "Ça a expiré entre-temps, je n'ai rien fait. Tu me le redemandes ?"],
  unknownOp: ["Ça, je ne sais pas encore le faire.", "Là je ne sais pas encore faire."],
  deleteTail: [
    `Écris ${DELETE_CONFIRM_WORD} pour confirmer, ou NON pour laisser tomber (10 minutes).`,
    `Pour confirmer, écris ${DELETE_CONFIRM_WORD} en majuscules. NON pour annuler, tu as 10 minutes.`,
  ],
  deleteImpact: voiceTemplate<{ impact: string }>([{ impact: "12 liens, les clics restent dans les chiffres" }], (p) => [`Ce qui disparaît : ${p.impact}.`, `Ça efface : ${p.impact}.`]),
  deleteYesNotEnough: [
    `Un oui ne suffit pas pour supprimer. Écris ${DELETE_CONFIRM_WORD} en majuscules, ou NON.`,
    `Pour une suppression il me faut le mot ${DELETE_CONFIRM_WORD}, en majuscules. Sinon réponds NON.`,
  ],
  sendHead: ["Le message partira exactement comme ça :", "Tel qu'il partira, mot pour mot :"],
  recipients: voiceTemplate<{ n: number }>([{ n: 1 }, { n: 340 }], (p) => [
    p.n > 1 ? `Il part à ${p.n} personnes.` : `Il part à ${p.n} personne.`,
    p.n > 1 ? `${p.n} personnes vont le recevoir.` : `${p.n} personne va le recevoir.`,
  ]),
  adminConfirms: voiceTemplate<{ name: string }>([{ name: "@matheo" }], (p) => [`${p.name}, c'est toi qui confirmes.`, `${p.name} confirme ou pas.`]),
  choiceFor: voiceTemplate<{ what: string }>([{ what: "Il me manque le pays." }], (p) => [`${p.what} Choisis ci-dessous.`, `${p.what} Appuie sur le bon bouton.`]),
  choiceLost: ["Ce choix n'est plus valable, rien n'a changé.", "Trop tard pour ce bouton, rien n'a bougé."],
} satisfies VoiceTable;

const V = SITE_FLOW_VARIANTS;

// ------------------------------------------------------------------------------------------- droits

/** Niveau d'une personne pour les opérations du site. */
export type SiteRightsLevel = "ADMIN" | "MANAGER" | "READ";

export type FlowWho = { kind: "admin"; telegramUserId: string | null } | { kind: "member"; telegramUserId: string };

export type SiteRights = { level: SiteRightsLevel; actor: SiteOpActor; who: FlowWho };

/**
 * Droits de la personne qui parle (règle 2), relus en base : admin (speaker absent ou `admin`) = ADMIN ; membre
 * présenté encore actif = rôle d'équipe ramené au rôle du site ; sinon null (inconnu : rien).
 */
export async function siteRightsOf(deps: BossDeps, speaker?: BossSpeaker | null): Promise<SiteRights | null> {
  if (!speaker || speaker.kind === "admin") {
    const admin = await adminTelegramId(deps).catch(() => null);
    if (speaker && admin != null && speaker.telegramUserId !== admin) return null;
    const tg = admin != null ? admin.toString() : null;
    return { level: "ADMIN", actor: { userId: await telegramActorUserId(deps).catch(() => null), role: "ADMIN", via: "TELEGRAM", telegramUserId: tg }, who: { kind: "admin", telegramUserId: tg } };
  }
  const member = await findTeamMember(deps, speaker.telegramUserId).catch(() => null);
  if (!member) return null;
  const level: SiteRightsLevel = member.role === "ADMIN" ? "ADMIN" : member.role === "MANAGER" ? "MANAGER" : "READ";
  const user = (await deps.prisma.user.findFirst({ where: { telegramUserId: member.telegramUserId, isActive: true } }).catch(() => null)) as { id: string } | null;
  const tg = member.telegramUserId.toString();
  return { level, actor: { userId: user?.id ?? null, role: level === "ADMIN" ? "ADMIN" : "MANAGER", via: "TELEGRAM", telegramUserId: tg }, who: { kind: "member", telegramUserId: tg } };
}

/** Le niveau permet-il l'opération (pur) ? Lecture seule : seulement `read` ; MANAGER : seulement les opérations MANAGER. */
export function siteOpAllowed(meta: Pick<SiteOpMeta, "role" | "kind">, level: SiteRightsLevel | null): boolean {
  if (!level) return false;
  if (level === "ADMIN") return true;
  if (level === "READ") return meta.kind === "read";
  return meta.role === "MANAGER";
}

// ------------------------------------------------------------------------------------------- état

export type SiteFlowState = {
  id: string;
  op: string;
  params: Record<string, unknown>;
  /** Champs secrets déjà reçus (rangés chiffrés dans `agents.secret.site.<op>.<champ>`, jamais ici). */
  secrets: string[];
  actor: SiteOpActor;
  who: FlowWho;
  chatId: string | null;
  group: boolean;
  /** Entrées Telegram lues pour cette opération (consommées après l'exécution). */
  used?: { forwarded?: boolean; document?: boolean };
  choice?: { field: string; options: { label: string; value: unknown }[] };
  createdAt: string;
};

function newState(op: SiteOpMeta, params: Record<string, unknown>, rights: SiteRights, chat: BossChat | null | undefined, now: Date): SiteFlowState {
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 16),
    op: op.key,
    params: JSON.parse(JSON.stringify(params)) as Record<string, unknown>,
    secrets: [],
    actor: rights.actor,
    who: rights.who,
    chatId: chat ? chat.chatId.toString() : null,
    group: chat?.type === "group",
    createdAt: now.toISOString(),
  };
}

async function saveState(deps: BossDeps, s: SiteFlowState): Promise<void> {
  await writeSetting(deps, `${SITE_FLOW_SETTING_PREFIX}${s.id}`, s);
}

export async function readSiteFlowState(deps: BossDeps, id: string): Promise<SiteFlowState | null> {
  const v = (await readSetting(deps, `${SITE_FLOW_SETTING_PREFIX}${id}`)) as SiteFlowState | undefined;
  if (!v || typeof v !== "object" || v.id !== id || typeof v.op !== "string") return null;
  if (nowOf(deps).getTime() - new Date(v.createdAt).getTime() > SITE_FLOW_TTL_MS) return null;
  return v;
}

async function dropState(deps: BossDeps, id: string): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: `${SITE_FLOW_SETTING_PREFIX}${id}` } }).catch(() => undefined);
}

/** Clé d'une demande SECRET (et de son rangement chiffré) : propre à ce déroulé, effacée après usage. */
export function siteSecretKey(op: string, field: string, flowId: string): string {
  return `${SITE_SECRET_KEY_PREFIX}${op}.${field}.${flowId}`;
}

// ------------------------------------------------------------------------------------------- confirmation

/** Durcissement selon les valeurs (baisse = `none`, hausse = `yes`…) : enregistré par opération, facultatif. */
export type SiteOpClassifier = (params: Record<string, unknown>, preview: SiteOpPreview | undefined) => SiteOpConfirm;
const classifiers = new Map<string, SiteOpClassifier>();
export function registerSiteOpClassifier(key: string, fn: SiteOpClassifier): void {
  classifiers.set(key, fn);
}

/** Confirmation effective (pur sauf le registre) : jamais plus faible que `delete` / `send` déclarés. */
export function siteConfirmOf(meta: Pick<SiteOpMeta, "key" | "confirm" | "kind">, params: Record<string, unknown>, preview?: SiteOpPreview): SiteOpConfirm {
  if (meta.kind === "delete" || meta.confirm === "delete") return "delete";
  if (meta.kind === "send" || meta.confirm === "send") return "send";
  const c = classifiers.get(meta.key);
  return c ? c(params, preview) : meta.confirm;
}

// ------------------------------------------------------------------------------------------- déroulé

export type SiteFlowReply = BossReply & { status: BossTurnStatus };

const chatOf = (s: Pick<SiteFlowState, "chatId">) => s.chatId;

async function notAllowedReply(deps: BossDeps, level: SiteRightsLevel | null, chatId: string | null): Promise<string> {
  const name = esc(await adminFirstName(deps).catch(() => "l'admin"));
  return level === "READ" ? pick(V.readOnly({ name }), "site.flow.readonly", chatId) : pick(V.notAllowed({ name }), "site.flow.notallowed", chatId);
}

/** Conversation où vivent les entrées Telegram (privé : l'admin ; groupe : le groupe). */
async function inputsChatId(deps: BossDeps, s: SiteFlowState): Promise<string | null> {
  if (s.chatId) return s.chatId;
  return s.who.telegramUserId ?? ((await adminTelegramId(deps).catch(() => null))?.toString() ?? null);
}

/** Valeurs secrètes déchiffrées pour l'appel (jamais gardées ailleurs qu'en mémoire). */
async function secretValues(deps: BossDeps, s: SiteFlowState): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of s.secrets) {
    const v = await readSecret(deps.prisma as never, siteSecretKey(s.op, f, s.id));
    if (v != null) out[f] = v;
  }
  return out;
}

async function forgetSecrets(deps: BossDeps, s: SiteFlowState): Promise<void> {
  if (!s.secrets.length) return;
  await deps.prisma.setting
    .deleteMany({ where: { key: { in: s.secrets.map((f) => secretSettingKey(siteSecretKey(s.op, f, s.id))) } } })
    .catch(() => undefined);
}

async function callSite(deps: BossDeps, s: SiteFlowState, dryRun: boolean): Promise<SiteOpResult> {
  if (!deps.siteOps) return { ok: false, error: "", code: "unavailable" };
  const input = { ...s.params, ...(await secretValues(deps, s)) };
  try {
    return await deps.siteOps({ op: s.op, input, actor: s.actor, dryRun });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, op: s.op }, "[boss] opération du site injoignable");
    return { ok: false, error: "", code: "unavailable" };
  }
}

function choiceButtons(id: string, options: readonly { label: string }[]): AdminButton[][] {
  const row = options.map((o, i) => ({ text: o.label.slice(0, 40), callbackData: `${SITE_CHOICE_PREFIX}${id}:${i + 1}` }));
  const out: AdminButton[][] = [];
  for (let i = 0; i < row.length; i += 2) out.push(row.slice(i, i + 2));
  return out;
}

/** Une opération ne s'est pas faite : phrase de collègue (et boutons de choix si peu de valeurs possibles). */
async function failureReply(deps: BossDeps, s: SiteFlowState, meta: SiteOpMeta, r: Extract<SiteOpResult, { ok: false }>): Promise<SiteFlowReply> {
  const chatId = chatOf(s);
  if (r.code === "forbidden") return { reply: await notAllowedReply(deps, s.actor.role === "ADMIN" ? "ADMIN" : "MANAGER", chatId), status: "refused" };
  const text = await colleagueError(r, meta, { llm: deps.llm, chatId });
  if (r.code === "invalid" || r.code === undefined) {
    const options = choicesFor(meta, r.field, r.error ?? "");
    if (options.length && r.field) {
      const next: SiteFlowState = { ...s, choice: { field: r.field, options } };
      await saveState(deps, next);
      return { reply: pick(V.choiceFor({ what: text }), "site.flow.choice", chatId), buttons: choiceButtons(s.id, options), status: "clarify" };
    }
    return { reply: text, status: "clarify" };
  }
  return { reply: text, status: "error" };
}

/** Exécute pour de vrai (après confirmation ou sans confirmation) et rend la phrase de collègue. */
export async function executeSiteFlow(deps: BossDeps, s: SiteFlowState): Promise<SiteFlowReply> {
  const meta = siteOp(s.op);
  if (!meta) return { reply: pick(V.unknownOp, "site.flow.unknown", chatOf(s)), status: "unmet" };
  const r = await callSite(deps, s, false);
  await forgetSecrets(deps, s);
  await dropState(deps, s.id);
  if (!r.ok) return failureReply(deps, s, meta, r);
  // Entrées Telegram utilisées : consommées (un même message transféré ne part jamais deux fois).
  const conv = await inputsChatId(deps, s);
  if (conv && s.used?.forwarded) await takeForwarded(deps, conv).catch(() => null);
  if (conv && s.used?.document) await takeDocument(deps, conv).catch(() => null);
  return { reply: await colleagueMessage(r.message, { llm: deps.llm, chatId: chatOf(s) }), status: "done" };
}

/** Message de confirmation d'une suppression (récapitulatif + ce qui disparaît + SUPPRIMER ; bouton NON seulement). */
async function askDelete(deps: BossDeps, s: SiteFlowState, preview: SiteOpPreview | undefined, meta: SiteOpMeta): Promise<SiteFlowReply> {
  const chatId = chatOf(s);
  const summary = (preview?.summary ?? meta.description).trim();
  const r = await createBossPending(deps, { actionKey: SITE_OP_DELETE_ACTION, params: { flow: s }, summary, chatId });
  const impact = preview?.impact?.trim() ? pick(V.deleteImpact({ impact: esc(preview.impact.trim().replace(/[.]+$/, "")) }), "site.flow.delete.impact", chatId) : null;
  const head = (r.reply ?? "").split("\n").slice(0, -1).join("\n");
  const lines = [head, impact, pick(V.deleteTail, "site.flow.delete.tail", chatId)].filter((l): l is string => !!l);
  const buttons: AdminButton[][] = [[{ text: "❌ NON", callbackData: `${BOSS_CALLBACK_PREFIX}${r.pendingId}:no` }]];
  return { reply: lines.join("\n"), buttons, pendingId: r.pendingId, status: "confirm" };
}

/** Message de confirmation d'un envoi : l'aperçu EXACT (HTML tel qu'il partira), le nombre de destinataires, OUI. */
async function askSend(deps: BossDeps, s: SiteFlowState, preview: SiteOpPreview | undefined, meta: SiteOpMeta): Promise<SiteFlowReply> {
  const chatId = chatOf(s);
  const previous = await readBossPending(deps);
  const summary = (preview?.summary ?? meta.description).trim();
  const r = await createBossPending(deps, { actionKey: SITE_OP_ACTION, params: { flow: s }, summary, chatId });
  const replaced =
    previous && !previous.expired
      ? pick(CONFIRM_VARIANTS.replaced({ by: previous.requestedBy ? esc(previous.requestedBy.firstName) : "", what: esc((previous.summary.split("\n")[0] ?? "").slice(0, 90)) }), "confirm.replaced", chatId)
      : null;
  const n = typeof preview?.recipients === "number" ? preview.recipients : null;
  const lines = [
    replaced,
    esc(summary.split("\n")[0] ?? ""),
    pick(V.sendHead, "site.flow.send.head", chatId),
    // Texte exact du site (HTML Telegram), jamais réécrit ni échappé : c'est ce qui partira.
    preview?.exactText ?? "",
    n !== null ? pick(V.recipients({ n }), "site.flow.send.recipients", chatId) : null,
    confirmTail(chatId),
  ].filter((l): l is string => typeof l === "string" && l.length > 0);
  return { reply: lines.join("\n"), buttons: r.buttons, pendingId: r.pendingId, status: "confirm" };
}

/** Suite du déroulé à partir d'un état (premier passage, après un secret, après un choix par bouton). */
export async function proceedSiteFlow(deps: BossDeps, s: SiteFlowState): Promise<SiteFlowReply> {
  const meta = siteOp(s.op);
  const chatId = chatOf(s);
  if (!meta) return { reply: pick(V.unknownOp, "site.flow.unknown", chatId), status: "unmet" };
  if (!deps.siteOps) return { reply: pick(V.unavailable, "site.flow.unavailable", chatId), status: "error" };
  // 2. Secrets : jamais dans le groupe ; en privé, une demande SECRET par champ, l'un après l'autre.
  const secretFields = meta.secretParams ?? [];
  if ((meta.kind === "secret" || secretFields.length) && s.group) return { reply: pick(V.privateOnly, "site.flow.private", chatId), status: "refused" };
  const missing = secretFields.filter((f) => !s.secrets.includes(f));
  if (missing.length) {
    const field = missing[0]!;
    await saveState(deps, s);
    const key = siteSecretKey(s.op, field, s.id);
    const label = secretLabel(key);
    const what = /^(clé|adresse)/.test(label) ? `la ${label}` : /^[aeiouyéèh]/i.test(label) ? `l'${label}` : `le ${label}`;
    const asked = await askHuman(deps, {
      kind: "SECRET",
      key,
      teamKey: null,
      question: `${meta.description} : envoie-moi ${what}. Je l'efface dès que c'est rangé.`,
      onAnswer: { action: SITE_SECRET_ANSWER_ACTION, flowId: s.id, field, resume: false },
    });
    return { reply: pick((asked.sent ? V.secretAsked : V.secretQueued)({ label: esc(what) }), asked.sent ? "site.flow.secret.asked" : "site.flow.secret.queued", chatId), status: "clarify" };
  }
  // 3. Entrées Telegram : message transféré = contenu, document = fichier (lus ici, consommés après l'exécution).
  const conv = await inputsChatId(deps, s);
  const used = { ...(s.used ?? {}) };
  const params = { ...s.params };
  if (conv && meta.inputs?.includes("forwarded") && params.content == null) {
    const fw = await peekForwarded(deps, conv).catch(() => null);
    if (fw) {
      params.content = fw;
      used.forwarded = true;
    }
  }
  if (conv && meta.inputs?.includes("file") && params.file == null) {
    const doc = await peekDocument(deps, conv).catch(() => null);
    if (doc) {
      params.file = doc;
      used.document = true;
    }
  }
  const state: SiteFlowState = { ...s, params, used };
  // 4. Essai à blanc : mêmes validations que le site, rien d'écrit.
  const dry = await callSite(deps, state, true);
  if (!dry.ok) {
    if (dry.code === "unavailable") return { reply: pick(V.unavailable, "site.flow.unavailable", chatId), status: "error" };
    return failureReply(deps, state, meta, dry);
  }
  // 5. Confirmation.
  const confirm = siteConfirmOf(meta, params, dry.preview);
  if (confirm === "none") return executeSiteFlow(deps, state);
  let out: SiteFlowReply;
  if (confirm === "delete") out = await askDelete(deps, state, dry.preview, meta);
  else if (confirm === "send") out = await askSend(deps, state, dry.preview, meta);
  else {
    const r = await createBossPending(deps, { actionKey: SITE_OP_ACTION, params: { flow: state }, summary: (dry.preview?.summary ?? meta.description).trim(), chatId });
    out = { ...r, status: "confirm" };
  }
  // Demande d'un membre : seul l'admin confirme (règle de la phase 26), Kevin le dit.
  if (state.who.kind === "member") {
    const { adminMention } = await import("../boss/team/members");
    const name = await adminMention(deps).catch(() => "l'admin");
    out = { ...out, reply: `${out.reply}\n${pick(V.adminConfirms({ name }), "site.flow.adminconfirms", chatId)}` };
  }
  return out;
}

/**
 * Point d'entrée : l'outil `site_<domaine>` choisi par l'IA (ou une capacité). Droits d'abord, puis le déroulé.
 */
export async function runSiteFlow(
  deps: BossDeps,
  req: { op: SiteOpMeta; params: Record<string, unknown>; input?: Pick<BossTeamInput, "speaker" | "chat"> | null },
): Promise<SiteFlowReply> {
  const chat = req.input?.chat ?? null;
  const chatId = chat ? chat.chatId.toString() : null;
  const rights = await siteRightsOf(deps, req.input?.speaker ?? null);
  // Inconnu : rien (ni réponse, ni journal).
  if (!rights) return { status: "refused" };
  if (!siteOpAllowed(req.op, rights.level)) return { reply: await notAllowedReply(deps, rights.level, chatId), status: "refused" };
  // Les champs secrets ne viennent jamais de l'IA : retirés (ils seront demandés en privé).
  const secret = new Set(req.op.secretParams ?? []);
  const params = Object.fromEntries(Object.entries(req.params ?? {}).filter(([k]) => !secret.has(k)));
  return proceedSiteFlow(deps, newState(req.op, params, rights, chat, nowOf(deps)));
}

// ------------------------------------------------------------------------------------------- reprises

/** Paramètres de l'entrée cachée confirmée : l'état du déroulé (revalidé ici). */
export function flowOfParams(params: unknown): SiteFlowState | null {
  const f = params && typeof params === "object" ? (params as { flow?: unknown }).flow : null;
  if (!f || typeof f !== "object") return null;
  const s = f as SiteFlowState;
  if (typeof s.id !== "string" || typeof s.op !== "string" || !s.actor || typeof s.actor !== "object" || !Array.isArray(s.secrets)) return null;
  return s;
}

/**
 * Mot SUPPRIMER (chemin rapide, avant les OUI / NON) pour une suppression en attente dans cette conversation : seul le
 * mot exact (casse comprise) exécute ; « oui » / « supprimer » répondent que ça ne suffit pas ; le reste suit son
 * chemin (NON, annule…). Rend null si ce n'est pas le cas.
 */
export async function siteDeleteWordReply(deps: BossDeps, input: Pick<BossTeamInput, "text" | "speaker" | "chat" | "replyToMessageId" | "source">): Promise<SiteFlowReply | null> {
  const pending = await readBossPending(deps);
  if (!pending || pending.expired || pending.actionKey !== SITE_OP_DELETE_ACTION) return null;
  if (input.speaker && input.speaker.kind !== "admin") return null;
  const conv = input.chat ? input.chat.chatId.toString() : null;
  if (pending.chatId && conv && pending.chatId !== conv) return null;
  if (input.replyToMessageId != null && pending.messageId != null && input.replyToMessageId !== pending.messageId) return null;
  const text = (input.text ?? "").trim().replace(/[.!]+$/, "");
  const chatId = pending.chatId ?? null;
  if (text === DELETE_CONFIRM_WORD && input.source !== "voice") {
    const s = flowOfParams(pending.params);
    if (!s || !(await clearBossPending(deps, pending.id))) return { reply: pick(V.expired, "site.flow.expired", chatId), status: "refused" };
    return executeSiteFlow(deps, s);
  }
  const n = text.toLowerCase();
  if (/^(oui|ouais|yes|ok|vas-y|vas y|confirme|je confirme|supprimer|supprime|go)$/.test(n) || (text === DELETE_CONFIRM_WORD && input.source === "voice"))
    return { reply: pick(V.deleteYesNotEnough, "site.flow.delete.notenough", chatId), status: "refused" };
  return null;
}

/** Bouton de choix `bsk:<id>:<n>` : seule la personne qui a demandé (ou l'admin) ; la valeur reprend le déroulé. */
export function isSiteChoiceData(data: string): boolean {
  return data.startsWith(SITE_CHOICE_PREFIX);
}

const CHOICE = /^bsk:([A-Za-z0-9_-]{1,40}):(\d{1,2})$/;

export async function handleSiteChoiceCallback(
  deps: BossDeps,
  input: { data: string; fromTelegramId: bigint | number | string },
): Promise<{ handled: true; toast?: string; reply?: string; buttons?: AdminButton[][]; removeButtons?: boolean; pendingId?: string }> {
  const m = CHOICE.exec(input.data);
  if (!m) return { handled: true, removeButtons: true };
  const s = await readSiteFlowState(deps, m[1]!);
  if (!s || !s.choice) return { handled: true, toast: pick(V.choiceLost, "site.flow.choicelost"), removeButtons: true };
  const from = String(input.fromTelegramId);
  const admin = await adminTelegramId(deps).catch(() => null);
  const isAdmin = admin != null && admin.toString() === from;
  // Silence pour toute autre personne (comme les boutons OUI / NON).
  if (!isAdmin && from !== s.who.telegramUserId) return { handled: true };
  const opt = s.choice.options[Number(m[2]) - 1];
  if (!opt) return { handled: true, toast: pick(V.choiceLost, "site.flow.choicelost"), removeButtons: true };
  // Droits relus au moment du choix (un membre retiré entre-temps n'obtient plus rien).
  if (s.who.kind === "member") {
    const member = await findTeamMember(deps, BigInt(s.who.telegramUserId)).catch(() => null);
    const meta = siteOp(s.op);
    const level: SiteRightsLevel | null = member ? (member.role === "ADMIN" ? "ADMIN" : member.role === "MANAGER" ? "MANAGER" : "READ") : null;
    if (!meta || !siteOpAllowed(meta, level)) return { handled: true, removeButtons: true };
  }
  const { choice: _c, ...rest } = s;
  const next: SiteFlowState = { ...rest, params: { ...s.params, [s.choice.field]: opt.value } };
  await dropState(deps, s.id);
  const r = await proceedSiteFlow(deps, next);
  return { handled: true, toast: opt.label.slice(0, 60), reply: r.reply, buttons: r.buttons, removeButtons: true, ...(r.pendingId ? { pendingId: r.pendingId } : {}) };
}

/** Réponse à une demande SECRET d'une opération du site : la valeur est déjà rangée chiffrée, le déroulé reprend. */
registerAnswerAction(SITE_SECRET_ANSWER_ACTION, async (deps, ctx) => {
  const flowId = typeof ctx.onAnswer.flowId === "string" ? ctx.onAnswer.flowId : "";
  const field = typeof ctx.onAnswer.field === "string" ? ctx.onAnswer.field : "";
  const s = flowId ? await readSiteFlowState(deps as BossDeps, flowId) : null;
  if (!s || !field) {
    await deps.prisma.setting.deleteMany({ where: { key: secretSettingKey(ctx.request.key) } }).catch(() => undefined);
    return pick(V.expired, "site.flow.expired");
  }
  const next: SiteFlowState = { ...s, secrets: [...new Set([...s.secrets, field])] };
  await dropState(deps as BossDeps, s.id);
  const r = await proceedSiteFlow(deps as BossDeps, next);
  return r.reply ?? undefined;
});
