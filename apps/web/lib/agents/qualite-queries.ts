/**
 * Lectures de la page Agents → Qualité (phase 30) : vérifications du contrôle qualité global (`QaCheck`), en LECTURE
 * SEULE. Le contenu vérifié (`content`, déjà masqué par le moteur) n'est lu que pour le détail d'une vérification, et
 * repasse par `maskedContentFields` avant l'affichage ; les listes ne lisent jamais le contenu.
 */
import { prisma, type Prisma } from "@linkaffipro/db";
import { dayBounds, maskQaText, type QaCheckLite, type QualiteFilters } from "./qualite";

const DAY_MS = 86_400_000;
/** Vérifications lues au plus pour un tableau de chiffres (les plus récentes). */
export const QUALITE_ROWS_LIMIT = 20_000;
export const HISTORY_PAGE_SIZE = 50;

const LITE_SELECT = { id: true, contentType: true, teamKey: true, verdict: true, reasons: true, durationMs: true, createdAt: true } as const;

/** Vérifications depuis `days` jours (chiffres du tableau de bord et des tendances). */
export async function loadQaRows(days: number, now = new Date()): Promise<QaCheckLite[]> {
  const rows = await prisma.qaCheck.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - days * DAY_MS) } },
    orderBy: { createdAt: "desc" },
    take: QUALITE_ROWS_LIMIT,
    select: LITE_SELECT,
  });
  return rows as QaCheckLite[];
}

export type QaState = { enabled: boolean; latest: Pick<QaCheckLite, "verdict" | "createdAt"> | null };

/** Réglage `qa.enabled` (vrai par défaut) et dernière vérification. */
export async function loadQaState(): Promise<QaState> {
  const [setting, latest] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "qa.enabled" } }),
    prisma.qaCheck.findFirst({ orderBy: { createdAt: "desc" }, select: { verdict: true, createdAt: true } }),
  ]);
  const v = setting?.value;
  return { enabled: v === undefined || v === null ? true : v !== false && v !== "false", latest };
}

function historyWhere(f: QualiteFilters): Prisma.QaCheckWhereInput {
  const range = dayBounds(f.from, f.to);
  return {
    ...(f.verdict ? { verdict: f.verdict } : {}),
    ...(f.type ? { contentType: f.type } : {}),
    ...(f.team ? { teamKey: f.team } : {}),
    ...(range.gte || range.lt ? { createdAt: range } : {}),
  };
}

export type HistoryRow = QaCheckLite & { contentId: string; attempt: number; label: string };

/** Nom court de chaque contenu (canal d'un post, numéro d'un short, titre d'un rapport), jamais son texte. */
async function contentLabels(rows: ReadonlyArray<{ id: string; contentType: string; contentId: string }>): Promise<Map<string, string>> {
  const ids = (t: string) => [...new Set(rows.filter((r) => r.contentType === t).map((r) => r.contentId))];
  const [posts, missions, clips, reports] = await Promise.all([
    ids("POST").length ? prisma.post.findMany({ where: { id: { in: ids("POST") } }, select: { id: true, channel: { select: { title: true } } } }) : [],
    ids("POST").length
      ? prisma.agentMission.findMany({
          where: { postId: { in: ids("POST") } },
          select: { postId: true, validations: { select: { number: true }, orderBy: { createdAt: "desc" }, take: 1 } },
        })
      : [],
    ids("SHORT").length ? prisma.shortClip.findMany({ where: { id: { in: ids("SHORT") } }, select: { id: true, index: true } }) : [],
    ids("REPORT").length ? prisma.strategyReport.findMany({ where: { id: { in: ids("REPORT") } }, select: { id: true, title: true } }) : [],
  ]);
  const postChannel = new Map(posts.map((p) => [p.id, p.channel.title]));
  const postNumber = new Map(missions.filter((m) => m.postId && m.validations[0]).map((m) => [m.postId!, m.validations[0]!.number]));
  const clipIndex = new Map(clips.map((c) => [c.id, c.index]));
  const reportTitle = new Map(reports.map((r) => [r.id, r.title]));
  const out = new Map<string, string>();
  for (const r of rows) {
    let label = "";
    if (r.contentType === "POST") {
      const n = postNumber.get(r.contentId);
      const ch = postChannel.get(r.contentId);
      label = [n ? `Post n° ${n}` : "Post", ch ? `sur ${ch}` : ""].filter(Boolean).join(" ");
    } else if (r.contentType === "SHORT") {
      const i = clipIndex.get(r.contentId);
      label = i ? `Short n° ${i}` : "Short";
    } else if (r.contentType === "REPORT") {
      const t = reportTitle.get(r.contentId);
      label = t ? maskQaText(t, 80) : "Rapport";
    }
    out.set(r.id, label);
  }
  return out;
}

/** Historique filtré, page par page (plus récentes d'abord). */
export async function loadHistory(f: QualiteFilters): Promise<{ rows: HistoryRow[]; total: number }> {
  const where = historyWhere(f);
  const [rows, total] = await Promise.all([
    prisma.qaCheck.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * HISTORY_PAGE_SIZE,
      take: HISTORY_PAGE_SIZE,
      select: { ...LITE_SELECT, contentId: true, attempt: true },
    }),
    prisma.qaCheck.count({ where }),
  ]);
  const labels = await contentLabels(rows);
  return { rows: rows.map((r) => ({ ...(r as QaCheckLite & { contentId: string; attempt: number }), label: labels.get(r.id) ?? "" })), total };
}

export type CheckDetail = HistoryRow & { corrections: unknown; content: unknown; modelUsed: string; checkedBy: string; previous: Array<{ id: string; verdict: string; attempt: number; createdAt: Date }> };

/** Détail d'une vérification (contenu masqué compris) et les autres vérifications du même contenu. */
export async function loadCheck(id: string): Promise<CheckDetail | null> {
  const row = await prisma.qaCheck.findUnique({
    where: { id },
    select: { ...LITE_SELECT, contentId: true, attempt: true, corrections: true, content: true, modelUsed: true, checkedBy: true },
  });
  if (!row) return null;
  const [labels, previous] = await Promise.all([
    contentLabels([row]),
    prisma.qaCheck.findMany({
      where: { contentType: row.contentType, contentId: row.contentId, NOT: { id: row.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, verdict: true, attempt: true, createdAt: true },
    }),
  ]);
  return { ...(row as CheckDetail), label: labels.get(row.id) ?? "", previous };
}

/** Équipes présentes dans les vérifications (liste du filtre). */
export async function loadQaTeams(): Promise<string[]> {
  const rows = await prisma.qaCheck.findMany({ distinct: ["teamKey"], select: { teamKey: true }, take: 50 });
  return rows.map((r) => r.teamKey).sort();
}
