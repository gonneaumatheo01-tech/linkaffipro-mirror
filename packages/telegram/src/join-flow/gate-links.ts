/**
 * Liens des canaux à rejoindre (liens GATE) : création par n'importe lequel de nos bots, vérification qu'un membre a
 * bien rejoint, avec les dépendances injectées (testé sans base ni Telegram).
 *
 * Cas du client (11 octobre) : un canal « Rencontres » demande de rejoindre un canal casino et un canal paris sportifs,
 * chacun géré par un AUTRE de nos bots. Le bot qui traite la demande n'est pas administrateur de ces canaux :
 * `createChatInviteLink` et `getChatMember` échouent avec lui. On essaie donc d'abord ce bot, puis chacun de nos bots
 * administrateurs du canal à rejoindre (avec le droit d'inviter pour un lien), dans un ordre stable, et chaque échec
 * est journalisé avec l'erreur exacte de Telegram (plus jamais de `catch` muet).
 */
import type { ChannelInfo, GateButton } from "./deps";

/** Sous-ensemble de l'API Telegram utilisé pour les canaux à rejoindre (facile à simuler). */
export interface GateLinkApi {
  createChatInviteLink(
    chatId: number | string,
    other?: { name?: string },
  ): Promise<{ invite_link: string }>;
  getChatMember(chatId: number | string, userId: number): Promise<{ status: string }>;
}

/** Un de nos bots administrateur d'un canal (droits non retirés, bot actif). */
export type GateBot = {
  botId: string;
  username: string;
  /** Droit d'inviter par lien : vrai, faux, ou inconnu (droits enregistrés incomplets). */
  canInvite: boolean | null;
};

/** Bot qui traite la demande : essayé en premier, avec son API déjà ouverte. */
export type FirstBot = { botId: string; username: string; api: GateLinkApi };

/**
 * Canal à rejoindre qui bloque une demande : resté sans lien (`Membership.source.gateLinksMissing`), ou dont aucun de
 * nos bots ne peut vérifier qu'il a été rejoint (`Membership.source.gateCheckFailed`, canaux obligatoires).
 */
export type GateLinkProblem = {
  channelId: string;
  title: string;
  /** Erreurs exactes de Telegram, bot par bot (ou l'explication quand aucun bot n'a pu essayer). */
  error: string;
  /** @noms des bots essayés, dans l'ordre. */
  tried: string[];
  /** Bot à ajouter comme administrateur du canal (celui qui traite les demandes du canal source). */
  suggestedBot: string | null;
  /**
   * « no_link » (par défaut) : aucun lien n'a pu être créé ; « cannot_verify » : le lien existe (lien public) mais aucun
   * de nos bots ne peut vérifier que la personne a rejoint. Même solution : ajouter un de nos bots comme administrateur.
   */
  reason?: GateProblemReason;
};

export type GateProblemReason = "no_link" | "cannot_verify";

export interface GateLinkDeps {
  /**
   * Lien GATE déjà créé pour (canal source → canal à rejoindre), encore actif, dont le bot créateur est actif et n'a
   * pas perdu ses droits sur le canal à rejoindre ; sinon null.
   */
  findGateLink(sourceChannelId: string, gateChannelId: string): Promise<string | null>;
  /** Mémorise un lien GATE créé par `botId`. */
  saveGateLink(input: {
    sourceChannelId: string;
    gate: ChannelInfo;
    botId: string;
    url: string;
  }): Promise<void>;
  /** Nos bots actifs administrateurs du canal (droits non retirés), dans un ordre stable. */
  adminBots(channelId: string): Promise<GateBot[]>;
  /** API Telegram d'un de nos bots (null si le bot est inconnu ou inactif). */
  apiFor(botId: string): Promise<GateLinkApi | null>;
  /** Journal des échecs (console par défaut ; le worker passe son logger). */
  warn?(message: string, details: Record<string, unknown>): void;
}

export type GateLinksResult = { gates: GateButton[]; missing: GateLinkProblem[] };

