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
  | { ok: true; assetId: string; created: boolean; line: string; requestClosed: boolean }
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

/** Fait avancer la plus ancienne demande MEDIA ouverte qui attend ces mots-clés ; la clôt au nombre atteint. */
async function advanceMediaRequest(
  deps: AgentsDeps,
  tags: string[],
): Promise<{ progress: string | null; closed: boolean }> {
  const open = (await deps.prisma.humanRequest.findMany({
    where: { kind: "MEDIA", status: { in: ["PENDING", "QUEUED"] } },
    orderBy: { createdAt: "asc" },
  })) as HumanRequestRow[];
  const request = open.find((r) => tagsMatchRequest(tags, expectedOf(r.expected).tags));
  if (!request) return { progress: null, closed: false };
  const expected = expectedOf(request.expected);
  const need = Math.max(1, expected.count ?? 1);
  const received = (expected.received ?? 0) + 1;
  const closed = received >= need;
  await deps.prisma.humanRequest.update({
    where: { id: request.id },
    data: {
      expected: { ...(request.expected as Record<string, unknown>), received },
      answerSummary: `${Math.min(received, need)}/${need} reçus`,
      ...(closed ? { status: "ANSWERED", answeredAt: deps.now ? deps.now() : new Date() } : {}),
    },
  });
  if (closed) {
    await agentEvent(deps, "agents.request.answered", { requestId: request.id, key: request.key, kind: "MEDIA" });
    await resumeWaitingMissions(deps, request, { answered: true, summary: `${need}/${need} reçus` });
    await sendNextHumanRequest(deps);
  }
  return { progress: closed ? `demande complète : ${need}/${need} 🎉` : `${received}/${need} pour la demande en cours`, closed };
}

/** Images de référence gardées par persona (la première sert au remplacement vidéo). */
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
  if (!parsed) return { ok: false, line: "Aucun mot-clé de médiathèque (#casino, #dating #source #lea, #photo…)." };
  const kind = parsed.kind ?? defaultKindFor(input.mimeType);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const classification = {
    teamKey: parsed.teamKey,
    theme: parsed.theme,
    personaId: parsed.personaId,
    kind,
    origin: "HUMAN" as const,
  };

  const existing = await deps.prisma.mediaAsset.findUnique({ where: { sha256 } });
  let assetId: string;
  let libraryMessageId: number | null;
  if (existing) {
    assetId = existing.id;
    libraryMessageId = existing.libraryMessageId ?? null;
    const tags = [...new Set([...tagsArray(existing.tags), ...parsed.tags])];
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
        tags: parsed.tags,
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

  // Un doublon ne compte pas pour une demande de médias (il faut des médias nouveaux).
  const advance = existing ? { progress: null, closed: false } : await advanceMediaRequest(deps, parsed.tags);
  await agentEvent(deps, "agents.library.stored", {
    assetId,
    created: !existing,
    teamKey: parsed.teamKey,
    kind,
    theme: parsed.theme,
    personaId: parsed.personaId,
  });
  return {
    ok: true,
    assetId,
    created: !existing,
    requestClosed: advance.closed,
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
