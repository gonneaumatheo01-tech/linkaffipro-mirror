import { StatusPill } from "@/components/admin/status-pill";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import type { BotCheck } from "@/lib/status/health";

/** Libellé de l'état d'un bot (`botCheck`), aussi utilisé pour trier les tableaux. */
export function botCheckLabel(check: BotCheck): string {
  switch (check) {
    case "unreachable":
      return "Telegram injoignable";
    case "error":
      return "Erreur du bot";
    default:
      return statusLabel("webhook", check);
  }
}

/**
 * Pastille de l'état d'un bot, la même sur la page Bots et dans État du système : « Connecté », « À vérifier »,
 * « Inactif », « Telegram injoignable » ou « Erreur du bot » (connexion bonne mais dernière erreur enregistrée).
 */
export function BotConnection({ check }: { check: BotCheck }) {
  if (check === "unreachable" || check === "error")
    return <StatusPill tone="danger">{botCheckLabel(check)}</StatusPill>;
  return <StatusBadge kind="webhook" value={check} />;
}
