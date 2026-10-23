/** Règles pures de détection des alertes (testées sans base). */

import {
  alertKindLabel,
  isLinkaffiQueueStuck,
  linkAffiTableLabel,
  queueLabel,
} from "@linkaffipro/core";

export type AlertKind =
  | "bot_webhook"
  | "sync_failed"
  | "queue_backlog"
  | "dm_blocked"
  | "subid_health"
  | "worker_down"
  | "job_failures"
  | "backup_failed"
  | "registrations_drop"
  | "spend_no_conversion"
  | "channel_leak"
  | "post_failed"
  | "offer_link_inactive"
  | "connector_reconnect"
  | "gate_links_missing"
  | "custom_emoji_refused"
  | "telegram_account_reconnect"
  | "linkaffi_events_stuck"
  | "bot_blocked_rate"
  | "assistant_ai_failing"
  | "assistant_cap_reached"
  | "agents_team_paused"
  | "agents_channel_drop"
  | "agents_persona_drop"
  | "agents_media_low";
export type AlertSeverityKey = "INFO" | "WARNING" | "CRITICAL";
export type Detected = {
  kind: AlertKind;
  severity: AlertSeverityKey;
  message: string;
  payload: Record<string, unknown>;
};

export const WEBHOOK_SILENCE_MS = 10 * 60 * 1000;
export const QUEUE_BACKLOG_THRESHOLD = 500;
export const DM_BLOCKED_THRESHOLD = 50;
export const SYNC_ERROR_STREAK = 3;
/** Worker considéré arrêté sans battement depuis 3 min ; « erreurs répétées » à partir de 10 échecs en 15 min sur une file. */
export const WORKER_DOWN_MS = 3 * 60 * 1000;
export const JOB_FAILURES_THRESHOLD = 10;
/** Sauvegarde : alerte si le dernier essai a échoué et qu'aucune sauvegarde n'a réussi depuis 36 h. */
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60 * 1000;
/** Une alerte du même type non résolue datant de moins de 24 h n'est pas recréée (une notification par jour au plus). */
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BotSnapshot = {
  username: string;
  isActive: boolean;
  lastWebhookAt: Date | null;
  lastError: string | null;
  /** Phase 17 : « ASSISTANT » = assistant de conversation (il ne reçoit que les messages privés qu'on lui écrit). */
  mode?: string;
};

/**
 * Bots en erreur, ou silencieux depuis 10 min alors qu'un autre bot normal reçoit des updates. Un bot assistant de
 * conversation n'est jamais « silencieux » (il peut rester des heures sans message) et ne sert pas de référence : seule
 * la règle « en erreur » s'applique à lui.
 */
export function detectBotWebhook(bots: BotSnapshot[], now: Date): Detected | null {
  const active = bots.filter((b) => b.isActive);
  const isAssistant = (b: BotSnapshot) => b.mode === "ASSISTANT";
  const recent = active.some(
    (b) =>
      !isAssistant(b) &&
      b.lastWebhookAt &&
      now.getTime() - b.lastWebhookAt.getTime() < WEBHOOK_SILENCE_MS,
  );
  const faulty = active.filter(
    (b) =>
      b.lastError ||
      (!isAssistant(b) &&
        recent &&
        (!b.lastWebhookAt || now.getTime() - b.lastWebhookAt.getTime() >= WEBHOOK_SILENCE_MS)),
  );
  if (faulty.length === 0) return null;
  const names = faulty
    .map((b) => `@${b.username}${b.lastError ? ` (${b.lastError.slice(0, 80)})` : " (silencieux)"}`)
    .join(", ");
  return {
    kind: "bot_webhook",
    severity: "CRITICAL",
    message: `Bot en difficulté : ${names}`,
    payload: { bots: faulty.map((b) => b.username) },
  };
}

export type SyncSnapshot = { source: string; lastError: string | null; errorStreak: number };

/** Une table en échec sur 3 passages consécutifs. */
export function detectSyncFailed(states: SyncSnapshot[]): Detected | null {
  const failing = states.filter((s) => s.lastError && s.errorStreak >= SYNC_ERROR_STREAK);
  if (failing.length === 0) return null;
  return {
    kind: "sync_failed",
    severity: "WARNING",
    message: `Synchro Link Affi en échec répété : ${failing.map((s) => `${linkAffiTableLabel(s.source)} (${(s.lastError ?? "").slice(0, 60)})`).join(", ")}`,
    payload: { sources: failing.map((s) => s.source) },
  };
}

export function detectQueueBacklog(waiting: number): Detected | null {
  if (waiting <= QUEUE_BACKLOG_THRESHOLD) return null;
  return {
    kind: "queue_backlog",
    severity: "WARNING",
    message: `File d'envoi Telegram engorgée : ${waiting} messages en attente`,
    payload: { waiting },
  };
}

export function detectDmBlocked(blockedLastHour: number): Detected | null {
  if (blockedLastHour <= DM_BLOCKED_THRESHOLD) return null;
  // Depuis la phase 14, « bloqué » = la personne a vraiment bloqué le bot (les personnes injoignables sont à part).
  return {
    kind: "dm_blocked",
    severity: "WARNING",
    message: `${blockedLastHour} messages privés refusés dans l'heure par des personnes qui ont bloqué le bot`,
    payload: { blockedLastHour },
  };
}

