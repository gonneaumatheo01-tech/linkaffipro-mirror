import { describe, expect, it } from "vitest";
// Contrat lu directement (sans charger tout le paquet des agents).
import { MONTAGE_LIMITS } from "../../../../packages/agents/src/montage/contract";
import { AGENTS_JARGON, jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  BOT_DOWNLOAD_MAX_BYTES,
  assetThemes,
  canApproveClip,
  canCancelJob,
  canDecideClip,
  canModifyClip,
  canRejectClip,
  canManageMontage,
  clipCounts,
  clipCountsText,
  fmtClock,
  fmtDuration,
  fmtResolution,
  fmtSize,
  instructionLines,
  libraryHref,
  montageEngineResult,
  parseChange,
  parseLibraryKind,
  parseThemeFilter,
  playableInBrowser,
  qcView,
  safeMontageId,
  sourceInfo,
  telegramMessageLink,
  timelineItems,
} from "./montage";

describe("Montage : durées, poids, résolution", () => {
  it("horloge et durée en mots", () => {
    expect(fmtClock(150_000)).toBe("2:30");
    expect(fmtClock(3_725_000)).toBe("1:02:05");
    expect(fmtDuration(15_400)).toBe("15,4 s");
    expect(fmtDuration(2_832_000)).toBe("47 min 12 s");
    expect(fmtDuration(3_720_000)).toBe("1 h 02 min");
    expect(fmtDuration(null)).toBe("—");
  });

  it("poids et résolution", () => {
    expect(fmtSize(23.4 * 1024 * 1024)).toBe("23,4 Mo");
    expect(fmtSize(1.2 * 1024 ** 3)).toBe("1,2 Go");
    expect(fmtSize(850 * 1024)).toBe("850 Ko");
    expect(fmtResolution(1920, 1080)).toBe("1920 × 1080 (1080p)");
    expect(fmtResolution(1080, 1920)).toBe("1080 × 1920 (1080p)");
    expect(fmtResolution(null, 1080)).toBe("—");
  });

  it("source : lecture du fichier d'abord, sinon le média (durée en secondes)", () => {
    expect(sourceInfo({ durationMs: 2_832_000, width: 1920, height: 1080, sizeBytes: 900, fps: 29.97 }, null)).toEqual({
      durationMs: 2_832_000,
      width: 1920,
      height: 1080,
      sizeBytes: 900,
      fps: 29.97,
    });
    expect(sourceInfo(null, { size: 10, width: 1280, height: 720, duration: 60 })).toMatchObject({ durationMs: 60_000, width: 1280, sizeBytes: 10, fps: null });
  });
});

describe("Montage : droits, états, saisies", () => {
  it("seuls les administrateurs agissent", () => {
    expect(canManageMontage("ADMIN")).toBe(true);
    expect(canManageMontage("MANAGER")).toBe(false);
  });

  it("annuler tant que ce n'est pas fini ; décider un short dont l'aperçu existe", () => {
    expect(canCancelJob("CUTTING")).toBe(true);
    for (const s of ["DONE", "FAILED", "CANCELLED"]) expect(canCancelJob(s)).toBe(false);
    expect(canDecideClip("PREVIEW_SENT", "PREVIEW")).toBe(true);
    expect(canApproveClip("QC_FAILED", "PREVIEW")).toBe(false);
    expect(canRejectClip("QC_FAILED", "PREVIEW")).toBe(true);
    expect(canApproveClip("APPROVED", "PREVIEW")).toBe(false);
    expect(canModifyClip("APPROVED", "PREVIEW")).toBe(true);
    expect(canModifyClip("CUTTING", "CUTTING")).toBe(false);
    expect(canDecideClip("CUTTING", "CUTTING")).toBe(false);
    expect(canDecideClip("PREVIEW_SENT", "CANCELLED")).toBe(false);
  });

  it("identifiants et textes", () => {
    expect(safeMontageId("ck12_x")).toBe("ck12_x");
    expect(safeMontageId("../x")).toBeNull();
    expect(parseChange("  raccourcis   de 2 s ")).toBe("raccourcis de 2 s");
    expect(parseChange("ok")).toBeNull();
    expect(parseLibraryKind("SHORT")).toBe("SHORT");
    expect(parseLibraryKind("PHOTO")).toBe("ALL");
    expect(parseThemeFilter("roulette")).toBe("roulette");
    expect(parseThemeFilter("<script>")).toBeNull();
    expect(libraryHref("SHORT", "roulette")).toBe("/agents/montage?vue=mediatheque&type=SHORT&theme=roulette");
  });

  it("comptes des shorts (annulés exclus)", () => {
    const c = clipCounts(["APPROVED", "APPROVED", "PREVIEW_SENT", "REJECTED", "CANCELLED"]);
    expect(c).toEqual({ total: 4, approved: 2, toReview: 1, rejected: 1 });
    expect(clipCountsText(c)).toBe("2 validés sur 4");
    expect(clipCountsText(clipCounts([]))).toBe("aucun short pour l'instant");
  });

  it("résultat du moteur", () => {
    expect(montageEngineResult(undefined, "Fait.")).toEqual({ ok: true, message: "Fait." });
    expect(montageEngineResult({ ok: false, error: "Trop tard." }, "Fait.")).toEqual({ ok: false, message: "Trop tard." });
    expect(montageEngineResult({ ok: false }, "Fait.").message).toContain("Impossible pour l'instant");
    expect(montageEngineResult({ ok: false, reason: "Ce montage est déjà terminé." }, "Fait.")).toEqual({ ok: false, message: "Ce montage est déjà terminé." });
    // Réussite : la phrase du site, jamais celle de Kevin (qui tutoie).
    expect(montageEngineResult({ ok: true, message: "C'est noté, tu le retrouves ici." }, "Fait.")).toEqual({ ok: true, message: "Fait." });
  });
});

