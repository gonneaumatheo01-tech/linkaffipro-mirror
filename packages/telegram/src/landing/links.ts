/**
 * Liens d'invitation des pages d'atterrissage (phase 15, rubrique « Pages ») : un lien par source de la page (la source
 * "" est le lien par défaut), créé chez Telegram AVEC demande d'adhésion, nommé « <page>-<source> » (32 caractères au
 * plus, `landingInviteLinkName`), puis révoqué quand la source est retirée ou la page supprimée. Contrat :
 * `docs/PAGES-ATTERRISSAGE.md`.
 *
 * Pub figée (D9) : un lien est créé pour la pub reliée à sa source à ce moment-là et la garde pour toujours
 * (`InviteLink.landingAdId` et la campagne de cette pub, posées par `saveLink`). Quand la pub d'une source change
 * (reliée, changée ou retirée), un nouveau lien est créé pour la nouvelle pub et remplace l'ancien sur la source
 * (l'adresse de la page ne change pas, seul le bouton change de lien) ; l'ancien, détaché, reste valable pendant le
 * délai des liens remplacés (15 minutes, `LANDING_REPLACED_GRACE_MS` : visiteurs qui ont encore la page à l'écran ou
 * dans le cache du navigateur), puis il est révoqué, et garde ses demandes, sa pub et sa campagne.
 *
 * Bot qui crée le lien : le bot de l'univers du canal (`Bot.vertical` = `Channel.vertical`, administrateur du canal),
 * sinon un autre de nos bots administrateurs, dans le même ordre de repli que les liens de partage et les liens des
 * canaux à rejoindre (bot qui agit pour le canal, puis droit d'inviter connu, puis inconnu, un droit refusé en dernier).
 * Telegram injoignable ou surchargé (429, 5xx, réseau) : on s'arrête tout de suite, le worker réessaie plus tard.
 * Refus : texte en français gardé sur la source (`LandingSource.linkError`), affiché dans la rubrique Pages.
 *
 * Partagé par le site (enregistrement d'une page, `apps/web/lib/landing/links.ts`), le worker (nouvel essai des liens
 * manquants, révocation des liens orphelins) et le script de la page de test. Dépendances injectées : testé sans base
 * ni Telegram (`links.test.ts`) ; accès base dans `prisma-links.ts`.
 */
import { landingInviteLinkName } from "@linkaffipro/core";
import { telegramErrorText } from "../join-flow/gate-links";

/** Sous-ensemble de l'API Telegram utilisé ici (grammY `Api` ; facile à simuler). */
export interface LandingLinkApi {
  createChatInviteLink(
    chatId: number,
    other: { name: string; creates_join_request: boolean },
  ): Promise<{ invite_link: string }>;
  revokeChatInviteLink(chatId: number, inviteLink: string): Promise<unknown>;
}

/** Un de nos bots administrateur du canal (droits non retirés, bot actif). */
export type LandingLinkBot = {
  botId: string;
  username: string;
  /** Univers du bot (CASINO, SPORTS, DATING). */
  vertical: string | null;
  /** Droit d'inviter par lien : vrai, faux, ou inconnu (droits enregistrés incomplets). */
  canInvite: boolean | null;
};

export type LandingLinkChannel = {
  id: string;
  title: string;
  telegramChatId: bigint;
  vertical: string | null;
  primaryBotId: string | null;
};

/** Source d'une page, telle que relue avant de créer les liens. */
export type LandingSourceLinkState = {
  id: string;
  /** Clé de la source ("" = source par défaut). */
  key: string;
  isActive: boolean;
  /** Lien actuel de la source (null tant que Telegram ne l'a pas créé). */
  inviteLinkId: string | null;
  /** Le lien actuel est-il encore actif chez nous ? (faux : révoqué, à recréer si la source est active) */
  linkActive: boolean;
  /** Dernier refus enregistré (null si aucun). */
  linkError: string | null;
  /** Pub reliée aujourd'hui à la source (null : aucune). */
  adId: string | null;
  /** Pub pour laquelle le lien actuel a été créé (`InviteLink.landingAdId`, figée ; null : aucune). */
  linkAdId: string | null;
};