/** Alerte « bot bloqué après l'accueil » (phase 14, décision E10) : au plus une par canal toutes les 6 heures. */
export const BOT_BLOCKED_RATE_DEDUP_MS = 6 * 60 * 60 * 1000;
/** Au moins 10 demandes dont l'accueil est parti depuis au moins 1 heure (sur les dernières 24 heures). */
export const BOT_BLOCKED_RATE_MIN_REQUESTS = 10;
/** Plus de 25 % de vrais blocages dans l'heure qui suit l'accueil. */
export const BOT_BLOCKED_RATE_THRESHOLD = 0.25;

/** Demandes d'un canal dont l'accueil est parti (fenêtre glissante), et vrais blocages dans l'heure qui suit. */
export type BotBlockedRateGroup = {
  /** D'où viennent ces personnes, après « venues » : « de Pub 1 », « de « Tir Cadré » », « d'un autre lien ». */
  fromText: string;
  requests: number;
  blocked: number;
};

export type BotBlockedRateSnapshot = {
  channelId: string;
  channelTitle: string;
  /** Bot qui a envoyé l'accueil (le plus souvent bloqué s'il y en a plusieurs). */
  botUsername: string | null;
  requests: number;
  blocked: number;
  /** Par provenance (pub, canal, lien). */
  groups: BotBlockedRateGroup[];
};

