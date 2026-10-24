/**
 * Exécution des actions du Boss et tour avec l'IA (phase 26). `runBossAction` : droits, classe (immédiate / à
 * confirmer), exécution par l'entrée du catalogue, `AuditLog` `boss.<clé>`. `bossAiTurn` (tâche `boss-text` du
 * worker) : contexte, interprète, exécution ou confirmation, réponse chiffrée, précision, ou « je ne sais pas encore
 * faire ça » ; écrit les `BossTurn` ; ne lève JAMAIS.
 */
import { agentAudit, esc, telegramActorUserId } from "../admin/journal";
import { isSecretAdminText, type SecretTextContext } from "../admin/commands";
import { askedMessageIdsOf } from "../human/requests";
import { normalizeText } from "../human/answer";
import type { BossAction, BossActor, BossDeps, BossPending, BossReply, BossSpeaker, BossTeamInput } from "./contract";
import { BOSS_CATALOG, bossAction, bossActionAllowed } from "./catalog";
import type { BossExecDeps } from "./catalog-read";
import { createBossPending } from "./confirm";
import { checkAction } from "./catalog-kit";
import { answerQuestion } from "./answer";
import { interpretBossText, type BossDecision } from "./interpret";
import { BossBudgetError } from "./llm";
import { bossTurnForMessage, updateBossTurn, writeBossTurn, type BossTurnStatus } from "./memory";
import { readClarify, resolveTeam } from "./resolve";
import { recordBossUnmet } from "./unmet";

export const NO_AI_REPLY =
  "Je ne comprends que les commandes simples pour le moment (IA non réglée ou plafond du mois atteint). Écris aide.";
export const UNMET_HEAD = "Je ne sais pas encore faire ça.";
export const SECRET_REMOVED_REPLY =
  "🔒 J'ai retiré ce message : il ressemblait à une clé ou à un mot de passe. Pour l'enregistrer, écris « clé <fournisseur> <la clé> » ou colle-la seule quand je te la demande.";
export const NOT_YOURS_REPLY = "Ça, c'est l'admin qui décide.";

/** « jeton boss <valeur> » (enregistrement du bot Boss) : la valeur, ou null (pur). */
export function bossTokenCommand(text: string): string | null {
  const m = /^\s*(?:jeton|token)\s+(?:du\s+)?(?:boss|kevin)\s*:?\s+(\S+)\s*$/iu.exec(text);
  return m ? m[1]! : null;
}

/** Un jeton de bot Telegram (« 123456789:AAE… ») dans le texte : traité comme un secret (pur). */
export function looksLikeBotToken(text: string): boolean {
  return bossTokenCommand(text) !== null || /(?<![\w])\d{6,12}:[A-Za-z0-9_-]{30,}/.test(text);
}

export function oopsReply(reason: string): string {
  return `Oups, je n'ai pas réussi : ${esc(reason.slice(0, 120))}. Réessaie ou écris aide.`;
}

/** Contexte du détecteur de secrets : demande SECRET en cours et messages de toutes les demandes SECRET. */
export async function bossSecretContext(deps: BossDeps, replyToMessageId?: number | null): Promise<SecretTextContext> {
  const rows = (await deps.prisma.humanRequest.findMany({
    where: { kind: "SECRET" },
    orderBy: { createdAt: "desc" },
    take: 500,
  })) as { key: string; status: string; telegramMessageId: number | null; onAnswer: unknown; askedAt: Date | null }[];
  const pending = rows.filter((r) => r.status === "PENDING").sort((a, b) => (a.askedAt?.getTime() ?? 0) - (b.askedAt?.getTime() ?? 0))[0];
  const ids = new Set<number>();
  for (const r of rows) for (const id of askedMessageIdsOf(r)) ids.add(id);
  return {
    pending: pending ? { key: pending.key, telegramMessageId: pending.telegramMessageId ?? null } : null,
    replyToMessageId: replyToMessageId ?? null,
    secretMessageIds: [...ids],
  };
}

export async function bossActorOf(deps: BossDeps, speaker?: BossSpeaker | null): Promise<BossActor> {
  if (speaker && speaker.kind === "member") return { userId: null, via: "TELEGRAM" };
  return { userId: await telegramActorUserId(deps), via: "TELEGRAM" };
}

async function audit(deps: BossDeps, key: string, actor: BossActor, metadata: Record<string, unknown>, speaker?: BossSpeaker | null): Promise<void> {
  await agentAudit(deps, {
    userId: actor.userId,
    action: `boss.${key}`,
    entityType: "BossAction",
    entityId: key,
    metadata: {
      via: "TELEGRAM",
      ...(speaker ? { telegramActorId: speaker.telegramUserId.toString(), speaker: speaker.kind } : {}),
      ...metadata,
    },
  });
}

