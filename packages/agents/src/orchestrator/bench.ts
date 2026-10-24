/**
 * Banc d'essai vidéo (CONTRAT phase 20, propriétaire : chantier A). `startBench` vérifie (clés, persona, image de
 * référence, vidéos sources, plafond vidéo) et enfile la tâche `agents-orchestrator` `bench` ; `runBench` (worker)
 * soumet les essais — chaque vidéo source × chaque réglage disponible (fal 580p, fal 720p, Magic Hour si clé) — puis
 * se ré-enfile toutes les 30 s pour relire les travaux (jamais d'attente bloquante dans la file du Grand Chef).
 * Chaque résultat part à l'admin avec son coût et sa durée de traitement ; à la fin, une demande CHOICE « lequel
 * préfères-tu ? » dont la réponse règle le fournisseur et la résolution par défaut de l'équipe Rencontres.
 * Rien sans clé : message clair. État gardé dans `Setting` `agents.bench.<id>`, écrit juste après CHAQUE soumission
 * réussie (un redémarrage ne refait jamais un essai payant) ; une erreur sur un essai n'arrête pas les autres ; rien
 * n'est soumis pendant une pause (équipe Rencontres ou pause générale).
 */
import { escapeHtml } from "@linkaffipro/core";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { readSecret } from "../human/secrets";
import { storeProducedMedia } from "../agents/media-ia/store";
import type { EngineDeps } from "../missions/context";
import { loadTeamSettings } from "../missions/settings";
import { monthUsage, recordUsage } from "../missions/usage";
import { createFalClient, createFalVideoProvider } from "../providers/fal";
import { createMagicHourVideoProvider } from "../providers/magichour";
import { FAL_SECRET_KEY, MAGICHOUR_SECRET_KEY, mediaSettings } from "../providers/registry";
import type { ProviderFile, VideoJobRef, VideoProvider, VideoResolution } from "../providers/video";
import type { AgentsDeps } from "../types";
import { maybeAlertBudget } from "./budgets";
import { isTeamHalted } from "./pause";

export const BENCH_SETTING_PREFIX = "agents.bench.";
export const BENCH_LAST_KEY = "agents.bench.last";
export const BENCH_POLL_MS = 30_000;
/** Un essai encore en cours après 20 minutes est abandonné. */
export const BENCH_ITEM_TIMEOUT_MS = 20 * 60_000;
export const BENCH_CHOICE_ACTION = "bench-choice";

export type BenchConfig = { provider: "fal" | "magichour"; resolution: VideoResolution; label: string };

/** Réglages essayés selon les clés présentes (pur). */
export function benchConfigs(keys: { fal: boolean; magichour: boolean }): BenchConfig[] {
  const out: BenchConfig[] = [];
  if (keys.fal) out.push({ provider: "fal", resolution: "580p", label: "fal.ai 580p" }, { provider: "fal", resolution: "720p", label: "fal.ai 720p" });
  if (keys.magichour) out.push({ provider: "magichour", resolution: "580p", label: "Magic Hour (visage seulement)" });
  return out;
}

type BenchItem = {
  config: number;
  sourceAssetId: string;
  durationSec: number;
  status: "pending" | "running" | "done" | "failed";
  estimatedCents: number;
  jobId?: string;
  ref?: VideoJobRef;
  submittedAt?: string;
  cents?: number;
  durationMs?: number;
  assetId?: string;
  error?: string;
};

export type BenchState = {
  id: string;
  personaId: string;
  personaName: string;
  createdAt: string;
  configs: BenchConfig[];
  items: BenchItem[];
  finishedAt?: string;
  byUserId?: string | null;
};

const eur = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

type Prepared =
  | { ok: false; message: string }
  | {
      ok: true;
      persona: { id: string; name: string; referenceImageId: string };
      sources: Array<{ id: string; durationSec: number }>;
      configs: BenchConfig[];
      estimatedCents: number;
      keys: { fal: string | null; magichour: string | null };
    };

