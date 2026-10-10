/**
 * Liste « À faire pour démarrer » de l'accueil (fonctions pures, testées) : chaque ligne est cochée d'après la base.
 * Relier son Telegram est propre à chaque utilisateur ; créer une campagne, programmer un message et inviter l'équipe
 * valent pour toute l'équipe (ce qu'un collègue a déjà fait n'est pas à refaire). « Inviter l'équipe » : ADMIN seulement.
 */
import type { OnboardingState } from "./state";

export type ChecklistInput = {
  isAdmin: boolean;
  telegramLinked: boolean;
  /** Au moins une campagne créée par l'équipe (hors campagnes pub importées pas encore rattachées). */
  hasCampaign: boolean;
  /** Au moins un message de canal programmé ou envoyé. */
  hasScheduledPost: boolean;
  /** Une invitation envoyée ou un autre compte actif. */
  teamInvited: boolean;
};

export type ChecklistKey = "telegram" | "campaign" | "message" | "team";

export type ChecklistItem = {
  key: ChecklistKey;
  label: string;
  /** Une phrase : pourquoi le faire. */
  hint: string;
  href: string;
  done: boolean;
};

export function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      key: "telegram",
      label: "Relier votre Telegram",
      hint: "Pour recevoir les alertes et vous envoyer des tests.",
      href: "/account",
      done: input.telegramLinked,
    },
    {
      key: "campaign",
      label: "Créer une campagne",
      hint: "Une campagne réunit vos pubs, vos offres et vos canaux.",
      href: "/campaigns/new",
      done: input.hasCampaign,
    },
    {
      key: "message",
      label: "Programmer un message",
      hint: "Il partira tout seul dans le canal à l'heure choisie.",
      href: "/messages/new",
      done: input.hasScheduledPost,
    },
  ];
  if (input.isAdmin)
    items.push({
      key: "team",
      label: "Inviter l'équipe",
      hint: "Chaque équipier a son propre compte.",
      href: "/settings/team",
      done: input.teamInvited,
    });
  return items;
}

export function checklistProgress(items: readonly ChecklistItem[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, complete: done === items.length };
}

/** Ligne repliée de la liste sur téléphone : « Pour démarrer : 1 sur 4 » et la prochaine étape (première non faite). */
export function checklistSummary(items: readonly ChecklistItem[]): {
  title: string;
  next: ChecklistItem | null;
} {
  const { done, total } = checklistProgress(items);
  return {
    title: `Pour démarrer : ${done} sur ${total}`,
    next: items.find((i) => !i.done) ?? null,
  };
}

/** Affichée sur l'accueil jusqu'à ce qu'elle soit finie ou masquée. */
export function checklistVisible(items: readonly ChecklistItem[], state: OnboardingState): boolean {
  return state.checklistDismissedAt === null && !checklistProgress(items).complete;
}