/** Paramètres sans texte libre long (journal). */
function safeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === "string" ? v.slice(0, 80) : v;
  return out;
}

export type RunResult = BossReply & { status: BossTurnStatus };

/** Exécute (immédiate) ou fait confirmer (à confirmer) une entrée du catalogue. */
export async function runBossAction(
  deps: BossDeps,
  action: BossAction,
  params: Record<string, unknown>,
  ctx: { actor: BossActor; inputText?: string; speaker?: BossSpeaker | null },
): Promise<RunResult> {
  if (!bossActionAllowed(action, ctx.speaker)) {
    await audit(deps, action.key, ctx.actor, { status: "refused", params: safeParams(params) }, ctx.speaker);
    return { reply: NOT_YOURS_REPLY, status: "refused" };
  }
  const before = await readClarify(deps);
  const cls = action.classify ? await action.classify(deps, params) : action.cls;
  if (cls === "confirm") {
    const blocked = await checkAction(deps, action, params);
    if (blocked) {
      await audit(deps, action.key, ctx.actor, { status: "clarify", params: safeParams(params) }, ctx.speaker);
      return { ...blocked, status: "clarify" };
    }
    const summary = action.summarize ? await action.summarize(deps, params) : `${action.description} ?`;
    const r = await createBossPending(deps, { actionKey: action.key, params, summary });
    await audit(deps, action.key, ctx.actor, { status: "confirm", params: safeParams(params) }, ctx.speaker);
    return { ...r, status: "confirm" };
  }
  const execDeps: BossExecDeps = { ...deps, inputText: ctx.inputText };
  const r = await action.execute(execDeps, params, ctx.actor);
  // Nom ambigu : l'entrée a posé une question numérotée au lieu d'agir.
  const after = await readClarify(deps);
  const status: BossTurnStatus = after && after.createdAt !== before?.createdAt ? "clarify" : "done";
  await audit(deps, action.key, ctx.actor, { status, params: safeParams(params) }, ctx.speaker);
  return { ...r, status };
}

/** Action confirmée par OUI : revalidée par le code, puis exécutée (bornes revérifiées par l'entrée). */
export async function runConfirmedAction(deps: BossDeps, pending: BossPending, actor: BossActor): Promise<BossReply> {
  const action = bossAction(pending.actionKey);
  if (!action) return { reply: oopsReply("action inconnue") };
  const parsed = action.parse(pending.params);
  if (!parsed.ok) return { reply: oopsReply(parsed.error) };
  try {
    const r = await action.execute(deps, parsed.params as Record<string, unknown>, actor);
    await audit(deps, action.key, actor, { status: "done", confirmed: true, params: safeParams(parsed.params as Record<string, unknown>) });
    await writeBossTurn(deps, { role: "BOSS", text: r.reply ?? "", actionKey: action.key, status: "done", source: "button" });
    return r;
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, action: action.key }, "[boss] action confirmée en échec");
    return { reply: oopsReply((err as Error).message || "erreur interne") };
  }
}

// ------------------------------------------------------------------------------------------- actions proches

const STOP = new Set(
  "le la les un une des de du d l a au aux et ou en sur pour par avec mon ma mes ton ta tes son sa ses ce cet cette ces je tu il elle on nous vous ils me te se ne pas plus que qui quoi est sont fais fait faire peux peut veux dis dit moi toi y".split(
    " ",
  ),
);

function words(s: string): string[] {
  return normalizeText(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/s$/, ""));
}

