/**
 * Rangement d'un média déposé par l'admin (photo, vidéo envoyée ou transférée au bot avec des mots-clés) : `MediaAsset`
 * dédoublonné par empreinte (le classement est mis à jour), `MediaAssetTelegramFile` du bot, copie facultative dans le
 * canal Telegram « Médiathèque » (`Setting` `agents.libraryChannelId`), avancement d'une demande MEDIA en cours.
 */
import { createHash } from "node:crypto";
import { TEAM_LABELS, type AgentsDeps } from "../types";
import { agentEvent, readSetting } from "../admin/journal";
import { expectedOf, sendNextHumanRequest } from "../human/requests";
import { resumeWaitingMissions, type HumanRequestRow } from "../human/respond";
import { defaultKindFor, parseLibraryCaption, tagsMatchRequest, type LibraryKind } from "./tags";
import { askCreateCasinoThemes, casinoDepositLine, planCasinoDeposit, type CasinoDepositInfo } from "../casino/deposit";

export const LIBRARY_CHANNEL_KEY = "agents.libraryChannelId";

export type StoreLibraryMediaInput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  caption: string;
  botId: string;
  telegramFileId: string;
  fileUniqueId: string;
  /** Copie dans le canal « Médiathèque » (le bot qui a reçu le média la fait) ; rend l'identifiant du message copié. */
  copyToLibrary?: (libraryChannelId: string) => Promise<{ messageId: number } | null>;
};

export type StoreLibraryMediaResult =
  | {
      ok: true;
      assetId: string;
      created: boolean;
      line: string;
      requestClosed: boolean;
      /** Dépôt casino (phase 22) : de quoi refaire une seule ligne pour un album. */
      casino?: CasinoDepositInfo;
      /** Avancement d'une demande MEDIA (« 2/3 pour la demande en cours »). */
      progress?: string | null;
    }
  | { ok: false; line: string };

const KIND_LABELS: Record<LibraryKind, string> = {
  SOURCE: "source",
  GENERATED: "générée",
  PHOTO: "photo",
  REFERENCE: "référence",
};

function tagsArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Ligne de confirmation (une ligne). */
function confirmationLine(o: {
  created: boolean;
  isVideo: boolean;
  teamKey: string | null;
  kind: LibraryKind;
  personaName: string | null;
  theme: string | null;
  progress: string | null;
}): string {
  const parts = [o.isVideo ? "vidéo" : "photo"];
  if (o.teamKey && o.teamKey in TEAM_LABELS) parts.push(TEAM_LABELS[o.teamKey as keyof typeof TEAM_LABELS]);
  parts.push(KIND_LABELS[o.kind]);
  if (o.personaName) parts.push(o.personaName);
  if (o.theme) parts.push(`thème ${o.theme}`);
  const head = o.created ? "Rangé dans la médiathèque ✅" : "Déjà dans la médiathèque : classement mis à jour ✅";
  return `${head} ${parts.join(" · ")}${o.progress ? ` (${o.progress})` : ""}`;
}

/** Essais de l'incrément du compteur quand des médias d'un même album arrivent en même temps. */
const ADVANCE_ATTEMPTS = 8;

/**
 * Fait avancer la plus ancienne demande MEDIA ouverte qui attend ces mots-clés ; la clôt au nombre atteint.
 * Incrément sans perte : écriture conditionnelle (« compare puis échange ») sur le résumé (`answerSummary`, qui porte
 * le compteur), la date de mise à jour et le statut ouvert ; si un autre média de l'album est passé entre la lecture
 * et l'écriture, on relit et on recommence. La clôture ne rouvre jamais une demande expirée ou passée (statut lu dans
 * la même condition).
 */
async function advanceMediaRequest(
  deps: AgentsDeps,
  tags: string[],
): Promise<{ progress: string | null; closed: boolean }> {
  for (let attempt = 0; attempt < ADVANCE_ATTEMPTS; attempt++) {
    const open = (await deps.prisma.humanRequest.findMany({
      where: { kind: "MEDIA", status: { in: ["PENDING", "QUEUED"] } },
      orderBy: { createdAt: "asc" },
    })) as (HumanRequestRow & { answerSummary?: string | null; updatedAt?: Date })[];
    const request = open.find((r) => tagsMatchRequest(tags, expectedOf(r.expected).tags));
    if (!request) return { progress: null, closed: false };
    const expected = expectedOf(request.expected);
    const need = Math.max(1, expected.count ?? 1);
    const received = (expected.received ?? 0) + 1;
    const closed = received >= need;
    const done = await deps.prisma.humanRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ["PENDING", "QUEUED"] },
        answerSummary: request.answerSummary ?? null,
        ...(request.updatedAt ? { updatedAt: request.updatedAt } : {}),
      },
      data: {
        expected: { ...(request.expected as Record<string, unknown>), received },
        answerSummary: `${Math.min(received, need)}/${need} reçus`,
        ...(closed ? { status: "ANSWERED", answeredAt: deps.now ? deps.now() : new Date() } : {}),
      },
    });
    if (done.count === 0) continue;
    if (closed) {
      await agentEvent(deps, "agents.request.answered", { requestId: request.id, key: request.key, kind: "MEDIA" });
      await resumeWaitingMissions(deps, request, { answered: true, summary: `${need}/${need} reçus` });
      await sendNextHumanRequest(deps);
    }
    return { progress: closed ? `demande complète : ${need}/${need} 🎉` : `${received}/${need} pour la demande en cours`, closed };
  }
  deps.logger?.warn({ tags }, "[agents] demande de médias : compteur non avancé (trop d'envois simultanés)");
  return { progress: null, closed: false };
}

