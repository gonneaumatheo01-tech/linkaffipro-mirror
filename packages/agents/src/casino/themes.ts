/**
 * Thèmes d'un média casino déposé ou classé (chantier B, phase 22) : mots-clés `theme:<clé>` + « à classer », et ajout
 * d'un thème à l'équipe depuis Telegram. Les réglages eux-mêmes sont lus par `settings.ts` (chantier A).
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { agentAudit, agentEvent } from "../admin/journal";
import { parseCasinoSettings } from "./settings";
import { THEME_TAG_PREFIX, TO_CLASSIFY_TAG, assetThemes, themeTag } from "./rotation";

/**
 * Mots-clés d'un média casino : les mots-clés hors thème sont gardés, les thèmes remplacés ; « à classer » si aucun
 * thème. Le thème principal (`MediaAsset.theme`) est le premier.
 */
export function casinoTagsFor(previous: unknown, themes: string[]): { tags: string[]; theme: string | null } {
  const others = (Array.isArray(previous) ? previous : []).filter(
    (t): t is string => typeof t === "string" && !t.startsWith(THEME_TAG_PREFIX) && t !== TO_CLASSIFY_TAG,
  );
  const unique = [...new Set(themes)];
  const tags = [...new Set(["casino", ...others]), ...unique.map(themeTag)];
  if (unique.length === 0) tags.push(TO_CLASSIFY_TAG);
  return { tags, theme: unique[0] ?? null };
}

/** Thèmes actuels d'un média casino (principal puis mots-clés), vide pour un média d'une autre équipe. */
export function casinoThemesOfAsset(asset: { teamKey: string | null; theme: string | null; tags: unknown } | null): string[] {
  return asset?.teamKey === "casino" ? assetThemes(asset) : [];
}

/** Thèmes de l'équipe Casino (défaut : thèmes de départ). */
export async function readCasinoThemes(deps: Pick<AgentsDeps, "prisma">): Promise<string[]> {
  const row = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } });
  return parseCasinoSettings(row?.settings).themes;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/**
 * Ajoute un thème à l'équipe (idempotent) ; les autres réglages (`settings.casino.*`, autres clés) sont conservés.
 * Un `AuditLog` par création réelle.
 */
export async function addCasinoTheme(deps: AgentsDeps, theme: string, actor: ActorRef): Promise<{ created: boolean; themes: string[] }> {
  const row = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } });
  const settings = record(row?.settings);
  const casino = record(settings.casino);
  const current = parseCasinoSettings(settings).themes;
  if (current.includes(theme)) return { created: false, themes: current };
  const next = [...current, theme];
  const data = { settings: JSON.parse(JSON.stringify({ ...settings, casino: { ...casino, themes: next } })) };
  await deps.prisma.agentTeamConfig.upsert({
    where: { teamKey: "casino" },
    create: { teamKey: "casino", ...data },
    update: { ...data, updatedById: actor.userId ?? null },
  });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.casino.theme_created",
    entityType: "AgentTeamConfig",
    entityId: "casino",
    metadata: { theme, via: actor.via },
  });
  await agentEvent(deps, "agents.casino.theme_created", { theme, via: actor.via });
  return { created: true, themes: next };
}
