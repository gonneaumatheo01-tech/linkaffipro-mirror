import { prisma, toJsonValue } from "@linkaffipro/db";
import { notifyAdmin } from "@linkaffipro/telegram";
import { WORKER_DOWN_AFTER_MS, type Heartbeat } from "@linkaffipro/queue";
import { alertKindLabel } from "@linkaffipro/core";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Alerte « worker arrêté » évaluée côté site (le worker ne peut pas signaler sa propre absence) :
 * appelée par `/api/health` quand le battement date de plus de 3 minutes. Une seule alerte par 24 h ;
 * la résolution est faite par le worker à son retour (`reportWorkerRestart`) ou par son passage d'alertes.
 * Jamais d'erreur levée : la santé doit répondre même si la base d'alertes est indisponible.
 */
export async function ensureWorkerDownAlert(hb: Heartbeat, now = new Date()): Promise<"created" | "exists" | "error"> {
  try {
    const recent = await prisma.alert.findFirst({ where: { kind: "worker_down", createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) } }, select: { id: true } });
    if (recent) return "exists";
    const minutes = Math.round((now.getTime() - Date.parse(hb.at)) / 60_000);
    const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(hb.at));
    const message = `Service d'arrière-plan arrêté : aucun signe de vie depuis ${minutes} min (dernier signal ${when})`;
    const alert = await prisma.alert.create({ data: { kind: "worker_down", severity: "CRITICAL", message, payload: toJsonValue({ lastHeartbeatAt: hb.at, downMinutes: minutes, detectedBy: "web" }) } });
    const text = `🔴 <b>Alerte : ${alertKindLabel("worker_down")}</b>\n${message}. Les envois, la synchro et les alertes sont à l'arrêt jusqu'à son redémarrage.\n<i>Voir Réglages → État du système.</i>`;
    await notifyAdmin(text).catch(() => false);
    await prisma.alert.update({ where: { id: alert.id }, data: { notifiedAt: now } });
    return "created";
  } catch {
    return "error";
  }
}

export { WORKER_DOWN_AFTER_MS };
