/**
 * Agents → Montage (phase 28) : fonctions pures de la page (adresses, droits, durées, poids, plan de coupe en frise,
 * contrôle qualité en clair, lien vers le message Telegram d'un short). Testées dans `montage.test.ts`.
 *
 * Vocabulaire : jamais le nom de l'outil de montage, ni « codec », « CRF », « SRT » ou « burn-in » en surface ; on dit
 * « qualité », « format », « sous-titres ».
 */
/** `MONTAGE_LIMITS.botDownloadMaxBytes` du contrat (20 Mo : un bot ne télécharge pas plus) ; égalité vérifiée par le test. */
export const BOT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

export const MONTAGE_PATH = "/agents/montage";

export function montageHref(id: string): string {
  return `${MONTAGE_PATH}/${encodeURIComponent(id)}`;
}

export function shortPlayerSrc(clipId: string): string {
  return `/api/agents/montage/short/${encodeURIComponent(clipId)}`;
}

/** Valider, modifier, refuser un short ou annuler un montage : administrateurs seulement (les responsables lisent). */
export function canManageMontage(role: string): boolean {
  return role === "ADMIN";
}

/** Identifiant venant d'un formulaire ou d'une adresse (clé de la base). */
export function safeMontageId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── Durées, poids, résolution ─────────────────────────────────────────────────────────────────────────────────

