/**
 * Tuiles « en un coup d'œil » de Réglages → État du système (fonction pure, testée dans health.test.ts) : site,
 * service d'arrière-plan, sauvegarde, bots, synchro Link Affi, alertes. Chaque tuile : une pastille (nuance + mot)
 * et une phrase courte. Les seuils reprennent ceux de la page : battement rouge au-delà de 3 minutes
 * (`worker.down`, calculé par le paquet queue), latence élevée au-delà de 150 ms ; une sauvegarde de plus de 36 h
 * (elle passe chaque nuit) est signalée « en retard ».
 *
 * Règle unique pour les trois écrans de Réglages : la carte « Bots » de Réglages, la page Bots et la tuile « Bots »
 * lisent l'état d'un bot avec `botCheck` (connexion vérifiée auprès de Telegram + dernière erreur du bot) ; la carte
 * « État du système » de Réglages compte les tuiles qui ne sont pas vertes (`healthSummary`), comme la page.
 */
import { fmtDate, fmtRelative } from "@/lib/format";
import { pointsLabel } from "@/lib/home/status";
import { LINKAFFI_STALE_MS, linkAffiState, plural, type CardState } from "./card-state";
import type { HealthInput } from "./queries";

export type HealthTileKey = "site" | "worker" | "backup" | "bots" | "sync" | "alerts";

export type HealthTile = {
  key: HealthTileKey;
  label: string;
  /** Terme technique au survol du titre. */
  term?: string;
  state: CardState;
  /** Une phrase courte sous la pastille. */
  detail: string;
};

export const DB_SLOW_MS = 150;
export const BACKUP_LATE_MS = 36 * 3_600_000;

type Input = HealthInput;

/** Ce qu'il faut savoir d'un bot pour son état : actif, dernière erreur, connexion lue chez Telegram (`null` si inactif). */
export type BotHealth = Pick<Input["bots"][number], "isActive" | "lastError" | "webhook">;

/**
 * État d'un bot : `off` inactif, `unreachable` Telegram ne répond pas (ou refuse le jeton), `check` connexion à
 * reposer (adresse différente ou erreur signalée par Telegram), `error` le bot a signalé une erreur en traitant un
 * message, `ok` tout va bien. Tout ce qui n'est ni `ok` ni `off` est « à vérifier ».
 */
export type BotCheck = "off" | "unreachable" | "check" | "error" | "ok";

export function botCheck(b: BotHealth): BotCheck {
  if (!b.isActive) return "off";
  if (b.webhook?.fetchError) return "unreachable";
  if (!b.webhook?.ok) return "check";
  if (b.lastError) return "error";
  return "ok";
}

function siteTile(web: Input["web"]): HealthTile {
  const base = { key: "site" as const, label: "Site" };
  if (web.db !== "ok" || web.redis !== "ok")
    return {
      ...base,
      state: { tone: "danger", label: "En panne" },
      detail:
        web.db !== "ok"
          ? "La base de données ne répond pas."
          : "La mémoire des files (Redis) ne répond pas.",
    };
  const ms = web.dbLatencyMs;
  if (ms !== null && ms > DB_SLOW_MS)
    return {
      ...base,
      state: { tone: "warning", label: "Lent" },
      detail: `Base de données à ${Math.round(ms)} ms : vérifiez la région du service.`,
    };
  return {
    ...base,
    state: { tone: "success", label: "En ligne" },
    detail: ms !== null ? `Base de données en ${Math.round(ms)} ms.` : "Base de données joignable.",
  };
}

function workerTile(worker: Input["worker"], now: Date): HealthTile {
  const base = { key: "worker" as const, label: "Service d'arrière-plan", term: "worker" };
  const hb = worker.heartbeat;
  if (!hb)
    return worker.error
      ? {
          ...base,
          state: { tone: "danger", label: "Injoignable" },
          detail: "Impossible de lire son signe de vie.",
        }
      : {
          ...base,
          state: { tone: "muted", label: "Inconnu" },
          detail: "Aucun signe de vie connu pour l'instant.",
        };
  const age = fmtRelative(new Date(hb.at), now);
  if (worker.down)
    return {
      ...base,
      state: { tone: "danger", label: "Arrêté" },
      detail: `Dernier signe de vie ${age} : envois et synchro à l'arrêt.`,
    };
  return {
    ...base,
    state: { tone: "success", label: "En marche" },
    detail: `Signe de vie ${age}.`,
  };
}

function backupTile(backup: Input["backup"], now: Date): HealthTile {
  const base = { key: "backup" as const, label: "Sauvegarde" };
  if (!backup)
    return {
      ...base,
      state: { tone: "muted", label: "Aucune" },
      detail: "Sauvegarde automatique chaque nuit à 4 h (Paris).",
    };
  if (!backup.ok)
    return {
      ...base,
      state: { tone: "danger", label: "En échec" },
      detail: backup.at ? `Dernier essai le ${fmtDate(backup.at)}.` : "Le dernier essai a échoué.",
    };
  if (backup.at && now.getTime() - backup.at.getTime() > BACKUP_LATE_MS)
    return {
      ...base,
      state: { tone: "warning", label: "En retard" },
      detail: `Dernière sauvegarde ${fmtRelative(backup.at, now)}.`,
    };
  return {
    ...base,
    state: { tone: "success", label: "Faite" },
    detail: backup.at
      ? `Dernière sauvegarde ${fmtRelative(backup.at, now)}.`
      : "Sauvegarde réussie.",
  };
}