async function prepare(deps: AgentsDeps, personaId: string, count: number): Promise<Prepared> {
  const [fal, magichour] = await Promise.all([readSecret(deps.prisma, FAL_SECRET_KEY), readSecret(deps.prisma, MAGICHOUR_SECRET_KEY)]);
  const configs = benchConfigs({ fal: !!fal, magichour: !!magichour });
  if (!configs.length)
    return { ok: false, message: "Banc d'essai impossible : aucune clé fal.ai ni Magic Hour. Colle la clé fal.ai dans Agents → Réglages (ou réponds à la question du bot), puis relance." };
  const persona = await deps.prisma.persona.findUnique({ where: { id: personaId }, select: { id: true, name: true, referenceImageIds: true } });
  if (!persona) return { ok: false, message: "Persona introuvable." };
  const refs = Array.isArray(persona.referenceImageIds) ? persona.referenceImageIds.filter((x): x is string => typeof x === "string") : [];
  if (!refs[0]) return { ok: false, message: `Banc d'essai impossible : ${persona.name} n'a pas d'image de référence (envoie une photo avec #dating #reference au bot, ou dépose-la dans la fiche persona).` };
  const rows = await deps.prisma.mediaAsset.findMany({
    where: { personaId, kind: "SOURCE", mimeType: { startsWith: "video/" } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(10, count)),
    select: { id: true, duration: true },
  });
  if (!rows.length) return { ok: false, message: `Banc d'essai impossible : aucune vidéo source pour ${persona.name} (envoie des vidéos avec #dating #source au bot).` };
  const settings = await loadTeamSettings(deps.prisma, "dating");
  const max = mediaSettings(settings).maxVideoSeconds;
  const sources = rows.map((r) => ({ id: r.id, durationSec: r.duration && r.duration > 0 ? Math.min(r.duration, max) : max }));
  const estimatedCents = configs.reduce(
    (sum, c) => sum + sources.reduce((s, src) => s + providerFor(c, { fal, magichour }, settings.settings).estimateCents({ durationSec: src.durationSec, fps: null, resolution: c.resolution }), 0),
    0,
  );
  return { ok: true, persona: { id: persona.id, name: persona.name, referenceImageId: refs[0] }, sources, configs, estimatedCents, keys: { fal, magichour } };
}

function providerFor(c: BenchConfig, keys: { fal: string | null; magichour: string | null }, settings: Record<string, unknown>, fetchImpl?: typeof fetch): VideoProvider {
  if (c.provider === "magichour")
    return createMagicHourVideoProvider({ apiKey: keys.magichour ?? "", fetch: fetchImpl, centsPerCredit: mediaSettings({ settings }).magicHourCentsPerCredit });
  return createFalVideoProvider({ client: createFalClient({ apiKey: keys.fal ?? "", fetch: fetchImpl }) });
}

/** Coût estimé du banc (question de confirmation de la mise en route). */
export async function benchEstimate(deps: AgentsDeps, personaId: string, count = 3): Promise<{ ok: boolean; cents: number; message: string }> {
  const p = await prepare(deps, personaId, count);
  if (!p.ok) return { ok: false, cents: 0, message: p.message };
  return { ok: true, cents: p.estimatedCents, message: `${p.sources.length} vidéo(s) × ${p.configs.length} réglage(s), environ ${eur(p.estimatedCents)}` };
}