/** Images de référence gardées par persona (la première sert de modèle aux photos). */
export const MAX_REFERENCE_IMAGES = 3;

/** Met l'image en tête des images de référence de la persona (la plus récente d'abord, 3 au plus). */
export async function addPersonaReferenceImage(deps: AgentsDeps, personaId: string, assetId: string): Promise<string[]> {
  const persona = await deps.prisma.persona.findUnique({ where: { id: personaId }, select: { referenceImageIds: true } });
  if (!persona) return [];
  const current = tagsArray(persona.referenceImageIds).filter((id) => id !== assetId);
  const next = [assetId, ...current].slice(0, MAX_REFERENCE_IMAGES);
  await deps.prisma.persona.update({ where: { id: personaId }, data: { referenceImageIds: next } });
  return next;
}

export async function storeLibraryMedia(
  deps: AgentsDeps,
  input: StoreLibraryMediaInput,
): Promise<StoreLibraryMediaResult> {
  const personas = await deps.prisma.persona.findMany({ select: { id: true, name: true } });
  const parsed = parseLibraryCaption(input.caption, personas as { id: string; name: string }[]);
  if (!parsed) return { ok: false, line: "Aucun mot-clé de médiathèque (#casino, #dating #reference #lea, #photo…)." };
  const isCasino = parsed.teamKey === "casino";
  // Casino (phase 22) : la nature suit le fichier (vidéo → SOURCE, image → PHOTO), jamais de persona.
  const kind = isCasino ? defaultKindFor(input.mimeType) : (parsed.kind ?? defaultKindFor(input.mimeType));
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await deps.prisma.mediaAsset.findUnique({ where: { sha256 } });
  const casinoPlan = isCasino ? await planCasinoDeposit(deps, parsed.tags, existing) : null;
  const classification = {
    teamKey: parsed.teamKey,
    theme: casinoPlan ? casinoPlan.theme : parsed.theme,
    personaId: casinoPlan ? null : parsed.personaId,
    kind,
    origin: "HUMAN" as const,
  };
  let assetId: string;
  let libraryMessageId: number | null;
  if (existing) {
    assetId = existing.id;
    libraryMessageId = existing.libraryMessageId ?? null;
    // Casino : thèmes fusionnés avec ceux du doublon (`theme:<clé>`) ; autres équipes : mots-clés ajoutés.
    const tags = casinoPlan ? casinoPlan.tags : [...new Set([...tagsArray(existing.tags), ...parsed.tags])];
    await deps.prisma.mediaAsset.update({ where: { id: existing.id }, data: { ...classification, tags } });
  } else {
    const created = await deps.prisma.mediaAsset.create({
      data: {
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        sha256,
        bytes: Buffer.from(input.bytes),
        width: input.width ?? null,
        height: input.height ?? null,
        duration: input.duration ?? null,
        tags: casinoPlan ? casinoPlan.tags : parsed.tags,
        ...classification,
      },
    });
    assetId = created.id;
    libraryMessageId = null;
  }

  await deps.prisma.mediaAssetTelegramFile.upsert({
    where: { assetId_botId: { assetId, botId: input.botId } },
    create: { assetId, botId: input.botId, telegramFileId: input.telegramFileId, fileUniqueId: input.fileUniqueId },
    update: { telegramFileId: input.telegramFileId, fileUniqueId: input.fileUniqueId },
  });

  // Copie dans le canal « Médiathèque » : une seule fois par média ; un échec n'empêche pas le rangement.
  const libraryChannelId = await readSetting(deps, LIBRARY_CHANNEL_KEY);
  if (!libraryMessageId && input.copyToLibrary && (typeof libraryChannelId === "string" || typeof libraryChannelId === "number")) {
    try {
      const copied = await input.copyToLibrary(String(libraryChannelId));
      if (copied)
        await deps.prisma.mediaAsset.update({ where: { id: assetId }, data: { libraryMessageId: copied.messageId } });
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, assetId }, "[agents] copie dans la médiathèque Telegram impossible");
    }
  }

  // Photo de référence d'une persona (phase 20) : en tête de `Persona.referenceImageIds` (3 au plus).
  if (kind === "REFERENCE" && parsed.personaId && input.mimeType.startsWith("image/"))
    await addPersonaReferenceImage(deps, parsed.personaId, assetId);

  // Thème inconnu : le média reste « à classer » et l'admin reçoit « Créer le thème <x> » (un bouton).
  if (casinoPlan?.unknownThemes.length) await askCreateCasinoThemes(deps, casinoPlan.unknownThemes, assetId);

  // Un doublon ne compte pas pour une demande de médias (il faut des médias nouveaux). Casino : `#slots` vaut
  // `#machines-a-sous` pour la demande.
  const requestTags = casinoPlan ? [...new Set([...parsed.tags, ...casinoPlan.themes])] : parsed.tags;
  const advance = existing ? { progress: null, closed: false } : await advanceMediaRequest(deps, requestTags);
  await agentEvent(deps, "agents.library.stored", {
    assetId,
    created: !existing,
    teamKey: parsed.teamKey,
    kind,
    theme: classification.theme,
    personaId: classification.personaId,
    ...(casinoPlan ? { themes: casinoPlan.themes, unknownThemes: casinoPlan.unknownThemes } : {}),
  });
  if (casinoPlan) {
    const casino: CasinoDepositInfo = {
      created: !existing,
      isVideo: !input.mimeType.startsWith("image/"),
      themes: casinoPlan.themes,
      unknownThemes: casinoPlan.unknownThemes,
    };
    return {
      ok: true,
      assetId,
      created: !existing,
      requestClosed: advance.closed,
      casino,
      progress: advance.progress,
      line: await casinoDepositLine(deps, [casino], advance.progress),
    };
  }
  return {
    ok: true,
    assetId,
    created: !existing,
    requestClosed: advance.closed,
    progress: advance.progress,
    line: confirmationLine({
      created: !existing,
      isVideo: !input.mimeType.startsWith("image/"),
      teamKey: parsed.teamKey,
      kind,
      personaName: parsed.personaName,
      theme: parsed.theme,
      progress: advance.progress,
    }),
  };
}

