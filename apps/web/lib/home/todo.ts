/**
 * Bloc « À faire » de l'accueil (fonction pure, testée dans todo.test.ts) : une phrase et un lien par chose à faire,
 * du plus urgent au moins urgent. Vide : « Rien à faire pour l'instant ».
 */

export type TodoIcon =
  "requests" | "failed" | "reconnect" | "rules" | "ab" | "telegram" | "ai" | "links";
export type TodoTone = "danger" | "warning" | "neutral";

/** Bouton d'action à côté de la ligne (action serveur choisie par `kind`, jamais automatique). */
export type TodoAction = {
  kind: "resend-gate-welcome";
  channelId: string;
  label: string;
};

export type TodoLine = {
  key: string;
  text: string;
  href: string;
  icon: TodoIcon;
  tone: TodoTone;
  action?: TodoAction;
};

export type TodoInput = {
  isAdmin: boolean;
  /** Demandes d'adhésion qui attendent une validation à la main (ou une acceptation en échec), par canal. */
  pendingRequests: ReadonlyArray<{ channelId: string; channelTitle: string; count: number }>;
  /** Messages de canal qui n'ont pas pu partir (7 derniers jours). */
  failedPosts: number;
  /** Comptes pub dont la connexion est à refaire. */
  adReconnect: ReadonlyArray<{ platform: string; name: string }>;
  /** Le compte Telegram qui relève les vues est en erreur. */
  telegramSessionError: boolean;
  /** Canaux actifs sans règle d'adhésion (validation à la main, sans message privé automatique). */
  channelsWithoutRule: ReadonlyArray<{ id: string; title: string }>;
  /** Tests A/B de canal envoyés, avec un résultat, à conclure ; `winner` null = égalité. */
  abTests: ReadonlyArray<{ groupId: string; channelTitle: string; winner: string | null }>;
  telegramLinked: boolean;
  /** « Reliez votre Telegram » figure déjà dans la liste « À faire pour démarrer » : pas de doublon. */
  telegramInChecklist: boolean;
  aiKeyMissing: boolean;
  /**
   * Demandes en attente bloquées par des canaux à rejoindre, par canal : `missingTitles` = canaux restés sans lien
   * (aucun de nos bots ne pouvait le créer, ou accueil parti sans lui) ; `uncheckedTitles` = canaux obligatoires
   * qu'aucun de nos bots ne peut vérifier au « ✅ J'ai rejoint ».
   */
  gateLinksMissing?: ReadonlyArray<GateLinksGroup>;
};

export type GateLinksGroup = {
  channelId: string;
  channelTitle: string;
  count: number;
  missingTitles: string[];
  uncheckedTitles?: string[];
};

/**
 * Demandes bloquées regroupées par canal (lignes de `listGateLinksMissing`), canaux concernés dans l'ordre où ils
 * apparaissent : sans lien d'un côté, impossibles à vérifier de l'autre.
 */
export function groupGateLinksMissing(
  rows: ReadonlyArray<{
    channelId: string;
    channelTitle: string;
    missing: ReadonlyArray<{ title: string; reason?: string }>;
  }>,
): GateLinksGroup[] {
  const by = new Map<
    string,
    { channelTitle: string; count: number; titles: Set<string>; unchecked: Set<string> }
  >();
  for (const r of rows) {
    const g = by.get(r.channelId) ?? {
      channelTitle: r.channelTitle,
      count: 0,
      titles: new Set<string>(),
      unchecked: new Set<string>(),
    };
    g.count++;
    for (const m of r.missing) (m.reason === "cannot_verify" ? g.unchecked : g.titles).add(m.title);
    by.set(r.channelId, g);
  }
  return [...by.entries()].map(([channelId, g]) => ({
    channelId,
    channelTitle: g.channelTitle,
    count: g.count,
    missingTitles: [...g.titles],
    uncheckedTitles: [...g.unchecked],
  }));
}

/** Demandes listées canal par canal ; au-delà, une ligne « autres canaux ». */
export const MAX_REQUEST_LINES = 3;
/** Tests A/B listés. */
export const MAX_AB_LINES = 2;