function percent(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

/** Une provenance au-dessus du seuil : au moins 10 demandes et plus de 25 % de vrais blocages (comme le canal). */
function overBlockedRate(g: Pick<BotBlockedRateGroup, "requests" | "blocked">): boolean {
  return (
    g.requests >= BOT_BLOCKED_RATE_MIN_REQUESTS &&
    g.blocked / g.requests > BOT_BLOCKED_RATE_THRESHOLD
  );
}

/**
 * Provenance la plus touchée à citer dans l'alerte : seulement parmi celles au-dessus du seuil (au moins 10 demandes,
 * plus de 25 %), du taux le plus haut au plus bas, puis du plus de blocages au moins. Aucune : null (l'alerte cite le
 * total du canal), jamais une provenance sous le seuil qui rassurerait à tort.
 */
export function worstBlockedGroup(
  groups: readonly BotBlockedRateGroup[],
): BotBlockedRateGroup | null {
  return (
    groups
      .filter(overBlockedRate)
      .sort(
        (a, b) => b.blocked / b.requests - a.blocked / a.requests || b.blocked - a.blocked,
      )[0] ?? null
  );
}

/**
 * Canaux où plus de 25 % des personnes bloquent le bot dans l'heure qui suit l'accueil, sur au moins 10 demandes
 * (phase 14) : une alerte par canal, avec la provenance la plus touchée au-dessus du seuil (`worstBlockedGroup`), sinon
 * le total du canal. « 40 % des personnes venues de Pub 1 ont bloqué @womendatingoobot après l'accueil… ».
 */
export function detectBotBlockedRate(rows: readonly BotBlockedRateSnapshot[]): Detected[] {
  const out: Detected[] = [];
  for (const r of rows) {
    if (!overBlockedRate(r)) continue;
    const worst = worstBlockedGroup(r.groups);
    const g = worst ?? { fromText: "", requests: r.requests, blocked: r.blocked };
    const who = g.fromText ? `des personnes venues ${g.fromText}` : "des personnes";
    const bot = r.botUsername ? `@${r.botUsername}` : "le bot";
    out.push({
      kind: "bot_blocked_rate",
      severity: "WARNING",
      message: `${percent(g.blocked, g.requests)} % ${who} ont bloqué ${bot} après l'accueil de « ${r.channelTitle} » (${g.blocked} sur ${g.requests} en 24 h) : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ».`,
      payload: {
        channelId: r.channelId,
        channelTitle: r.channelTitle,
        botUsername: r.botUsername,
        requests: r.requests,
        blocked: r.blocked,
        rate: percent(r.blocked, r.requests),
        worst: worst
          ? {
              fromText: worst.fromText,
              requests: worst.requests,
              blocked: worst.blocked,
              rate: percent(worst.blocked, worst.requests),
            }
          : null,
      },
    });
  }
  return out;
}

/**
 * Alerte « bot bloqué » à créer pour ce canal ? Non si une alerte du même canal a été créée il y a moins de 6 heures
 * (ouverte ou résolue) : au plus une notification par canal toutes les 6 heures.
 */
export function shouldCreateForChannel(
  channelId: string,
  recent: ReadonlyArray<{ createdAt: Date; payload: unknown }>,
  now: Date,
): boolean {
  return !recent.some(
    (a) =>
      (a.payload as { channelId?: unknown } | null)?.channelId === channelId &&
      now.getTime() - a.createdAt.getTime() < BOT_BLOCKED_RATE_DEDUP_MS,
  );
}

export function detectSubIdHealth(status: string, message: string): Detected | null {
  if (status !== "alert") return null;
  return {
    kind: "subid_health",
    severity: "CRITICAL",
    message: `Identifiant de suivi qui ne revient pas : ${message}`,
    payload: { status },
  };
}

/**
 * Worker absent : le dernier battement connu date de plus de 3 minutes.
 * Évaluée (1) par le site dans `/api/health` pendant l'absence et (2) par le worker à son redémarrage,
 * pour signaler la durée de l'absence (`lastHeartbeatAt` = copie persistante du battement).
 */
export function detectWorkerDown(lastHeartbeatAt: Date | null, now: Date): Detected | null {
  if (!lastHeartbeatAt) return null;
  const downMs = now.getTime() - lastHeartbeatAt.getTime();
  if (downMs < WORKER_DOWN_MS) return null;
  const minutes = Math.round(downMs / 60_000);
  return {
    kind: "worker_down",
    severity: "CRITICAL",
    message: `Service d'arrière-plan arrêté : aucun signe de vie depuis ${minutes} min (dernier signal ${formatTime(lastHeartbeatAt)})`,
    payload: { lastHeartbeatAt: lastHeartbeatAt.toISOString(), downMinutes: minutes },
  };
}

/** Erreurs répétées : au moins 10 tâches échouées en 15 minutes sur une même file. */
export function detectJobFailures(failuresByQueue: Record<string, number>): Detected | null {
  const hot = Object.entries(failuresByQueue).filter(([, n]) => n >= JOB_FAILURES_THRESHOLD);
  if (hot.length === 0) return null;
  const list = hot.map(([q, n]) => `${queueLabel(q)} (${n})`).join(", ");
  return {
    kind: "job_failures",
    severity: "WARNING",
    message: `Erreurs répétées sur les tâches du service d'arrière-plan en 15 min : ${list}. Voir Réglages → État du système.`,
    payload: { queues: Object.fromEntries(hot) },
  };
}

/** Dernier état de sauvegarde (`Setting` `backup.last`, écrit par `backups/run.ts`) ; un échec garde le `file` du dernier succès. */
export type BackupSnapshot = { at: string; file: string | null; ok: boolean; error?: string };

/** Date encodée dans le nom d'un fichier de sauvegarde (`linkaffipro-2026-10-09T04-00-00.sql.gz`), sinon null. */
export function backupFileDate(file: string | null | undefined): Date | null {
  const m = file?.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sauvegarde en échec : le dernier essai a échoué et le dernier succès (date du fichier conservé) est absent ou
 * plus vieux que 36 h. Rien tant qu'aucune sauvegarde n'a été tentée.
 */
export function detectBackupFailed(status: BackupSnapshot | null, now: Date): Detected | null {
  if (!status || status.ok) return null;
  const lastSuccess = backupFileDate(status.file);
  if (lastSuccess && now.getTime() - lastSuccess.getTime() < BACKUP_MAX_AGE_MS) return null;
  const error = (status.error ?? "erreur inconnue").slice(0, 160);
  return {
    kind: "backup_failed",
    severity: "CRITICAL",
    message: `La sauvegarde automatique de la base a échoué : ${error}`,
    payload: { at: status.at, lastSuccessAt: lastSuccess?.toISOString() ?? null, error },
  };
}

// ------------------------------------------------------------------
// Règles métier (phase 6) : seuils réglables dans Réglages → Alertes (`Setting` `alerts.thresholds`).
// ------------------------------------------------------------------

/** Seuils réglables. `registrationsDropPct` : chute en % sous la moyenne ; `spendNoConversionEur` : dépense sans inscription ; `channelLeakPct` : départs en % des membres actifs. */
export type AlertThresholds = {
  registrationsDropPct: number;
  spendNoConversionEur: number;
  channelLeakPct: number;
};
export const DEFAULT_THRESHOLDS: AlertThresholds = {
  registrationsDropPct: 50,
  spendNoConversionEur: 50,
  channelLeakPct: 10,
};
/** Chute des inscriptions : la règle ne s'applique qu'avec une moyenne d'au moins 10 inscriptions par jour. */
export const REGISTRATIONS_MIN_DAILY_AVG = 10;
/** Canal qui fuit : la règle ne s'applique qu'aux canaux d'au moins 20 membres actifs. */
export const CHANNEL_LEAK_MIN_MEMBERS = 20;

/** Lit les seuils depuis la valeur JSON du réglage ; chaque champ absent ou invalide prend sa valeur par défaut. */
export function parseThresholds(value: unknown): AlertThresholds {
  const v = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof AlertThresholds, unknown>
  >;
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : fallback;
  return {
    registrationsDropPct: num(
      v.registrationsDropPct,
      DEFAULT_THRESHOLDS.registrationsDropPct,
      1,
      100,
    ),
    spendNoConversionEur: num(
      v.spendNoConversionEur,
      DEFAULT_THRESHOLDS.spendNoConversionEur,
      0,
      1_000_000,
    ),
    channelLeakPct: num(v.channelLeakPct, DEFAULT_THRESHOLDS.channelLeakPct, 1, 100),
  };
}

export type RegistrationsSnapshot = { last24h: number; previous7dTotal: number };

/**
 * Chute des inscriptions : les inscriptions des dernières 24 h sont sous (100 − seuil) % de la moyenne quotidienne
 * des 7 jours précédents, et cette moyenne vaut au moins 10 par jour (sinon trop peu de données pour conclure).
 */
export function detectRegistrationsDrop(
  s: RegistrationsSnapshot,
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): Detected | null {
  const avg = s.previous7dTotal / 7;
  if (avg < REGISTRATIONS_MIN_DAILY_AVG) return null;
  const limit = avg * (1 - t.registrationsDropPct / 100);
  if (s.last24h >= limit) return null;
  const dropPct = Math.round((1 - s.last24h / avg) * 100);
  return {
    kind: "registrations_drop",
    severity: "WARNING",
    message: `Chute des inscriptions : ${s.last24h} sur les dernières 24 h contre ${Math.round(avg)} par jour en moyenne sur les 7 jours précédents (−${dropPct} %).`,
    payload: {
      last24h: s.last24h,
      dailyAverage: Math.round(avg * 10) / 10,
      dropPct,
      thresholdPct: t.registrationsDropPct,
    },
  };
}

export type SpendSnapshot = {
  name: string;
  spend: number;
  registrations: number;
  /** Commissions de la campagne sur la même fenêtre (phase 10) ; absentes : le message ne parle pas des gains. */
  commissions?: number;
};

/** Montant d'une alerte avec le vrai signe moins (« −60,50 € »), comme sur le site et dans les rapports. */
function alertEur(n: number): string {
  const s = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(n);
  return `${s.replace(/^-/, "\u2212")} €`;
}

/**
 * Dépense sans conversion : une campagne a coûté plus que le seuil sur 24 h sans aucune inscription rattachée. Quand
 * ses commissions sont connues, le message donne ses gains (commissions − dépense pub, la définition unique).
 */
export function detectSpendNoConversion(
  items: SpendSnapshot[],
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): Detected | null {
  const hot = items.filter((i) => i.spend > t.spendNoConversionEur && i.registrations === 0);
  if (hot.length === 0) return null;
  const gains = (i: SpendSnapshot) =>
    i.commissions === undefined ? null : Math.round((i.commissions - i.spend) * 100) / 100;
  const list = hot
    .map((i) => {
      const g = gains(i);
      return g === null
        ? `${i.name} (${alertEur(i.spend)})`
        : `${i.name} (${alertEur(i.spend)} dépensés, gains ${alertEur(g)})`;
    })
    .join(", ");
  return {
    kind: "spend_no_conversion",
    severity: "WARNING",
    message: `Dépense sans inscription sur 24 h : ${list}. Vérifiez les liens d'entrée de la campagne et ses offres Link Affi.`,
    payload: {
      campaigns: hot.map((i) =>
        i.commissions === undefined
          ? { name: i.name, spend: i.spend }
          : { name: i.name, spend: i.spend, commissions: i.commissions, gains: gains(i) },
      ),
      thresholdEur: t.spendNoConversionEur,
    },
  };
}

export type ChannelLeakSnapshot = { title: string; activeMembers: number; left24h: number };

/** Canal qui fuit : les départs sur 24 h dépassent le seuil (en % des membres actifs), pour un canal d'au moins 20 membres. */
export function detectChannelLeak(
  channels: ChannelLeakSnapshot[],
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): Detected | null {
  const leaking = channels.filter(
    (c) =>
      c.activeMembers >= CHANNEL_LEAK_MIN_MEMBERS &&
      c.left24h > (c.activeMembers * t.channelLeakPct) / 100,
  );
  if (leaking.length === 0) return null;
  const list = leaking
    .map(
      (c) =>
        `${c.title} (${c.left24h} départs sur ${c.activeMembers} membres, ${Math.round((c.left24h / c.activeMembers) * 100)} %)`,
    )
    .join(", ");
  return {
    kind: "channel_leak",
    severity: "WARNING",
    message: `Canal qui perd ses membres : ${list}.`,
    payload: {
      channels: leaking.map((c) => ({
        title: c.title,
        activeMembers: c.activeMembers,
        left24h: c.left24h,
      })),
      thresholdPct: t.channelLeakPct,
    },
  };
}

export type FailedPostSnapshot = { code: string; channelTitle: string; lastError: string | null };

/** Message programmé en échec dans les dernières 24 h. */
export function detectPostFailed(posts: FailedPostSnapshot[]): Detected | null {
  if (posts.length === 0) return null;
  const list = posts
    .slice(0, 5)
    .map(
      (p) => `${p.channelTitle} / ${p.code}${p.lastError ? ` (${p.lastError.slice(0, 60)})` : ""}`,
    )
    .join(", ");
  const more = posts.length > 5 ? ` et ${posts.length - 5} autre(s)` : "";
  return {
    kind: "post_failed",
    severity: "WARNING",
    message: `${posts.length} message${posts.length > 1 ? "s" : ""} programmé${posts.length > 1 ? "s" : ""} en échec sur 24 h : ${list}${more}. Voir la page Messages.`,
    payload: { posts: posts.map((p) => p.code) },
  };
}

export type InactiveLinkClickSnapshot = { slug: string; label: string; clicks: number };

/** Lien d'offre désactivé mais encore cliqué dans les dernières 24 h (un message ou un bouton pointe toujours dessus). */
export function detectOfferLinkInactive(links: InactiveLinkClickSnapshot[]): Detected | null {
  const hit = links.filter((l) => l.clicks > 0);
  if (hit.length === 0) return null;
  const list = hit
    .slice(0, 5)
    .map((l) => `${l.label} (/${l.slug}, ${l.clicks} clic${l.clicks > 1 ? "s" : ""})`)
    .join(", ");
  const more = hit.length > 5 ? ` et ${hit.length - 5} autre(s)` : "";
  return {
    kind: "offer_link_inactive",
    severity: "WARNING",
    message: `Lien désactivé encore cliqué sur 24 h : ${list}${more}. Réactivez-le ou remplacez-le dans les messages.`,
    payload: { links: hit.map((l) => ({ slug: l.slug, clicks: l.clicks })) },
  };
}

/**
 * Demande encore en attente bloquée par un canal à rejoindre : accueil parti sans son lien, ou (raison
 * « cannot_verify ») canal obligatoire qu'aucun de nos bots ne peut vérifier au « ✅ J'ai rejoint ».
 */
export type GateLinksMissingSnapshot = {
  channelTitle: string;
  status: string;
  missing: Array<{
    title: string;
    suggestedBot: string | null;
    reason?: "no_link" | "cannot_verify";
  }>;
};

function quoted(titles: string[], max = 3): string {
  const shown = titles.slice(0, max).map((t) => `« ${t} »`);
  const more = titles.length > max ? ` et ${titles.length - max} autre(s)` : "";
  return `${shown.join(", ")}${more}`;
}

/**
 * Liens des canaux à rejoindre impossibles à créer (aucun de nos bots n'y est administrateur avec le droit d'inviter),
 * ou canaux obligatoires impossibles à vérifier : demandes regroupées par canal, canaux concernés, et la solution avec
 * le bot à ajouter. Critique si des personnes attendent des canaux obligatoires (elles ne peuvent pas entrer), sinon
 * avertissement.
 */
export function detectGateLinksMissing(rows: GateLinksMissingSnapshot[]): Detected | null {
  if (rows.length === 0) return null;
  const byChannel = new Map<
    string,
    { requests: number; missing: Set<string>; unchecked: Set<string>; bots: Set<string> }
  >();
  for (const r of rows) {
    const c = byChannel.get(r.channelTitle) ?? {
      requests: 0,
      missing: new Set(),
      unchecked: new Set(),
      bots: new Set(),
    };
    c.requests++;
    for (const m of r.missing) {
      (m.reason === "cannot_verify" ? c.unchecked : c.missing).add(m.title);
      if (m.suggestedBot) c.bots.add(m.suggestedBot);
    }
    byChannel.set(r.channelTitle, c);
  }
  const parts = [...byChannel.entries()].slice(0, 3).map(([title, c]) => {
    const n = c.requests;
    const unchecked =
      c.unchecked.size > 0 ? `le bot ne peut pas vérifier ${quoted([...c.unchecked])}` : "";
    if (c.missing.size === 0)
      return `${n > 1 ? `${n} demandes sont bloquées` : "1 demande est bloquée"} dans « ${title} » : ${unchecked}.`;
    const verb = n > 1 ? `${n} demandes attendent` : "1 demande attend";
    return `${verb} les liens des canaux à rejoindre dans « ${title} » : ${quoted([...c.missing])}${unchecked ? ` ; ${unchecked}` : ""}.`;
  });
  if (byChannel.size > 3) parts.push(`Et ${byChannel.size - 3} autre(s) canal(aux).`);
  const bots = [...new Set([...byChannel.values()].flatMap((c) => [...c.bots]))];
  const who = bots.length > 0 ? bots.map((b) => `@${b}`).join(" ou ") : "un de nos bots";
  const blocked = rows.some((r) => r.status === "PENDING_GATE");
  return {
    kind: "gate_links_missing",
    severity: blocked ? "CRITICAL" : "WARNING",
    message: `${parts.join(" ")} Ajoutez ${who} comme administrateur de ces canaux avec le droit « Inviter via un lien », puis cliquez « Renvoyer l'accueil avec les liens » dans « À faire » sur l'accueil du site.`,
    payload: { requests: rows.length, channels: [...byChannel.keys()] },
  };
}

/** Fenêtre lue pour l'alerte des emojis animés refusés (événements `dm.custom_emoji_fallback`). */
export const CUSTOM_EMOJI_REFUSED_WINDOW_MS = 3600_000;

export type CustomEmojiFallbackSnapshot = {
  /** Bot qui a envoyé (nom d'utilisateur Telegram), null s'il n'est plus connu. */
  botUsername: string | null;
  /** Vrai : message refusé puis renvoyé avec les emojis normaux ; faux : Telegram a retiré les emojis animés. */
  resent: boolean;
  /**
   * Message privé (`dm.custom_emoji_fallback`, par défaut) ou message programmé publié par un bot dans un groupe
   * (`post.custom_emoji_fallback`).
   */
  kind?: "dm" | "post";
};

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/**
 * Messages partis avec les emojis normaux au lieu des emojis animés dans la dernière heure (Telegram les a refusés ou
 * retirés : abonnement Premium du propriétaire des bots expiré, emoji supprimé par son auteur) : messages privés et
 * messages programmés publiés par un bot (groupes). Alerte de type « rouvert en silence » (`REOPEN_KINDS`) : une
 * notification Telegram par 24 h au plus.
 */
export function detectCustomEmojiRefused(rows: CustomEmojiFallbackSnapshot[]): Detected | null {
  if (rows.length === 0) return null;
  const n = rows.length;
  const posts = rows.filter((r) => r.kind === "post").length;
  const dms = n - posts;
  const bots = [...new Set(rows.map((r) => r.botUsername).filter((b): b is string => !!b))];
  const who = bots.length > 0 ? ` (${bots.map((b) => `@${b}`).join(", ")})` : "";
  const verb = n > 1 ? "sont partis" : "est parti";
  const what =
    posts === 0
      ? `${countLabel(n, "message privé", "messages privés")} de la dernière heure ${verb}`
      : dms === 0
        ? `${countLabel(n, "message programmé", "messages programmés")} de la dernière heure ${verb}`
        : `${n} messages de la dernière heure (${countLabel(dms, "message privé", "messages privés")}, ${countLabel(posts, "message programmé", "messages programmés")}) ${verb}`;
  return {
    kind: "custom_emoji_refused",
    severity: "WARNING",
    message: `${what} avec les emojis normaux au lieu des emojis animés${who}. Vérifiez que le compte Telegram propriétaire des bots a toujours Telegram Premium.`,
    payload: { messages: n, bots, resent: rows.filter((r) => r.resent).length, dms, posts },
  };
}

export type TelegramAccountSnapshot = {
  /** Statut de la session (`TelegramUserSession.status`) : ACTIVE, ERROR… */
  status: string;
  /** Messages de canal programmés qui doivent être publiés par le compte (emojis animés). */
  pendingAccountPosts: number;
};

/**
 * Compte Telegram connecté à reconnecter (session expirée, révoquée ou utilisée ailleurs, phase 12) : les vues ne sont
 * plus relevées et les messages avec emojis animés ne peuvent plus être publiés. Critique si de tels messages attendent.
 * Condition durable : une alerte ouverte n'est pas recréée avant 24 h (une notification par jour au plus).
 */
export function detectTelegramAccountReconnect(s: TelegramAccountSnapshot | null): Detected | null {
  if (!s || s.status !== "ERROR") return null;
  const n = s.pendingAccountPosts;
  const pending =
    n > 0
      ? ` ${n} message${n > 1 ? "s" : ""} programmé${n > 1 ? "s" : ""} avec emojis animés ne partir${n > 1 ? "ont" : "a"} pas.`
      : "";
  return {
    kind: "telegram_account_reconnect",
    severity: n > 0 ? "CRITICAL" : "WARNING",
    message: `Le compte Telegram connecté est à reconnecter (session expirée ou révoquée) : les vues des messages ne sont plus relevées et les messages avec emojis animés ne peuvent pas être publiés.${pending} Réglages → Connexions → Telegram → Reconnecter.`,
    payload: { pendingAccountPosts: n },
  };
}

export type LinkaffiEventsSnapshot = {
  /** Événements en attente d'envoi à Link Affi (`LinkaffiEvent` PENDING). */
  pending: number;
  /** Création du plus ancien en attente. */
  oldestCreatedAt: Date;
  /** Raison de l'attente du plus ancien (réponse de Link Affi, secret pas encore créé…). */
  lastError: string | null;
};

function durationText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * Événements des membres d'affiliés bloqués : le plus ancien attend d'être reçu par Link Affi depuis plus d'une heure
 * (phase 13). Alerte « rouverte en silence » (`REOPEN_KINDS`) : une notification Telegram par 24 h au plus.
 */
export function detectLinkaffiEventsStuck(
  s: LinkaffiEventsSnapshot | null,
  now: Date,
): Detected | null {
  if (!s || s.pending === 0 || !isLinkaffiQueueStuck(s.oldestCreatedAt, now)) return null;
  const n = s.pending;
  const what =
    n > 1
      ? `${n} événements de membres d'affiliés attendent`
      : "1 événement de membre d'affilié attend";
  const reason = s.lastError ? ` Dernier problème : ${s.lastError.slice(0, 160)}.` : "";
  return {
    kind: "linkaffi_events_stuck",
    severity: "WARNING",
    message: `${what} d'être reçus par Link Affi depuis ${durationText(now.getTime() - s.oldestCreatedAt.getTime())}.${reason} Vérifiez Réglages → Connexions → Link Affi (secret de signature, adresse de réception, « Envoyer un événement de test ») ; les essais continuent pendant 24 h et Link Affi peut tout rattraper.`,
    payload: {
      pending: n,
      oldestCreatedAt: s.oldestCreatedAt.toISOString(),
      lastError: s.lastError,
    },
  };
}

// ------------------------------------------------------------------
// Assistant de conversation (phase 17)
// ------------------------------------------------------------------

/** Fenêtre lue pour l'alerte « assistant en panne » (événements `conversation.ai_failed`). */
export const ASSISTANT_AI_FAILING_WINDOW_MS = 15 * 60_000;
/** Pannes de l'IA (autres que clé, solde ou clé absente) à partir desquelles l'admin est prévenu. */
export const ASSISTANT_AI_FAILING_THRESHOLD = 3;
/** Pannes qui arrêtent l'assistant tout de suite : prévenir sans attendre. */
const ASSISTANT_FATAL_CODES = new Set(["auth", "balance", "no_key"]);

export type AssistantAiFailure = {
  /** Code de la panne (`auth`, `balance`, `no_key`, `rate_limit`, `server`, `timeout`, `invalid_output`…). */
  code: string;
  /** Aucun nouvel essai prévu (l'assistant n'a pas répondu à ce message). */
  final: boolean;
};

const AI_FAILURE_REASON: Record<string, string> = {
  auth: "la clé Venice est refusée",
  balance: "le solde Venice est vide",
  no_key: "aucune clé Venice n'est enregistrée",
};

/**
 * L'assistant de conversation n'arrive plus à répondre (pannes `conversation.ai_failed` des 15 dernières minutes) : clé
 * refusée, solde vide ou clé absente → tout de suite ; une réponse abandonnée (aucun nouvel essai) → tout de suite ;
 * sinon à partir de 3 pannes. Message en français simple avec la marche à suivre. Alerte « rouverte en silence »
 * (`REOPEN_KINDS`) : une notification Telegram par 24 h au plus.
 */
export function detectAssistantAiFailing(failures: readonly AssistantAiFailure[]): Detected | null {
  if (failures.length === 0) return null;
  const fatal = failures.find((f) => ASSISTANT_FATAL_CODES.has(f.code));
  const final = failures.filter((f) => f.final).length;
  if (!fatal && final === 0 && failures.length < ASSISTANT_AI_FAILING_THRESHOLD) return null;
  const n = failures.length;
  const what = fatal
    ? `L'assistant de conversation ne peut plus répondre : ${AI_FAILURE_REASON[fatal.code]}.`
    : `L'assistant de conversation n'a pas réussi à répondre ${n} fois en 15 minutes${final > 0 ? ` (${final} message${final > 1 ? "s" : ""} resté${final > 1 ? "s" : ""} sans réponse)` : ""} : le service d'IA Venice ne répond pas ou refuse.`;
  const codes = [...new Set(failures.map((f) => f.code))];
  return {
    kind: "assistant_ai_failing",
    severity: fatal ? "CRITICAL" : "WARNING",
    message: `${what} Vérifiez la clé et le solde Venice dans Réglages → IA de conversation (bouton « Vérifier »).`,
    payload: { failures: n, final, codes },
  };
}

export type AssistantSpendSnapshot = {
  /** Activation de l'assistant (« off », « team », « all »). */
  activation: string;
  /** Dépense IA du mois en cours (Paris), en euros. */
  spentEur: number;
  /** Plafond mensuel des réglages, en euros (0 = aucun appel voulu par l'équipe : pas d'alerte). */
  capEur: number;
};

/**
 * Plafond mensuel de l'assistant atteint : il ne répond plus jusqu'au 1er du mois suivant. Seulement si l'assistant est
 * activé et qu'un plafond est fixé (0 € = choix de l'équipe de ne faire aucun appel).
 */
export function detectAssistantCapReached(s: AssistantSpendSnapshot | null): Detected | null {
  if (!s || s.activation === "off" || s.capEur <= 0 || s.spentEur < s.capEur) return null;
  const eur = (n: number) =>
    `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
  return {
    kind: "assistant_cap_reached",
    severity: "WARNING",
    message: `L'assistant de conversation a atteint son plafond de dépense du mois (${eur(s.spentEur)} pour un plafond de ${eur(s.capEur)}) : il ne répond plus jusqu'au 1er du mois prochain. Pour le relancer, augmentez le plafond dans Réglages → IA de conversation.`,
    payload: { spentEur: Math.round(s.spentEur * 100) / 100, capEur: s.capEur },
  };
}

// ------------------------------------------------------------------
// Agents IA (phase 19)
// ------------------------------------------------------------------

export type AgentTeamSnapshot = { label: string; paused: boolean; consecutiveFailures: number; pausedReason: string | null };

/**
 * Équipe d'agents mise en pause automatiquement (3 missions échouées de suite). Une pause demandée par l'équipe n'est
 * pas une alerte. Résolue d'elle-même quand l'équipe reprend.
 */
export function detectAgentsTeamPaused(teams: readonly AgentTeamSnapshot[], threshold = 3): Detected | null {
  const auto = teams.filter((t) => t.paused && t.consecutiveFailures >= threshold);
  if (!auto.length) return null;
  const names = auto.map((t) => t.label).join(", ");
  return {
    kind: "agents_team_paused",
    severity: "WARNING",
    message: `${auto.length > 1 ? "Les équipes d'agents" : "L'équipe d'agents"} ${names} ${auto.length > 1 ? "sont" : "est"} en pause après ${threshold} missions échouées de suite. Regardez le journal dans Agents, puis relancez l'équipe (bouton Reprendre, ou « reprends <équipe> » au bot).`,
    payload: { teams: auto.map((t) => t.label) },
  };
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(d);
}

/**
 * Types d'alerte gérés canal par canal (création, dédoublonnage et résolution à part : `bot_blocked_rate`), jamais
 * résolus par la règle générale « type plus détecté ».
 */
export const PER_CHANNEL_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "bot_blocked_rate",
  // Équipe Algorithme (phase 21) : créées et résolues cible par cible par la file `agents-algo`, notifiées ici.
  "agents_channel_drop",
  "agents_persona_drop",
  // Équipe Casino (phase 22) : vidéos en manque, créées et résolues canal par canal par le cycle des agents.
  "agents_media_low",
]);