/**
 * Une seule ligne pour un album (phase 22) : tout casino → ligne casino commune (stock relu une fois) ; sinon les
 * lignes distinctes. `failed` : médias de l'album qui n'ont pas pu être rangés.
 */
export async function libraryAlbumLine(
  deps: AgentsDeps,
  results: StoreLibraryMediaResult[],
  failed = 0,
): Promise<string> {
  const ok = results.filter((r): r is Extract<StoreLibraryMediaResult, { ok: true }> => r.ok);
  const lines: string[] = [];
  if (ok.length > 0 && ok.every((r) => r.casino)) {
    const progress = [...ok].reverse().find((r) => r.progress)?.progress ?? null;
    lines.push(await casinoDepositLine(deps, ok.map((r) => r.casino!), progress));
  } else for (const r of results) if (!lines.includes(r.line)) lines.push(r.line);
  if (failed > 0) lines.push(`${failed} média${failed > 1 ? "s" : ""} n'${failed > 1 ? "ont" : "a"} pas pu être rangé${failed > 1 ? "s" : ""} : renvoie-le${failed > 1 ? "s" : ""}.`);
  return lines.join("\n");
}

/** Mot-clé posé sur un média repris d'un message transféré à Kevin (phase 34) : retrouvable, jamais classé d'office. */
export const FORWARDED_MEDIA_TAG = "transfert-kevin";

export type StoreForwardedMediaInput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  /** Bot qui a reçu le message transféré (le bot du dialogue admin : l'identifiant de fichier lui est propre). */
  botId: string;
  telegramFileId: string;
  /** Pas connu sans le message d'origine : l'identifiant de fichier à défaut. */
  fileUniqueId?: string | null;
};

/**
 * Phase 34 — média d'un message transféré à Kevin, repris pour un post, un envoi ou un message du bot (règle 6 : le
 * contenu reste fidèle, médias compris). Sans légende ni mot-clé : ni équipe, ni thème, ni persona ; jamais compté pour
 * une demande de médias ; pas de copie dans le canal « Médiathèque » (le message d'origine n'est plus là). Dédoublonné
 * par empreinte (un média déjà rangé garde son classement) ; l'identifiant de fichier du bot est mémorisé (une seconde
 * reprise du même fichier ne télécharge plus rien).
 */
export async function storeForwardedMedia(
  deps: AgentsDeps,
  input: StoreForwardedMediaInput,
): Promise<{ assetId: string; created: boolean }> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await deps.prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  let assetId: string;
  if (existing) assetId = existing.id;
  else {
    const created = await deps.prisma.mediaAsset.create({
      data: {
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        sha256,
        bytes: Buffer.from(input.bytes),
        tags: [FORWARDED_MEDIA_TAG],
        kind: defaultKindFor(input.mimeType),
        origin: "HUMAN",
      },
      select: { id: true },
    });
    assetId = created.id;
  }
  const fileUniqueId = input.fileUniqueId || input.telegramFileId;
  await deps.prisma.mediaAssetTelegramFile.upsert({
    where: { assetId_botId: { assetId, botId: input.botId } },
    create: { assetId, botId: input.botId, telegramFileId: input.telegramFileId, fileUniqueId },
    update: { telegramFileId: input.telegramFileId, fileUniqueId },
  });
  await agentEvent(deps, "agents.library.forwarded_stored", { assetId, created: !existing });
  return { assetId, created: !existing };
}