const PLATFORM_LABELS: Record<string, string> = { META: "Meta", TIKTOK: "TikTok" };
const PLATFORM_PAGES: Record<string, string> = {
  META: "/settings/connectors/meta",
  TIKTOK: "/settings/connectors/tiktok",
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Canaux sans lien cités dans une ligne ; au-delà, « et N autres ». */
export const MAX_GATE_TITLES = 3;

function titleList(all: readonly string[]): string {
  const titles = all.slice(0, MAX_GATE_TITLES).map((t) => `« ${t} »`);
  const more = all.length - titles.length;
  return `${titles.join(", ")}${more > 0 ? ` et ${more} ${plural(more, "autre", "autres")}` : ""}`;
}

/** Phrase d'une ligne de demandes bloquées par des canaux à rejoindre (liens manquants, vérification impossible). */
function gateLineText(g: GateLinksGroup): string {
  const demandes = `${g.count} ${plural(g.count, "demande", "demandes")} dans « ${g.channelTitle} »`;
  const unchecked =
    (g.uncheckedTitles ?? []).length > 0
      ? `le bot ne peut pas vérifier ${titleList(g.uncheckedTitles ?? [])}`
      : "";
  if (g.missingTitles.length === 0)
    return `${demandes} ${plural(g.count, "est bloquée", "sont bloquées")} : ${unchecked}`;
  return `${demandes} ${plural(g.count, "attend", "attendent")} des liens de canaux : ${titleList(g.missingTitles)}${unchecked ? ` ; ${unchecked}` : ""}`;
}

export function buildTodo(input: TodoInput): TodoLine[] {
  const lines: TodoLine[] = [];

  // En tête : des personnes attendent des liens que le bot n'a pas pu créer, ou un canal obligatoire que le bot ne
  // peut pas vérifier (elles ne peuvent pas entrer).
  const gate = [...(input.gateLinksMissing ?? [])]
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count || a.channelTitle.localeCompare(b.channelTitle, "fr"));
  for (const g of gate.slice(0, MAX_REQUEST_LINES)) {
    lines.push({
      key: `gate-links:${g.channelId}`,
      text: gateLineText(g),
      href: `/channels/${g.channelId}?tab=rules`,
      icon: "links",
      tone: "danger",
      action: {
        kind: "resend-gate-welcome",
        channelId: g.channelId,
        label: "Renvoyer l'accueil avec les liens",
      },
    });
  }

  const requests = [...input.pendingRequests]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.channelTitle.localeCompare(b.channelTitle, "fr"));
  for (const r of requests.slice(0, MAX_REQUEST_LINES)) {
    lines.push({
      key: `requests:${r.channelId}`,
      text: `${r.count} ${plural(r.count, "demande d'adhésion à valider", "demandes d'adhésion à valider")} dans « ${r.channelTitle} »`,
      href: `/channels/${r.channelId}?tab=requests`,
      icon: "requests",
      tone: "warning",
    });
  }
  const rest = requests.slice(MAX_REQUEST_LINES);
  if (rest.length > 0) {
    const n = rest.reduce((s, r) => s + r.count, 0);
    lines.push({
      key: "requests:others",
      text: `${n} ${plural(n, "autre demande", "autres demandes")} à valider dans ${rest.length} ${plural(rest.length, "autre canal", "autres canaux")}`,
      href: "/channels",
      icon: "requests",
      tone: "warning",
    });
  }

  if (input.failedPosts > 0)
    lines.push({
      key: "failed-posts",
      text: plural(
        input.failedPosts,
        "1 message n'a pas pu partir",
        `${input.failedPosts} messages n'ont pas pu partir`,
      ),
      href: "/messages?view=list&status=FAILED",
      icon: "failed",
      tone: "danger",
    });

  for (const a of input.adReconnect) {
    const platform = PLATFORM_LABELS[a.platform] ?? "pub";
    lines.push({
      key: `reconnect:${a.platform}:${a.name}`,
      text: input.isAdmin
        ? `Reconnectez le compte pub ${platform} « ${a.name} »`
        : `Le compte pub ${platform} « ${a.name} » est à reconnecter par un administrateur`,
      href: PLATFORM_PAGES[a.platform] ?? "/settings/connectors",
      icon: "reconnect",
      tone: "danger",
    });
  }
  if (input.telegramSessionError)
    lines.push({
      key: "reconnect:telegram",
      text: input.isAdmin
        ? "Reconnectez le compte Telegram qui relève les vues des messages"
        : "Le compte Telegram qui relève les vues est à reconnecter par un administrateur",
      href: "/settings/connectors/telegram",
      icon: "reconnect",
      tone: "danger",
    });

  const noRule = input.channelsWithoutRule;
  if (noRule.length === 1)
    lines.push({
      key: "rules",
      text: `Le canal « ${noRule[0]!.title} » n'a pas de règle d'adhésion : chaque demande attend votre validation`,
      href: `/channels/${noRule[0]!.id}?tab=rules`,
      icon: "rules",
      tone: "neutral",
    });
  else if (noRule.length > 1)
    lines.push({
      key: "rules",
      text: `${noRule.length} canaux n'ont pas de règle d'adhésion : leurs demandes attendent votre validation`,
      href: "/channels",
      icon: "rules",
      tone: "neutral",
    });

  for (const t of input.abTests.slice(0, MAX_AB_LINES)) {
    lines.push({
      key: `ab:${t.groupId}`,
      text: t.winner
        ? `Test A/B à conclure dans « ${t.channelTitle} » : la version ${t.winner} l'emporte`
        : `Test A/B à conclure dans « ${t.channelTitle} » : égalité entre les deux versions`,
      href: `/messages/ab/${t.groupId}`,
      icon: "ab",
      tone: "neutral",
    });
  }

  if (!input.telegramLinked && !input.telegramInChecklist)
    lines.push({
      key: "telegram",
      text: "Reliez votre compte Telegram pour recevoir les alertes et vous envoyer des tests",
      href: "/account",
      icon: "telegram",
      tone: "neutral",
    });

  if (input.isAdmin && input.aiKeyMissing)
    lines.push({
      key: "ai",
      text: "Ajoutez la clé de l'assistant IA pour qu'il propose des textes de messages",
      href: "/settings/ai",
      icon: "ai",
      tone: "neutral",
    });

  return lines;
}