export async function startBench(
  deps: AgentsDeps,
  input: { personaId: string; count?: number; byUserId?: string | null },
): Promise<{ ok: boolean; message: string }> {
  const halted = await isTeamHalted(deps, "dating");
  if (halted.halted) return { ok: false, message: `Banc d'essai refusé : ${halted.reason ?? "équipe en pause"}. Reprends l'équipe Rencontres, puis relance.` };
  const p = await prepare(deps, input.personaId, input.count ?? 3);
  if (!p.ok) return { ok: false, message: p.message };
  const now = nowOf(deps);
  const settings = await loadTeamSettings(deps.prisma, "dating");
  const cap = settings.monthlyBudgetCents.video;
  const spent = (await monthUsage(deps.prisma, "dating", now)).find((u) => u.provider === "video")?.cents ?? 0;
  if (cap !== undefined && spent + p.estimatedCents > cap)
    return { ok: false, message: `Banc d'essai refusé : environ ${eur(p.estimatedCents)} alors qu'il reste ${eur(Math.max(0, cap - spent))} sur le plafond vidéo du mois. Augmente le plafond ou essaie moins de vidéos.` };
  const id = `b${now.getTime().toString(36)}`;
  const state: BenchState = {
    id,
    personaId: p.persona.id,
    personaName: p.persona.name,
    createdAt: now.toISOString(),
    configs: p.configs,
    items: p.configs.flatMap((_, ci) => p.sources.map((s) => ({ config: ci, sourceAssetId: s.id, durationSec: s.durationSec, status: "pending" as const, estimatedCents: 0 }))),
    byUserId: input.byUserId ?? null,
  };
  await writeSetting(deps, `${BENCH_SETTING_PREFIX}${id}`, state);
  await writeSetting(deps, BENCH_LAST_KEY, id);
  await deps.enqueue.orchestrator({ type: "bench", benchId: id }, { jobId: `bench-${id}-0` });
  await agentEvent(deps, "agents.bench.started", { benchId: id, personaId: p.persona.id, items: state.items.length, estimatedCents: p.estimatedCents });
  await agentAudit(deps, { userId: input.byUserId ?? null, action: "agents.bench.started", entityType: "Persona", entityId: p.persona.id, metadata: { benchId: id } });
  return {
    ok: true,
    message: `Banc d'essai lancé pour ${p.persona.name} : ${p.sources.length} vidéo(s) × ${p.configs.length} réglage(s) (${p.configs.map((c) => c.label).join(", ")}), environ ${eur(p.estimatedCents)}. Les résultats arrivent par Telegram.`,
  };
}

async function loadFile(deps: AgentsDeps, id: string): Promise<ProviderFile | null> {
  const a = await deps.prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } });
  return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename } : null;
}

