/**
 * Phase 28, chantier E — crochets de Kevin branchés sur la chaîne du montage (`MontageHooks` de `runtime.ts`,
 * chantier D) : la chaîne les appelle dans le worker, Kevin parle au client dans la conversation du travail
 * (`MontageJob.chatId`, le privé de l'admin) par le bot de Kevin.
 * - `onPlanReady` : plan de coupe (découpé s'il est trop long), Kevin attend la réponse (« ok », « enlève le 3 ») ;
 * - `onSubtitleDoubt` : une question à la fois, un bouton par variante + « autre » ;
 * - `onQcFailed` : phrase simple + « Refaire » / « Me le montrer » (jamais publié sans ✅) ;
 * - `onPreviewReady` : la vidéo (identifiant de fichier du bot de Kevin, pas de ré-envoi) + légende + ✅ ✏️ ❌ ;
 * - `onFailed` : phrase simple, jamais une erreur technique brute.
 */
import type { AdminButton } from "../types";
import type { QcReport, UncertainSegment } from "./contract";
import type { KevinMontageDeps } from "./kevin-port";
import { readMontageAwait, setMontageAwait } from "./kevin-state";
import { planMessages, type PlanClip } from "./plan-message";
import { doubtOptions, failedText, PREVIEW_VARIANTS, previewButtons, previewCaption, qcButtons, qcFailedText, subtitleDoubtButtons, subtitleDoubtText } from "./preview";
import type { MontageHooks, MontagePipelineDeps, MontageJobRow, ShortClipRow, StoredShort } from "./runtime";
import { pick } from "../boss/voice";

type Deps = MontagePipelineDeps & KevinMontageDeps;

const nowIso = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date()).toISOString();

/** Envoie un texte dans la conversation du travail (privé de l'admin) ; rend l'identifiant du message. */
async function say(deps: Deps, chatId: string | null, html: string, buttons?: AdminButton[][]): Promise<number | null> {
  if (!deps.admin) return null;
  const opts = buttons?.length ? { buttons } : {};
  const r = chatId && deps.admin.sendTo ? await deps.admin.sendTo(BigInt(chatId), html, opts) : await deps.admin.send(html, opts);
  return r?.messageId ?? null;
}

async function totalOf(deps: Deps, jobId: string): Promise<number> {
  const rows = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId } })) as Array<{ status: string }>;
  return rows.filter((r) => r.status !== "CANCELLED").length;
}

function sourceSecondsOf(job: MontageJobRow): number | null {
  const meta = job.sourceMeta as { durationMs?: unknown } | null;
  return meta && typeof meta.durationMs === "number" ? meta.durationMs / 1000 : null;
}

/** Les crochets de Kevin (à passer dans `deps.montage.hooks` du worker). */
export function createKevinMontageHooks(): Required<MontageHooks> {
  return KEVIN_HOOKS;
}

/** Même chose, sous le nom attendu par le worker (`montageKevinHooks(deps)`, `apps/worker/src/montage/deps.ts`). */
export function montageKevinHooks(_deps?: unknown): Required<MontageHooks> {
  return KEVIN_HOOKS;
}

const KEVIN_HOOKS: Required<MontageHooks> = (() => {
  return {
    async onPlanReady(rawDeps, job, clips) {
      const deps = rawDeps as Deps;
      const list: PlanClip[] = clips
        .filter((c) => c.status !== "CANCELLED")
        .map((c) => ({ index: c.index, startMs: c.startMs, endMs: c.endMs, description: c.description, score: c.score }));
      const parts = planMessages(list, sourceSecondsOf(job), job.chatId);
      const ids: number[] = [];
      for (const p of parts) {
        const id = await say(deps, job.chatId, p);
        if (id) ids.push(id);
      }
      if (job.chatId && list.length) await setMontageAwait(deps, job.chatId, { kind: "plan", jobId: job.id, at: nowIso(deps), messageIds: ids });
      return { messageId: ids[ids.length - 1] ?? null };
    },

    async onSubtitleDoubt(rawDeps, job, clip, uncertain: UncertainSegment[]) {
      const deps = rawDeps as Deps;
      // Une question à la fois : le premier passage ; les suivants viendront après la réponse.
      const u = uncertain[0];
      if (!u) return;
      const options = doubtOptions(u);
      const text = subtitleDoubtText({ atMs: u.atMs, text: u.text, alternatives: options }, clip.index, job.chatId);
      await say(deps, job.chatId, text, subtitleDoubtButtons(clip.id, u.index, options));
    },

    async onQcFailed(rawDeps, job, clip: ShortClipRow, report: QcReport) {
      const deps = rawDeps as Deps;
      await say(deps, job.chatId, qcFailedText(clip.index, report, job.chatId), qcButtons(clip.id, !!clip.assetId));
    },

    async onPreviewReady(rawDeps, job, clip, short: StoredShort) {
      const deps = rawDeps as Deps;
      const total = await totalOf(deps, job.id);
      const caption = previewCaption(
        { index: clip.index, total, durationMs: short.durationMs || clip.durationMs, format: clip.format, sizeBytes: short.sizeBytes, description: clip.description, compressed: short.compressed },
        job.chatId,
      );
      const buttons = previewButtons(clip.id);
      let messageId: number | null = null;
      const admin = deps.admin;
      const send =
        deps.sendStoredVideo ??
        (admin?.sendStoredVideo ? (req: Parameters<NonNullable<Deps["sendStoredVideo"]>>[0]) => admin.sendStoredVideo!(BigInt(req.chatId), req) : null);
      if (send && job.chatId) {
        try {
          messageId = (await send({ chatId: job.chatId, assetId: short.assetId, fileId: short.fileId || null, caption, buttons }))?.messageId ?? null;
        } catch (err) {
          deps.logger?.warn({ err: (err as Error).message }, "[montage] aperçu vidéo non envoyé");
        }
      }
      // Vidéo impossible à envoyer : même légende, mêmes boutons, la vidéo est sur la page Montage du site.
      if (!messageId) messageId = await say(deps, job.chatId, `${caption}\n${pick(PREVIEW_VARIANTS.noVideo({ index: clip.index }), "montage.preview.novideo", job.chatId)}`, buttons);
      // Une modification ou un sous-titre en cours de réponse garde la main (la phrase suivante est pour lui).
      const busy = job.chatId ? await readMontageAwait(deps, job.chatId) : null;
      if (job.chatId && busy?.kind !== "edit" && busy?.kind !== "subtitle")
        await setMontageAwait(deps, job.chatId, { kind: "previews", jobId: job.id, at: nowIso(deps), ...(messageId ? { messageIds: [messageId] } : {}) });
      return { messageId };
    },

    async onFailed(rawDeps, job, reason, clip) {
      const deps = rawDeps as Deps;
      await say(deps, job.chatId, failedText(reason, job.chatId, clip ? clip.index : null));
    },
  };
})();