/** Erreur Telegram lisible et exacte : « 400 Bad Request: not enough rights… » (sinon le message de l'erreur). */
export function telegramErrorText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { error_code?: unknown; description?: unknown; message?: unknown };
    if (typeof e.description === "string")
      return typeof e.error_code === "number" ? `${e.error_code} ${e.description}` : e.description;
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return String(err);
}

const NO_BOT_ERROR = "aucun de nos bots n'est administrateur de ce canal avec le droit d'inviter";

function warnOf(deps: GateLinkDeps) {
  return (
    deps.warn ??
    ((message: string, details: Record<string, unknown>) =>
      console.warn(`[join-flow] ${message}`, details))
  );
}

/**
 * Bots à essayer pour créer un lien vers un canal : le bot qui traite la demande d'abord (même si la base ne le sait
 * pas administrateur : ses droits enregistrés peuvent être en retard), puis nos bots administrateurs avec le droit
 * d'inviter, puis ceux dont le droit est inconnu. Un bot dont le droit est explicitement refusé n'est pas essayé.
 */
export function inviteCandidates(
  first: { botId: string; username: string } | null | undefined,
  admins: readonly GateBot[],
): Array<{ botId: string; username: string }> {
  const out: Array<{ botId: string; username: string }> = [];
  const seen = new Set<string>();
  const push = (b: { botId: string; username: string }) => {
    if (seen.has(b.botId)) return;
    seen.add(b.botId);
    out.push({ botId: b.botId, username: b.username });
  };
  if (first) push(first);
  for (const a of admins) if (a.canInvite === true) push(a);
  for (const a of admins) if (a.canInvite === null) push(a);
  return out;
}

/**
 * Bots à essayer pour vérifier qu'un membre a rejoint : nos administrateurs du canal d'abord (le bot de la demande en
 * tête s'il en fait partie), puis le bot de la demande s'il n'est pas connu comme administrateur. Un bot non
 * administrateur peut répondre « left » sans pouvoir lire la liste des membres : sa réponse ne passe qu'en dernier.
 */
export function checkCandidates(
  first: { botId: string; username: string } | null | undefined,
  admins: readonly GateBot[],
): Array<{ botId: string; username: string }> {
  const out: Array<{ botId: string; username: string }> = [];
  const seen = new Set<string>();
  const firstIsAdmin = !!first && admins.some((a) => a.botId === first.botId);
  const ordered = [
    ...(first && firstIsAdmin ? [first] : []),
    ...admins,
    ...(first && !firstIsAdmin ? [first] : []),
  ];
  for (const b of ordered) {
    if (seen.has(b.botId)) continue;
    seen.add(b.botId);
    out.push({ botId: b.botId, username: b.username });
  }
  return out;
}

/**
 * API d'un bot à essayer. Un bot impossible à ouvrir (jeton illisible, base injoignable) ne doit jamais faire échouer
 * la demande : l'erreur est renvoyée pour être notée, et le bot suivant est essayé.
 */
async function apiOf(
  deps: GateLinkDeps,
  first: FirstBot | null | undefined,
  botId: string,
): Promise<{ api: GateLinkApi | null } | { error: string }> {
  if (first && first.botId === botId) return { api: first.api };
  try {
    return { api: await deps.apiFor(botId) };
  } catch (err) {
    return { error: `bot impossible à ouvrir (${telegramErrorText(err)})` };
  }
}

/**
 * Lien d'un canal à rejoindre : lien GATE existant et valide, sinon création par le premier de nos bots qui y arrive,
 * sinon le lien public du canal (s'il a un nom public). Renvoie le bouton, ou le problème (canal, erreurs exactes).
 */