/** Un passage du banc : soumet, relit, range et envoie ; se ré-enfile tant qu'un essai est en cours. */
export async function runBench(deps: EngineDeps, job: { benchId?: string; personaId?: string; count?: number }): Promise<Record<string, unknown>> {
  if (!job.benchId) {
    if (!job.personaId) return { ok: false, reason: "banc sans persona" };
    const r = await startBench(deps, { personaId: job.personaId, count: job.count });
    if (!r.ok) await deps.admin?.send(`🎬 ${escapeHtml(r.message)}`).catch(() => null);
    return { ok: r.ok, message: r.message };
  }
  const key = `${BENCH_SETTING_PREFIX}${job.benchId}`;
  const state = (await readSetting(deps, key)) as BenchState | undefined;
  if (!state || !Array.isArray(state.items)) return { ok: false, reason: "banc introuvable" };
  if (state.finishedAt) return { ok: true, finished: true };
  const now = nowOf(deps);
  const keys = { fal: await readSecret(deps.prisma, FAL_SECRET_KEY), magichour: await readSecret(deps.prisma, MAGICHOUR_SECRET_KEY) };
  const settings = await loadTeamSettings(deps.prisma, "dating");
  const persona = await deps.prisma.persona.findUnique({ where: { id: state.personaId }, select: { referenceImageIds: true } });
  const refId = Array.isArray(persona?.referenceImageIds) ? (persona!.referenceImageIds as unknown[]).find((x): x is string => typeof x === "string") : undefined;
  const provider = (c: BenchConfig) => deps.providers?.video ?? providerFor(c, keys, settings.settings, deps.fetch);

  const halted = await isTeamHalted(deps, "dating");
  for (const [n, item] of state.items.entries()) {
    try {
      await benchItem(n, item);
    } catch (err) {
      // Une erreur sur un essai n'arrête pas les autres ; l'essai est relu au prochain passage.
      deps.logger?.warn({ err: (err as Error).message, benchId: state.id, item: n }, "[agents] essai du banc en erreur");
    }
  }

  async function benchItem(n: number, item: BenchItem): Promise<void> {
    const config = state!.configs[item.config]!;
    const p = provider(config);
    if (item.status === "pending") {
      // Pause : aucune nouvelle dépense ; les essais déjà soumis sont relus.
      if (halted.halted) return;
      const [source, ref] = [await loadFile(deps, item.sourceAssetId), refId ? await loadFile(deps, refId) : null];
      if (!source || !ref) {
        Object.assign(item, { status: "failed", error: !source ? "vidéo source introuvable" : "image de référence introuvable" });
        return;
      }
      try {
        const start = await p.startReplace({ sourceVideo: source, referenceImage: ref, resolution: config.resolution, durationSec: item.durationSec, fps: null, sourceAssetId: item.sourceAssetId });
        Object.assign(item, { status: "running", jobId: start.jobId, ref: start.ref, submittedAt: now.toISOString(), estimatedCents: start.estimatedCents });
      } catch (err) {
        Object.assign(item, { status: "failed", error: ((err as Error).message || "erreur inconnue").slice(0, 200) });
      }
      // Écrit tout de suite : un redémarrage relit ce travail au lieu de le payer une seconde fois.
      await writeSetting(deps, key, state);
      return;
    }
    if (item.status !== "running" || !item.jobId) return;
    const elapsed = now.getTime() - Date.parse(item.submittedAt ?? state!.createdAt);
    const r = await p.poll(item.jobId, item.ref);
    if (r.status === "queued" || r.status === "running") {
      if (elapsed > BENCH_ITEM_TIMEOUT_MS) {
        // Abandon : annulation chez le fournisseur, estimation comptée sauf annulation confirmée.
        const cancel = p.cancel ? await p.cancel(item.jobId, item.ref).catch(() => ({ cancelled: false })) : { cancelled: false };
        const cents = cancel.cancelled ? 0 : Math.max(0, Math.round(item.estimatedCents));
        Object.assign(item, { status: "failed", error: "toujours en cours après 20 minutes", cents });
        if (cents > 0) {
          await recordUsage(deps.prisma, "dating", "video", cents, now);
          await maybeAlertBudget(deps, settings, "video", now);
        }
      }
      return;
    }
    if (r.status === "failed" || !r.outputUrl) {
      // Coût facturé malgré l'échec (Magic Hour) : compté.
      const cents = Math.max(0, Math.round(r.actualCents ?? 0));
      Object.assign(item, { status: "failed", error: (r.error ?? "échec").slice(0, 200), cents });
      if (cents > 0) await recordUsage(deps.prisma, "dating", "video", cents, now);
      return;
    }
    try {
      const file = await p.download(r.outputUrl);
      const stored = await storeProducedMedia(deps.prisma, {
        file,
        kind: "GENERATED",
        teamKey: "dating",
        personaId: state!.personaId,
        sourceAssetId: item.sourceAssetId,
        providerName: p.name,
        providerJobId: item.jobId,
        resolution: config.resolution,
        simulation: p.name === "fake",
        salt: `${state!.id}:${n}`,
        duration: Math.round(item.durationSec),
        tags: ["banc"],
      });
      const cents = Math.max(0, Math.round(r.actualCents ?? item.estimatedCents));
      Object.assign(item, { status: "done", assetId: stored.id, cents, durationMs: elapsed });
      await writeSetting(deps, key, state);
      if (cents > 0) {
        await recordUsage(deps.prisma, "dating", "video", cents, now);
        await maybeAlertBudget(deps, settings, "video", now);
      }
      await deps.admin
        ?.send(
          `🎬 <b>Essai ${item.config + 1}</b> — ${escapeHtml(config.label)} — ${escapeHtml(state!.personaName)}\nCoût : ${eur(cents)} · traitement : ${durationText(elapsed)}`,
          { mediaAssetId: stored.id },
        )
        .catch(() => null);
    } catch (err) {
      // Téléchargement passager : relu au prochain passage, sauf délai dépassé.
      if (elapsed > BENCH_ITEM_TIMEOUT_MS) Object.assign(item, { status: "failed", error: (err as Error).message.slice(0, 200) });
    }
  }

  const open = state.items.some((i) => i.status === "pending" || i.status === "running");
  // Pause sans essai en cours : rien n'est relancé ; le banc reprend quand on le relance (`bench` + `benchId`).
  if (open && halted.halted && !state.items.some((i) => i.status === "running")) {
    await writeSetting(deps, key, state);
    await agentEvent(deps, "agents.bench.halted", { benchId: state.id, reason: halted.reason });
    return { ok: false, halted: true, reason: halted.reason };
  }
  if (open) {
    await writeSetting(deps, key, state);
    const passes = Math.round((now.getTime() - Date.parse(state.createdAt)) / BENCH_POLL_MS) + 1;
    await deps.enqueue.orchestrator({ type: "bench", benchId: state.id }, { jobId: `bench-${state.id}-${passes}`, delayMs: BENCH_POLL_MS });
    return { ok: true, open: true };
  }
  state.finishedAt = now.toISOString();
  await writeSetting(deps, key, state);
  await finishBench(deps, state);
  return { ok: true, finished: true };
}

