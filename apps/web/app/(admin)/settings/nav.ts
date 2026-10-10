/** Sous-pages des réglages : même libellé dans les boutons de la page Réglages et dans le titre de chaque page. */
export const SETTINGS_PAGES: Array<{ href: string; label: string; description: string }> = [
  {
    href: "/settings/team",
    label: "Équipe",
    description: "Comptes, invitations, rôles, réinitialisation de mot de passe.",
  },
  {
    href: "/settings/connectors",
    label: "Connecteurs",
    description: "Link Affi, comptes publicitaires Meta et TikTok, compte Telegram pour les vues.",
  },
  {
    href: "/settings/ai",
    label: "IA",
    description: "Assistant d'écriture des messages : clé Anthropic, modèles, plafond.",
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
    href: "/settings/postbacks",
    label: "Postbacks directs",
    description: "Adresses de postback pour les programmes partenaires.",
  },
  {
    href: "/settings/reports",
    label: "Rapports automatiques",
    description: "Rapports envoyés par Telegram chaque jour ou chaque semaine.",
  },
  {
    href: "/settings/status",
    label: "État du système",
    description: "Santé du site, du worker, des files et des sauvegardes.",
  },
];
