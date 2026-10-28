/**
 * Kevin met une persona à la place de la personne d'une vidéo reçue (base en mémoire, faux fournisseur vidéo, faux
 * téléchargement et faux envoi, aucun réseau) : phrase reconnue sans IA, contrôles avant la question (pas de vidéo,
 * trop longue, persona sans photo, pas de clé, plafond atteint), OUI → file, lancement, relectures, envoi au seul chat de
 * l'admin, dépense de l'équipe Rencontres, échec, abandon après 15 minutes, double lancement refusé, état, annulation,
 * reprise après un lancement coupé, légende de la vidéo, voix.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_TG_ID } from "../human/test-kit";
import { rememberVideo, readMontageState, type ReceivedVideo } from "../montage/kevin-state";
import { receiveMontageVideo } from "../montage/reception";
import type { VideoJobRef, VideoPoll, VideoProvider } from "../providers/video";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import { bossFastPath } from "./fast";
import { createBossKit, type BossKit } from "./testing";
import { looksLikeReplaceRequest, videoIaIntentOf } from "./video-ia-intent";
import { cancelReplace, pollReplace, replaceStatus, submitReplace, type VideoIaDeps } from "./video-ia-run";
import { readVideoIaState, writeVideoIaState } from "./video-ia-state";
import { VIDEO_IA_VARIANTS } from "./video-ia-texts";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts } from "./voice";

const CHAT = ADMIN_TG_ID.toString();

type FakeVideo = VideoProvider & {
  started: number;
  cancels: number;
  next: VideoPoll;
  startError: Error | null;
  cancelOk: boolean;
};

function fakeVideo(): FakeVideo {
  const v: FakeVideo = {
    name: "fal",
    started: 0,
    cancels: 0,
    next: { status: "queued" },
    startError: null,
    cancelOk: true,
    // 10 centimes par seconde : 12 s → 1,20 €.
    estimateCents: ({ durationSec }) => Math.round(durationSec * 10),
    async startReplace(input) {
      if (v.startError) throw v.startError;
      v.started++;
      return { jobId: `job-${v.started}`, estimatedCents: Math.round(input.durationSec * 10), ref: { statusUrl: "https://exemple/status", cancelUrl: "https://exemple/cancel" } };
    },
    async poll(_id: string, _ref?: VideoJobRef) {
      return v.next;
    },
    async download() {
      return { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "video/mp4", filename: "resultat.mp4" };
    },
    async cancel() {
      v.cancels++;
      return { cancelled: v.cancelOk };
    },
  };
  return v;
}

let mid = 700;
function received(extra: Partial<ReceivedVideo> = {}, at = new Date("2026-10-23T08:00:00Z")): ReceivedVideo {
  mid++;
  return { messageId: mid, fileId: `f${mid}`, fileUniqueId: `u${mid}`, sizeBytes: 3 * 1024 * 1024, durationSec: 12, width: 1080, height: 1920, mimeType: "video/mp4", fileName: "danse.mp4", botId: "bot-kevin", forwarded: false, receivedAt: at.toISOString(), ...extra };
}

async function setup(opts: { reference?: boolean; provider?: boolean; budget?: number } = {}) {
  const kit = await createBossKit();
  const p = kit.prisma;
  if (opts.reference !== false) {
    const img = (await p.mediaAsset.create({ data: { filename: "lea.png", mimeType: "image/png", size: 4, sha256: "lea-ref", bytes: Buffer.from([9, 9, 9, 9]) } as never })) as { id: string };
    await p.persona.update({ where: { id: kit.ids.lea }, data: { referenceImageIds: [img.id] } as never });
  }
  if (opts.budget !== undefined) await p.agentTeamConfig.upsert({ where: { teamKey: "dating" }, create: { teamKey: "dating", monthlyBudgetCents: { video: opts.budget } }, update: { monthlyBudgetCents: { video: opts.budget } } } as never);
  const video = fakeVideo();
  const workDir = await mkdtemp(join(tmpdir(), "video-ia-"));
  const downloads: Array<{ chatId: string; messageId: number }> = [];
  const sentVideos: Array<{ chatId: string; caption: string }> = [];
  const queued: Array<{ job: { type: string; chatId: string }; opts?: { jobId?: string; delayMs?: number } }> = [];
  const deps: VideoIaDeps = {
    ...kit.deps,
    ...(opts.provider === false ? {} : { mediaProviders: { video } }),
    downloadTelegramFile: async (ref, dest) => {
      downloads.push({ chatId: ref.chatId, messageId: ref.messageId });
      await writeFile(dest, Buffer.alloc(ref.sizeBytes ?? 10, 1));
    },
    sendVideo: vi.fn(async (req) => {
      sentVideos.push({ chatId: req.chatId, caption: req.caption });
      return { messageId: 1, fileId: "out", fileUniqueId: "out-u" };
    }),
    montage: {
      workDir,
      enqueue: (async (job: { type: string; chatId: string }, o?: { jobId?: string; delayMs?: number }) => {
        queued.push({ job, ...(o ? { opts: o } : {}) });
      }) as never,
    },
  };
  return { kit, deps, video, downloads, sentVideos, queued };
}

const text = (r: unknown) => String((r as { reply?: string }).reply ?? "");
const say = (kit: BossKit, t: string) => kit.input(t);

async function usageCents(kit: BossKit): Promise<number> {
  const rows = (await kit.prisma.agentUsage.findMany({ where: { teamKey: "dating", provider: "video" } })) as Array<{ cents: number }>;
  return rows.reduce((s, r) => s + r.cents, 0);
}

beforeEach(() => resetVoiceRotation());

describe("reconnaissance de la demande (pur)", () => {
  it("prend les façons de dire, jamais un canal ou un lien", () => {
    expect(looksLikeReplaceRequest("mets Léa à la place de la personne dans cette vidéo")).toBe(true);
    expect(looksLikeReplaceRequest("remplace la fille par Léa")).toBe(true);
    expect(looksLikeReplaceRequest("Léa à la place du mec dans la vidéo stp")).toBe(true);
    expect(looksLikeReplaceRequest("remplace Léa par Emma sur le canal Rencontres")).toBe(false);
    expect(looksLikeReplaceRequest("remplace le lien de l'offre")).toBe(false);
    expect(looksLikeReplaceRequest("découpe ça en shorts de 15 secondes")).toBe(false);
    expect(videoIaIntentOf("où en est le remplacement ?")).toBe("status");
    expect(videoIaIntentOf("annule le remplacement")).toBe("cancel");
  });

  it("au catalogue ; lancer et annuler réservés à l'admin, l'état ouvert aux membres", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["remplacer_personne", "remplacement_status", "annuler_remplacement"]));
    const member = { kind: "member" as const, telegramUserId: 7n, memberId: "m", role: "MANAGER" as const, firstName: "Sam" };
    const by = (k: string) => BOSS_CATALOG.find((a) => a.key === k)!;
    expect(bossActionAllowed(by("remplacer_personne"), member)).toBe(false);
    expect(bossActionAllowed(by("annuler_remplacement"), member)).toBe(false);
    expect(by("remplacer_personne").cls).toBe("confirm");
  });
});

describe("contrôles avant la question", () => {
  it("pas de vidéo reçue : l'interprète s'en charge (le chemin rapide passe)", async () => {
    const t = await setup();
    const r = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(r.handled).toBe(false);
    // Par l'action elle-même (interprète) : « envoie-moi d'abord la vidéo ».
    const action = BOSS_CATALOG.find((a) => a.key === "remplacer_personne")!;
    const { runBossAction } = await import("./execute");
    const res = await runBossAction(t.deps, action, { persona: "Léa" }, { actor: { userId: null, via: "TELEGRAM" } });
    expect(text(res)).toMatch(/vidéo d'abord|d'abord la vidéo/);
  });

  it("vidéo de plus de 15 s : refus avec conseil, aucune question", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received({ durationSec: 47 }));
    const r = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(r)).toMatch(/47 s/);
    expect(text(r)).not.toMatch(/OUI/);
  });

  it("persona sans photo de référence", async () => {
    const t = await setup({ reference: false });
    await rememberVideo(t.deps, CHAT, received());
    const r = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(r)).toMatch(/photo de référence de Léa|Léa n'a pas encore de photo/);
  });

  it("sans clé du service : refus clair (jamais la simulation)", async () => {
    const t = await setup({ provider: false });
    await rememberVideo(t.deps, CHAT, received());
    const r = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(r)).toMatch(/clé du service de vidéo/);
  });

  it("plafond vidéo de l'équipe Rencontres atteint", async () => {
    const t = await setup({ budget: 500 });
    await t.kit.prisma.agentUsage.create({ data: { teamKey: "dating", provider: "video", month: "2026-10", cents: 450, calls: 3 } as never });
    await rememberVideo(t.deps, CHAT, received());
    const r = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(r)).toMatch(/plafond vidéo/);
    expect(text(r)).toMatch(/1,2 €/);
  });

  it("sans nom de persona : Kevin demande laquelle", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    const r = await bossFastPath(t.deps, say(t.kit, "remplace la fille dans la vidéo"));
    expect(text(r)).toMatch(/Quelle persona/);
  });
});

describe("de la demande à la vidéo", () => {
  it("OUI → lancé ; relectures ; vidéo envoyée au seul chat de l'admin ; dépense Rencontres", async () => {
    const t = await setup();
    const v = received();
    await rememberVideo(t.deps, CHAT, v);
    const ask = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(ask)).toMatch(/Léa/);
    expect(text(ask)).toMatch(/12 s/);
    expect(text(ask)).toMatch(/1,2 €/);
    expect(text(ask)).toMatch(/OUI/);
    expect(t.video.started).toBe(0);

    const yes = await bossFastPath(t.deps, say(t.kit, "OUI"));
    expect(text(yes)).toMatch(/lancé|m'en occupe/);
    expect(t.queued.map((q) => q.job.type)).toEqual(["video-ia.submit"]);
    expect((await readVideoIaState(t.deps, CHAT))?.status).toBe("queued");
    // La vidéo est prise : ni le montage ni un second remplacement ne la reprennent.
    expect((await readMontageState(t.deps, CHAT)).videos?.[0]?.jobId).toMatch(/^video-ia:/);

    await submitReplace(t.deps, CHAT);
    expect(t.downloads).toEqual([{ chatId: CHAT, messageId: v.messageId }]);
    expect(t.video.started).toBe(1);
    expect((await readVideoIaState(t.deps, CHAT))?.status).toBe("running");
    expect(t.queued[1]).toMatchObject({ job: { type: "video-ia.poll", chatId: CHAT }, opts: { delayMs: 30_000 } });

    // Rejouée par BullMQ : jamais une seconde soumission.
    await submitReplace(t.deps, CHAT);
    expect(t.video.started).toBe(1);

    t.kit.advance(30_000);
    t.video.next = { status: "running" };
    await pollReplace(t.deps, CHAT);
    expect(t.queued[2]).toMatchObject({ job: { type: "video-ia.poll" }, opts: { delayMs: 60_000 } });
    expect(await replaceStatus(t.deps, CHAT)).toMatch(/Léa/);

    t.kit.advance(60_000);
    t.video.next = { status: "done", outputUrl: "https://exemple/out.mp4", actualCents: 95 };
    await pollReplace(t.deps, CHAT);
    expect(t.sentVideos).toHaveLength(1);
    expect(t.sentVideos[0]!.chatId).toBe(CHAT);
    expect(t.sentVideos[0]!.caption).toMatch(/Léa.*rien n'est publié/);
    expect(await readVideoIaState(t.deps, CHAT)).toBeNull();
    expect(await usageCents(t.kit)).toBe(95);
    // Rien d'autre n'est envoyé (aucun canal) et aucune dépense au Boss.
    const boss = (await t.kit.prisma.agentUsage.findMany({ where: { teamKey: "boss" } })) as unknown[];
    expect(boss).toHaveLength(0);
  });

  it("un seul remplacement à la fois", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    await bossFastPath(t.deps, say(t.kit, "OUI"));
    await rememberVideo(t.deps, CHAT, received());
    const again = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    expect(text(again)).toMatch(/déjà/);
  });

  it("échec chez le fournisseur : message clair, rien de facturé, la vidéo redevient libre", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    await bossFastPath(t.deps, say(t.kit, "OUI"));
    await submitReplace(t.deps, CHAT);
    t.video.next = { status: "failed", error: "pose illisible" };
    await pollReplace(t.deps, CHAT);
    expect(t.kit.sent.at(-1)?.html).toMatch(/n'a pas abouti|pas marché/);
    expect(await readVideoIaState(t.deps, CHAT)).toBeNull();
    expect(await usageCents(t.kit)).toBe(0);
    expect((await readMontageState(t.deps, CHAT)).videos?.[0]?.jobId ?? null).toBeNull();
    expect(t.sentVideos).toHaveLength(0);
  });

  it("toujours en cours après 15 minutes : annulé chez le fournisseur, prévenu", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    await bossFastPath(t.deps, say(t.kit, "OUI"));
    await submitReplace(t.deps, CHAT);
    t.video.next = { status: "running" };
    for (let i = 0; i < 16; i++) {
      t.kit.advance(60_000);
      await pollReplace(t.deps, CHAT);
    }
    expect(t.video.cancels).toBe(1);
    expect(t.kit.sent.at(-1)?.html).toMatch(/15 minutes/);
    expect(await readVideoIaState(t.deps, CHAT)).toBeNull();
    expect(await usageCents(t.kit)).toBe(0);
  });

  it("annulation par l'admin : arrêt demandé, estimation comptée si l'arrêt n'est pas confirmé", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    await bossFastPath(t.deps, say(t.kit, "OUI"));
    await submitReplace(t.deps, CHAT);
    t.video.cancelOk = false;
    const r = await bossFastPath(t.deps, say(t.kit, "annule le remplacement"));
    expect(text(r)).toMatch(/arrêté/);
    expect(t.video.cancels).toBe(1);
    expect(await usageCents(t.kit)).toBe(120);
    expect(await cancelReplace(t.deps, CHAT)).toMatch(/Aucun|pas de remplacement/);
  });

  it("annulé avant le lancement : la soumission ne part jamais", async () => {
    const t = await setup();
    await rememberVideo(t.deps, CHAT, received());
    await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo"));
    await bossFastPath(t.deps, say(t.kit, "OUI"));
    expect(await cancelReplace(t.deps, CHAT)).toMatch(/arrêté|annulé/);
    await submitReplace(t.deps, CHAT);
    expect(t.video.started).toBe(0);
  });

  it("lancement coupé entre l'appel payant et l'enregistrement : jamais resoumis, estimation comptée", async () => {
    const t = await setup();
    const v = received();
    await writeVideoIaState(t.deps, {
      status: "submitting",
      chatId: CHAT,
      personaId: t.kit.ids.lea,
      personaName: "Léa",
      video: v,
      resolution: "580p",
      durationSec: 12,
      estimatedCents: 120,
      requestedAt: new Date("2026-10-23T08:00:00Z").toISOString(),
      provider: "fal",
      polls: 0,
    });
    await submitReplace(t.deps, CHAT);
    expect(t.video.started).toBe(0);
    expect(await usageCents(t.kit)).toBe(120);
    expect(t.kit.sent.at(-1)?.html).toMatch(/coupé/);
  });
});

describe("phrase écrite sous la vidéo", () => {
  it("la légende part comme une demande à Kevin, pas comme un montage", async () => {
    const t = await setup();
    const r = await receiveMontageVideo(t.deps as never, {
      chatId: CHAT,
      video: { messageId: 900, fileId: "f900", fileUniqueId: "u900", sizeBytes: 2_000_000, durationSec: 15, width: 1080, height: 1920, mimeType: "video/mp4", fileName: null, asDocument: false },
      botId: "bot-kevin",
      forwarded: false,
      caption: "mets Léa à la place de la personne dans cette vidéo de 15 secondes",
    });
    expect(r).toEqual({ action: "text", text: "mets Léa à la place de la personne dans cette vidéo de 15 secondes" });
    const ask = await bossFastPath(t.deps, say(t.kit, "mets Léa à la place de la personne dans cette vidéo de 15 secondes"));
    expect(text(ask)).toMatch(/OUI/);
  });
});

describe("voix", () => {
  it("chaque texte passe voiceCheck et ne nomme jamais le fournisseur", () => {
    for (const [key, entry] of Object.entries(VIDEO_IA_VARIANTS)) {
      const { texts, rules } = voiceEntryTexts(entry);
      for (const t of texts) {
        expect(voiceCheck(t, rules).problems, `${key} : ${t}`).toEqual([]);
        expect(t).not.toMatch(/\bfal\b|wan|worker|\bfile\b/i);
      }
    }
  });
});
