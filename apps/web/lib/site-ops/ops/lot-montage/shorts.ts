/**
 * Phase 28 (règle de la phase 34) — cœurs uniques de la page Agents → Montage, appelés par le site ET par Kevin,
 * administrateurs seulement :
 * - « Valider » / « Refuser » un short : `decideShort` de Kevin, MÊME effet que les boutons ✅ / ❌ de l'aperçu
 *   (refusé = archivé, jamais supprimé) ;
 * - « Modifier » un short : `redoClip` de la chaîne, avec la modification écrite (« raccourcis de 2 secondes ») ;
 * - « Annuler le montage » : `cancelJob` de la chaîne.
 * Mêmes validations et mêmes textes pour le site et Kevin ; essai à blanc (`dryRun`) qui ne lit que la base, n'écrit
 * rien et n'appelle aucun moteur ; journal (`AuditLog`, métadonnée `via`) à chaque geste, réussi ou non.
 * Module SANS « use server » et sans `next/*`.
 */
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import {
  canApproveClip,
  canCancelJob,
  canRejectClip,
  canManageMontage,
  canModifyClip,
  montageEngineResult,
  parseChange,
  parseReason,
  safeMontageId,
  MODIFY_MAX,
  MODIFY_MIN,
} from "@/lib/agents/montage";
import { loadMontageEngine } from "@/lib/agents/montage-engine";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, str, type CoreRun, type Fail } from "../lot-d/kit";

export const NOT_YET = "Pas encore disponible : réessayez après la prochaine mise à jour du site.";
export const ADMIN_ONLY_SHORT = "Valider, modifier ou refuser un short est réservé aux administrateurs.";
export const ADMIN_ONLY_CANCEL = "Annuler un montage est réservé aux administrateurs.";

async function clipOf(id: string) {
  return prisma.shortClip.findUnique({
    where: { id },
    select: { id: true, index: true, status: true, montageJobId: true, montageJob: { select: { status: true, shortCount: true } } },
  });
}

type Clip = NonNullable<Awaited<ReturnType<typeof clipOf>>>;

async function checkedClip(fd: FormData, actor: Parameters<CoreRun>[1]): Promise<{ ok: true; clip: Clip } | { ok: false; result: Fail }> {
  if (!canManageMontage(actor.role)) return { ok: false, result: forbidden(ADMIN_ONLY_SHORT) };
  const clipId = safeMontageId(fd.get("clipId"));
  if (!clipId) return { ok: false, result: fail("Short inconnu.", "invalid", "clipId") };
  const clip = await clipOf(clipId);
  if (!clip) return { ok: false, result: fail("Ce short n'existe plus.", "not_found") };
  return { ok: true, clip };
}

const shortName = (c: Clip) => `Le short ${c.index}`;

function decide(decision: "ok" | "no"): CoreRun {
  return async (fd, actor, opts = {}) => {
    const c = await checkedClip(fd, actor);
    if (!c.ok) return c.result;
    const { clip } = c;
    const jobStatus = String(clip.montageJob.status);
    const status = String(clip.status);
    const allowed = decision === "ok" ? canApproveClip(status, jobStatus) : canRejectClip(status, jobStatus);
    if (!allowed) {
      if (jobStatus === "CANCELLED" || jobStatus === "FAILED") return fail("Ce montage est arrêté : plus rien à décider.", "conflict");
      if (status === "APPROVED" || status === "REJECTED")
        return fail(`${shortName(clip)} est déjà ${status === "APPROVED" ? "validé" : "refusé"} : pour changer d'avis, demandez une modification.`, "conflict");
      return fail(`${shortName(clip)} n'est pas encore prêt : attendez son aperçu.`, "conflict");
    }
    const reason = decision === "no" ? parseReason(fd.get("reason")) : null;
    const done =
      decision === "ok"
        ? `${shortName(clip)} est validé : il est prêt dans la médiathèque. Rien n'est publié sans vous.`
        : `${shortName(clip)} est refusé : il est archivé, pas supprimé.`;
    if (opts.dryRun) return preview(decision === "ok" ? `Valider ${shortName(clip).toLowerCase()}.` : `Refuser ${shortName(clip).toLowerCase()} (archivé, pas supprimé).`);
    let result = { ok: false, message: "" };
    try {
      const engine = await loadMontageEngine();
      if (!engine.decideShort) return fail(NOT_YET, "unavailable");
      result = montageEngineResult(await engine.decideShort(buildAgentsDeps(), clip.id, decision, engineActor(actor), reason), done);
      await audit({
        userId: actor.userId,
        action: decision === "ok" ? "agents.montage_short_approved" : "agents.montage_short_rejected",
        entityType: "ShortClip",
        entityId: clip.id,
        metadata: { montageJobId: clip.montageJobId, index: clip.index, previousStatus: status, ...(reason ? { reason } : {}), ok: result.ok, via: actor.via },
      });
    } catch (err) {
      return fail(`Décision impossible pour l'instant : ${errorText(err)}.`, "unavailable");
    }
    return result.ok ? ok(result.message) : fail(result.message, "conflict");
  };
}

export const runApproveShort: CoreRun = decide("ok");
export const runRejectShort: CoreRun = decide("no");

