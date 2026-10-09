import { prisma } from "@linkaffipro/db";
import { notifyAdmin } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { buildDailyData, buildWeeklyData } from "./build";
import { formatDailyBrief, formatWeeklyReport } from "./format";
import { dueReports, parseReportsConfig } from "./schedule";

async function settingString(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s && typeof s.value === "string" ? s.value : null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function sendReport(kind: "daily" | "weekly", now: Date = new Date()): Promise<{ sent: boolean; text: string }> {
  const data = kind === "daily" ? await buildDailyData(now) : await buildWeeklyData(now);
  const text = kind === "daily" ? formatDailyBrief(data) : formatWeeklyReport(data);
  const sent = await notifyAdmin(text);
  await setSetting(kind === "daily" ? "reports.lastDailyText" : "reports.lastWeeklyText", text);
  logger.info({ kind, sent, length: text.length }, "rapport Telegram");
  return { sent, text };
}

/**
 * Passage périodique : envoie ce qui est dû (brief à l'heure configurée, hebdo le lundi), une seule fois par jour.
 * `force` envoie immédiatement sans toucher aux marqueurs d'idempotence.
 */
export async function runReports(force?: "daily" | "weekly", now: Date = new Date()): Promise<{ daily: boolean; weekly: boolean }> {
  if (force) {
    const r = await sendReport(force, now);
    return { daily: force === "daily" && r.sent, weekly: force === "weekly" && r.sent };
  }
  const cfgSetting = await prisma.setting.findUnique({ where: { key: "reports.config" } });
  const config = parseReportsConfig(cfgSetting?.value);
  const [lastDaily, lastWeekly] = await Promise.all([settingString("reports.lastDaily"), settingString("reports.lastWeekly")]);
  const due = dueReports({ now, config, lastDaily, lastWeekly });
  const out = { daily: false, weekly: false };
  if (due.daily) {
    await setSetting("reports.lastDaily", due.dayKey);
    out.daily = (await sendReport("daily", now)).sent;
  }
  if (due.weekly) {
    await setSetting("reports.lastWeekly", due.dayKey);
    out.weekly = (await sendReport("weekly", now)).sent;
  }
  return out;
}
