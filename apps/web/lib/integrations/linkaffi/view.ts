import { fmtRelative } from "@/lib/format";

/**
 * État de la connexion « Campagnes Telegram des affiliés » en une pastille et une phrase (Réglages → Connexions).
 * Règle pure, testée.
 */
export type LinkaffiConnectionTone = "success" | "info" | "warning" | "danger";

export function linkaffiConnectionStatus(
  s: {
    keyPrefix: string | null;
    hasSecret: boolean;
    lastApiCallAt: Date | null;
    queue: { stuck: boolean };
  },
  now = new Date(),
): { tone: LinkaffiConnectionTone; label: string; sentence: string } {
  const missing = [
    !s.keyPrefix ? "la clé de connexion" : null,
    !s.hasSecret ? "le secret de signature" : null,
  ].filter((x): x is string => !!x);
  if (missing.length)
    return {
      tone: "warning",
      label: "À brancher",
      sentence: `Générez ${missing.join(" et ")}, puis collez-les dans Link Affi (guide ci-dessous).`,
    };
  if (s.queue.stuck)
    return {
      tone: "danger",
      label: "Envois bloqués",
      sentence:
        "Des événements attendent depuis plus d'une heure : vérifiez l'adresse et le secret collé dans Link Affi, puis envoyez un test.",
    };
  if (!s.lastApiCallAt)
    return {
      tone: "info",
      label: "En attente de Link Affi",
      sentence:
        "Les deux valeurs sont prêtes. Link Affi ne nous a pas encore appelés : vérifiez qu'elles sont collées dans ses secrets.",
    };
  return {
    tone: "success",
    label: "Branché",
    sentence: `Link Affi nous a appelés ${fmtRelative(s.lastApiCallAt, now)}.`,
  };
}
