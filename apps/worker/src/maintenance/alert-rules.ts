/** Règles pures de détection des alertes (testées sans base). */

import { alertKindLabel, linkAffiTableLabel, queueLabel } from "@linkaffipro/core";

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
  | "gate_links_missing";
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
};

/** Bots en erreur, ou silencieux depuis 10 min alors qu'un autre bot reçoit des updates. */
export function detectBotWebhook(bots: BotSnapshot[], now: Date): Detected | null {
  const active = bots.filter((b) => b.isActive);
  const recent = active.some(
    (b) => b.lastWebhookAt && now.getTime() - b.lastWebhookAt.getTime() < WEBHOOK_SILENCE_MS,
  );
  const faulty = active.filter(
    (b) =>
      b.lastError ||
      (recent &&
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
  return {
    kind: "dm_blocked",
    severity: "WARNING",
    message: `${blockedLastHour} messages privés bloqués dans l'heure (membres ayant bloqué le bot ou fenêtres expirées)`,
    payload: { blockedLastHour },
  };
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

export type SpendSnapshot = { name: string; spend: number; registrations: number };

/** Dépense sans conversion : une campagne a coûté plus que le seuil sur 24 h sans aucune inscription rattachée. */
export function detectSpendNoConversion(
  items: SpendSnapshot[],
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): Detected | null {
  const hot = items.filter((i) => i.spend > t.spendNoConversionEur && i.registrations === 0);
  if (hot.length === 0) return null;
  const list = hot.map((i) => `${i.name} (${i.spend.toFixed(2)} €)`).join(", ");
  return {
    kind: "spend_no_conversion",
    severity: "WARNING",
    message: `Dépense sans inscription sur 24 h : ${list}. Vérifiez les liens d'entrée de la campagne et ses offres Link Affi.`,
    payload: {
      campaigns: hot.map((i) => ({ name: i.name, spend: i.spend })),
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

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(d);
}

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
export const REOPEN_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(["gate_links_missing"]);

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