/** Faut-il créer une nouvelle alerte ? Non si une alerte du même type est ouverte et récente. */
export function shouldCreate(
  kind: AlertKind,
  open: Array<{ kind: string; createdAt: Date }>,
  now: Date,
): boolean {
  return !open.some(
    (a) => a.kind === kind && now.getTime() - a.createdAt.getTime() < DEDUP_WINDOW_MS,
  );
}

/**
 * Types d'alerte dont la condition apparaît et disparaît d'elle-même : une demande attend ses liens 10 minutes puis
 * est acceptée, la suivante arrive une heure plus tard. Pour eux, une alerte résolue créée il y a moins de 24 h est
 * rouverte en silence au lieu d'une nouvelle alerte notifiée : une notification Telegram par 24 h au plus.
 */
export const REOPEN_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "gate_links_missing",
  "custom_emoji_refused",
  "linkaffi_events_stuck",
  "assistant_ai_failing",
]);

/**
 * Alerte à rouvrir (sans nouvelle notification) au lieu d'en créer une : la plus récente du même type créée il y a
 * moins de 24 h, résolue ou non, pour les types de `REOPEN_KINDS` ; sinon null (nouvelle alerte).
 */
export function alertToReopen(
  kind: AlertKind,
  recent: ReadonlyArray<{ id: string; kind: string; createdAt: Date }>,
  now: Date,
): string | null {
  if (!REOPEN_KINDS.has(kind)) return null;
  let best: { id: string; createdAt: Date } | null = null;
  for (const a of recent) {
    if (a.kind !== kind) continue;
    const age = now.getTime() - a.createdAt.getTime();
    if (age >= DEDUP_WINDOW_MS) continue;
    if (!best || a.createdAt.getTime() > best.createdAt.getTime()) best = a;
  }
  return best?.id ?? null;
}

