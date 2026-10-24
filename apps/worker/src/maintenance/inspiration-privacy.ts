/**
 * Phase 27 (relecture adverse) — reprise unique des événements `telegram.message` / `telegram.edited_message` écrits
 * avant le masquage des posts transférés (`redactForwardedUpdate`) : depuis la création du plus ancien canal de
 * référence (ou les 3 derniers jours), chaque événement dont le message est un transfert perd texte, légende, boutons
 * et auteur d'origine (longueur et type de média gardés). Repère `Setting inspiration.eventsRedacted` : une seule fois.
 */
import type { Db as AppDb } from "@linkaffipro/db";
import { isForwardedMessage, redactForwardedUpdate } from "@linkaffipro/telegram";

export const EVENTS_REDACTED_SETTING = "inspiration.eventsRedacted";
const BATCH = 500;

type Db = Pick<AppDb, "setting" | "event" | "referenceChannel">;

export async function redactForwardedEventsOnce(prisma: Db, now = new Date()): Promise<{ done: boolean; redacted: number }> {
  if (await prisma.setting.findUnique({ where: { key: EVENTS_REDACTED_SETTING } })) return { done: false, redacted: 0 };
  const oldest = await prisma.referenceChannel.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const threeDays = new Date(now.getTime() - 3 * 86_400_000);
  const since = oldest && oldest.createdAt < threeDays ? oldest.createdAt : threeDays;
  let redacted = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.event.findMany({
      where: { type: { in: ["telegram.message", "telegram.edited_message"] }, occurredAt: { gte: since }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      select: { id: true, payload: true },
      take: BATCH,
    });
    for (const r of rows) {
      const p = r.payload as { message?: unknown; edited_message?: unknown } | null;
      if (!p || !(isForwardedMessage(p.message) || isForwardedMessage(p.edited_message))) continue;
      const next = redactForwardedUpdate(p);
      if (next === p) continue;
      await prisma.event.update({ where: { id: r.id }, data: { payload: next as object } });
      redacted++;
    }
    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1]!.id;
  }
  const value = { at: now.toISOString(), since: since.toISOString(), redacted };
  await prisma.setting.upsert({ where: { key: EVENTS_REDACTED_SETTING }, create: { key: EVENTS_REDACTED_SETTING, value }, update: { value } });
  return { done: true, redacted };
}
