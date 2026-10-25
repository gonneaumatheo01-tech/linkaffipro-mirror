/**
 * Phase 34, lot B — cœurs des liens de partage de la fiche canal (phase 11 : créer, désactiver) et du renvoi de
 * l'accueil avec les liens des canaux à rejoindre (À faire de l'accueil). Toute la logique reste dans
 * `lib/channels/share-links.ts` et `lib/approval/resend-welcome.ts`.
 */
import { prisma } from "@linkaffipro/db";
import {
  ShareLinkError,
  createShareLink,
  disableShareLink,
  disabledMessage,
  parseShareName,
} from "@/lib/channels/share-links";
import { resendGateWelcomeForChannel } from "@/lib/approval/resend-welcome";
import { fail, ok, preview, resolveChannelRef, resolveNamed, str, type CoreRun, type SiteOpResult } from "./common";

/** « Créer le lien » : un lien de partage nommé (demande d'adhésion), « À poster dans » facultatif. */
export const shareLinkCreate: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  if (!ref) return fail("Canal introuvable : rechargez la page.", "invalid", "channel");
  const src = await resolveChannelRef(input, { id: "sourceChannelId", name: "sourceChannel" });
  if (src && !src.ok) return src.result;
  const name = parseShareName(input.name);
  if ("error" in name) return fail(name.error, "invalid", "name");
  try {
    const created = await createShareLink({
      channelId: ref.id,
      name: name.name,
      sourceChannelId: src?.id ?? null,
      userId: actor.userId,
      via: actor.via,
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    if (opts.dryRun)
      return preview({ summary: `Nouveau lien de partage « ${created.name} » pour « ${ref.name} »${src ? `, à poster dans « ${src.name} »` : ""}.` });
    return ok(`Lien de partage « ${created.name} » créé : ${created.url}`, { channelId: ref.id, created });
  } catch (err) {
    if (err instanceof ShareLinkError) return fail(err.message, "invalid");
    throw err;
  }
};

/** Lien de partage par `linkId` (site) ou par son nom dans le canal (`link`, Kevin). */
async function shareLinkIdOf(input: Record<string, unknown>, channelId: string): Promise<{ ok: true; id: string } | { ok: false; result: Extract<SiteOpResult, { ok: false }> }> {
  const id = str(input.linkId);
  if (id || !input.link) return { ok: true, id };
  const rows = await prisma.inviteLink.findMany({ where: { channelId, kind: "SHARE" }, select: { id: true, name: true } });
  const r = await resolveNamed({ plural: "liens de partage", one: "le lien de partage" }, str(input.link).trim(), rows);
  return r.ok ? { ok: true, id: r.id } : r;
}

/** « Désactiver » un lien de partage : il ne fonctionne plus dans Telegram (révoqué). */
export const shareLinkDisable: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const link = await shareLinkIdOf(input, ref?.id ?? "");
  if (!link.ok) return link.result;
  if (!ref?.id || !link.id) return fail("Lien introuvable : rechargez la page.", "not_found");
  try {
    const r = await disableShareLink({
      channelId: ref.id,
      linkId: link.id,
      userId: actor.userId,
      via: actor.via,
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    if (opts.dryRun)
      return preview({
        summary: r.alreadyDisabled ? `Le lien « ${r.name} » est déjà désactivé.` : `Désactiver le lien de partage « ${r.name} ».`,
        impact: "Il ne fonctionnera plus dans Telegram ; les demandes déjà reçues restent.",
      });
    const channel = await prisma.channel.findUnique({ where: { id: ref.id }, select: { title: true } });
    const message = disabledMessage(r, channel?.title ?? "ce canal");
    return r.revokedOnTelegram
      ? ok(message, { channelId: ref.id })
      : { ok: false, code: "unavailable", error: message, field: "telegram" };
  } catch (err) {
    if (err instanceof ShareLinkError) return fail(err.message, "invalid");
    throw err;
  }
};

/**
 * « Renvoyer l'accueil avec les liens » : à chaque demande du canal qui attend les liens des canaux à rejoindre. Aucun
 * envoi pour une demande qui n'est plus en attente.
 */
export const welcomeResend: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  if (!ref) return fail("Quel canal ?", "invalid", "channel");
  const r = await resendGateWelcomeForChannel(ref.id, actor.userId, { via: actor.via, dryRun: opts.dryRun });
  if (opts.dryRun) {
    const n = r.requests ?? 0;
    return preview({
      summary: n
        ? `Renvoyer l'accueil avec les liens des canaux à rejoindre à ${n} personne${n > 1 ? "s" : ""} de « ${ref.name} ».`
        : "Aucune demande n'attend de liens dans ce canal.",
      recipients: n,
      exactText: null,
    });
  }
  if (!r.ok && r.error) return { ok: false, code: "unavailable", error: r.error };
  return ok(r.ok ?? "", { channelId: ref.id, ...(r.error ? { warning: r.error } : {}) });
};
