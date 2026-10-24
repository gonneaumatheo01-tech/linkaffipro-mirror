/**
 * Mémoire courte du Boss (phase 26) : table `BossTurn` (un tour = un message de l'admin ou une réponse du Boss). Un
 * secret n'y est jamais écrit : il devient « [secret] ». Contexte de l'interprète : 20 tours ET 24 heures au plus.
 */
import { BOSS_DEFAULT_NAME, BOSS_MEMORY_HOURS, BOSS_MEMORY_TURNS, BOSS_NAME_SETTING, type BossSource } from "./contract";
import { nowOf } from "../admin/journal";
import type { AgentsDeps } from "../types";

export const SECRET_PLACEHOLDER = "[secret]";
/** Longueur gardée d'un tour (une réponse longue du Boss est coupée dans la mémoire, jamais dans Telegram). */
export const TURN_TEXT_MAX = 1500;

export type BossTurnRole = "ADMIN" | "BOSS";
export type BossTurnStatus = "done" | "confirm" | "refused" | "error" | "unmet" | "clarify" | "answered" | "running";

export type BossTurnInput = {
  role: BossTurnRole;
  text: string;
  secret?: boolean;
  actionKey?: string | null;
  status?: BossTurnStatus | null;
  source?: BossSource | null;
  telegramMessageId?: number | null;
  costCents?: number;
  /** Conversation (privée ou groupe) et auteur du message (null pour un tour de Kevin). */
  chatId?: bigint | null;
  fromTelegramId?: bigint | null;
};

export type BossTurnRow = {
  id: string;
  createdAt: Date;
  role: string;
  text: string;
  actionKey: string | null;
  status: string | null;
  source: string | null;
  telegramMessageId: number | null;
  costCents: number;
  chatId?: bigint | null;
  fromTelegramId?: bigint | null;
};

/** Texte gardé : `[secret]` pour un secret, balises HTML retirées, longueur bornée. */
export function memoryText(text: string, secret = false): string {
  if (secret) return SECRET_PLACEHOLDER;
  const plain = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  return plain.length > TURN_TEXT_MAX ? `${plain.slice(0, TURN_TEXT_MAX - 1)}…` : plain;
}

/** Écrit un tour ; ne lève jamais (la mémoire ne doit pas empêcher une réponse). */
export async function writeBossTurn(deps: AgentsDeps, input: BossTurnInput): Promise<string | null> {
  try {
    const row = await deps.prisma.bossTurn.create({
      data: {
        createdAt: nowOf(deps),
        role: input.role,
        text: memoryText(input.text, input.secret),
        actionKey: input.actionKey ?? null,
        status: input.status ?? null,
        source: input.source ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
        costCents: Math.max(0, Math.round(input.costCents ?? 0)),
        chatId: input.chatId ?? null,
        fromTelegramId: input.fromTelegramId ?? null,
      },
    });
    return row.id;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] tour non écrit");
    return null;
  }
}