/** Formate l'alerte pour Telegram (HTML) : titre en français (`alertKindLabel`), jamais le code technique. */
export function formatAlert(d: Detected): string {
  const icon = d.severity === "CRITICAL" ? "🔴" : d.severity === "WARNING" ? "🟠" : "ℹ️";
  return `${icon} <b>Alerte : ${escapeHtml(alertKindLabel(d.kind))}</b>\n${escapeHtml(d.message)}\n<i>Voir Réglages → Alertes.</i>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Jeton d'un compte publicitaire à renouveler dans moins de 7 jours. */
export const CONNECTOR_EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type ConnectionSnapshot = {
  platform: string;
  name: string;
  status: string;
  tokenExpiresAt: Date | null;
  lastError: string | null;
};

/** Comptes publicitaires à reconnecter : jeton refusé par la plateforme, ou expirant dans moins de 7 jours (phase 7). */
export function detectConnectorReconnect(
  connections: ConnectionSnapshot[],
  now: Date,
): Detected | null {
  const needs = connections.filter((c) => c.status === "NEEDS_RECONNECT");
  const soon = connections.filter(
    (c) =>
      c.status === "ACTIVE" &&
      c.tokenExpiresAt &&
      c.tokenExpiresAt.getTime() - now.getTime() < CONNECTOR_EXPIRY_SOON_MS,
  );
  if (needs.length === 0 && soon.length === 0) return null;
  const label = (c: ConnectionSnapshot) =>
    `${c.platform === "META" ? "Meta" : c.platform === "TIKTOK" ? "TikTok" : c.platform} « ${c.name} »`;
  const parts: string[] = [];
  if (needs.length) parts.push(`à reconnecter : ${needs.map(label).join(", ")}`);
  if (soon.length) parts.push(`jeton expirant sous 7 jours : ${soon.map(label).join(", ")}`);
  return {
    kind: "connector_reconnect",
    severity: needs.length ? "CRITICAL" : "WARNING",
    message: `Compte publicitaire ${parts.join(" ; ")}. Réglages → Connexions → Reconnecter.`,
    payload: { needsReconnect: needs.map((c) => c.name), expiringSoon: soon.map((c) => c.name) },
  };
}
