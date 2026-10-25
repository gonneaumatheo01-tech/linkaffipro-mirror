/**
 * Phase 34, lot C : cœurs de « Campagnes → Tous les liens » (`app/(admin)/campaigns/links/actions.ts`) : liens
 * d'entrée (un par nom), lien générique, activer / désactiver un lien. Mêmes validations et messages que le site.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { LinkError, createEntryLink, createGenericLink } from "@/lib/links/create";
import { env } from "@/lib/env";
import {
  done,
  doneTo,
  fail,
  failTo,
  isPartial,
  preview,
  str,
  withVia,
  type Core,
} from "./common";
import { channelCandidates, resolveInto, trackingLinkCandidates } from "./resolve";

const LINKS = "/campaigns/links";

const entrySchema = z.object({
  channelId: z.string().min(1),
  names: z.string().min(1),
  platform: z.enum(["TIKTOK", "META", "OTHER"]),
  adCampaignName: z.string().trim().max(120).optional(),
  adSetName: z.string().trim().max(120).optional(),
  adName: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(5).toLowerCase(),
  approvalRuleId: z.string().optional(),
});

const PLATFORM_LABEL: Record<string, string> = { TIKTOK: "TikTok", META: "Meta", OTHER: "Autre" };

/** Crée un ou plusieurs liens d'entrée (une ligne par nom). */
export const createEntryLinks: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const ch = await resolveInto(input, "channelId", "channel", "le canal", channelCandidates);
  if (!ch.ok) return fail(ch.error, null, { code: ch.code });
  if (isPartial(actor)) {
    // Kevin : « un lien de suivi pour TikTok sur Zone Interdite » → plateforme en majuscules, nom et langue déduits.
    if (typeof input.platform === "string") {
      const p = input.platform.trim().toUpperCase();
      input.platform = p === "FACEBOOK" || p === "INSTAGRAM" ? "META" : p;
    }
    if (Array.isArray(input.names)) input.names = input.names.map(String).join("\n");
    if (!str(input.names).trim() && str(input.platform)) {
      const d = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
      input.names = `${PLATFORM_LABEL[str(input.platform)] ?? "Lien"} ${d}`;
    }
    if (!str(input.language).trim() && str(input.channelId)) {
      const c = await prisma.channel.findUnique({
        where: { id: str(input.channelId) },
        select: { language: true },
      });
      input.language = c?.language || "fr";
    }
  }
  const fields: Record<string, string> = {};
  for (const k of Object.keys(entrySchema.shape))
    if (input[k] !== undefined && input[k] !== null) fields[k] = str(input[k]);
  const parsed = entrySchema.safeParse(fields);
  if (!parsed.success)
    return failTo(
      LINKS,
      "Vérifiez le formulaire : le canal, au moins un nom, la plateforme et une langue (code de 2 à 5 lettres, ex. fr) sont obligatoires.",
    );
  const d = parsed.data;
  const names = [
    ...new Set(
      d.names
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
  if (names.length === 0) return failTo(LINKS, "Indiquez au moins un nom de lien.");
  if (opts.dryRun) {
    const channel = await prisma.channel.findUnique({ where: { id: d.channelId }, select: { title: true } });
    if (!channel) return failTo(LINKS, "Canal introuvable.", {}, { code: "not_found" });
    return preview(
      `${names.length} lien(s) d'entrée ${PLATFORM_LABEL[d.platform]} vers « ${channel.title} » (invitation avec demande d'adhésion) : ${names.map((n) => `« ${n} »`).join(", ")}.`,
    );
  }
  const created: string[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      const r = await createEntryLink({
        channelId: d.channelId,
        name,
        platform: d.platform,
        adCampaignName: d.adCampaignName,
        adSetName: d.adSetName,
        adName: d.adName,
        language: d.language,
        approvalRuleId: d.approvalRuleId || null,
        userId: actor.userId,
        ...(actor.via !== "WEB" ? { via: actor.via } : {}),
      });
      created.push(r.trackingLink.slug);
    } catch (err) {
      errors.push(`${name} : ${err instanceof LinkError ? err.message : "erreur inattendue"}`);
      if (err instanceof LinkError && /Aucun bot administrateur|introuvable/.test(err.message))
        break;
    }
  }
  revalidatePath(LINKS);
  if (errors.length > 0 && created.length === 0)
    return failTo(LINKS, errors.join(" · "), {}, { code: "unavailable" });
  const message = `${created.length} lien(s) créé(s) : copiez les adresses à coller dans la pub, ci-dessous${errors.length ? ` · échecs : ${errors.join(" · ")}` : ""}.`;
  const urls = created.map((s) => `${env.trackingBaseUrl}/${s}`);
  return done(
    actor.via === "WEB" ? message : `${created.length} lien(s) créé(s) : ${urls.join(" ")}${errors.length ? ` · échecs : ${errors.join(" · ")}` : ""}`,
    { path: LINKS, params: { ok: message, highlight: created.join(",") } },
    { urls, slugs: created },
  );
};

const genericSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
});

export const createGeneric: Core = async (input, actor, opts = {}) => {
  const parsed = genericSchema.safeParse({ label: str(input.label), url: str(input.url) });
  if (!parsed.success)
    return failTo(LINKS, "Indiquez un nom et une adresse complète commençant par https://.");
  if (opts.dryRun) {
    let protocol = "";
    try {
      protocol = new URL(parsed.data.url).protocol;
    } catch {
      return failTo(LINKS, "URL invalide.");
    }
    if (!/^https?:$/.test(protocol))
      return failTo(LINKS, "L'URL doit commencer par http:// ou https://.");
    return preview(`Lien suivi « ${parsed.data.label} » vers ${parsed.data.url}.`);
  }
  try {
    const link = await createGenericLink({
      label: parsed.data.label,
      url: parsed.data.url,
      userId: actor.userId,
      ...(actor.via !== "WEB" ? { via: actor.via } : {}),
    });
    revalidatePath(LINKS);
    const url = `${env.trackingBaseUrl}/${link.slug}`;
    const message = `Lien « ${link.label} » créé.`;
    return done(
      actor.via === "WEB" ? message : `${message} Adresse : ${url}`,
      { path: LINKS, params: { ok: message, highlight: link.slug } },
      { url, slug: link.slug },
    );
  } catch (err) {
    return failTo(
      LINKS,
      err instanceof LinkError
        ? err.message
        : "Création impossible pour le moment. Réessayez dans un instant.",
      {},
      { code: err instanceof LinkError ? "invalid" : "unavailable" },
    );
  }
};

/**
 * Active / désactive un lien. Site : bascule. Kevin : `active` (vrai / faux) dit l'état voulu ; déjà dans cet état →
 * rien à faire.
 */
export const toggleLink: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const r = await resolveInto(input, "linkId", "link", "le lien", trackingLinkCandidates);
  if (!r.ok) return fail(r.error, null, { code: r.code });
  const id = str(input.linkId);
  const link = id
    ? await prisma.trackingLink.findUnique({ where: { id }, include: { inviteLink: true } })
    : null;
  if (!link) return failTo(LINKS, "Lien introuvable.", {}, { code: "not_found" });
  if (typeof input.active === "boolean" && input.active === link.isActive)
    return doneTo(LINKS, `Le lien « ${link.label} » est déjà ${link.isActive ? "actif" : "désactivé"}.`);
  const isActive = !link.isActive;
  if (opts.dryRun)
    return preview(
      `Le lien « ${link.label} » sera ${isActive ? "réactivé" : "désactivé (il renverra vers l'accueil du site)"}.`,
    );
  await prisma.trackingLink.update({ where: { id }, data: { isActive } });
  if (link.inviteLinkId)
    await prisma.inviteLink.update({ where: { id: link.inviteLinkId }, data: { isActive } });
  await audit({
    userId: actor.userId,
    action: isActive ? "link.activated" : "link.deactivated",
    entityType: "TrackingLink",
    entityId: id,
    metadata: withVia(actor),
  });
  revalidatePath(LINKS);
  return doneTo(
    LINKS,
    `Lien « ${link.label} » ${isActive ? "réactivé : il fonctionne à nouveau" : "désactivé : il renvoie vers l'accueil du site"}.`,
  );
};