/** « 2:05 » (moins d'une heure) ou « 1:02:05 ». */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Durée en mots : « 15 s », « 15,4 s », « 47 min 12 s », « 1 h 02 min ». */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) {
    const s = Math.round(ms / 100) / 10;
    return `${s.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  }
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** Poids lisible : « 850 Ko », « 23,4 Mo », « 1,2 Go ». */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const f = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (bytes >= 1024 ** 3) return `${f(bytes / 1024 ** 3)} Go`;
  if (bytes >= 1024 ** 2) return `${f(bytes / 1024 ** 2)} Mo`;
  return `${f(Math.max(1, bytes / 1024))} Ko`;
}

/** « 1920 × 1080 (1080p) » ; « — » si inconnue. Le « p » suit le petit côté (qualité usuelle). */
export function fmtResolution(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return "—";
  return `${width} × ${height} (${Math.min(width, height)}p)`;
}

// ── Source (métadonnées lues à la réception) ──────────────────────────────────────────────────────────────────

export type SourceInfo = { durationMs: number | null; width: number | null; height: number | null; sizeBytes: number | null; fps: number | null };

/** `MontageJob.sourceMeta` (lecture du fichier) complété par le `MediaAsset` (durée en secondes, poids). */
export function sourceInfo(
  meta: unknown,
  asset: { size?: number | null; width?: number | null; height?: number | null; duration?: number | null } | null,
): SourceInfo {
  const m = isObj(meta) ? meta : {};
  const durationMs = num(m.durationMs) ?? (asset?.duration ? asset.duration * 1000 : null);
  return {
    durationMs,
    width: num(m.width) ?? asset?.width ?? null,
    height: num(m.height) ?? asset?.height ?? null,
    sizeBytes: num(m.sizeBytes) ?? (asset?.size ? asset.size : null),
    fps: num(m.fps),
  };
}

// ── Instructions du client ────────────────────────────────────────────────────────────────────────────────────

export const FORMAT_LABELS: Record<string, string> = {
  VERTICAL_9_16: "Vertical (9:16)",
  HORIZONTAL_16_9: "Horizontal (16:9)",
  SQUARE_1_1: "Carré (1:1)",
};

export const PIP_LABELS: Record<string, string> = {
  TOP_RIGHT: "Caméra en haut à droite",
  TOP_LEFT: "Caméra en haut à gauche",
  BOTTOM_RIGHT: "Caméra en bas à droite",
  BOTTOM_LEFT: "Caméra en bas à gauche",
  NONE: "Sans caméra incrustée",
};

export function formatLabel(v: string | null | undefined): string {
  return (v && FORMAT_LABELS[v]) || "Vertical (9:16)";
}

export function pipLabel(v: string | null | undefined): string {
  return (v && PIP_LABELS[v]) || PIP_LABELS.NONE!;
}

export type InstructionLine = { label: string; value: string };

/** Les consignes comprises par Kevin, en lignes lisibles (champs absents ignorés). */
export function instructionLines(raw: unknown): { rawText: string | null; lines: InstructionLine[] } {
  const i = isObj(raw) ? raw : {};
  const lines: InstructionLine[] = [];
  const theme = text(i.theme);
  if (theme) lines.push({ label: "Thème", value: theme });
  lines.push({ label: "Format", value: formatLabel(text(i.format)) });
  const target = num(i.durationTarget);
  if (target) lines.push({ label: "Durée visée", value: `${target} s par short` });
  const count = num(i.count);
  lines.push({ label: "Nombre de shorts", value: count ? String(count) : "choisi par l'équipe" });
  lines.push({ label: "Caméra", value: pipLabel(text(i.pipPosition)) });
  if (typeof i.subtitles === "boolean") lines.push({ label: "Sous-titres", value: i.subtitles ? "oui" : "non" });
  const overlay = text(i.overlayText);
  if (overlay) lines.push({ label: "Texte incrusté", value: `« ${overlay} »` });
  const speed = num(i.speed);
  if (speed && speed !== 1) lines.push({ label: "Vitesse", value: `× ${speed.toLocaleString("fr-FR")}` });
  return { rawText: text(i.rawText), lines };
}

export function instructionTheme(raw: unknown): string | null {
  return isObj(raw) ? text(raw.theme) : null;
}

// ── Shorts : comptes, décisions possibles ─────────────────────────────────────────────────────────────────────

export type ClipCounts = { total: number; approved: number; toReview: number; rejected: number };

export function clipCounts(statuses: readonly string[]): ClipCounts {
  const live = statuses.filter((s) => s !== "CANCELLED");
  return {
    total: live.length,
    approved: live.filter((s) => s === "APPROVED").length,
    toReview: live.filter((s) => s === "PREVIEW_SENT").length,
    rejected: live.filter((s) => s === "REJECTED").length,
  };
}

/** « 3 validés sur 12 » ; « aucun short pour l'instant ». */
export function clipCountsText(c: ClipCounts): string {
  if (c.total === 0) return "aucun short pour l'instant";
  return `${c.approved} validé${c.approved > 1 ? "s" : ""} sur ${c.total}`;
}

const ENDED_JOB = new Set(["DONE", "FAILED", "CANCELLED"]);

/** Un montage s'annule tant qu'il n'est ni fini, ni en échec, ni déjà annulé. */
export function canCancelJob(status: string): boolean {
  return !ENDED_JOB.has(status);
}

export function jobIsLive(status: string): boolean {
  return !ENDED_JOB.has(status);
}

const STOPPED_JOB = new Set(["CANCELLED", "FAILED"]);

/** Valider : seulement un short dont l'aperçu a été envoyé (même règle que les boutons de Kevin : rien sans aperçu). */
export function canApproveClip(clipStatus: string, jobStatus: string): boolean {
  return !STOPPED_JOB.has(jobStatus) && clipStatus === "PREVIEW_SENT";
}

/** Refuser : un short en aperçu, ou dont le contrôle qualité a échoué. */
export function canRejectClip(clipStatus: string, jobStatus: string): boolean {
  return !STOPPED_JOB.has(jobStatus) && (clipStatus === "PREVIEW_SENT" || clipStatus === "QC_FAILED");
}

/** Valider ou refuser possible (l'un des deux). */
export function canDecideClip(clipStatus: string, jobStatus: string): boolean {
  return canApproveClip(clipStatus, jobStatus) || canRejectClip(clipStatus, jobStatus);
}

/** Modifier : un short déjà fabriqué (aperçu envoyé, validé, refusé ou contrôle raté) ; il est refait. */
export function canModifyClip(clipStatus: string, jobStatus: string): boolean {
  return !STOPPED_JOB.has(jobStatus) && ["PREVIEW_SENT", "APPROVED", "REJECTED", "QC_FAILED"].includes(clipStatus);
}

export const MODIFY_MIN = 3;
export const MODIFY_MAX = 500;

/** Texte d'une modification demandée (« raccourcis de 2 secondes ») : 3 à 500 caractères. */
export function parseChange(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length >= MODIFY_MIN && s.length <= MODIFY_MAX ? s : null;
}

/** Raison facultative d'un refus (300 caractères au plus). */
export function parseReason(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, 300) : null;
}

// ── Plan de coupe en frise ────────────────────────────────────────────────────────────────────────────────────

export type TimelineItem = { id: string; index: number; leftPct: number; widthPct: number; startMs: number; endMs: number; score: number | null };

/** Place chaque moment sur la durée de la source (pourcentages bornés, largeur visible au moins 0,6 %). */
export function timelineItems(
  clips: ReadonlyArray<{ id: string; index: number; startMs: number; endMs: number; score: number | null }>,
  durationMs: number | null,
): { totalMs: number; items: TimelineItem[] } {
  const maxEnd = clips.reduce((m, c) => Math.max(m, c.endMs), 0);
  const totalMs = Math.max(durationMs ?? 0, maxEnd, 1);
  const pct = (v: number) => Math.min(100, Math.max(0, (v / totalMs) * 100));
  const items = [...clips]
    .sort((a, b) => a.startMs - b.startMs)
    .map((c) => {
      const leftPct = pct(c.startMs);
      const widthPct = Math.max(0.6, Math.min(100 - leftPct, pct(c.endMs) - leftPct));
      return { id: c.id, index: c.index, leftPct, widthPct, startMs: c.startMs, endMs: c.endMs, score: c.score };
    });
  return { totalMs, items };
}

/** Graduations de la frise : 0, quarts, fin. */
export function timelineTicks(totalMs: number): Array<{ pct: number; label: string }> {
  return [0, 25, 50, 75, 100].map((pct) => ({ pct, label: fmtClock((totalMs * pct) / 100) }));
}

// ── Contrôle qualité en clair ─────────────────────────────────────────────────────────────────────────────────

export type QcView = { state: "ok" | "failed" | "none"; summary: string; problems: string[] };

/** `ShortClip.qc` (rapport du contrôle) → une phrase et les problèmes en français courant. */
export function qcView(qc: unknown): QcView {
  if (!isObj(qc)) return { state: "none", summary: "Pas encore contrôlé.", problems: [] };
  const problems = Array.isArray(qc.problems) ? qc.problems.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  const parts: string[] = [];
  const d = num(qc.durationMs);
  if (d != null) parts.push(fmtDuration(d));
  const w = num(qc.width);
  const h = num(qc.height);
  if (w && h) parts.push(`${w} × ${h}`);
  const size = num(qc.sizeBytes);
  if (size != null) parts.push(fmtSize(size));
  const black = num(qc.blackSec);
  if (black != null) parts.push(black > 0 ? `${black.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s d'écran noir` : "pas d'écran noir");
  if (typeof qc.silent === "boolean") parts.push(qc.silent ? "aucun son" : "son présent");
  if (qc.clipping === true) parts.push("son qui sature");
  const ok = qc.ok === true && problems.length === 0;
  const head = ok ? "Contrôle réussi" : "Contrôle raté";
  return { state: ok ? "ok" : "failed", summary: parts.length ? `${head} : ${parts.join(", ")}.` : `${head}.`, problems };
}

// ── Lecture d'un short : dans le navigateur ou dans Telegram ──────────────────────────────────────────────────

/** `telegramRef` d'un média gardé dans Telegram : conversation et message (chaînes). */
export function telegramRefOf(ref: unknown): { chatId: string | null; messageId: number | null } {
  if (!isObj(ref)) return { chatId: null, messageId: null };
  const chatId = typeof ref.chatId === "string" || typeof ref.chatId === "number" || typeof ref.chatId === "bigint" ? String(ref.chatId) : null;
  const mid = typeof ref.messageId === "number" ? ref.messageId : typeof ref.messageId === "string" ? Number(ref.messageId) : NaN;
  return { chatId, messageId: Number.isInteger(mid) && mid > 0 ? mid : null };
}

/**
 * Lien vers le message d'un canal (la Médiathèque) : `https://t.me/c/<numéro>/<message>` pour un canal privé
 * (identifiant « -100… »), `https://t.me/<nom>/<message>` si son nom public est connu. Null pour une conversation
 * privée (pas de lien stable).
 */
export function telegramMessageLink(ref: unknown, username?: string | null): string | null {
  const { chatId, messageId } = telegramRefOf(ref);
  if (!messageId) return null;
  const u = username?.trim().replace(/^@/, "");
  if (u && /^[A-Za-z0-9_]{4,64}$/.test(u)) return `https://t.me/${u}/${messageId}`;
  if (chatId && /^-100\d+$/.test(chatId)) return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  return null;
}

/**
 * Un short se lit dans le navigateur s'il est en base, ou s'il est gardé dans Telegram et assez léger pour que le bot
 * le récupère (20 Mo, limite de téléchargement d'un bot). Au-delà : « ouvrez-le dans Telegram ».
 */
export function playableInBrowser(asset: { storage: string; size: number } | null): boolean {
  if (!asset) return false;
  if (asset.storage !== "telegram") return true;
  return asset.size > 0 && asset.size <= BOT_DOWNLOAD_MAX_BYTES;
}

export const TOO_BIG_TEXT = "Ce short est trop lourd pour être lu ici : ouvrez-le dans Telegram.";

// ── Médiathèque : filtre par type et par thème ────────────────────────────────────────────────────────────────

export type LibraryKind = "SHORT" | "LONG_VIDEO" | "ALL";

export function parseLibraryKind(v: unknown): LibraryKind {
  return v === "SHORT" || v === "LONG_VIDEO" ? v : "ALL";
}

export function parseThemeFilter(v: unknown): string | null {
  return typeof v === "string" && /^[\p{L}\p{N} _'-]{1,40}$/u.test(v.trim()) ? v.trim() : null;
}

/** Thème d'un média : colonne `theme`, sinon le mot-clé `theme:<clé>` de ses tags. */
export function assetThemes(theme: string | null, tags: unknown): string[] {
  const out = new Set<string>();
  if (theme) out.add(theme);
  if (Array.isArray(tags)) for (const t of tags) if (typeof t === "string" && t.startsWith("theme:") && t.length > 6) out.add(t.slice(6));
  return [...out];
}

export function libraryHref(kind: LibraryKind, theme: string | null): string {
  const q = new URLSearchParams({ vue: "mediatheque" });
  if (kind !== "ALL") q.set("type", kind);
  if (theme) q.set("theme", theme);
  return `${MONTAGE_PATH}?${q.toString()}`;
}

/**
 * Résultat d'une fonction de l'équipe : `{ ok, message | error | reason }` ou rien (succès). Réussite : toujours la
 * phrase du site (les messages de Kevin tutoient, le site vouvoie) ; refus : la raison donnée par l'équipe.
 */
export function montageEngineResult(r: unknown, fallback: string): { ok: boolean; message: string } {
  if (isObj(r)) {
    const ok = typeof r.ok === "boolean" ? r.ok : true;
    if (ok) return { ok, message: fallback };
    const msg = text(r.message) ?? text(r.error) ?? text(r.reason);
    return { ok, message: msg ?? "Impossible pour l'instant : réessayez dans un moment." };
  }
  return { ok: true, message: fallback };
}
