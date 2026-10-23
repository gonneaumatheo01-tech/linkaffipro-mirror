/**
 * Classement d'un média casino (chantier B, phase 22) : thèmes connus de l'équipe seulement, `AuditLog` avant / après,
 * retrait de « à classer ». Appelé par le site (fiche Casino) et après la création d'un thème depuis Telegram.
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { agentAudit, agentEvent } from "../admin/journal";
import { matchCasinoTheme } from "../library/tags";
import { normalizeText } from "../human/answer";
import { casinoTagsFor, casinoThemesOfAsset, readCasinoThemes } from "./themes";

/**
 * Pose les thèmes d'un média : `replace` (classement depuis le site) ou `merge` (thème ajouté à ceux qu'il a déjà).
 * Thèmes déjà validés par l'appelant. Rend les thèmes avant / après.
 */
export async function applyCasinoThemes(
  deps: AgentsDeps,
  assetId: string,
  themes: string[],
  mode: "replace" | "merge",
): Promise<{ before: string[]; after: string[] } | null> {
  const asset = await deps.prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, teamKey: true, theme: true, tags: true },
  });
  if (!asset || asset.teamKey !== "casino") return null;
  const before = casinoThemesOfAsset(asset);
  const after = mode === "merge" ? [...new Set([...before, ...themes])] : [...new Set(themes)];
  const next = casinoTagsFor(asset.tags, after);
  await deps.prisma.mediaAsset.update({ where: { id: assetId }, data: { tags: next.tags, theme: next.theme } });
  return { before, after };
}

export async function classifyCasinoMediaImpl(
  deps: AgentsDeps,
  input: { assetId: string; themes: string[] },
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  const known = await readCasinoThemes(deps);
  const themes: string[] = [];
  const unknown: string[] = [];
  for (const raw of input.themes) {
    const t = normalizeText(raw.replace(/^#/, ""));
    if (!t) continue;
    const k = matchCasinoTheme(t, known);
    if (k) {
      if (!themes.includes(k)) themes.push(k);
    } else unknown.push(raw);
  }
  // Un thème inconnu se crée d'abord dans les réglages de l'équipe : jamais de thème posé au hasard.
  if (unknown.length > 0)
    return { ok: false, message: `Thème inconnu : ${unknown.join(", ")}. Crée-le d'abord dans les réglages de l'équipe Casino.` };
  if (themes.length === 0) return { ok: false, message: "Choisis au moins un thème." };
  const r = await applyCasinoThemes(deps, input.assetId, themes, "replace");
  if (!r) return { ok: false, message: "Média introuvable dans la médiathèque Casino." };
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.casino.media_classified",
    entityType: "MediaAsset",
    entityId: input.assetId,
    metadata: { before: r.before, after: r.after, via: actor.via },
  });
  await agentEvent(deps, "agents.casino.media_classified", { assetId: input.assetId, themes: r.after, via: actor.via });
  return { ok: true, message: `Média classé ✅ ${r.after.join(", ")}` };
}
