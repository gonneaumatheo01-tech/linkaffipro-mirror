import { StatusPill } from "@/components/admin/status-pill";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import type { BotCheck } from "@/lib/status/health";
import { telegramErrorText, type TelegramErrorSource } from "@/lib/status/telegram-error";

/**
 * Libellé de l'état d'un bot (`botCheck`), aussi utilisé pour trier les tableaux. `error` : réponse de Telegram quand
 * la connexion n'a pas pu être lue ; un jeton refusé (401) se dit « Jeton refusé », pas « Telegram injoignable ».
 */
export function botCheckLabel(check: BotCheck, error?: string | null): string {
  switch (check) {
    case "unreachable":
      return telegramErrorText(error)?.label ?? "Telegram injoignable";
    case "error":
      return "Erreur du bot";
    default:
      return statusLabel("webhook", check);
  }
}

/**
 * Pastille de l'état d'un bot, la même sur la page Bots et dans État du système : « Connecté », « À vérifier »,
 * « Inactif », « Jeton refusé », « Telegram injoignable » ou « Erreur du bot » (connexion bonne mais dernière erreur
 * enregistrée). `error` : réponse brute de Telegram (au survol seulement).
 */
export function BotConnection({ check, error }: { check: BotCheck; error?: string | null }) {
  if (check === "unreachable" || check === "error")
    return (
      <StatusPill tone="danger" title={error ?? undefined}>
        {botCheckLabel(check, error)}
      </StatusPill>
    );
  return <StatusBadge kind="webhook" value={check} />;
}

/**
 * Erreur Telegram d'un bot dans un volet : une phrase en français (ce qui se passe, quoi faire), puis le texte brut
 * de Telegram replié dans « Détail technique » (jamais en surface : anglais, termes techniques). `at` : date déjà
 * formatée, ajoutée au détail.
 */
export function TelegramErrorText({
  raw,
  source = "check",
  at,
}: {
  raw: string | null | undefined;
  source?: TelegramErrorSource;
  at?: string | null;
}) {
  const v = telegramErrorText(raw, source);
  if (!v) return <>—</>;
  return (
    <span className="block space-y-1">
      <span className="block text-danger">{v.sentence}</span>
      <details className="group/raw text-note text-muted-foreground">
        <summary className="inline-flex min-h-6 cursor-pointer items-center rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-10">
          Détail technique
        </summary>
        <span className="mt-1 block font-mono break-words">
          {v.raw}
          {at ? ` (${at})` : ""}
        </span>
      </details>
    </span>
  );
}