/** Met à jour un tour (réponse finale d'un tour « en cours »). */
export async function updateBossTurn(
  deps: AgentsDeps,
  id: string | null,
  data: { text?: string; secret?: boolean; actionKey?: string | null; status?: BossTurnStatus | null; costCents?: number },
): Promise<void> {
  if (!id) return;
  try {
    await deps.prisma.bossTurn.update({
      where: { id },
      data: {
        ...(data.text !== undefined ? { text: memoryText(data.text, data.secret) } : {}),
        ...(data.actionKey !== undefined ? { actionKey: data.actionKey } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.costCents !== undefined ? { costCents: Math.max(0, Math.round(data.costCents)) } : {}),
      },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] tour non mis à jour");
  }
}

/** Derniers tours (du plus ancien au plus récent) : 20 au plus, des dernières 24 heures seulement. */
export async function recentBossTurns(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  opts: { turns?: number; hours?: number; chatId?: bigint | null } = {},
): Promise<BossTurnRow[]> {
  const turns = Math.min(opts.turns ?? BOSS_MEMORY_TURNS, BOSS_MEMORY_TURNS);
  const hours = Math.min(opts.hours ?? BOSS_MEMORY_HOURS, BOSS_MEMORY_HOURS);
  const since = new Date(nowOf(deps).getTime() - hours * 3600_000);
  const rows = (await deps.prisma.bossTurn.findMany({
    where: { createdAt: { gte: since }, ...(opts.chatId != null ? { chatId: opts.chatId } : {}) },
    orderBy: { createdAt: "desc" },
    take: turns,
  })) as BossTurnRow[];
  return rows.reverse();
}

/**
 * Tour du Boss déjà écrit pour ce message (le worker évite ainsi une double exécution). Les numéros de message sont
 * propres à chaque conversation : dans le groupe (identifiant négatif), seule la conversation du groupe compte ; en
 * privé, la conversation privée ou un tour ancien sans conversation notée.
 */
export async function bossTurnForMessage(deps: Pick<AgentsDeps, "prisma">, messageId: number, chatId?: bigint | null): Promise<BossTurnRow | null> {
  const where =
    chatId == null
      ? { role: "BOSS", telegramMessageId: messageId }
      : chatId < 0n
        ? { role: "BOSS", telegramMessageId: messageId, chatId }
        : { role: "BOSS", telegramMessageId: messageId, OR: [{ chatId }, { chatId: null }] };
  return (await deps.prisma.bossTurn.findFirst({ where, orderBy: { createdAt: "desc" } })) as BossTurnRow | null;
}

/**
 * Mémoire d'une personne (phase 26, section 4) : 20 tours ou 24 heures au plus, de CETTE conversation. Groupe : les
 * messages de cette personne à Kevin et ses réponses (jamais les conversations des autres). Privé d'un membre : sa
 * conversation. Privé de l'admin : sa conversation (et les tours anciens sans conversation notée).
 */
export async function bossTurnsForSpeaker(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  input: { chatId: bigint; fromTelegramId?: bigint | null },
): Promise<BossTurnRow[]> {
  const since = new Date(nowOf(deps).getTime() - BOSS_MEMORY_HOURS * 3600_000);
  if (input.chatId >= 0n) {
    const rows = (await deps.prisma.bossTurn.findMany({
      where: { createdAt: { gte: since }, OR: [{ chatId: input.chatId }, { chatId: null }] },
      orderBy: { createdAt: "desc" },
      take: BOSS_MEMORY_TURNS,
    })) as BossTurnRow[];
    return rows.reverse();
  }
  const rows = (await deps.prisma.bossTurn.findMany({
    where: { createdAt: { gte: since }, chatId: input.chatId },
    orderBy: { createdAt: "desc" },
    take: BOSS_MEMORY_TURNS * 4,
  })) as BossTurnRow[];
  const mine = new Set(rows.filter((r) => r.role === "ADMIN" && input.fromTelegramId != null && r.fromTelegramId === input.fromTelegramId).map((r) => r.telegramMessageId));
  return rows
    .filter((r) => r.telegramMessageId !== null && mine.has(r.telegramMessageId))
    .slice(0, BOSS_MEMORY_TURNS)
    .reverse();
}

/** Mémoire en texte pour l'interprète (une ligne par tour, « Admin : … » / « Kevin : … »). */
export function memoryLines(turns: readonly BossTurnRow[], bossName = "Kevin", personName = "Admin"): string[] {
  return turns.map((t) => `${t.role === "ADMIN" ? personName : bossName} : ${t.text.replace(/\s+/g, " ").slice(0, 300)}`);
}

/** Prénom affiché du Boss (`Setting` `boss.name`, « Kevin » par défaut). */
export async function readBossName(deps: Pick<AgentsDeps, "prisma">): Promise<string> {
  try {
    const s = await deps.prisma.setting.findUnique({ where: { key: BOSS_NAME_SETTING } });
    const v = s?.value;
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : BOSS_DEFAULT_NAME;
  } catch {
    return BOSS_DEFAULT_NAME;
  }
}
