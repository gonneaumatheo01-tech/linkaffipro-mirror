/**
 * Chemin rapide du Boss (phase 26, appelé dans le webhook : instantané, gratuit, sans IA). Ordre :
 * 1. secret (`isSecretAdminText` avec le contexte des demandes SECRET ; « jeton boss <valeur> ») : rangé par
 *    `handleAdminText`, message supprimé, `[secret]` dans la mémoire ; jamais envoyé à l'IA ;
 * 2. message transféré : une donnée, rien n'est fait ;
 * 3. OUI / NON / annule de la confirmation en attente (« OUI » sans rien → « Rien à confirmer. ») ;
 * 4. numéro d'une question de précision (liste numérotée) ;
 * 5. commandes exactes d'aujourd'hui et réponses aux questions ouvertes (`handleAdminText`), plus `aide`,
 *    `commencer`, `annule` ;
 * 6. le message suivant de l'admin répond à une question TEXT ouverte, sauf s'il ressemble clairement à un ordre ou à
 *    une question (l'interprète décide alors : `repondre_demande` ou autre action) ;
 * 7. sinon : `{ handled: false, needsAi: true }` (tâche `boss-text` du worker).
 */
import { handleAdminText, type AdminTextResult } from "../admin/handle";
import { isSecretAdminText, parseAdminCommand } from "../admin/commands";
import { currentHumanRequest, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, type HumanRequestRow } from "../human/respond";
import { isSkipText, looksLikeSecretValue, normalizeText, parseYesNo } from "../human/answer";
import { agentAudit, esc, nowOf } from "../admin/journal";
import { BOSS_TOKEN_SECRET_KEY, bossRegisterPort } from "./register-port";
import type { BossDeps, BossFastResult, BossReply, BossTeamInput } from "./contract";
import { bossAction } from "./catalog";
import { NOTHING_TO_CANCEL, NOTHING_TO_CONFIRM, confirmWordOf, readBossPending, resolveBossPending } from "./confirm";
import { bossActorOf, bossSecretContext, bossTokenCommand, looksLikeBotToken, oopsReply, runBossAction, SECRET_REMOVED_REPLY, NOT_YOURS_REPLY } from "./execute";
import { writeBossTurn, type BossTurnStatus } from "./memory";
import { clearClarify, readClarify } from "./resolve";
import { bossActionAllowed } from "./catalog";

export const FORWARDED_REPLY =
  "J'ai bien reçu ce message transféré : je ne fais rien de ce qu'il contient. Dis-moi ce que tu veux en faire.";

const ORDER_VERBS =
  /^(mets?|met|passe|passer|active|activer|desactive|desactiver|arrete|arreter|stop|pause|reprends?|reprendre|lance|lancer|change|changer|monte|baisse|augmente|diminue|annule|annuler|supprime|envoie|envoyer|montre|donne|dis|fais|fait|produis|teste|tester|valide|refuse|corrige|ajoute|retire|enleve|coupe|relance|applique|appliquer|cree|creer|liste|affiche|explique|combien|c'est quoi|quel|quelle|quels|quelles|est-ce|pourquoi|comment|ou en|t'as|tu as|tu peux|peux-tu|kevin)\b/u;

/** Un texte ressemble-t-il clairement à un ordre ou à une question (pur) ? Commence par un verbe d'ordre ou finit par « ? ». */
export function looksLikeOrderOrQuestion(text: string): boolean {
  const t = text.trim();
  if (/\?\s*$/.test(t)) return true;
  return ORDER_VERBS.test(normalizeText(t));
}

const AIDE = new Set(["aide", "help", "/aide", "/help", "menu", "?"]);
const COMMENCER = new Set(["commencer", "commence", "/commencer", "demarrer", "on commence", "par ou je commence", "/start"]);

/** Ordre d'écriture : tour de l'admin puis tour du Boss, même identifiant de message. */
async function remember(
  deps: BossDeps,
  input: BossTeamInput,
  r: BossReply,
  opts: { secret?: boolean; actionKey: string; status: BossTurnStatus },
): Promise<void> {
  const chatId = input.chat?.chatId ?? null;
  await writeBossTurn(deps, {
    role: "ADMIN",
    text: opts.secret ? "" : input.forwarded ? `[message transféré] ${input.text}` : input.text,
    secret: opts.secret,
    source: input.source,
    telegramMessageId: input.messageId,
    chatId,
    fromTelegramId: input.speaker?.telegramUserId ?? null,
  });
  await writeBossTurn(deps, {
    role: "BOSS",
    text: r.reply ?? "",
    actionKey: opts.actionKey,
    status: opts.status,
    telegramMessageId: input.messageId,
    chatId,
  });
}

function fromAdmin(r: AdminTextResult): BossReply {
  return {
    reply: r.reply ?? "C'est noté ✅",
    ...(r.deleteMessage ? { deleteMessage: true } : {}),
    ...(r.followUp ? { followUp: r.followUp } : {}),
  };
}