/** 2 ou 3 actions proches d'une demande non couverte (mots en commun avec les descriptions, pur). */
export function nearestActions(text: string, catalog: readonly BossAction[] = BOSS_CATALOG, n = 3): BossAction[] {
  const want = new Set(words(text));
  const scored = catalog
    .filter((a) => a.key !== "annule")
    .map((a) => ({ a, score: words(`${a.description} ${a.key.replace(/_/g, " ")}`).filter((w) => want.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  const out = scored.slice(0, n).map((x) => x.a);
  for (const key of ["etat_general", "depenses_du_mois", "aide"]) {
    if (out.length >= 2) break;
    const a = catalog.find((c) => c.key === key);
    if (a && !out.includes(a)) out.push(a);
  }
  return out.slice(0, n);
}

export async function unmetReply(deps: BossDeps, text: string, secretContext?: SecretTextContext | null): Promise<BossReply> {
  await recordBossUnmet(deps, text, secretContext ?? null);
  const near = nearestActions(text);
  return {
    reply: [UNMET_HEAD, "Je sais par exemple :", ...near.map((a) => `• ${esc(a.description)}`), "Écris aide pour tout voir."].join("\n"),
  };
}

// ------------------------------------------------------------------------------------------- tour avec l'IA

async function handleDecision(
  deps: BossDeps,
  decision: BossDecision,
  input: BossTeamInput,
  actor: BossActor,
  secretContext: SecretTextContext,
): Promise<RunResult & { costCents?: number; actionKey: string }> {
  switch (decision.type) {
    case "action": {
      const r = await runBossAction(deps, decision.action, decision.params, { actor, inputText: input.spokenText ?? input.text, speaker: input.speaker });
      return { ...r, actionKey: decision.action.key };
    }
    case "preciser": {
      const list = decision.choix.length ? ["", ...decision.choix.map((c, i) => `${i + 1}. ${esc(c)}`)] : [];
      return { reply: [esc(decision.question), ...list].join("\n").replace("\n\n", "\n"), status: "clarify", actionKey: "preciser" };
    }
    case "question": {
      let team = null;
      if (decision.team) {
        const t = resolveTeam(decision.team, { allowAll: true });
        team = t.ok && t.value !== "all" ? t.value : null;
      }
      const a = await answerQuestion(deps, { topic: decision.topic, question: decision.question, team, period: decision.period });
      return { reply: a.reply, status: "answered", costCents: a.costCents, actionKey: "repondre_question" };
    }
    case "pas_prevu":
      return { ...(await unmetReply(deps, input.text, secretContext)), status: "unmet", actionKey: "pas_prevu" };
  }
}

/**
 * Tour complet avec l'IA (worker, tâche `boss-text`). Un message déjà traité (tour du Boss avec le même
 * `telegramMessageId`) ne l'est jamais deux fois : réponse vide. Ne lève jamais.
 */
export async function bossAiTurn(deps: BossDeps, input: BossTeamInput): Promise<BossReply> {
  const text = (input.text ?? "").trim();
  try {
    if (await bossTurnForMessage(deps, input.messageId)) return {};
    const actor = await bossActorOf(deps, input.speaker);
    const secretContext = await bossSecretContext(deps, input.replyToMessageId);
    const chatId = input.chat?.chatId ?? null;
    const fromId = input.speaker?.telegramUserId ?? null;
    // Filet : un secret n'atteint JAMAIS l'IA (le chemin rapide l'a déjà traité ; un vocal n'en est jamais un).
    if (input.source !== "voice" && (isSecretAdminText(text, secretContext) || looksLikeBotToken(text))) {
      await writeBossTurn(deps, { role: "ADMIN", text, secret: true, source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
      await writeBossTurn(deps, { role: "BOSS", text: SECRET_REMOVED_REPLY, status: "refused", actionKey: "secret", telegramMessageId: input.messageId, chatId });
      return { reply: SECRET_REMOVED_REPLY, deleteMessage: true };
    }
    if (input.forwarded) {
      const reply = "J'ai bien reçu ce message transféré : je ne fais rien de ce qu'il contient. Dis-moi ce que tu veux en faire.";
      await writeBossTurn(deps, { role: "ADMIN", text: `[message transféré] ${text}`, source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
      await writeBossTurn(deps, { role: "BOSS", text: reply, status: "refused", actionKey: "transfere", telegramMessageId: input.messageId, chatId });
      return { reply };
    }
    await writeBossTurn(deps, { role: "ADMIN", text, source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
    const turnId = await writeBossTurn(deps, { role: "BOSS", text: "…", status: "running", telegramMessageId: input.messageId, chatId });
    const finish = async (r: BossReply, status: BossTurnStatus, actionKey: string, costCents = 0): Promise<BossReply> => {
      await updateBossTurn(deps, turnId, { text: r.reply ?? "", status, actionKey, costCents });
      return r;
    };
    if (!deps.llm || !text) return finish({ reply: text ? NO_AI_REPLY : "Je n'ai rien lu dans ce message. Écris-moi ce que tu veux en quelques mots (ou aide)." }, "error", "sans_ia");
    let interpreted: Awaited<ReturnType<typeof interpretBossText>>;
    try {
      interpreted = await interpretBossText(deps, text, { source: input.source });
    } catch (err) {
      if (err instanceof BossBudgetError) return finish({ reply: NO_AI_REPLY }, "error", "plafond");
      deps.logger?.warn({ err: (err as Error).message }, "[boss] interprète en échec");
      return finish({ reply: oopsReply("l'IA ne répond pas") }, "error", "erreur");
    }
    const r = await handleDecision(deps, interpreted.decision, input, actor, secretContext);
    const { status, actionKey, costCents, ...reply } = r;
    return finish(reply, status, actionKey, interpreted.costCents + (costCents ?? 0));
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] tour en échec");
    return { reply: oopsReply((err as Error).message || "erreur interne") };
  }
}
