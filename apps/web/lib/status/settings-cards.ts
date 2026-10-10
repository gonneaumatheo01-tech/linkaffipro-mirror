/**
 * État affiché sur les cartes de Réglages (fonctions pures, testées dans settings-cards.test.ts) : une pastille courte
 * par connexion ou par page quand c'est utile (« Link Affi synchronisé il y a 2 min », « Clé IA absente »…).
 * Les données viennent de `loadSettingsStateInput` (settings-cards-queries.ts) ; une donnée absente (`null` :
 * bloc non demandé ou lecture en panne) ne donne pas de pastille plutôt qu'un état faux.
 * Bots et État du système suivent la règle des pages qu'elles ouvrent (health.ts) : la carte Bots montre la tuile
 * « Bots » d'État du système (« 2 à vérifier »), la carte État du système compte les tuiles qui ne sont pas vertes.
 */
import { type CardState, linkAffiState, plural } from "./card-state";
import { botsTile, healthSummary, healthTiles, type BotHealth } from "./health";
import type { HealthInput } from "./queries";

export { LINKAFFI_STALE_MS, linkAffiState, plural, type CardState } from "./card-state";

/** Ce dont une carte ou un lien de carte peut afficher l'état. */
export const SETTINGS_STATE_KEYS = [
  "linkaffi",
  "meta",
  "tiktok",
  "telegram",
  "bots",
  "team",
  "alerts",
  "ai",
  "categories",
  "tags",
  "status",
  "postbacks",
] as const;
export type SettingsStateKey = (typeof SETTINGS_STATE_KEYS)[number];

export type SettingsStates = Partial<Record<SettingsStateKey, CardState>>;

export type ConnectionCount = {
  platform: string;
  status: "ACTIVE" | "NEEDS_RECONNECT" | "DISABLED" | string;
  count: number;
};

export type SettingsStateInput = {
  /** Tables de la synchro Link Affi (`SyncState`). */
  sync: ReadonlyArray<{ lastSuccessAt: Date | null; lastError: string | null }> | null;
  /** Comptes publicitaires par plateforme et état (`AdAccountConnection`). */
  connections: readonly ConnectionCount[] | null;
  /** Compte Telegram des vues : `{ status: null }` = jamais connecté. */
  telegram: { status: string | null } | null;
  /** Bots avec leur connexion lue chez Telegram (même lecture que la page Bots et État du système). */
  bots: readonly BotHealth[] | null;
  team: { users: number; pendingInvitations: number } | null;
  /** Alertes non résolues. */
  openAlerts: number | null;
  ai: { hasKey: boolean; lastError: string | null } | null;
  categories: number | null;
  tags: number | null;
  /** Données des tuiles d'État du système (même règle « Tout va bien / N points à voir » que la page). */
  health: HealthInput | null;
  /** Adresses de retour du casino actives. */
  postbacks: number | null;
};

/** Meta ou TikTok : à reconnecter, « 2 comptes connectés » ou « Aucun compte connecté ». */
export function adPlatformState(
  connections: SettingsStateInput["connections"],
  platform: "META" | "TIKTOK",
): CardState | undefined {
  if (!connections) return undefined;
  const of = (status: string) =>
    connections
      .filter((c) => c.platform === platform && c.status === status)
      .reduce((n, c) => n + c.count, 0);
  const reconnect = of("NEEDS_RECONNECT");
  if (reconnect > 0)
    return {
      tone: "danger",
      label: reconnect === 1 ? "1 compte à reconnecter" : `${reconnect} comptes à reconnecter`,
    };
  const active = of("ACTIVE");
  if (active > 0)
    return { tone: "success", label: plural(active, "compte connecté", "comptes connectés") };
  return { tone: "muted", label: "Aucun compte connecté" };
}

/** Compte Telegram des vues (`TelegramUserSession.status`). */
export function telegramState(telegram: SettingsStateInput["telegram"]): CardState | undefined {
  if (!telegram) return undefined;
  switch (telegram.status) {
    case "ACTIVE":
      return { tone: "success", label: "Connecté" };
    case "ERROR":
      return { tone: "danger", label: "À reconnecter" };
    case "PENDING_CODE":
    case "PENDING_PASSWORD":
      return { tone: "warning", label: "Connexion à terminer" };
    default:
      return { tone: "muted", label: "Non connecté" };
  }
}