/** Enregistre le Boss par son jeton (port du chantier A) ; ferme la demande SECRET « jeton boss » si elle est ouverte. */
async function registerBossToken(deps: BossDeps, token: string, actorUserId: string | null): Promise<string> {
  const port = bossRegisterPort();
  if (!port) return "Je ne peux pas enregistrer le Boss d'ici : colle le jeton dans Réglages → Bots (rôle Boss).";
  let username: string;
  try {
    username = (await port(token)).username;
  } catch (err) {
    return `Jeton refusé : ${esc(((err as Error).message || "jeton invalide").slice(0, 160))}. Vérifie-le dans @BotFather et renvoie-le.`;
  }
  const closed = await deps.prisma.humanRequest.updateMany({
    where: { key: BOSS_TOKEN_SECRET_KEY, status: { in: ["QUEUED", "PENDING"] } },
    data: { status: "ANSWERED", answerSummary: "enregistrée", answeredAt: nowOf(deps) },
  });
  if (closed.count)
    await agentAudit(deps, { userId: actorUserId, action: "agents.request.answered", entityType: "HumanRequest", entityId: BOSS_TOKEN_SECRET_KEY, metadata: { key: BOSS_TOKEN_SECRET_KEY, kind: "SECRET", via: "TELEGRAM", summary: "enregistrée" } });
  return `Boss enregistré ✅ : @${esc(username)}. Envoie /start à @${esc(username)} depuis ton compte, puis écris « commencer ».`;
}