export async function resolveGateLink(
  deps: GateLinkDeps,
  source: { id: string; title: string },
  gate: ChannelInfo,
  first?: FirstBot | null,
): Promise<{ button: GateButton } | { problem: GateLinkProblem }> {
  const warn = warnOf(deps);
  const existing = await deps.findGateLink(source.id, gate.id);
  if (existing) return { button: { channelId: gate.id, title: gate.title, url: existing } };

  const admins = await deps.adminBots(gate.id);
  const candidates = inviteCandidates(first, admins);
  const errors: string[] = [];
  const tried: string[] = [];
  for (const c of candidates) {
    tried.push(`@${c.username}`);
    const opened = await apiOf(deps, first, c.botId);
    if ("error" in opened) {
      errors.push(`@${c.username} : ${opened.error}`);
      warn("lien du canal à rejoindre impossible à créer", {
        sourceChannelId: source.id,
        gateChannelId: gate.id,
        gateTitle: gate.title,
        bot: c.username,
        error: opened.error,
      });
      continue;
    }
    const api = opened.api;
    if (!api) {
      errors.push(`@${c.username} : bot inactif ou inconnu`);
      continue;
    }
    try {
      const link = await api.createChatInviteLink(Number(gate.telegramChatId), {
        name: `gate ${source.title}`.slice(0, 32),
      });
      await deps.saveGateLink({
        sourceChannelId: source.id,
        gate,
        botId: c.botId,
        url: link.invite_link,
      });
      return { button: { channelId: gate.id, title: gate.title, url: link.invite_link } };
    } catch (err) {
      const text = telegramErrorText(err);
      errors.push(`@${c.username} : ${text}`);
      warn("lien du canal à rejoindre impossible à créer", {
        sourceChannelId: source.id,
        gateChannelId: gate.id,
        gateTitle: gate.title,
        telegramChatId: gate.telegramChatId.toString(),
        bot: c.username,
        error: text,
      });
    }
  }
  if (gate.username)
    return {
      button: { channelId: gate.id, title: gate.title, url: `https://t.me/${gate.username}` },
    };
  const problem: GateLinkProblem = {
    channelId: gate.id,
    title: gate.title,
    error: errors.length > 0 ? errors.join(" ; ") : NO_BOT_ERROR,
    tried,
    suggestedBot: first?.username ?? null,
  };
  if (errors.length === 0)
    warn("lien du canal à rejoindre impossible à créer", {
      sourceChannelId: source.id,
      gateChannelId: gate.id,
      gateTitle: gate.title,
      error: NO_BOT_ERROR,
    });
  return { problem };
}

/**
 * Liens de tous les canaux à rejoindre d'une règle, dans l'ordre de la règle. Ne lève jamais d'erreur : une erreur
 * inattendue sur un canal (base, Telegram) devient un problème de ce canal (la demande est toujours enregistrée et
 * l'accueil part avec « ✅ J'ai rejoint »), les autres canaux continuent.
 */
export async function resolveGateLinks(
  deps: GateLinkDeps,
  source: { id: string; title: string },
  gates: readonly ChannelInfo[],
  first?: FirstBot | null,
): Promise<GateLinksResult> {
  const warn = warnOf(deps);
  const out: GateLinksResult = { gates: [], missing: [] };
  for (const g of gates) {
    if (g.id === source.id) continue;
    try {
      const r = await resolveGateLink(deps, source, g, first);
      if ("button" in r) out.gates.push(r.button);
      else out.missing.push(r.problem);
    } catch (err) {
      const error = `erreur inattendue : ${telegramErrorText(err)}`;
      warn("lien du canal à rejoindre impossible à créer", {
        sourceChannelId: source.id,
        gateChannelId: g.id,
        gateTitle: g.title,
        error,
      });
      out.missing.push({
        channelId: g.id,
        title: g.title,
        error,
        tried: [],
        suggestedBot: first?.username ?? null,
      });
    }
  }
  return out;
}

const GOOD_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

export type GateCheckResult = {
  /** Canaux pas encore rejoints (ou impossibles à vérifier). */
  missing: ChannelInfo[];
  /** Canaux qu'aucun de nos bots n'a pu vérifier (erreurs exactes, bots essayés) : comptés comme non rejoints. */
  unverified: Array<{ channelId: string; title: string; error: string; tried: string[] }>;
};

/**
 * Le membre a-t-il rejoint chaque canal ? `getChatMember` avec nos bots administrateurs du canal, puis avec le bot qui
 * traite la demande s'il n'est pas connu comme administrateur (un bot non administrateur d'un canal ne peut pas lire
 * ses membres). Si aucun bot ne peut répondre, le canal compte comme non rejoint (jamais d'acceptation sans
 * vérification) et l'erreur est gardée. Un bot impossible à ouvrir est noté et le suivant est essayé.
 */
