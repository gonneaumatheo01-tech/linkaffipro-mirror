import type { Role } from "@linkaffipro/core";
import type { SettingsStateKey } from "@/lib/status/settings-cards";

/**
 * Cartes de la page Réglages (docs/REFONTE-UX.md) : les sous-pages rangées en 10 cartes, dans l'ordre de la
 * spécification (phase 17 : « IA de conversation » juste après « IA », réservée aux administrateurs). Une carte = une icône (choisie par `key` dans components/settings/settings-card-grid.tsx), un titre,
 * une phrase, une pastille d'état facultative (`state`, calculée dans lib/status/settings-cards.ts) et, pour les
 * cartes qui regroupent plusieurs pages, la liste de leurs liens (`links`, chacun avec sa pastille).
 * `managers` : la carte s'affiche aussi pour un MANAGER (sinon, réservée aux administrateurs).
 * Chaque sous-page garde ses propres contrôles d'accès (`requireAdminPage`, `requireAdmin` dans les actions) :
 * cacher une carte n'ouvre ni ne ferme rien.
 */
export type SettingsCardKey =
  | "connections"
  | "bots"
  | "team"
  | "alerts"
  | "ai"
  | "assistant"
  | "content"
  | "journal"
  | "status"
  | "advanced";

export type SettingsLink = {
  href: string;
  label: string;
  /** Terme technique au survol (seulement dans la carte « Avancé »). */
  term?: string;
  state?: SettingsStateKey;
};

export type SettingsCard = {
  key: SettingsCardKey;
  title: string;
  /** Une phrase, en français simple. */
  description: string;
  /** Phrase pour un MANAGER quand la phrase par défaut promet une action réservée aux administrateurs. */
  managerDescription?: string;
  /** Page ouverte par un clic sur la carte. */
  href: string;
  state?: SettingsStateKey;
  links?: SettingsLink[];
  managers?: boolean;
};

export const SETTINGS_CARDS: SettingsCard[] = [
  {
    key: "connections",
    title: "Connexions",
    description: "Ce qui remplit la plateforme tout seul : Link Affi, vos comptes pub et Telegram.",
    href: "/settings/connectors",
    links: [
      { href: "/settings/connectors", label: "Link Affi", state: "linkaffi" },
      { href: "/settings/connectors/meta", label: "Meta", state: "meta" },
      { href: "/settings/connectors/tiktok", label: "TikTok", state: "tiktok" },
      {
        href: "/settings/connectors/telegram",
        label: "Telegram (vues)",
        state: "telegram",
      },
    ],
  },
  {
    key: "bots",
    title: "Bots",
    description: "Vos bots Telegram, un par univers : leur état et l'ajout d'un bot.",
    managerDescription: "Vos bots Telegram, un par univers : leur état et leur connexion Telegram.",
    href: "/settings/bots",
    state: "bots",
    managers: true,
  },
  {
    key: "team",
    title: "Équipe",
    description: "Les comptes de l'équipe, les invitations et les mots de passe.",
    href: "/settings/team",
    state: "team",
  },
  {
    key: "alerts",
    title: "Alertes et rapports",
    description: "Quand être prévenu, combien de temps garder les données, et les rapports reçus.",
    href: "/settings/alerts",
    links: [
      { href: "/settings/alerts", label: "Alertes", state: "alerts" },
      { href: "/settings/reports", label: "Rapports automatiques" },
    ],
  },
  {
    key: "ai",
    title: "IA",
    description: "L'assistant qui aide à écrire les messages : clé, modèles et plafond.",
    href: "/settings/ai",
    state: "ai",
    managers: true,
  },
  {
    key: "assistant",
    title: "IA de conversation",
    description:
      "L'assistant qui discute en privé : clé Venice, plafond, activation et comptes Telegram.",
    href: "/settings/assistant",
    state: "assistant",
    links: [
      { href: "/settings/assistant", label: "IA de conversation", state: "assistant" },
      { href: "/settings/accounts", label: "Comptes Telegram" },
    ],
  },
  {
    key: "content",
    title: "Catégories et étiquettes",
    description: "Pour ranger vos messages et repérer vos membres (VIP, test…).",
    href: "/settings/categories",
    links: [
      { href: "/settings/categories", label: "Catégories de messages", state: "categories" },
      { href: "/settings/tags", label: "Étiquettes de membres", state: "tags" },
    ],
  },
  {
    key: "journal",
    title: "Journal",
    description: "Ce que l'équipe a fait sur le site, et ce que les bots ont vu et fait.",
    href: "/settings/journal",
    links: [
      { href: "/settings/journal", label: "Actions de l'équipe" },
      { href: "/settings/journal/events", label: "Activité des bots et des membres" },
    ],
    managers: true,
  },
  {
    key: "status",
    title: "État du système",
    description: "La santé du site, des envois, de la synchro et des sauvegardes.",
    href: "/settings/status",
    state: "status",
  },
  {
    key: "advanced",
    title: "Avancé",
    description: "Les réglages techniques, rarement utiles.",
    href: "/settings/postbacks",
    links: [
      {
        href: "/settings/postbacks",
        label: "Retours du casino",
        term: "postbacks",
        state: "postbacks",
      },
    ],
  },
];

/**
 * Cartes que ce rôle peut ouvrir (ADMIN : toutes ; MANAGER : celles marquées `managers`, avec leur phrase
 * `managerDescription` quand elle existe), dans l'ordre.
 */
export function settingsCardsFor(
  role: Role,
  cards: readonly SettingsCard[] = SETTINGS_CARDS,
): SettingsCard[] {
  if (role === "ADMIN") return [...cards];
  return cards
    .filter((c) => c.managers)
    .map(({ managerDescription, ...c }) =>
      managerDescription ? { ...c, description: managerDescription } : c,
    );
}

/** Pastilles à calculer pour ces cartes (celles de la carte et de ses liens), sans doublon. */
export function stateKeysOf(cards: readonly SettingsCard[]): Set<SettingsStateKey> {
  const keys = new Set<SettingsStateKey>();
  for (const c of cards) {
    if (c.state) keys.add(c.state);
    for (const l of c.links ?? []) if (l.state) keys.add(l.state);
  }
  return keys;
}

/** Toutes les adresses ouvertes depuis les cartes (carte puis liens), sans doublon. */
export function settingsHrefs(cards: readonly SettingsCard[] = SETTINGS_CARDS): string[] {
  return [...new Set(cards.flatMap((c) => [c.href, ...(c.links ?? []).map((l) => l.href)]))];
}
