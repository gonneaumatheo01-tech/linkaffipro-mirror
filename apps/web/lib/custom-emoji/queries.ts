/**
 * Lectures de la bibliothèque des emojis animés (phase 12) : sélecteur de l'éditeur, page Messages → Emojis animés,
 * état de l'import des packs du compte Telegram connecté.
 */
import { prisma, type CustomEmojiSource } from "@linkaffipro/db";
import { TELEGRAM_SESSION_ID } from "@linkaffipro/mtproto";
import type { PickerEmoji } from "./library";

/** Emojis visibles de la bibliothèque, pour le sélecteur (sans les fichiers d'aperçu). */
export async function listPickerEmojis(): Promise<PickerEmoji[]> {
  const rows = await prisma.customEmoji.findMany({
    where: { hiddenAt: null },
    orderBy: [{ setName: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      customEmojiId: true,
      fallback: true,
      setName: true,
      setTitle: true,
      format: true,
      previewMime: true,
      useCount: true,
      lastUsedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.customEmojiId,
    fallback: r.fallback,
    setName: r.setName,
    setTitle: r.setTitle,
    format: r.format,
    hasPreview: Boolean(r.previewMime),
    useCount: r.useCount,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

/** Emoji tel que la page de la bibliothèque l'affiche (détail au clic). */
export type LibraryEmoji = PickerEmoji & {
  rowId: string;
  source: CustomEmojiSource;
  addedByName: string | null;
  createdAt: string;
  hidden: boolean;
  previewError: string | null;
};

export type LibraryData = {
  emojis: LibraryEmoji[];
  visibleCount: number;
  hiddenCount: number;
  /** Aperçus pas encore récupérés (ou en échec) parmi les emojis visibles. */
  missingPreviews: number;
};

/** Bibliothèque : emojis visibles (ou retirés, pour un administrateur qui les affiche). */
export async function loadLibrary(opts: { hidden: boolean }): Promise<LibraryData> {
  const [rows, visibleCount, hiddenCount, missingPreviews] = await Promise.all([
    prisma.customEmoji.findMany({
      where: { hiddenAt: opts.hidden ? { not: null } : null },
      orderBy: [{ setName: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        customEmojiId: true,
        fallback: true,
        setName: true,
        setTitle: true,
        format: true,
        previewMime: true,
        previewError: true,
        useCount: true,
        lastUsedAt: true,
        source: true,
        createdAt: true,
        hiddenAt: true,
        addedBy: { select: { name: true } },
      },
    }),
    prisma.customEmoji.count({ where: { hiddenAt: null } }),
    prisma.customEmoji.count({ where: { hiddenAt: { not: null } } }),
    prisma.customEmoji.count({ where: { hiddenAt: null, previewMime: null } }),
  ]);
  return {
    emojis: rows.map((r) => ({
      rowId: r.id,
      id: r.customEmojiId,
      fallback: r.fallback,
      setName: r.setName,
      setTitle: r.setTitle,
      format: r.format,
      hasPreview: Boolean(r.previewMime),
      previewError: r.previewMime ? null : r.previewError,
      useCount: r.useCount,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      source: r.source,
      addedByName: r.addedBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      hidden: Boolean(r.hiddenAt),
    })),
    visibleCount,
    hiddenCount,
    missingPreviews,
  };
}

/**
 * Bots actifs auxquels transférer un message (nom d'utilisateur Telegram, sans « @ »). Jamais un bot assistant de
 * conversation (phase 17) : il ne reçoit pas les emojis animés de l'équipe.
 */
export async function activeBotUsernames(): Promise<Array<{ username: string; name: string }>> {
  return prisma.bot.findMany({
    where: { isActive: true, mode: "STANDARD" },
    orderBy: { createdAt: "asc" },
    select: { username: true, name: true },
  });
}

/** Une demande d'import est « en cours » pendant 10 minutes au plus (le worker la traite en une minute environ). */
export const IMPORT_RUNNING_MS = 10 * 60 * 1000;

export type AccountImportState = {
  /** Compte Telegram connecté (Réglages → Connexions → Telegram) : utilisable, à reconnecter, ou absent. */
  session: "active" | "error" | "none";
  sessionError: string | null;
  /** Dernière demande d'import (journal de l'équipe). */
  lastRequest: { at: string; byName: string | null } | null;
  /** Dernier import qui a ajouté des emojis (événement `custom_emoji.added`, source ACCOUNT). */
  lastImport: { at: string; count: number } | null;
  /** Demande faite il y a moins de 10 minutes, pas encore suivie d'un import. */
  running: boolean;
  /** Emojis venus du compte, visibles dans la bibliothèque. */
  accountEmojis: number;
};

/** Règle pure de l'état « en cours » (testée). */
export function importRunning(
  lastRequestAt: Date | null,
  lastImportAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastRequestAt) return false;
  if (now.getTime() - lastRequestAt.getTime() > IMPORT_RUNNING_MS) return false;
  return !lastImportAt || lastImportAt.getTime() < lastRequestAt.getTime();
}

export async function accountImportState(now: Date = new Date()): Promise<AccountImportState> {
  const [session, request, imported, accountEmojis] = await Promise.all([
    prisma.telegramUserSession.findUnique({
      where: { id: TELEGRAM_SESSION_ID },
      select: { status: true, lastError: true },
    }),
    prisma.auditLog.findFirst({
      where: { action: "custom_emoji.account_import_requested" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, user: { select: { name: true } } },
    }),
    prisma.event.findFirst({
      where: { type: "custom_emoji.added", payload: { path: ["source"], equals: "ACCOUNT" } },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, payload: true },
    }),
    prisma.customEmoji.count({ where: { source: "ACCOUNT", hiddenAt: null } }),
  ]);
  const count = Number((imported?.payload as { count?: unknown } | null)?.count ?? 0);
  return {
    session: !session
      ? "none"
      : session.status === "ACTIVE"
        ? "active"
        : session.status === "ERROR"
          ? "error"
          : "none",
    sessionError: session?.status === "ERROR" ? session.lastError : null,
    lastRequest: request
      ? { at: request.createdAt.toISOString(), byName: request.user?.name ?? null }
      : null,
    lastImport: imported
      ? { at: imported.occurredAt.toISOString(), count: Number.isFinite(count) ? count : 0 }
      : null,
    running: importRunning(request?.createdAt ?? null, imported?.occurredAt ?? null, now),
    accountEmojis,
  };
}
