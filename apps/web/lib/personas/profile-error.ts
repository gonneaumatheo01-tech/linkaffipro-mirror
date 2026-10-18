/**
 * Échec de la pose du profil Telegram d'un bot assistant (description, description courte, commandes :
 * `setAssistantProfile`), en français simple. Le texte brut de Telegram ou de la bibliothèque (« Call to
 * 'setMyDescription' failed! (429: Too Many Requests: retry after 31) ») n'est jamais affiché : il part dans le journal
 * du serveur (`console.error`) et la phrase dit seulement ce qui se passe et quoi faire. Classement des erreurs
 * Telegram partagé avec Réglages → Bots et État du système (`telegramErrorKind` de `lib/status/telegram-error`).
 * Règle pure (testée). Utilisée par la fiche d'une persona (`save.ts`) et après « Enregistrer le mode » (Réglages →
 * Bots, `setBotModeAction`).
 */
import { telegramErrorKind } from "@/lib/status/telegram-error";

/** Refus de notre garde-fou (description sans « assistante ») : déjà une phrase en français, gardée telle quelle. */
const OWN_REFUSAL = /^Description du bot refusée/;

/** Raison en clair et marche à suivre, sans aucun texte technique. */
export function profileErrorReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (OWN_REFUSAL.test(raw)) return raw.replace(/\.\s*$/, "");
  switch (telegramErrorKind(raw, "check")) {
    case "rate":
      return "Telegram demande d'attendre quelques secondes";
    case "network":
      return "Telegram ne répond pas pour l'instant";
    case "token":
      return "Telegram refuse le jeton de ce bot (supprimé ou régénéré dans @BotFather)";
    default:
      return "Telegram a refusé la description";
  }
}

/**
 * Ce qu'il faut faire ensuite, selon la raison : réessayer n'aide que si l'échec est passager. Jeton refusé → coller le
 * nouveau jeton ; description refusée par notre garde-fou → la corriger dans la persona ; sinon `retry` (« Réenregistrez
 * dans un instant. » par défaut, la fiche d'une persona ; « Réessayez dans un instant. » pour Réglages → Bots).
 */
export function profileErrorNextStep(
  err: unknown,
  retry = "Réenregistrez dans un instant.",
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (OWN_REFUSAL.test(raw))
    return "Corrigez la description dans le bloc « Profil du bot » de la persona, puis réenregistrez.";
  if (telegramErrorKind(raw, "check") === "token")
    return "Collez le nouveau jeton avec « Ajouter un bot » (Réglages → Bots), puis réenregistrez.";
  return retry;
}

/** Phrase complète du bandeau rouge, pour un bot : « La description de @lea_bot n'a pas pu être posée… ». */
export function profileErrorMessage(username: string, err: unknown): string {
  return `La description de @${username} n'a pas pu être posée dans Telegram : ${profileErrorReason(err)}. ${profileErrorNextStep(err)}`;
}
