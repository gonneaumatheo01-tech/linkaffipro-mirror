/**
 * Clés des fournisseurs à l'écran (`/agents/settings`) : nom affiché, usage, adresse où la créer. La valeur n'est
 * jamais relue par le site : seulement « enregistrée, se termine par …ab12 » (`secretSummary` de `@linkaffipro/agents`).
 */
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { SECRET_KEYS, secretSummary, type SecretSummary } from "@linkaffipro/agents";

export type SecretInfo = { label: string; usage: string; createUrl: string | null };

export const SECRET_INFO: Record<string, SecretInfo> = {
  "providers.fal.apiKey": {
    label: "fal.ai",
    usage: "Vidéos et photos de vos personas (équipe Rencontres). Quelques dollars de crédit suffisent pour commencer.",
    createUrl: "https://fal.ai/dashboard/keys",
  },
  "providers.magichour.apiKey": {
    label: "Magic Hour",
    usage: "Vidéos de secours quand fal.ai échoue, ou fournisseur choisi dans la fiche Rencontres (visage seulement).",
    createUrl: "https://magichour.ai/developer",
  },
  "providers.odds.apiKey": {
    label: "Cotes sportives",
    usage: "Cotes des matchs pour l'équipe Paris sportifs.",
    createUrl: "https://sportsgameodds.com",
  },
};

export function secretInfo(key: string): SecretInfo {
  return SECRET_INFO[key] ?? { label: key.replace(/^providers\./, "").replace(/\.apiKey$/, ""), usage: "", createUrl: null };
}

export function isKnownSecretKey(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export type SecretRow = { key: string; info: SecretInfo; summary: SecretSummary | null };

/** Résumé de chaque clé connue ; `summary: null` si la lecture a échoué (la page le dit, sans planter). */
export async function loadSecretRows(): Promise<SecretRow[]> {
  return Promise.all(
    SECRET_KEYS.map(async (key) => ({
      key,
      info: secretInfo(key),
      summary: await secretSummary(prisma as unknown as PrismaClient, key).catch((err: unknown) => {
        console.error("[agents] résumé de clé", key, err instanceof Error ? err.message : err);
        return null;
      }),
    })),
  );
}
