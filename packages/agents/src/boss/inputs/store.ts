/**
 * Phase 34, chantier F — entrées Telegram gardées pour une conversation (`Setting` `boss.input.<chatId>`, 30 minutes) :
 * le dernier message transféré (ou album) et le dernier fichier reçu. Une DONNÉE : jamais exécutée, jamais envoyée à
 * l'IA (seul un résumé sans le texte peut l'être, `forwardedSummary` / `documentSummary`).
 *
 * Écritures sérialisées par conversation dans le processus (un album arrive en plusieurs updates presque en même temps :
 * sans file, deux lectures-écritures concurrentes perdraient un média). Le webhook tourne dans un seul service.
 */
import { nowOf, readSetting, writeSetting } from "../../admin/journal";
import type { AgentsDeps } from "../../types";
import { BOSS_INPUT_SETTING_PREFIX, BOSS_INPUT_TTL_MS, type ForwardedContent, type ReceivedDocument } from "../../site/contract";

export type InputsDeps = Pick<AgentsDeps, "prisma" | "now" | "logger">;

/** Message transféré gardé, avec ce qui sert à regrouper un album ou une rafale de transferts. */
export type StoredForwarded = ForwardedContent & {
  /** Dernier ajout (un album ou une rafale prolonge la garde). */
  lastAt: string;
  expiresAt: string;
  /** `media_group_id` du dernier message (album). */
  groupId: string | null;
  messageIds: number[];
  /** Bot qui a reçu le message : les `fileId` ne valent que pour lui (un autre bot doit renvoyer le fichier). */
  botId: string | null;
};

export type StoredDocument = ReceivedDocument & { expiresAt: string };

export type StoredInputs = { forwarded?: StoredForwarded | null; document?: StoredDocument | null };

export function inputKey(chatId: string): string {
  return `${BOSS_INPUT_SETTING_PREFIX}${chatId}`;
}

export function expiresFrom(at: Date): string {
  return new Date(at.getTime() + BOSS_INPUT_TTL_MS).toISOString();
}

function alive<T extends { expiresAt: string }>(v: T | null | undefined, now: Date): T | null {
  if (!v || typeof v !== "object" || typeof v.expiresAt !== "string") return null;
  return new Date(v.expiresAt).getTime() > now.getTime() ? v : null;
}

/** Entrées encore valables de la conversation (les expirées sont ignorées). */
export async function readInputs(deps: InputsDeps, chatId: string): Promise<StoredInputs> {
  const raw = (await readSetting(deps, inputKey(chatId))) as StoredInputs | undefined;
  if (!raw || typeof raw !== "object") return {};
  const now = nowOf(deps);
  return { forwarded: alive(raw.forwarded, now), document: alive(raw.document, now) };
}

export async function writeInputs(deps: InputsDeps, chatId: string, value: StoredInputs): Promise<void> {
  if (!value.forwarded && !value.document) {
    await deps.prisma.setting.deleteMany({ where: { key: inputKey(chatId) } });
    return;
  }
  await writeSetting(deps, inputKey(chatId), value);
}

const queues = new Map<string, Promise<unknown>>();

/** Exécute `fn` après les écritures précédentes de la même conversation (dans ce processus). */
export function serialized<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(chatId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(chatId, tail);
  void tail.then(() => {
    if (queues.get(chatId) === tail) queues.delete(chatId);
  });
  return run;
}