/**
 * Le lien actuel de la source est-il bon ? Actif ici, et créé pour la pub reliée aujourd'hui à la source (sinon un
 * nouveau lien est créé pour la nouvelle pub : l'ancien garde la sienne).
 */
export function landingSourceLinkIsCurrent(
  s: Pick<LandingSourceLinkState, "inviteLinkId" | "linkActive" | "adId" | "linkAdId">,
): boolean {
  return !!s.inviteLinkId && s.linkActive && (s.linkAdId ?? null) === (s.adId ?? null);
}

export type LandingPageLinks = {
  id: string;
  name: string;
  /** Langue de la page (gardée sur le lien d'invitation). */
  language: string;
  channel: LandingLinkChannel;
  sources: LandingSourceLinkState[];
};

export type LandingInvalidate = { pageId?: string; channelId?: string; all?: boolean };

export interface LandingLinkDeps {
  loadPage(pageId: string): Promise<LandingPageLinks | null>;
  /** Nos bots actifs administrateurs du canal (droits non retirés), du plus ancien au plus récent. */
  adminBots(channelId: string): Promise<LandingLinkBot[]>;
  /** API Telegram d'un de nos bots (null si le bot est inconnu ou inactif). */
  apiFor(botId: string): Promise<LandingLinkApi | null>;
  /**
   * Enregistre le lien créé (`InviteLink` LANDING) et le pose sur la source, en une fois, seulement si la source n'a
   * pas déjà un bon lien (`landingSourceLinkIsCurrent`, relu sous verrou : deux passages en même temps, un seul
   * gagne). Le lien gagnant est créé pour la pub reliée à la source à cet instant (pub et campagne figées) ; il remplace
   * l'ancien lien de la source si celui-ci avait été créé pour une autre pub (`replacedInviteLinkId`, détaché : révoqué
   * après le délai des liens remplacés). `won` faux : le lien gagnant est rendu (`inviteLinkId`, `url`), le
   * nôtre est enregistré sans source, sans pub ni campagne (`ownInviteLinkId`) : l'appelant le révoque chez Telegram,
   * sinon la révocation des liens orphelins du worker le reprendra.
   */
  saveLink(input: {
    pageId: string;
    sourceId: string;
    sourceKey: string;
    channelId: string;
    botId: string;
    url: string;
    name: string;
    language: string;
    userId: string | null;
  }): Promise<{
    won: boolean;
    inviteLinkId: string;
    url: string;
    ownInviteLinkId: string;
    /** Ancien lien de la source (créé pour une autre pub) remplacé par le nôtre, sinon null. */
    replacedInviteLinkId?: string | null;
  }>;
  /** Refus gardé sur la source (null : effacé). */
  setLinkError(sourceId: string, error: string | null): Promise<void>;
  /**
   * Heure du dernier essai de création des liens de ces sources (réussi ou non) : la reprise du worker passe d'abord
   * les pages essayées le moins récemment, chacune à son tour.
   */
  markTried?(sourceIds: readonly string[], at: Date): Promise<void>;
  /** Lien marqué inactif ici (révoqué, ou impossible à révoquer : `error`). */
  markLinkInactive(inviteLinkId: string, error: string | null): Promise<void>;
  /** Invalidation du HTML gardé en mémoire par le service web (`publishLandingInvalidate`, ne lève jamais). */
  publishInvalidate(msg: LandingInvalidate): Promise<unknown>;
  recordEvent(input: {
    type: string;
    channelId?: string | null;
    botId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  warn?(message: string, details: Record<string, unknown>): void;
}

// ─── Ordre des bots ──────────────────────────────────────────────────────────────────────────────────────────────

/** Bot qui agit pour le canal : son bot principal s'il en est administrateur, sinon le premier (`actingBotFor`). */
function actingOf(
  channel: Pick<LandingLinkChannel, "primaryBotId">,
  admins: readonly LandingLinkBot[],
) {
  return (
    (channel.primaryBotId && admins.find((a) => a.botId === channel.primaryBotId)) || admins[0]
  );
}

/**
 * Bots à essayer pour créer le lien d'une source, dans l'ordre :
 * 1. nos bots de l'univers du canal (celui qui agit pour le canal d'abord, puis droit d'inviter connu, puis inconnu) ;
 * 2. le bot qui agit pour le canal (bot principal administrateur, sinon le premier administrateur) ;
 * 3. nos autres bots administrateurs (droit d'inviter connu, puis inconnu) ;
 * 4. en dernier, ceux dont le droit d'inviter est enregistré comme refusé (droits peut-être en retard).
 */
export function landingLinkCandidates(
  channel: Pick<LandingLinkChannel, "vertical" | "primaryBotId">,
  admins: readonly LandingLinkBot[],
): LandingLinkBot[] {
  const out: LandingLinkBot[] = [];
  const seen = new Set<string>();
  const push = (b: LandingLinkBot | undefined) => {
    if (!b || seen.has(b.botId)) return;
    seen.add(b.botId);
    out.push(b);
  };
  const acting = actingOf(channel, admins);
  const allowed = admins.filter((a) => a.canInvite !== false);
  const byRight = (list: readonly LandingLinkBot[]) => [
    ...list.filter((a) => a.canInvite === true),
    ...list.filter((a) => a.canInvite === null),
  ];
  if (channel.vertical) {
    const same = allowed.filter((a) => a.vertical === channel.vertical);
    if (acting && acting.canInvite !== false && acting.vertical === channel.vertical) push(acting);
    for (const b of byRight(same)) push(b);
  }
  if (acting && acting.canInvite !== false) push(acting);
  for (const b of byRight(allowed)) push(b);
  const refused = admins.filter((a) => a.canInvite === false);
  if (acting && acting.canInvite === false) push(acting);
  for (const b of refused) push(b);
  return out;
}

// ─── Erreurs de Telegram ─────────────────────────────────────────────────────────────────────────────────────────

function errorCode(err: unknown): number | null {
  const code = (err as { error_code?: unknown } | null)?.error_code;
  return typeof code === "number" ? code : null;
}

function errorDescription(err: unknown): string {
  const d = (err as { description?: unknown } | null)?.description;
  return typeof d === "string" ? d : "";
}

/**
 * Telegram injoignable ou surchargé (à réessayer plus tard) : 429, erreur 5xx, ou erreur réseau de grammY (`HttpError`).
 */
export function isTransientLandingError(err: unknown): boolean {
  const code = errorCode(err);
  if (code !== null) return code === 429 || code >= 500;
  return (err as { name?: unknown } | null)?.name === "HttpError";
}

/** Lien déjà retiré ou inconnu chez Telegram (la révocation est alors acquise). */
export function isGoneLandingLinkError(err: unknown): boolean {
  return (
    errorCode(err) === 400 &&
    /INVITE_HASH_EXPIRED|INVITE_HASH_INVALID|link not found/i.test(errorDescription(err))
  );
}

/** Texte en français du refus de Telegram (gardé sur la source, affiché dans la rubrique Pages). */
export function landingLinkErrorText(err: unknown, bot: string, channelTitle: string): string {
  if (isTransientLandingError(err))
    return "Telegram ne répond pas pour l'instant : nouvel essai automatique dans quelques minutes.";
  const code = errorCode(err);
  // Jeton refusé : 401, ou 404 « Not Found » (Telegram ne reconnaît pas le jeton du tout).
  if (code === 401 || (code === 404 && /^not found$/i.test(errorDescription(err))))
    return `Le bot @${bot} n'est plus reconnu par Telegram : renouvelez son jeton dans Réglages → Bots. Nouvel essai automatique ensuite.`;
  return `Telegram refuse que @${bot} crée le lien dans « ${channelTitle} ». Ajoutez @${bot} comme administrateur de « ${channelTitle} » avec le droit « Inviter via un lien ». Nouvel essai automatique dans quelques minutes.`;
}

/** Aucun de nos bots n'est administrateur du canal. */
export function landingNoBotText(channelTitle: string): string {
  return `Aucun de nos bots n'est administrateur de « ${channelTitle} » : ajoutez le bot de cet univers comme administrateur avec le droit « Inviter via un lien », puis cliquez « Re-vérifier les droits des bots ». Nouvel essai automatique ensuite.`;
}

function warnOf(deps: Pick<LandingLinkDeps, "warn">) {
  return (
    deps.warn ??
    ((message: string, details: Record<string, unknown>) =>
      console.warn(`[landing] ${message}`, details))
  );
}

// ─── Création ────────────────────────────────────────────────────────────────────────────────────────────────────

export type LandingLinkOutcome =
  | {
      sourceId: string;
      key: string;
      status: "ok";
      inviteLinkId: string;
      /** Adresse du lien (rendue seulement pour un lien créé maintenant ; sinon null : celle en base). */
      url: string | null;
      created: boolean;
      /** @nom du bot qui a créé le lien (lien créé maintenant). */
      bot?: string;
      /** Lien créé pour la nouvelle pub de la source : il remplace l'ancien (créé pour une autre pub). */
      replaced?: boolean;
    }
  | { sourceId: string; key: string; status: "error"; error: string; transient: boolean }
  | { sourceId: string; key: string; status: "inactive" };

export type EnsureLandingLinksReport = {
  pageId: string;
  found: boolean;
  /** Liens créés maintenant (remplacements compris). */
  created: number;
  /** Dont : liens créés pour la nouvelle pub d'une source, à la place de l'ancien. */
  replaced: number;
  failed: number;
  sources: LandingLinkOutcome[];
};

type Attempt =
  | { ok: true; bot: LandingLinkBot; api: LandingLinkApi; url: string }
  | { ok: false; error: string; transient: boolean };

/**
 * Essaie les bots dans l'ordre ; Telegram injoignable ou surchargé (429, 5xx, réseau) : arrêt immédiat (inutile
 * d'essayer les autres bots). Texte gardé : le premier refus définitif (« Ajoutez @bot… », la consigne utile), même si
 * un bot de repli est ensuite seulement surchargé ; la panne passagère (`transient`, qui suspend la reprise) seulement
 * quand aucun bot n'a donné de refus définitif.
 */
async function createWithFallback(
  deps: LandingLinkDeps,
  page: LandingPageLinks,
  candidates: readonly LandingLinkBot[],
  name: string,
  context: Record<string, unknown>,
): Promise<Attempt> {
  const warn = warnOf(deps);
  if (candidates.length === 0)
    return { ok: false, error: landingNoBotText(page.channel.title), transient: false };
  let refusal: { err: unknown; bot: LandingLinkBot } | null = null;
  let down: { err: unknown; bot: LandingLinkBot } | null = null;
  for (const bot of candidates) {
    let api: LandingLinkApi | null;
    try {
      api = await deps.apiFor(bot.botId);
    } catch (err) {
      refusal ??= { err, bot };
      warn("bot impossible à ouvrir pour le lien d'une page", {
        ...context,
        bot: bot.username,
        error: telegramErrorText(err),
      });
      continue;
    }
    if (!api) continue;
    try {
      const invite = await api.createChatInviteLink(Number(page.channel.telegramChatId), {
        name,
        creates_join_request: true,
      });
      return { ok: true, bot, api, url: invite.invite_link };
    } catch (err) {
      warn("lien d'une page d'atterrissage refusé par Telegram", {
        ...context,
        bot: bot.username,
        error: telegramErrorText(err),
      });
      if (isTransientLandingError(err)) {
        down = { err, bot };
        break;
      }
      refusal ??= { err, bot };
    }
  }
  if (refusal)
    return {
      ok: false,
      error: landingLinkErrorText(refusal.err, refusal.bot.username, page.channel.title),
      transient: false,
    };
  if (down)
    return {
      ok: false,
      error: landingLinkErrorText(down.err, down.bot.username, page.channel.title),
      transient: true,
    };
  return { ok: false, error: landingNoBotText(page.channel.title), transient: false };
}

/**
 * Crée les liens manquants des sources actives d'une page (source sans lien, dont le lien a été révoqué, ou dont la pub
 * a changé depuis la création de son lien), un par source, sans doublon (relançable à volonté : une source qui a déjà un
 * bon lien ne touche pas Telegram). Publie l'invalidation de la page si un lien a été créé (le bouton de la source
 * change d'adresse). Ne lève pas pour un refus de Telegram : le refus est gardé sur la source et rendu dans le
 * rapport ; une source dont le lien est bon perd son ancien refus. Un lien remplacé (autre pub) reste actif pendant le
 * délai des liens remplacés (15 minutes), puis la révocation des liens détachés du worker le retire.
 */
export async function ensureLandingLinks(
  deps: LandingLinkDeps,
  pageId: string,
  opts: { userId?: string | null } = {},
): Promise<EnsureLandingLinksReport> {
  const page = await deps.loadPage(pageId);
  const report: EnsureLandingLinksReport = {
    pageId,
    found: !!page,
    created: 0,
    replaced: 0,
    failed: 0,
    sources: [],
  };
  if (!page) return report;
  const missing = page.sources.filter((s) => s.isActive && !landingSourceLinkIsCurrent(s));
  const candidates = missing.length
    ? landingLinkCandidates(page.channel, await deps.adminBots(page.channel.id))
    : [];
  // Toutes les sources en attente de la page comptent comme essayées maintenant (même celles qu'une panne de Telegram
  // empêche d'essayer) : la page passe après les autres au prochain passage du worker.
  if (missing.length && deps.markTried)
    await deps.markTried(
      missing.map((s) => s.id),
      new Date(),
    );
  /** Telegram injoignable : les sources suivantes ne sont pas essayées maintenant. */
  let down: string | null = null;

  for (const s of page.sources) {
    if (!s.isActive) {
      report.sources.push({ sourceId: s.id, key: s.key, status: "inactive" });
      continue;
    }
    if (landingSourceLinkIsCurrent(s)) {
      // Ancien refus (pub changée puis remise, par exemple) : effacé, le lien de la source est bon.
      if (s.linkError) await deps.setLinkError(s.id, null);
      report.sources.push({
        sourceId: s.id,
        key: s.key,
        status: "ok",
        inviteLinkId: s.inviteLinkId!,
        url: null,
        created: false,
      });
      continue;
    }
    const context = { pageId: page.id, sourceKey: s.key, channelId: page.channel.id };
    const attempt: Attempt = down
      ? { ok: false, error: down, transient: true }
      : await createWithFallback(
          deps,
          page,
          candidates,
          landingInviteLinkName(page.name, s.key),
          context,
        );
    if (!attempt.ok) {
      if (attempt.transient) down = attempt.error;
      report.failed++;
      report.sources.push({
        sourceId: s.id,
        key: s.key,
        status: "error",
        error: attempt.error,
        transient: attempt.transient,
      });
      if (s.linkError !== attempt.error) {
        await deps.setLinkError(s.id, attempt.error);
        // Refus nouveau seulement (le worker réessaie toutes les 10 minutes : pas un événement à chaque passage).
        await deps.recordEvent({
          type: "invite_link.landing_failed",
          channelId: page.channel.id,
          payload: { landingPageId: page.id, sourceKey: s.key, error: attempt.error },
        });
      }
      continue;
    }
    const name = landingInviteLinkName(page.name, s.key);
    const saved = await deps.saveLink({
      pageId: page.id,
      sourceId: s.id,
      sourceKey: s.key,
      channelId: page.channel.id,
      botId: attempt.bot.botId,
      url: attempt.url,
      name,
      language: page.language,
      userId: opts.userId ?? null,
    });
    if (!saved.won) {
      // Un autre passage a posé son lien sur la source pendant ce temps : le nôtre est en trop, on le retire.
      try {
        await attempt.api.revokeChatInviteLink(Number(page.channel.telegramChatId), attempt.url);
        await deps.markLinkInactive(saved.ownInviteLinkId, null);
      } catch (err) {
        warnOf(deps)("lien en trop d'une page non révoqué (le worker le reprendra)", {
          ...context,
          error: telegramErrorText(err),
        });
      }
      report.sources.push({
        sourceId: s.id,
        key: s.key,
        status: "ok",
        inviteLinkId: saved.inviteLinkId,
        url: saved.url,
        created: false,
      });
      continue;
    }
    const replaced = saved.replacedInviteLinkId ?? null;
    report.created++;
    if (replaced) report.replaced++;
    report.sources.push({
      sourceId: s.id,
      key: s.key,
      status: "ok",
      inviteLinkId: saved.inviteLinkId,
      url: saved.url,
      created: true,
      bot: attempt.bot.username,
      ...(replaced ? { replaced: true } : {}),
    });
    await deps.recordEvent({
      type: "invite_link.landing_created",
      channelId: page.channel.id,
      botId: attempt.bot.botId,
      payload: {
        inviteLinkId: saved.inviteLinkId,
        landingPageId: page.id,
        sourceKey: s.key,
        name,
        adId: s.adId,
        ...(replaced ? { replacedInviteLinkId: replaced } : {}),
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
    });
  }
  if (report.created > 0) await deps.publishInvalidate({ pageId: page.id });
  return report;
}

// ─── Révocation ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Lien LANDING à révoquer (source retirée, page supprimée, lien remplacé). */
export type LandingLinkToRevoke = {
  id: string;
  channelId: string;
  telegramChatId: bigint;
  telegramInviteLink: string;
  /** Bot qui a créé le lien : seul Telegram le laisse le révoquer. */
  botId: string;
  botUsername: string;
  botActive: boolean;
  landingPageId: string | null;
  landingSource: string | null;
};

export type RevokeLandingLinksReport = {
  /** Révoqués chez Telegram (ou déjà retirés), inactifs ici. */
  revoked: number;
  /** Inactifs ici, mais Telegram n'a pas pu les retirer (bot désactivé, plus administrateur…). */
  disabledOnly: number;
  /** Laissés pour plus tard (Telegram injoignable). */
  retryLater: number;
};

/**
 * Révoque des liens LANDING chez Telegram par le bot qui les a créés, puis les marque inactifs. Telegram injoignable :
 * le lien reste actif ici (nouvel essai par le worker). Refus définitif (bot désactivé, plus administrateur) : inactif
 * ici avec l'erreur gardée dans le journal. Une erreur sur un lien n'arrête jamais les autres ; un 429 suspend
 * seulement les liens du même bot.
 */
export async function revokeLandingLinks(
  deps: Pick<LandingLinkDeps, "apiFor" | "markLinkInactive" | "recordEvent" | "warn">,
  links: readonly LandingLinkToRevoke[],
  opts: { userId?: string | null } = {},
): Promise<RevokeLandingLinksReport> {
  const report: RevokeLandingLinksReport = { revoked: 0, disabledOnly: 0, retryLater: 0 };
  const warn = warnOf(deps);
  const throttled = new Set<string>();
  for (const l of links) {
    if (throttled.has(l.botId)) {
      report.retryLater++;
      continue;
    }
    let error: string | null = null;
    if (!l.botActive) error = "bot désactivé : lien impossible à révoquer chez Telegram";
    else {
      try {
        const api = await deps.apiFor(l.botId);
        if (!api) error = "bot inconnu ou désactivé : lien impossible à révoquer chez Telegram";
        else await api.revokeChatInviteLink(Number(l.telegramChatId), l.telegramInviteLink);
      } catch (err) {
        if (isTransientLandingError(err)) {
          if (errorCode(err) === 429) throttled.add(l.botId);
          report.retryLater++;
          warn("lien d'une page : révocation remise à plus tard", {
            inviteLinkId: l.id,
            bot: l.botUsername,
            error: telegramErrorText(err),
          });
          continue;
        }
        if (!isGoneLandingLinkError(err)) error = telegramErrorText(err);
      }
    }
    await deps.markLinkInactive(l.id, error);
    await deps.recordEvent({
      type: "invite_link.landing_revoked",
      channelId: l.channelId,
      botId: l.botId,
      payload: {
        inviteLinkId: l.id,
        landingPageId: l.landingPageId,
        sourceKey: l.landingSource,
        revokedOnTelegram: error === null,
        error,
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
    });
    if (error === null) report.revoked++;
    else {
      report.disabledOnly++;
      warn("lien d'une page marqué inactif sans révocation chez Telegram", {
        inviteLinkId: l.id,
        bot: l.botUsername,
        error,
      });
    }
  }
  return report;
}