async function fastPathInner(deps: BossDeps, input: BossTeamInput): Promise<BossFastResult> {
  const text = (input.text ?? "").trim();
  const voice = input.source === "voice";
  const replyTo = input.replyToMessageId ?? null;
  if (!text) {
    const r = { reply: "Je n'ai rien lu dans ce message. Écris-moi ce que tu veux en quelques mots (ou aide)." };
    return { handled: true, ...r };
  }

  // 1. Secret : jamais envoyé à l'IA, jamais journalisé en clair.
  if (!voice) {
    const ctx = await bossSecretContext(deps, replyTo);
    const tokenAnswer =
      ctx.pending?.key === BOSS_TOKEN_SECRET_KEY &&
      (replyTo === null ? looksLikeSecretValue(text) : replyTo === ctx.pending.telegramMessageId || (ctx.secretMessageIds ?? []).includes(replyTo));
    const token = bossTokenCommand(text) ?? (tokenAnswer && !input.forwarded ? text : null);
    if (token) {
      const actor = await bossActorOf(deps, input.speaker);
      const reply = await registerBossToken(deps, token, actor.userId);
      const r: BossReply = { reply, deleteMessage: true };
      await remember(deps, input, r, { secret: true, actionKey: "jeton_boss", status: "done" });
      return { handled: true, ...r };
    }
    if (isSecretAdminText(text, ctx) || looksLikeBotToken(text)) {
      // Un message transféré qui contient une clé : retiré, jamais rangé (c'est une donnée).
      const handled = input.forwarded ? null : await handleAdminText(deps, { text, messageId: input.messageId, replyToMessageId: replyTo, source: "text", entities: input.entities });
      const r: BossReply = handled?.handled ? { ...fromAdmin(handled), deleteMessage: true } : { reply: SECRET_REMOVED_REPLY, deleteMessage: true };
      await remember(deps, input, r, { secret: true, actionKey: "secret", status: handled?.handled ? "done" : "refused" });
      return { handled: true, ...r };
    }
  }

  // 2. Message transféré : une donnée.
  if (input.forwarded) {
    const r = { reply: FORWARDED_REPLY };
    await remember(deps, input, r, { actionKey: "transfere", status: "refused" });
    return { handled: true, ...r };
  }

  const current = (await currentHumanRequest(deps)) as (HumanRequestRow & { askedAt: Date | null; telegramMessageId?: number | null }) | null;
  const pending = await readBossPending(deps);
  const word = confirmWordOf(voice ? (input.spokenText ?? text) : text);

  // 3. OUI / NON / annule de la confirmation du Boss. Une question CONFIRM / CHOICE posée APRÈS la confirmation (ou
  // une réponse au message de la question) garde la priorité.
  if (word && pending) {
    const questionFirst =
      current &&
      (current.kind === "CONFIRM" || current.kind === "CHOICE") &&
      ((replyTo !== null && replyTo !== pending.messageId) || (replyTo === null && (current.askedAt?.getTime() ?? 0) > new Date(pending.createdAt).getTime()));
    if (!questionFirst && (replyTo === null || replyTo === pending.messageId || pending.expired)) {
      const speaker = input.speaker;
      if (speaker && speaker.kind !== "admin") {
        const r = { reply: NOT_YOURS_REPLY };
        await remember(deps, input, r, { actionKey: "confirmation", status: "refused" });
        return { handled: true, ...r };
      }
      const r = await resolveBossPending(deps, word);
      if (r.handled) {
        const { handled: _h, ...reply } = r;
        await remember(deps, input, reply, { actionKey: `confirmation:${pending.actionKey}`, status: word === "yes" ? "done" : "refused" });
        return { handled: true, ...reply };
      }
    }
  }

  // 4. Numéro d'une question de précision du Boss.
  if (/^\s*\d{1,2}\s*[).]?\s*$/.test(text) && !(current && (current.kind === "CHOICE" || current.kind === "CONFIRM") && replyTo !== null)) {
    const clarify = await readClarify(deps);
    const choiceFirst = current?.kind === "CHOICE" && clarify && (current.askedAt?.getTime() ?? 0) > new Date(clarify.createdAt).getTime();
    if (clarify && !choiceFirst) {
      const n = Number(text.replace(/\D/g, ""));
      const opt = clarify.options[n - 1];
      const action = bossAction(clarify.actionKey);
      if (!opt || !action) {
        const r = { reply: `Réponds par un numéro de 1 à ${clarify.options.length}.` };
        return { handled: true, ...r };
      }
      await clearClarify(deps);
      const params = { ...clarify.params, [clarify.field]: opt.value };
      const parsed = action.parse(params);
      if (!parsed.ok) return { handled: true, reply: oopsReply(parsed.error) };
      const actor = await bossActorOf(deps, input.speaker);
      const r = await runBossAction(deps, action, parsed.params as Record<string, unknown>, { actor, inputText: text, speaker: input.speaker });
      const { status, ...reply } = r;
      await remember(deps, input, reply, { actionKey: action.key, status });
      return { handled: true, ...reply };
    }
  }

  // 5. Aide, commencer, annule, commandes exactes et réponses aux questions ouvertes.
  const n = normalizeText(text);
  for (const [set, key] of [
    [AIDE, "aide"],
    [COMMENCER, "commencer"],
  ] as const) {
    if (set.has(n)) {
      const action = bossAction(key)!;
      const actor = await bossActorOf(deps, input.speaker);
      if (!bossActionAllowed(action, input.speaker)) return { handled: true, reply: NOT_YOURS_REPLY };
      const r = await action.execute(deps, {}, actor);
      await remember(deps, input, r, { actionKey: key, status: "done" });
      return { handled: true, ...r };
    }
  }
  if (input.speaker && input.speaker.kind !== "admin") return { handled: false, needsAi: true };
  const admin = await handleAdminText(deps, {
    text: input.text,
    messageId: input.messageId,
    replyToMessageId: replyTo,
    source: voice ? "voice" : "text",
    entities: input.entities,
    spokenText: input.spokenText,
  });
  if (admin.handled) {
    const r = fromAdmin(admin);
    await remember(deps, input, r, { actionKey: parseAdminCommand(text)?.type ?? "demande", status: "done" });
    return { handled: true, ...r };
  }
  if (word === "cancel" || word === "no") {
    await clearClarify(deps);
    const r = { reply: word === "cancel" ? NOTHING_TO_CANCEL : "D'accord, je ne fais rien." };
    await remember(deps, input, r, { actionKey: "annule", status: "done" });
    return { handled: true, ...r };
  }
  if (word === "yes" || parseYesNo(text) === "oui") {
    const r = { reply: NOTHING_TO_CONFIRM };
    await remember(deps, input, r, { actionKey: "confirmation", status: "refused" });
    return { handled: true, ...r };
  }

  // 6. Question TEXT ouverte : le message suivant est la réponse (le client n'arrive pas à utiliser « Répondre »).
  if (current && current.kind === "TEXT" && replyTo === null && !isSkipText(text) && !looksLikeOrderOrQuestion(text)) {
    const actor = await bossActorOf(deps, input.speaker);
    const res = await respondToRequest(deps, current, text, { userId: actor.userId, via: "TELEGRAM" }, { deferNext: true, confirmText: input.spokenText ?? text });
    const r: BossReply = {
      reply: esc(res.message),
      followUp: res.closed
        ? async () => {
            await sendNextHumanRequest(deps);
          }
        : undefined,
    };
    await remember(deps, input, r, { actionKey: "repondre_demande", status: res.ok ? "done" : "refused" });
    return { handled: true, ...r };
  }

  return { handled: false, needsAi: true };
}

/** Chemin rapide (webhook) : réponse immédiate, ou passage à l'interprète. Ne lève jamais. */
export async function bossFastPath(deps: BossDeps, input: BossTeamInput): Promise<BossFastResult> {
  try {
    return await fastPathInner(deps, input);
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] chemin rapide en échec");
    return { handled: true, reply: oopsReply((err as Error).message || "erreur interne") };
  }
}

