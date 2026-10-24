/**
 * Phase 26 (chantier C) — carnet des besoins non couverts du Boss (`BossUnmet`) : chaque demande qu'il ne sait pas
 * encore faire est comptée sous une clé normalisée (minuscules, sans accents ni ponctuation, espaces réduits), pour
 * que « Fais-moi un export ! » et « fais moi un export » comptent une seule fois. C'est le carnet de la phase suivante
 * (page Agents → Boss, `pnpm boss:unmet`). Un texte qui ressemble à un secret n'est JAMAIS enregistré.
 */
import { isSecretAdminText, type SecretTextContext } from "../admin/commands";
import { nowOf } from "../admin/journal";
import type { AgentsDeps } from "../types";

/** Longueur maximale du texte gardé (et de la clé). */
export const BOSS_UNMET_MAX_CHARS = 300;

/** Clé d'un besoin (pure) : minuscules, sans accents, sans ponctuation, espaces réduits ; vide si rien de lisible. */
export function normalizeUnmetKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOSS_UNMET_MAX_CHARS);
}

export type BossUnmetRow = { id: string; key: string; text: string; count: number; firstAt: Date; lastAt: Date };

/**
 * Compte un besoin non couvert (+1 et date du dernier). Rien n'est écrit pour un texte vide ou qui ressemble à un
 * secret (`isSecretAdminText`, avec le contexte de la demande en cours si l'appelant le donne). Ne lève jamais.
 */
export async function recordBossUnmet(
  deps: Pick<AgentsDeps, "prisma" | "now" | "logger">,
  text: string,
  secretContext?: SecretTextContext | null,
): Promise<{ recorded: boolean; count: number }> {
  const raw = (text ?? "").trim();
  if (!raw || isSecretAdminText(raw, secretContext ?? null)) return { recorded: false, count: 0 };
  const key = normalizeUnmetKey(raw);
  if (!key) return { recorded: false, count: 0 };
  const now = nowOf(deps);
  const shown = raw.replace(/\s+/g, " ").slice(0, BOSS_UNMET_MAX_CHARS);
  try {
    const row = await deps.prisma.bossUnmet.upsert({
      where: { key },
      create: { key, text: shown, count: 1, firstAt: now, lastAt: now },
      update: { count: { increment: 1 }, lastAt: now, text: shown },
    });
    return { recorded: true, count: row.count };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] besoin non couvert non enregistré");
    return { recorded: false, count: 0 };
  }
}

/** Besoins non couverts, du plus fréquent au moins fréquent (puis le plus récent). */
export async function listBossUnmet(deps: Pick<AgentsDeps, "prisma">, limit = 100): Promise<BossUnmetRow[]> {
  return (await deps.prisma.bossUnmet.findMany({
    orderBy: [{ count: "desc" }, { lastAt: "desc" }],
    take: Math.max(1, Math.min(1000, Math.round(limit))),
  })) as BossUnmetRow[];
}

/** Lignes imprimées par `pnpm boss:unmet` (pures) : « 12 × fais moi un export (dernière fois le 24/10 09:12) ». */
export function bossUnmetLines(rows: readonly BossUnmetRow[]): string[] {
  if (!rows.length) return ["Aucun besoin non couvert pour l'instant."];
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return rows.map((r) => `${String(r.count).padStart(4)} × ${r.text} (dernière fois le ${fmt.format(new Date(r.lastAt))})`);
}
