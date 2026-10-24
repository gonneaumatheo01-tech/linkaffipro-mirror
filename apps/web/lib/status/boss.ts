/**
 * Phase 26 : État du système → le Boss répond-il encore ? Les messages de l'admin qui demandent l'interprète partent
 * en tâche `boss-text` (file `agents-orchestrator`) : une tâche en attente depuis plus de 2 minutes, ou des tâches en
 * échec ces dernières 24 heures, veulent dire que le service d'arrière-plan ne répond plus à l'admin. Plus le résultat
 * du dernier contrôle automatique des connexions Telegram (`Setting` `telegram.webhookCheck`). Règles pures, testées.
 */
import { BOSS_QUEUE_LATE_MS, parseWebhookCheck, type WebhookCheck } from "@linkaffipro/telegram";

export const BOSS_TEXT_JOB_NAME = "agents-orchestrator:boss-text";

export type BossHealth = {
  /** Tâches `boss-text` en attente (date d'ajout). */
  waiting: Date[];
  /** Tâches `boss-text` en échec ces dernières 24 heures. */
  failed24h: number;
  webhookCheck: WebhookCheck | null;
  error?: string;
};

export type BossHealthView = {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  detail: string;
};

export function bossHealthView(h: BossHealth, now: Date): BossHealthView {
  if (h.error) return { tone: "neutral", label: "Boss : lecture impossible", detail: h.error };
  const late = h.waiting.filter((d) => now.getTime() - d.getTime() > BOSS_QUEUE_LATE_MS).length;
  if (late > 0)
    return {
      tone: "danger",
      label: "Le Boss ne répond plus",
      detail: `${late} message${late > 1 ? "s" : ""} de l'administrateur attend${late > 1 ? "ent" : ""} une réponse depuis plus de 2 minutes : le service d'arrière-plan est arrêté ou bloqué.`,
    };
  if (h.failed24h > 0)
    return {
      tone: "warning",
      label: "Le Boss a eu des ratés",
      detail: `${h.failed24h} message${h.failed24h > 1 ? "s" : ""} de l'administrateur n'${h.failed24h > 1 ? "ont" : "a"} pas pu être traité${h.failed24h > 1 ? "s" : ""} ces dernières 24 heures.`,
    };
  return { tone: "success", label: "Le Boss répond", detail: "Aucun message de l'administrateur en retard." };
}

/** Résumé du dernier contrôle des connexions Telegram, en une ligne. */
export function webhookCheckLine(check: WebhookCheck | null, fmt: (d: Date) => string): string {
  if (!check) return "Contrôle automatique des connexions Telegram : pas encore fait.";
  if (check.skipped) return `Contrôle automatique des connexions Telegram : non fait ici (${check.skipped}).`;
  const repaired = check.bots.filter((b) => b.repaired).map((b) => `@${b.username}`);
  const broken = check.bots.filter((b) => !b.ok).map((b) => `@${b.username}`);
  const head = `Dernier contrôle des connexions Telegram : ${fmt(new Date(check.at))}`;
  if (broken.length) return `${head}, à vérifier : ${broken.join(", ")}.`;
  if (repaired.length) return `${head}, réparée${repaired.length > 1 ? "s" : ""} : ${repaired.join(", ")}.`;
  return `${head}, toutes correctes.`;
}

export { parseWebhookCheck };