export async function checkGateMembership(
  deps: GateLinkDeps,
  gates: readonly ChannelInfo[],
  userId: number,
  first?: FirstBot | null,
): Promise<GateCheckResult> {
  const warn = warnOf(deps);
  const result: GateCheckResult = { missing: [], unverified: [] };
  for (const g of gates) {
    const candidates = checkCandidates(first, await deps.adminBots(g.id));
    let status: string | null = null;
    const errors: string[] = [];
    const tried: string[] = [];
    for (const c of candidates) {
      const opened = await apiOf(deps, first, c.botId);
      if ("error" in opened) {
        tried.push(`@${c.username}`);
        errors.push(`@${c.username} : ${opened.error}`);
        continue;
      }
      if (!opened.api) continue;
      tried.push(`@${c.username}`);
      try {
        status = (await opened.api.getChatMember(Number(g.telegramChatId), userId)).status;
        break;
      } catch (err) {
        errors.push(`@${c.username} : ${telegramErrorText(err)}`);
      }
    }
    if (status === null) {
      const error = errors.length > 0 ? errors.join(" ; ") : NO_BOT_ERROR;
      result.unverified.push({ channelId: g.id, title: g.title, error, tried });
      result.missing.push(g);
      warn("vérification du canal à rejoindre impossible", {
        gateChannelId: g.id,
        gateTitle: g.title,
        error,
      });
    } else if (!GOOD_STATUSES.has(status)) result.missing.push(g);
  }
  return result;
}

function problemsFrom(raw: unknown, reason?: GateProblemReason): GateLinkProblem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p &&
        typeof p === "object" &&
        typeof (p as { channelId?: unknown }).channelId === "string",
    )
    .map((p) => {
      const r =
        reason ?? (p.reason === "no_link" || p.reason === "cannot_verify" ? p.reason : undefined);
      return {
        channelId: String(p.channelId),
        title: typeof p.title === "string" ? p.title : "canal",
        error: typeof p.error === "string" ? p.error : "",
        tried: Array.isArray(p.tried)
          ? p.tried.filter((t): t is string => typeof t === "string")
          : [],
        suggestedBot: typeof p.suggestedBot === "string" ? p.suggestedBot : null,
        ...(r ? { reason: r } : {}),
      };
    });
}

/** Problèmes de liens enregistrés sur une demande (`source.gateLinksMissing`), relus prudemment. */
export function gateProblemsOf(
  source: Record<string, unknown> | null | undefined,
): GateLinkProblem[] {
  return problemsFrom(source?.gateLinksMissing);
}

/**
 * Canaux obligatoires qu'aucun de nos bots n'a pu vérifier au « ✅ J'ai rejoint » (`source.gateCheckFailed`) : la
 * personne reste bloquée même si elle a rejoint. Relus prudemment, avec la raison « cannot_verify ».
 */
export function gateCheckProblemsOf(
  source: Record<string, unknown> | null | undefined,
): GateLinkProblem[] {
  return problemsFrom(source?.gateCheckFailed, "cannot_verify");
}

/** Mêmes canaux, dans le même ordre ? (évite de réécrire la demande pour rien). */
export function sameGateChannels(
  a: ReadonlyArray<{ channelId: string }>,
  b: ReadonlyArray<{ channelId: string }>,
): boolean {
  return a.map((p) => p.channelId).join() === b.map((p) => p.channelId).join();
}

/** Boutons enregistrés sur une demande (`source.gates`), relus prudemment. */
export function gateButtonsOf(source: Record<string, unknown> | null | undefined): GateButton[] {
  const raw = source?.gates;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (g): g is GateButton =>
      !!g &&
      typeof g === "object" &&
      typeof (g as GateButton).channelId === "string" &&
      typeof (g as GateButton).url === "string" &&
      typeof (g as GateButton).title === "string",
  );
}
