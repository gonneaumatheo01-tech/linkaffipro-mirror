/**
 * Page Agents → Bookmakers (phase 35) : libellés et calculs purs (testés dans bookmakers.test.ts). Vocabulaire du
 * client seulement : « méthode de lecture apprise », « lecture directe des données du site », « lecture de la page »,
 * « lecture de l'image » ; jamais le mot du moteur (voir tests/vocabulary).
 */

export const BOOKMAKERS_PATH = "/agents/bookmakers";

/** Gestes (tester, ré-apprendre, navigateur du Mac, adresse) : administrateurs seulement ; les autres lisent. */
export function canManageBookmakers(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

/** Clé d'un site reçue d'un formulaire : minuscules et chiffres, 2 à 40 caractères ; sinon null. */
export function safeSiteKey(v: unknown): string | null {
  return typeof v === "string" && /^[a-z0-9]{2,40}$/.test(v) ? v : null;
}

/** Qui lit le site. */
export function targetLabel(readTarget: string): string {
  if (readTarget === "mac") return "Le Mac";
  if (readTarget === "server") return "Le serveur";
  return "Le serveur (le Mac en secours)";
}

/** Chemin de lecture d'une cote ou d'une méthode apprise. */
export function levelLabel(level: string | null | undefined): string {
  if (level === "api") return "Lecture directe des données du site";
  if (level === "dom") return "Lecture de la page";
  if (level === "image") return "Lecture de l'image";
  return "—";
}

const JOB_KINDS: Record<string, string> = {
  learn: "Apprentissage du site",
  events: "Liste des matchs",
  markets: "Cotes d'un match",
  verify: "Double lecture d'une cote",
  capture: "Capture d'écran",
  test: "Test",
  visible: "Navigateur sur le Mac",
  "fetch-api": "Lecture directe",
  page: "Lecture d'une page",
  record: "Parcours guidé du site",
};

export function jobKindLabel(kind: string): string {
  return JOB_KINDS[kind] ?? "Lecture";
}

const CAUSES: Record<string, string> = {
  captcha: "le site demande un contrôle anti-robot",
  two_factor: "le site demande un code de connexion",
  password_refused: "le site refuse le mot de passe",
  moved: "le site ne répond plus à son adresse",
  geo_blocked: "le site refuse le serveur : lecture par le Mac",
  server_refused: "le site refuse le serveur",
  no_transport: "aucun lecteur disponible (serveur refusé, Mac éteint)",
  logged_out: "le site déconnecte le compte",
  maintenance: "le site est en maintenance",
  site_changed: "le site a changé",
  empty: "page vide",
  mac_absent: "le Mac ne lit pas en ce moment",
  mac_only: "le navigateur ne s'ouvre que sur le Mac",
  abandoned: "lecture abandonnée",
  night: "lecture reportée après 7 h",
  not_available: "pas encore disponible",
  error: "erreur pendant la lecture",
};

/** Cause lisible d'un échec (« captcha » → « le site demande un contrôle anti-robot »). */
export function causeLabel(cause: string | null | undefined): string | null {
  if (!cause) return null;
  return CAUSES[cause] ?? "le site n'a pas répondu comme prévu";
}

export type JobRow = {
  id: string;
  siteKey: string;
  kind: string;
  target: string;
  status: string;
  result: unknown;
  createdAt: Date;
  finishedAt: Date | null;
};

/** Résumé d'une lecture terminée, en une ligne (jamais de détail technique ni de secret). */
export function jobSummary(job: Pick<JobRow, "status" | "result">): string {
  if (job.status === "PENDING") return "En attente d'un lecteur";
  if (job.status === "CLAIMED") return "En cours";
  const r = (job.result ?? {}) as Record<string, unknown>;
  const v = (r.value && typeof r.value === "object" ? r.value : r) as Record<string, unknown>;
  const secs =
    typeof r.durationMs === "number" ? Math.max(1, Math.round(r.durationMs / 1000)) : null;
  const took = secs ? ` en ${secs} s` : "";
  const obstacle =
    typeof v.obstacle === "string"
      ? v.obstacle
      : typeof r.obstacle === "string"
        ? r.obstacle
        : null;
  if (obstacle || job.status === "FAILED" || job.status === "NEEDS_HUMAN" || v.ok === false) {
    const why =
      causeLabel(obstacle) ?? (job.status === "NEEDS_HUMAN" ? "attend votre aide" : "échec");
    return `${why.charAt(0).toUpperCase()}${why.slice(1)}${took}`;
  }
  const count = Array.isArray(v) ? v.length : typeof v.count === "number" ? v.count : null;
  return count !== null
    ? `${count} élément${count > 1 ? "s" : ""} lu${count > 1 ? "s" : ""}${took}`
    : `Réussi${took}`;
}

/** Contrôles de santé (`Setting bookmakers.health.<site>`) : réussite sur 24 h, `null` sans contrôle. */
export function rate24h(health: unknown, now: Date): { total: number; ratio: number | null } {
  const checks = Array.isArray((health as { checks?: unknown } | null)?.checks)
    ? (health as { checks: unknown[] }).checks
    : [];
  const since = now.getTime() - 24 * 3600_000;
  const recent = checks.filter(
    (c): c is { at: string; ok: unknown } =>
      !!c &&
      typeof c === "object" &&
      typeof (c as { at?: unknown }).at === "string" &&
      new Date((c as { at: string }).at).getTime() >= since,
  );
  const ok = recent.filter((c) => c.ok === true).length;
  return { total: recent.length, ratio: recent.length ? ok / recent.length : null };
}

const CREATED_BY: Record<string, string> = {
  learn: "apprise",
  repair: "réapprise toute seule",
  manual: "réapprise à la demande",
  reuse: "reprise d'un site au même moteur",
};

export type RecipeRow = {
  version: number;
  level: string;
  createdBy: string;
  createdAt: Date;
  mapping: unknown;
};

/** Méthode de lecture apprise active : version, chemin, origine, marchés reconnus (noms du site). */
export function recipeSummary(
  r: RecipeRow | null,
): { title: string; detail: string; markets: string[]; marketsCount: number } | null {
  if (!r) return null;
  const map = ((r.mapping as { marketMap?: unknown } | null)?.marketMap ?? {}) as Record<
    string,
    unknown
  >;
  const markets = Object.entries(map)
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k]) => k)
    .sort((a, b) => a.localeCompare(b, "fr"));
  return {
    title: `Version ${r.version} : ${levelLabel(r.level).toLowerCase()}`,
    detail: CREATED_BY[r.createdBy] ?? "apprise",
    markets: markets.slice(0, 12),
    marketsCount: markets.length,
  };
}