describe("Montage : consignes, frise, contrôle qualité", () => {
  it("consignes en lignes lisibles, sans mot technique", () => {
    const { rawText, lines } = instructionLines({
      theme: "roulette",
      format: "VERTICAL_9_16",
      durationTarget: 15,
      pipPosition: "TOP_RIGHT",
      subtitles: true,
      overlayText: "Jackpot !",
      count: null,
      speed: 1.5,
      rawText: "découpe ça, cam en haut à droite",
    });
    expect(rawText).toBe("découpe ça, cam en haut à droite");
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "Thème: roulette",
      "Format: Vertical (9:16)",
      "Durée visée: 15 s par short",
      "Nombre de shorts: choisi par l'équipe",
      "Caméra: Caméra en haut à droite",
      "Sous-titres: oui",
      "Texte incrusté: « Jackpot ! »",
      "Vitesse: × 1,5",
    ]);
    expect(instructionLines(null).lines.map((l) => l.label)).toEqual(["Format", "Nombre de shorts", "Caméra"]);
  });

  it("frise : moments placés sur la durée, triés, bornés", () => {
    const { totalMs, items } = timelineItems(
      [
        { id: "b", index: 2, startMs: 300_000, endMs: 315_000, score: 8 },
        { id: "a", index: 1, startMs: 150_000, endMs: 165_000, score: 9 },
      ],
      600_000,
    );
    expect(totalMs).toBe(600_000);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items[0]!.leftPct).toBe(25);
    expect(items[0]!.widthPct).toBeCloseTo(2.5);
    // Durée inconnue : la fin du dernier moment.
    expect(timelineItems([{ id: "a", index: 1, startMs: 0, endMs: 10_000, score: null }], null).totalMs).toBe(10_000);
  });

  it("contrôle qualité en clair", () => {
    const ok = qcView({ ok: true, durationMs: 15_200, width: 1080, height: 1920, sizeBytes: 24 * 1024 * 1024, blackSec: 0, silent: false, clipping: false, problems: [] });
    expect(ok).toEqual({ state: "ok", summary: "Contrôle réussi : 15,2 s, 1080 × 1920, 24 Mo, pas d'écran noir, son présent.", problems: [] });
    const bad = qcView({ ok: false, blackSec: 3.2, silent: true, problems: ["3,2 s de noir au début"] });
    expect(bad.state).toBe("failed");
    expect(bad.summary).toBe("Contrôle raté : 3,2 s d'écran noir, aucun son.");
    expect(bad.problems).toEqual(["3,2 s de noir au début"]);
    expect(qcView(null).state).toBe("none");
    for (const t of [ok.summary, bad.summary]) expect([...jargonIn(t), ...AGENTS_JARGON.filter((r) => r.re.test(t)).map((r) => r.word)]).toEqual([]);
  });
});

describe("Montage : lecture d'un short et médiathèque", () => {
  it("limite du bot = celle du contrat", () => {
    expect(BOT_DOWNLOAD_MAX_BYTES).toBe(MONTAGE_LIMITS.botDownloadMaxBytes);
  });

  it("lisible dans le navigateur : en base, ou dans Telegram jusqu'à 20 Mo", () => {
    expect(playableInBrowser({ storage: "db", size: 99 * 1024 * 1024 })).toBe(true);
    expect(playableInBrowser({ storage: "telegram", size: 19 * 1024 * 1024 })).toBe(true);
    expect(playableInBrowser({ storage: "telegram", size: 21 * 1024 * 1024 })).toBe(false);
    expect(playableInBrowser(null)).toBe(false);
  });

  it("lien du message : canal privé, nom public, conversation privée", () => {
    expect(telegramMessageLink({ chatId: "-1001234567890", messageId: 42 })).toBe("https://t.me/c/1234567890/42");
    expect(telegramMessageLink({ chatId: "-1001234567890", messageId: 42 }, "@media_lap")).toBe("https://t.me/media_lap/42");
    expect(telegramMessageLink({ chatId: "777", messageId: 42 })).toBeNull();
    expect(telegramMessageLink({ chatId: "-1001", messageId: 0 })).toBeNull();
    expect(telegramMessageLink(null)).toBeNull();
  });

  it("thèmes : colonne et tags « theme:<clé> »", () => {
    expect(assetThemes("roulette", ["theme:roulette", "theme:jackpot", "a-classer"])).toEqual(["roulette", "jackpot"]);
    expect(assetThemes(null, null)).toEqual([]);
  });
});