/** Tuile « Bots » : aussi la pastille de la carte Bots de Réglages et de l'en-tête de la page Bots. */
export function botsTile(bots: readonly BotHealth[]): HealthTile {
  const base = { key: "bots" as const, label: "Bots" };
  if (bots.length === 0)
    return {
      ...base,
      state: { tone: "warning", label: "Aucun bot" },
      detail: "Ajoutez un bot dans Réglages → Bots.",
    };
  const active = bots.filter((b) => b.isActive);
  const toCheck = active.filter((b) => botCheck(b) !== "ok").length;
  const detail = `${plural(active.length, "bot actif", "bots actifs")} sur ${bots.length}.`;
  if (active.length === 0)
    return { ...base, state: { tone: "warning", label: "Aucun actif" }, detail };
  if (toCheck > 0)
    return {
      ...base,
      state: { tone: "danger", label: toCheck === 1 ? "1 à vérifier" : `${toCheck} à vérifier` },
      detail,
    };
  return {
    ...base,
    state: { tone: "success", label: active.length === 1 ? "En ligne" : "Tous en ligne" },
    detail,
  };
}

function syncTile(sync: Input["syncStates"], now: Date): HealthTile {
  const base = { key: "sync" as const, label: "Synchro Link Affi" };
  const failing = sync.filter((s) => s.lastError).length;
  if (failing > 0)
    return {
      ...base,
      state: { tone: "danger", label: "En échec" },
      detail: `${plural(failing, "donnée en erreur", "données en erreur")} sur ${sync.length}.`,
    };
  // Même règle que la carte Réglages (« Synchronisé il y a 2 min », en retard au-delà de 15 min).
  const s = linkAffiState(sync, now);
  if (!s || s.tone === "muted")
    return {
      ...base,
      state: { tone: "muted", label: "Pas encore" },
      detail: "La première synchro démarre dans les 2 minutes.",
    };
  return {
    ...base,
    state: { tone: s.tone, label: s.tone === "warning" ? "En retard" : "À jour" },
    detail: `${s.label}.`,
  };
}

/** État d'une ligne du tableau « Synchro Link Affi » : `late` quand son dernier succès est trop ancien. */
export type SyncRowState = "running" | "error" | "late" | "ok" | "never";

/**
 * État d'une donnée Link Affi dans le tableau d'État du système, avec le même seuil que la tuile « Synchro Link
 * Affi » (`LINKAFFI_STALE_MS`, 15 minutes) : la tuile « En retard » ne côtoie jamais des lignes « OK ».
 */
export function syncRowState(
  s: { isRunning: boolean; lastError: string | null; lastSuccessAt: Date | null },
  now: Date,
): SyncRowState {
  if (s.isRunning) return "running";
  if (s.lastError) return "error";
  if (!s.lastSuccessAt) return "never";
  return now.getTime() - s.lastSuccessAt.getTime() > LINKAFFI_STALE_MS ? "late" : "ok";
}

function alertsTile(alerts: Input["openAlerts"]): HealthTile {
  const base = { key: "alerts" as const, label: "Alertes" };
  if (alerts.length === 0)
    return {
      ...base,
      state: { tone: "success", label: "Aucune" },
      detail: "Aucune alerte ouverte.",
    };
  const critical = alerts.filter((a) => a.severity === "CRITICAL").length;
  return {
    ...base,
    state: {
      tone: critical > 0 ? "danger" : "warning",
      label: plural(alerts.length, "ouverte", "ouvertes"),
    },
    detail:
      critical > 0
        ? `Dont ${plural(critical, "critique", "critiques")} : voir la liste ci-dessous.`
        : "Voir la liste ci-dessous.",
  };
}

export function healthTiles(s: Input, now: Date): HealthTile[] {
  return [
    siteTile(s.web),
    workerTile(s.worker, now),
    backupTile(s.backup, now),
    botsTile(s.bots),
    syncTile(s.syncStates, now),
    alertsTile(s.openAlerts),
  ];
}

/**
 * Résumé des tuiles : « Tout va bien » si toutes sont vertes, sinon « N points à voir » (N = tuiles qui ne sont pas
 * vertes, rouge si l'une est rouge). Affiché sur la carte « État du système » de Réglages et en tête de la page.
 */
export function healthSummary(tiles: readonly HealthTile[]): CardState & { points: number } {
  const issues = tiles.filter((t) => t.state.tone !== "success");
  if (issues.length === 0) return { tone: "success", label: "Tout va bien", points: 0 };
  return {
    tone: issues.some((t) => t.state.tone === "danger") ? "danger" : "warning",
    label: pointsLabel(issues.length),
    title: issues.map((t) => `${t.label} : ${t.state.label}`).join(" · "),
    points: issues.length,
  };
}