export const runModifyShort: CoreRun = async (fd, actor, opts = {}) => {
  const c = await checkedClip(fd, actor);
  if (!c.ok) return c.result;
  const { clip } = c;
  const change = parseChange(fd.get("change"));
  if (!change) return fail(`Dites ce qu'il faut changer (${MODIFY_MIN} à ${MODIFY_MAX} caractères), par exemple « raccourcis de 2 secondes ».`, "invalid", "change");
  const jobStatus = String(clip.montageJob.status);
  const status = String(clip.status);
  if (!canModifyClip(status, jobStatus))
    return fail(
      jobStatus === "CANCELLED" || jobStatus === "FAILED" ? "Ce montage est arrêté : plus rien à modifier." : `${shortName(clip)} est déjà en cours de fabrication.`,
      "conflict",
    );
  if (opts.dryRun) return preview(`Refaire ${shortName(clip).toLowerCase()} : « ${change} ». Un nouvel aperçu arrive ensuite.`);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadMontageEngine();
    if (!engine.redoClip) return fail(NOT_YET, "unavailable");
    result = montageEngineResult(
      await engine.redoClip(buildAgentsDeps(), clip.id, change, engineActor(actor)),
      `${shortName(clip)} est en cours de modification : Kevin vous envoie le nouvel aperçu.`,
    );
    await audit({
      userId: actor.userId,
      action: "agents.montage_short_modified",
      entityType: "ShortClip",
      entityId: clip.id,
      metadata: { montageJobId: clip.montageJobId, index: clip.index, change, previousStatus: status, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Modification impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

export const runCancelMontage: CoreRun = async (fd, actor, opts = {}) => {
  if (!canManageMontage(actor.role)) return forbidden(ADMIN_ONLY_CANCEL);
  const jobId = safeMontageId(fd.get("jobId"));
  if (!jobId) return fail("Montage inconnu.", "invalid", "jobId");
  const job = await prisma.montageJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, shorts: { select: { status: true } } },
  });
  if (!job) return fail("Ce montage n'existe plus.", "not_found");
  const status = String(job.status);
  if (!canCancelJob(status)) return fail("Ce montage est déjà fini, en échec ou annulé : rien à annuler.", "conflict");
  const approved = job.shorts.filter((s) => String(s.status) === "APPROVED").length;
  const kept = approved === 1 ? " Le short déjà validé reste dans la médiathèque." : approved > 1 ? ` Les ${approved} shorts déjà validés restent dans la médiathèque.` : "";
  if (opts.dryRun) return preview(`Annuler ce montage : les shorts pas encore faits sont abandonnés.${kept}`);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadMontageEngine();
    if (!engine.cancelJob) return fail(NOT_YET, "unavailable");
    result = montageEngineResult(await engine.cancelJob(buildAgentsDeps(), job.id, engineActor(actor)), `Montage annulé : les shorts pas encore faits sont abandonnés.${kept}`);
    await audit({
      userId: actor.userId,
      action: "agents.montage_cancelled",
      entityType: "MontageJob",
      entityId: job.id,
      metadata: { previousStatus: status, approved, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Annulation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/**
 * Montage désigné par Kevin : identifiant, ou rien / « dernier » / « en cours » = le plus récent (en cours d'abord).
 */
export async function resolveMontage(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const s = str(raw).trim();
  const id = safeMontageId(s);
  if (id && !/^(dernier|en_cours|encours|courant)$/i.test(s)) {
    const job = await prisma.montageJob.findUnique({ where: { id }, select: { id: true } });
    if (job) return { ok: true, id: job.id };
  }
  const live = await prisma.montageJob.findFirst({
    where: { status: { notIn: ["DONE", "FAILED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const job = live ?? (await prisma.montageJob.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }));
  if (!job) return { ok: false, result: fail("Aucun montage pour l'instant : envoyez une vidéo à Kevin.", "not_found", "montage") };
  return { ok: true, id: job.id };
}

/** Short désigné par Kevin : numéro (« le 3 ») dans le montage donné (le plus récent par défaut), ou identifiant. */
export async function resolveShort(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const raw = input.short ?? input.numero ?? input.clipId;
  const n = typeof raw === "number" ? raw : Number(str(raw).replace(/[^\d]/g, ""));
  if (typeof raw === "string" && safeMontageId(raw) && !/^\d+$/.test(raw)) {
    const clip = await prisma.shortClip.findUnique({ where: { id: raw }, select: { id: true } });
    if (clip) return { ok: true, id: clip.id };
  }
  if (!Number.isInteger(n) || n < 1) return { ok: false, result: fail("Quel short ? Donnez son numéro (« le 3 »).", "invalid", "short") };
  const job = await resolveMontage(input.montage);
  if (!job.ok) return job;
  const clip = await prisma.shortClip.findFirst({ where: { montageJobId: job.id, index: n }, select: { id: true } });
  if (!clip) return { ok: false, result: fail(`Pas de short ${n} dans ce montage.`, "not_found", "short") };
  return { ok: true, id: clip.id };
}

export async function kevinShortForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveShort(input);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ clipId: r.id, change: input.modification ?? input.change, reason: input.raison ?? input.reason }) };
}

export async function kevinMontageForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveMontage(input.montage ?? input.jobId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ jobId: r.id }) };
}
