/**
 * Clés des fournisseurs à l'écran (`/agents/settings`) : nom affiché, usage, adresse où la créer. La valeur n'est
 * jamais relue par le site : seulement « enregistrée, se termine par …ab12 » (`secretSummary` de `@linkaffipro/agents`).
 */
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { SECRET_KEYS, secretSummary, type SecretSummary } from "@linkaffipro/agents";
import { SCREENSHOT_PROXY_KEY, bookmakerLabel, bookmakerSecretKeys } from "./sports";

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
  "providers.apifootball.apiKey": {
    label: "Statistiques des matchs (offre gratuite)",
    usage: "Matchs et tirs cadrés pour choisir les paris quand les sites des bookmakers ne se lisent pas : vous envoyez ensuite la capture et la cote. Offre gratuite (100 demandes par jour).",
    createUrl: "https://dashboard.api-football.com",
  },
};

/**
 * Clés de l'équipe Paris sportifs (phase 23) gérées aussi par le site : identifiants du bookmaker partenaire et
 * adresse de secours des captures. Ajoutées ici tant que la liste du paquet (`SECRET_KEYS`) ne les contient pas.
 */
export const SITE_EXTRA_SECRET_KEYS: readonly string[] = [
  bookmakerSecretKeys("sportaza").login,
  bookmakerSecretKeys("sportaza").password,
  SCREENSHOT_PROXY_KEY,
];

/** Toutes les clés affichées dans les réglages, sans doublon. */
export const ALL_SECRET_KEYS: readonly string[] = [...new Set<string>([...SECRET_KEYS, ...SITE_EXTRA_SECRET_KEYS])];

function bookmakerInfo(key: string): SecretInfo | null {
  const m = /^providers\.bookmakers\.([a-z0-9_-]+)\.(login|password)$/.exec(key);
  if (!m) return null;
  const name = bookmakerLabel(m[1]!);
  return m[2] === "login"
    ? { label: `${name} : identifiant`, usage: `Identifiant du compte ${name} : l'équipe Paris sportifs s'y connecte seulement pour retrouver le pari et faire la capture d'écran (jamais de mise).`, createUrl: null }
    : { label: `${name} : mot de passe`, usage: `Mot de passe du compte ${name}, chiffré. Testez la connexion depuis la fiche Paris sportifs.`, createUrl: null };
}

export function secretInfo(key: string): SecretInfo {
  if (key === SCREENSHOT_PROXY_KEY)
    return {
      label: "Adresse internet de secours des captures",
      usage: "Seulement si le site du bookmaker bloque les captures : adresse fournie par un service d'adresses résidentielles.",
      createUrl: null,
    };
  return (
    SECRET_INFO[key] ??
    bookmakerInfo(key) ?? { label: key.replace(/^providers\./, "").replace(/\.apiKey$/, ""), usage: "", createUrl: null }
  );
}

export function isKnownSecretKey(key: string): boolean {
  return ALL_SECRET_KEYS.includes(key);
}

export type SecretRow = { key: string; info: SecretInfo; summary: SecretSummary | null };

/** Résumé de chaque clé connue ; `summary: null` si la lecture a échoué (la page le dit, sans planter). */
export async function loadSecretRows(): Promise<SecretRow[]> {
  return Promise.all(
    ALL_SECRET_KEYS.map(async (key) => ({
      key,
      info: secretInfo(key),
      summary: await secretSummary(prisma as unknown as PrismaClient, key).catch((err: unknown) => {
        console.error("[agents] résumé de clé", key, err instanceof Error ? err.message : err);
        return null;
      }),
    })),
  );
}
