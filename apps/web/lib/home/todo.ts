/**
 * Bloc « À faire » de l'accueil (fonction pure, testée dans todo.test.ts) : une phrase et un lien par chose à faire,
 * du plus urgent au moins urgent. Vide : « Rien à faire pour l'instant ».
 */

export type TodoIcon = "requests" | "failed" | "reconnect" | "rules" | "ab" | "telegram" | "ai";
export type TodoTone = "danger" | "warning" | "neutral";

export type TodoLine = {
  key: string;
  text: string;
  href: string;
  icon: TodoIcon;
  tone: TodoTone;
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
};

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

export function buildTodo(input: TodoInput): TodoLine[] {
  const lines: TodoLine[] = [];

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