/** Moteur de paris détecté sur le site (« betby », « inconnu »). */
export function providerLabel(hint: string | null | undefined): string {
  if (!hint || hint === "inconnu") return "non reconnu";
  return hint.charAt(0).toUpperCase() + hint.slice(1);
}

export type PickGapRow = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  selectionLabel: string;
  marketLabel: string;
  odds: number;
  consensusOdds: number | null;
  kickoffAt: Date;
};

/** Écart site ↔ cote moyenne des autres bookmakers (%), et « inhabituelle » au-delà de 15 %. */
export function gapOf(
  p: Pick<PickGapRow, "odds" | "consensusOdds">,
): { pct: number; unusual: boolean } | null {
  if (!p.consensusOdds || p.consensusOdds <= 0 || !Number.isFinite(p.odds)) return null;
  const pct = Math.round(((p.odds - p.consensusOdds) / p.consensusOdds) * 1000) / 10;
  return { pct, unusual: Math.abs(pct) > 15 };
}

/** Cote au format français (1.85 → « 1,85 »). */
export function frOdds(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Le Mac lit-il (dernier passage il y a moins de 2 minutes) ? */
export function macFresh(hb: unknown, now: Date): { alive: boolean; at: Date | null } {
  const at =
    typeof (hb as { at?: unknown } | null)?.at === "string"
      ? new Date((hb as { at: string }).at)
      : null;
  const ok = !!at && Number.isFinite(at.getTime());
  return { alive: ok && now.getTime() - at!.getTime() < 2 * 60_000, at: ok ? at : null };
}

/** Identifiants d'un site : les siens, les communs, ou aucun. */
export function credentialsLabel(source: "site" | "default" | null): string {
  if (source === "site") return "Identifiants propres au site";
  if (source === "default") return "Identifiants communs";
  return "Aucun identifiant : Kevin vous les demande en privé";
}