/** Bots : la tuile « Bots » d'État du système (« Aucun bot », « 2 à vérifier », « Tous en ligne »…). */
export function botsState(bots: SettingsStateInput["bots"]): CardState | undefined {
  if (!bots) return undefined;
  return botsTile(bots).state;
}

/** Équipe : « 4 comptes · 1 invitation en attente » (information, sans couleur d'état). */
export function teamState(team: SettingsStateInput["team"]): CardState | undefined {
  if (!team) return undefined;
  const parts = [plural(team.users, "compte", "comptes")];
  if (team.pendingInvitations > 0)
    parts.push(plural(team.pendingInvitations, "invitation en attente", "invitations en attente"));
  return { tone: "neutral", label: parts.join(" · ") };
}

/** Alertes ouvertes : « Aucune alerte ouverte » ou « 2 alertes ouvertes ». */
export function alertsState(open: number | null): CardState | undefined {
  if (open === null) return undefined;
  if (open === 0) return { tone: "success", label: "Aucune alerte ouverte" };
  return { tone: "warning", label: plural(open, "alerte ouverte", "alertes ouvertes") };
}

/** Assistant IA : clé absente, refusée à la vérification, ou prêt. */
export function aiState(ai: SettingsStateInput["ai"]): CardState | undefined {
  if (!ai) return undefined;
  if (!ai.hasKey) return { tone: "warning", label: "Clé IA absente" };
  if (ai.lastError) return { tone: "danger", label: "Clé IA refusée", title: ai.lastError };
  return { tone: "success", label: "Prêt" };
}

/** Catégories de messages actives : « Aucune catégorie » ou « 5 catégories ». */
export function categoriesState(n: number | null): CardState | undefined {
  if (n === null) return undefined;
  return n === 0
    ? { tone: "muted", label: "Aucune catégorie" }
    : { tone: "neutral", label: plural(n, "catégorie", "catégories") };
}

/** Étiquettes de membres du registre : « Aucune étiquette » ou « 3 étiquettes ». */
export function tagsState(n: number | null): CardState | undefined {
  if (n === null) return undefined;
  return n === 0
    ? { tone: "muted", label: "Aucune étiquette" }
    : { tone: "neutral", label: plural(n, "étiquette", "étiquettes") };
}

/** État du système : « Tout va bien » ou « 3 points à voir » (tuiles de la page qui ne sont pas vertes). */
export function systemState(health: HealthInput | null, now: Date): CardState | undefined {
  if (!health) return undefined;
  const s = healthSummary(healthTiles(health, now));
  return { tone: s.tone, label: s.label, ...(s.title ? { title: s.title } : {}) };
}

/** Retours du casino : « Aucune adresse » ou « 2 adresses actives ». */
export function postbacksState(n: number | null): CardState | undefined {
  if (n === null) return undefined;
  return n === 0
    ? { tone: "muted", label: "Aucune adresse" }
    : { tone: "neutral", label: plural(n, "adresse active", "adresses actives") };
}

/** Toutes les pastilles calculables avec ces données (les clés sans donnée sont absentes). */
export function settingsStates(input: SettingsStateInput, now: Date): SettingsStates {
  const all: Record<SettingsStateKey, CardState | undefined> = {
    linkaffi: linkAffiState(input.sync, now),
    meta: adPlatformState(input.connections, "META"),
    tiktok: adPlatformState(input.connections, "TIKTOK"),
    telegram: telegramState(input.telegram),
    bots: botsState(input.bots),
    team: teamState(input.team),
    alerts: alertsState(input.openAlerts),
    ai: aiState(input.ai),
    categories: categoriesState(input.categories),
    tags: tagsState(input.tags),
    status: systemState(input.health, now),
    postbacks: postbacksState(input.postbacks),
  };
  const out: SettingsStates = {};
  for (const k of SETTINGS_STATE_KEYS) {
    const s = all[k];
    if (s) out[k] = s;
  }
  return out;
}

/** Données vides : aucune pastille (repli quand toute la lecture échoue). */
export const NO_STATE_INPUT: SettingsStateInput = {
  sync: null,
  connections: null,
  telegram: null,
  bots: null,
  team: null,
  openAlerts: null,
  ai: null,
  categories: null,
  tags: null,
  health: null,
  postbacks: null,
};
