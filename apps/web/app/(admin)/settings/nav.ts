import type { Role } from "@linkaffipro/core";

/**
 * Sous-pages des réglages : même nom dans les cartes de la page Réglages et dans le titre de chaque page
 * (le préfixe « Avancé : » range les pages techniques, où le terme exact reste affiché).
 * `managers` : la page s'ouvre aussi pour un MANAGER (sinon, réservée aux administrateurs : la carte est cachée).
 * Chaque sous-page garde ses propres contrôles d'accès (`requireAdminPage`, `requireAdmin` dans les actions) :
 * cacher une carte n'ouvre ni ne ferme rien.
 */
export type SettingsPage = {
  href: string;
  label: string;
  description: string;
  managers?: boolean;
};

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    href: "/settings/team",
    label: "Équipe",
    description: "Comptes, invitations, rôles, réinitialisation de mot de passe.",
  },
  {
    href: "/settings/connectors",
    label: "Connexions",
    description: "Link Affi, comptes publicitaires Meta et TikTok, compte Telegram pour les vues.",
  },
  {
    href: "/settings/bots",
    label: "Bots",
    description: "Les bots Telegram de chaque univers : état, connexion, ajout d'un bot.",
    managers: true,
  },
  {
    href: "/settings/ai",
    label: "IA",
    description: "Assistant d'écriture des messages : clé, modèles, plafond.",
    managers: true,
  },
  {
    href: "/settings/categories",
    label: "Catégories de messages",
    description:
      "Vos propres catégories de messages (à créer vous-même), pour comparer ce qui marche.",
  },
  {
    href: "/settings/tags",
    label: "Étiquettes de membres",
    description: "Étiquettes colorées à poser sur les membres (VIP, test…).",
  },
  {
    href: "/settings/alerts",
    label: "Alertes et rétention",
    description: "Seuils d'alerte et durée de conservation des données.",
  },
  {
    href: "/settings/reports",
    label: "Rapports automatiques",
    description: "Rapports envoyés par Telegram chaque jour ou chaque semaine.",
  },
  {
    href: "/settings/journal",
    label: "Journal",
    description: "Ce que l'équipe a fait sur le site, et tout ce que les bots ont vu et fait.",
    managers: true,
  },
  {
    href: "/settings/status",
    label: "État du système",
    description: "Santé du site, des envois, de la synchro et des sauvegardes.",
  },
  {
    href: "/settings/postbacks",
    label: "Avancé : retour du casino (postbacks)",
    description: "Adresses que les programmes partenaires appellent à chaque inscription ou dépôt.",
  },
];

/** Cartes que ce rôle peut ouvrir (ADMIN : toutes ; MANAGER : celles marquées `managers`), dans l'ordre. */
export function settingsPagesFor(
  role: Role,
  pages: readonly SettingsPage[] = SETTINGS_PAGES,
): SettingsPage[] {
  return role === "ADMIN" ? [...pages] : pages.filter((p) => p.managers);
}