/** Fin du banc : bilan par réglage, puis la question « lequel préfères-tu ? ». */
async function finishBench(deps: AgentsDeps, state: BenchState): Promise<void> {
  const lines = state.configs.map((c, ci) => {
    const items = state.items.filter((i) => i.config === ci);
    const done = items.filter((i) => i.status === "done");
    const cents = done.reduce((s, i) => s + (i.cents ?? 0), 0);
    const failed = items.length - done.length;
    return `${ci + 1}. ${c.label} : ${done.length}/${items.length} vidéo(s), ${eur(cents)}${failed ? `, ${failed} en échec` : ""}`;
  });
  await agentEvent(deps, "agents.bench.finished", { benchId: state.id, done: state.items.filter((i) => i.status === "done").length, failed: state.items.filter((i) => i.status === "failed").length });
  await deps.admin?.send([`🎬 <b>Banc d'essai terminé</b> (${escapeHtml(state.personaName)})`, ...lines.map(escapeHtml)].join("\n")).catch(() => null);
  const usable = state.configs.filter((_, ci) => state.items.some((i) => i.config === ci && i.status === "done"));
  if (!usable.length) return;
  await askHuman(deps, {
    teamKey: "dating",
    kind: "CHOICE",
    key: `agents.bench.choice.${state.id}`,
    question: `Quel réglage préfères-tu pour les vidéos de l'équipe Rencontres ? Réponds ${usable.map((_, i) => i + 1).join(", ").replace(/, (\d+)$/, " ou $1")} (ou « plus tard »).`,
    options: usable.map((c) => c.label),
    onAnswer: { action: BENCH_CHOICE_ACTION, benchId: state.id, choices: usable, resume: false },
  });
}

/** Réponse à la question du banc : fournisseur et résolution par défaut de l'équipe Rencontres. */
export async function applyBenchChoice(deps: AgentsDeps, choice: BenchConfig, actor: { userId?: string | null; via: string }): Promise<string> {
  const row = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "dating" } });
  const current = row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {};
  const settings = { ...current, videoProvider: choice.provider, videoResolution: choice.resolution };
  await deps.prisma.agentTeamConfig.upsert({ where: { teamKey: "dating" }, create: { teamKey: "dating", settings }, update: { settings } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.bench.choice",
    entityType: "AgentTeamConfig",
    entityId: "dating",
    metadata: { provider: choice.provider, resolution: choice.resolution, via: actor.via },
  });
  return `C'est noté : ${choice.label} par défaut pour les vidéos de l'équipe Rencontres.`;
}

registerAnswerAction(BENCH_CHOICE_ACTION, async (deps, { value, onAnswer, actor }) => {
  const choices = Array.isArray(onAnswer.choices) ? (onAnswer.choices as BenchConfig[]) : [];
  const choice = choices.find((c) => c.label === value);
  if (!choice) return "Choix non reconnu : rien ne change.";
  return applyBenchChoice(deps, choice, actor);
});
