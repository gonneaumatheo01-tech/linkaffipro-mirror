/**
 * Alerte groupée des conversations « à traiter » (Casino / Paris sportifs, phase 25) : un seul message Telegram à
 * l'admin, au plus toutes les 30 minutes, une ligne par conversation (persona, univers, motif, lien vers la
 * conversation), JAMAIS de texte de conversation. Passé par le balayage `chat` (30 s) ; les conversations déjà
 * signalées ne reviennent pas (repère `watermark` dans `Setting` `assistant.needsHumanDigest`), ni celles que l'équipe
 * a déjà reprises (statut HUMAN, ou `needsHumanAt` remis à null par la reprise).
 */
import {
  NEEDS_HUMAN_DIGEST_INTERVAL_MS,
  needsHumanReasonLabel,
  parsePersonaUniverse,
  PERSONA_UNIVERSE_LABELS,
} from "@linkaffipro/core";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { getRedis } from "@linkaffipro/queue";
import { notifyAdmin } from "@linkaffipro/telegram";
import { logger } from "../logger";

export const NEEDS_HUMAN_DIGEST_SETTING_KEY = "assistant.needsHumanDigest";
/** Verrou Redis de la fenêtre de 30 minutes (posé seulement quand un message part). */
export const NEEDS_HUMAN_DIGEST_LOCK_KEY = "chat:needs-human:digest";
/** Lignes au plus dans un message (le reste est compté). */
export const NEEDS_HUMAN_DIGEST_MAX_LINES = 20;

export type DigestState = { lastSentAt: Date | null; watermark: Date | null };

export function parseDigestState(v: unknown): DigestState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const date = (x: unknown) => {
    if (typeof x !== "string") return null;
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { lastSentAt: date(o.lastSentAt), watermark: date(o.watermark) };
}

export type DigestRow = {
  id: string;
  needsHumanAt: Date;
  needsHumanReason: string | null;
  personaName: string | null;
  universe: string | null;
};

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Message à envoyer, ou null : moins de 30 min depuis le dernier envoi, ou aucune conversation signalée depuis le
 * dernier repère. `watermark` = plus récent `needsHumanAt` repris dans le message.
 */
export function planNeedsHumanDigest(input: {
  now: Date;
  state: DigestState;
  rows: readonly DigestRow[];
  baseUrl: string;
}): { text: string; watermark: Date; count: number } | null {
  const { now, state } = input;
  if (state.lastSentAt && now.getTime() - state.lastSentAt.getTime() < NEEDS_HUMAN_DIGEST_INTERVAL_MS)
    return null;
  const rows = input.rows
    .filter((r) => !state.watermark || r.needsHumanAt.getTime() > state.watermark.getTime())
    .sort((a, b) => a.needsHumanAt.getTime() - b.needsHumanAt.getTime());
  if (rows.length === 0) return null;
  const base = input.baseUrl.replace(/\/+$/, "");
  const lines = rows.slice(0, NEEDS_HUMAN_DIGEST_MAX_LINES).map((r) => {
    const persona = escapeHtml(r.personaName?.trim() || "Assistante");
    const universe = PERSONA_UNIVERSE_LABELS[parsePersonaUniverse(r.universe)];
    const reason = needsHumanReasonLabel(r.needsHumanReason);
    return `• ${persona} (${universe}) : ${reason} — <a href="${base}/conversations/${r.id}">ouvrir</a>`;
  });
  const more = rows.length - lines.length;
  const text = [
    `<b>Conversations à traiter</b> (${rows.length})`,
    ...lines,
    ...(more > 0 ? [`… et ${more} autre${more > 1 ? "s" : ""} dans Conversations.`] : []),
    "Prends la main depuis la conversation pour répondre.",
  ].join("\n");
  return { text, watermark: rows[rows.length - 1]!.needsHumanAt, count: rows.length };
}

export type DigestDeps = {
  notify(text: string): Promise<boolean>;
  /** Pose la fenêtre de 30 min ; false si elle est déjà prise (autre passage en cours ou envoi récent). */
  acquireWindow(): Promise<boolean>;
  releaseWindow(): Promise<void>;
  baseUrl: string;
};

const defaultDeps = (): DigestDeps => ({
  notify: notifyAdmin,
  acquireWindow: async () =>
    (await getRedis().set(NEEDS_HUMAN_DIGEST_LOCK_KEY, "1", "PX", NEEDS_HUMAN_DIGEST_INTERVAL_MS, "NX")) === "OK",
  releaseWindow: async () => {
    await getRedis().del(NEEDS_HUMAN_DIGEST_LOCK_KEY);
  },
  baseUrl: process.env.APP_BASE_URL?.trim() || "https://app.linkaffipro.com",
});

/** Un passage : nombre de conversations signalées (0 si rien n'est parti). */
export async function runNeedsHumanDigest(now: Date, deps: DigestDeps = defaultDeps()): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: NEEDS_HUMAN_DIGEST_SETTING_KEY } });
  const state = parseDigestState(setting?.value);
  if (state.lastSentAt && now.getTime() - state.lastSentAt.getTime() < NEEDS_HUMAN_DIGEST_INTERVAL_MS) return 0;
  const found = await prisma.conversation.findMany({
    where: {
      needsHumanAt: state.watermark ? { gt: state.watermark } : { not: null },
      status: { not: "HUMAN" },
    },
    select: {
      id: true,
      needsHumanAt: true,
      needsHumanReason: true,
      persona: { select: { name: true, universe: true } },
    },
    orderBy: { needsHumanAt: "asc" },
    take: 200,
  });
  const rows: DigestRow[] = found
    .filter((c): c is typeof c & { needsHumanAt: Date } => c.needsHumanAt instanceof Date)
    .map((c) => ({
      id: c.id,
      needsHumanAt: c.needsHumanAt,
      needsHumanReason: c.needsHumanReason,
      personaName: c.persona?.name ?? null,
      universe: c.persona?.universe ?? null,
    }));
  const plan = planNeedsHumanDigest({ now, state, rows, baseUrl: deps.baseUrl });
  if (!plan) return 0;
  if (!(await deps.acquireWindow())) return 0;
  let sent = false;
  try {
    sent = await deps.notify(plan.text);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "assistant : alerte des conversations à traiter non envoyée");
  }
  if (!sent) {
    // Rien n'est parti (pas d'admin connu, Telegram en panne) : nouvel essai au passage suivant.
    await deps.releaseWindow();
    return 0;
  }
  const value = { lastSentAt: now.toISOString(), watermark: plan.watermark.toISOString() };
  await prisma.setting.upsert({
    where: { key: NEEDS_HUMAN_DIGEST_SETTING_KEY },
    create: { key: NEEDS_HUMAN_DIGEST_SETTING_KEY, value: toJsonValue(value) },
    update: { value: toJsonValue(value) },
  });
  logger.info({ count: plan.count }, "assistant : conversations à traiter signalées");
  return plan.count;
}
