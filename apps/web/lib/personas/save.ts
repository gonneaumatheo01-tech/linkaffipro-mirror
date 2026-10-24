/**
 * Enregistrement et suppression des personas (phase 17). Toute la règle est ici (les actions serveur ne font que lire
 * la session et rediriger) :
 * - création et modification : ADMIN et MANAGER ; validation (`validatePersonaForm`), références vérifiées (offre,
 *   campagne, visuel de type image), activation refusée sans prénom ou avec une offre liée sans fiche ;
 * - journal : `persona.created`, `persona.updated` (champs modifiés, jamais les textes), `persona.activated`,
 *   `persona.deactivated`, `persona.deleted` ;
 * - après l'enregistrement, profil Telegram de chaque bot assistant qui l'utilise (`setAssistantProfile`) : un refus
 *   de Telegram est rapporté sans bloquer l'enregistrement (sans objet pour une fille, qui est sur un compte réel) ;
 * - campagne ou offre changée : le lien suivi de la persona pour son offre (`TrackingLink`, celui que le worker
 *   réutilise à chaque envoi) passe tout de suite dans la nouvelle campagne, et un recalcul complet des statistiques
 *   journalières est demandé (`refreshCampaignStats`, règle du projet : les jours passés changent de campagne) ;
 * - suppression : ADMIN seulement, refusée tant qu'un bot utilise la persona ;
 * - univers (phase 25) : hors Rencontres, toujours l'assistante (refus serveur dans `validatePersonaForm`), et le
 *   mode illusion n'est jamais posé pour une assistante ;
 * - fiche d'informations (phase 25) : ADMIN seulement ; un MANAGER qui l'envoie modifiée est refusé (la fiche reste
 *   inchangée) ; journal `persona.faq_updated` (nombres d'entrées, jamais les textes).
 */
import { deniesBeingAssistant } from "@linkaffipro/chat";
import { audit, prisma } from "@linkaffipro/db";
import { CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { mentionsAssistant, setAssistantProfile } from "@linkaffipro/telegram";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  OFFER_VISUAL_MIME_TYPES,
  botProfileTextProblem,
  hidesAssistant,
  validatePersonaForm,
  type PersonaData,
  type PersonaFormErrors,
} from "./form";
import { cleanFaq, sameFaq, type PersonaFaqEntry } from "./faq";
import { profileErrorMessage } from "./profile-error";

export type PersonaSaveResult =
  | {
      ok: true;
      id: string;
      created: boolean;
      /** Phrase de réussite (avec les remarques du profil Telegram). */
      message: string;
      /** Profil Telegram impossible à poser (l'enregistrement est fait). */
      problem: string | null;
    }
  | { ok: false; error: string; errors?: PersonaFormErrors };

type SaveUser = { id: string; role: "ADMIN" | "MANAGER" };

const COMPARED_FIELDS = [
  "name",
  "gender",
  "identityKind",
  "universe",
  "age",
  "personality",
  "tone",
  "styleExamples",
  "languages",
  "interests",
  "minExchangesBeforeOffer",
  "requireInterest",
  "maxOfferSends",
  "followUpAfterHours",
  "followUpsMax",
  "affiliateCampaignId",
  "campaignId",
  "offerPitch",
  "offerButtonText",
  "offerMediaAssetId",
  "botDescription",
  "botShortDescription",
  "model",
  "temperature",
  "extraPrompt",
  "isActive",
] as const satisfies ReadonlyArray<keyof PersonaData>;

/**
 * Champs modifiés entre l'enregistrement précédent et le nouveau (pour le journal, sans les textes). La fiche
 * d'informations a son propre journal (`persona.faq_updated`).
 */
export function changedFields(
  before: Partial<Record<keyof PersonaData, unknown>>,
  after: PersonaData,
): string[] {
  return COMPARED_FIELDS.filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}

/** Vérifie que l'offre, la campagne et le visuel existent (une offre inactive n'est acceptée que si elle était déjà liée). */
async function checkReferences(
  data: PersonaData,
  previousOfferId: string | null,
): Promise<PersonaFormErrors> {
  const errors: PersonaFormErrors = {};
  const [offer, campaign, media] = await Promise.all([
    data.affiliateCampaignId
      ? prisma.affiliateCampaign.findUnique({
          where: { id: data.affiliateCampaignId },
          select: { id: true, isActive: true },
        })
      : null,
    data.campaignId
      ? prisma.campaign.findUnique({ where: { id: data.campaignId }, select: { id: true } })
      : null,
    data.offerMediaAssetId
      ? prisma.mediaAsset.findUnique({
          where: { id: data.offerMediaAssetId },
          select: { id: true, mimeType: true },
        })
      : null,
  ]);
  if (data.affiliateCampaignId) {
    if (!offer) errors.affiliateCampaignId = "Offre introuvable : choisissez-en une autre.";
    else if (!offer.isActive && offer.id !== previousOfferId)
      errors.affiliateCampaignId =
        "Cette offre n'est plus active chez Link Affi : choisissez-en une autre.";
  }
  if (data.campaignId && !campaign)
    errors.campaignId = "Campagne introuvable : choisissez-en une autre.";
  if (data.offerMediaAssetId) {
    if (!media) errors.offerMediaAssetId = "Visuel introuvable : choisissez-en un autre.";
    else if (!(OFFER_VISUAL_MIME_TYPES as readonly string[]).includes(media.mimeType))
      errors.offerMediaAssetId = "Le visuel doit être une image (JPEG, PNG ou WebP).";
  }
  return errors;
}

/** Profil Telegram de chaque bot assistant qui utilise la persona : remarques et refus, en phrases simples. */
export async function refreshPersonaBotProfiles(
  personaId: string,
): Promise<{ notes: string[]; problems: string[] }> {
  const bots = await prisma.bot.findMany({
    where: { personaId, mode: "ASSISTANT", ...CHANNEL_BOT_WHERE },
    select: { id: true, username: true },
    orderBy: { username: "asc" },
  });
  const notes: string[] = [];
  const problems: string[] = [];
  for (const bot of bots) {
    try {
      const report = await setAssistantProfile(bot.id);
      if (report.mode === "ASSISTANT" && report.applied) {
        notes.push(`Description de @${bot.username} mise à jour dans Telegram.`);
        notes.push(...report.warnings);
      }
    } catch (err) {
      // Texte brut (anglais, technique) dans le journal du serveur seulement ; une phrase simple à l'écran.
      console.error(`[personas] profil Telegram de @${bot.username} non posé`, err);
      problems.push(profileErrorMessage(bot.username, err));
    }
  }
  return { notes, problems };
}

/** Crée ou modifie une persona à partir du brouillon du formulaire. */
export async function savePersona(raw: unknown, user: SaveUser): Promise<PersonaSaveResult> {
  const v = validatePersonaForm(raw);
  if (!v.ok) return { ok: false, error: v.error, errors: v.errors };
  const { data } = v;
  // Garde-fou du profil du bot (texte public, posé tel quel dans Telegram) : même règle que setAssistantProfile
  // (sinon le texte serait remplacé en silence), et jamais un texte qui nie être une assistante (règle 2 du client).
  const profileErrors: PersonaFormErrors = {};
  const profileProblem = (text: string | null, label: "description" | "description courte") => {
    if (!text) return null;
    // Une fille ne parle jamais de machine : ni « assistante », ni « IA », ni « bot » dans son texte public.
    if (data.identityKind === "GIRL")
      return botProfileTextProblem(text, label === "description" ? "long" : "short", "GIRL");
    if (deniesBeingAssistant(text) || hidesAssistant(text))
      return `Refusé : la ${label} ne doit ni nier que c'est une assistante (une IA), ni laisser croire à une vraie personne.`;
    if (!mentionsAssistant(text)) return `La ${label} doit dire « assistante » ou « assistant ».`;
    return null;
  };
  const longProblem = profileProblem(data.botDescription, "description");
  if (longProblem) profileErrors.botDescription = longProblem;
  const shortProblem = profileProblem(data.botShortDescription, "description courte");
  if (shortProblem) profileErrors.botShortDescription = shortProblem;

  const before = v.id
    ? await prisma.persona.findUnique({
        where: { id: v.id },
        select: {
          id: true,
          name: true,
          gender: true,
          identityKind: true,
          age: true,
          personality: true,
          tone: true,
          styleExamples: true,
          languages: true,
          interests: true,
          minExchangesBeforeOffer: true,
          requireInterest: true,
          maxOfferSends: true,
          followUpAfterHours: true,
          followUpsMax: true,
          affiliateCampaignId: true,
          campaignId: true,
          offerPitch: true,
          offerButtonText: true,
          offerMediaAssetId: true,
          botDescription: true,
          botShortDescription: true,
          model: true,
          temperature: true,
          extraPrompt: true,
          universe: true,
          faq: true,
          isActive: true,
        },
      })
    : null;
  if (v.id && !before)
    return {
      ok: false,
      error:
        "Cette persona n'existe plus (supprimée entre-temps) : revenez à la liste des personas.",
    };

  // Fiche d'informations : ADMIN seulement. Brouillon sans fiche → fiche enregistrée gardée telle quelle.
  const beforeFaq: PersonaFaqEntry[] = cleanFaq(before?.faq);
  const faq: PersonaFaqEntry[] = data.faq ?? beforeFaq;
  const faqChanged = !sameFaq(beforeFaq, faq);
  if (faqChanged && user.role !== "ADMIN")
    profileErrors.faq =
      "Seul un administrateur peut modifier la fiche d'informations : elle reste inchangée.";

  const errors = {
    ...profileErrors,
    ...(await checkReferences(data, before?.affiliateCampaignId ?? null)),
  };
  const count = Object.keys(errors).length;
  if (count > 0)
    return {
      ok: false,
      error:
        count === 1
          ? "Un champ est à corriger (indiqué en rouge)."
          : `${count} champs sont à corriger (indiqués en rouge).`,
      errors,
    };

  // `illusion` jamais posé pour une assistante (ni donc hors Rencontres, où « une fille » est refusée).
  const row = { ...data, faq, illusion: data.identityKind === "GIRL" };
  const faqMeta = { universe: data.universe, faqEntries: faq.length };
  let id: string;
  let created: boolean;
  let recompute = false;
  if (before) {
    // `illusion` garde la trace du verrou « elle ne se démasque jamais » : forcé pour une fille. Le moteur le déduit
    // déjà de l'identité ; la colonne ne sert qu'à documenter l'intention.
    await prisma.persona.update({ where: { id: before.id }, data: row });
    id = before.id;
    created = false;
    const fields = changedFields(before, data);
    if (fields.length > 0)
      await audit({
        userId: user.id,
        action: "persona.updated",
        entityType: "Persona",
        entityId: id,
        metadata: { fields, ...faqMeta },
      });
    if (fields.includes("campaignId") || fields.includes("affiliateCampaignId")) {
      // Même règle que le worker (apps/worker/src/assistant/offer-link.ts) : le lien de la persona pour son offre
      // actuelle suit sa campagne ; les liens d'une offre précédente gardent la leur.
      if (data.affiliateCampaignId)
        await prisma.trackingLink.updateMany({
          where: { personaId: id, kind: "OFFER", affiliateCampaignId: data.affiliateCampaignId },
          data: { campaignId: data.campaignId },
        });
      recompute = true;
    }
  } else {
    const createdRow = await prisma.persona.create({
      data: { ...row, createdById: user.id },
      select: { id: true },
    });
    id = createdRow.id;
    created = true;
    await audit({
      userId: user.id,
      action: "persona.created",
      entityType: "Persona",
      entityId: id,
      metadata: { name: data.name, isActive: data.isActive, ...faqMeta },
    });
  }
  if (faqChanged)
    await audit({
      userId: user.id,
      action: "persona.faq_updated",
      entityType: "Persona",
      entityId: id,
      // Nombres seulement : jamais le texte des questions ni des réponses dans le journal.
      metadata: { universe: data.universe, before: beforeFaq.length, after: faq.length },
    });
  const wasActive = before?.isActive ?? false;
  if (data.isActive !== wasActive && (before || data.isActive))
    await audit({
      userId: user.id,
      action: data.isActive ? "persona.activated" : "persona.deactivated",
      entityType: "Persona",
      entityId: id,
    });

  // Recalcul complet des statistiques (regroupé, attente bornée : n'empêche jamais l'enregistrement).
  if (recompute)
    await refreshCampaignStats().catch((err: unknown) =>
      console.error("[personas] recalcul des statistiques non demandé :", err),
    );

  const { notes, problems } = await refreshPersonaBotProfiles(id);
  return {
    ok: true,
    id,
    created,
    message: [
      saveMessage({ created, name: data.name, isActive: data.isActive, wasActive }),
      ...notes,
    ].join(" "),
    problem: problems.length ? problems.join(" ") : null,
  };
}

/** Phrase de réussite d'un enregistrement (création, modification, activation). */
export function saveMessage(p: {
  created: boolean;
  name: string;
  isActive: boolean;
  wasActive: boolean;
}): string {
  if (p.created)
    return `Persona ${p.name ? `« ${p.name} » ` : ""}créée.${
      p.isActive
        ? " Elle est activée."
        : " Elle est désactivée : testez-la (« Tester »), puis cochez « Persona activée »."
    }`;
  if (p.isActive !== p.wasActive)
    return p.isActive
      ? "Modifications enregistrées. La persona est activée."
      : "Modifications enregistrées. La persona est désactivée : l'assistant ne répond plus avec elle.";
  return "Modifications enregistrées.";
}

export type PersonaDeleteResult = { ok: true; message: string } | { ok: false; error: string };

/** Supprime une persona (ADMIN) ; refusé tant qu'un bot l'utilise. Les conversations gardent leur historique. */
export async function deletePersona(id: string, user: SaveUser): Promise<PersonaDeleteResult> {
  if (user.role !== "ADMIN")
    return {
      ok: false,
      error:
        "Seul un administrateur peut supprimer une persona. Vous pouvez la désactiver (case « Persona activée »).",
    };
  const persona = await prisma.persona.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      bots: { select: { username: true }, orderBy: { username: "asc" } },
    },
  });
  if (!persona) return { ok: false, error: "Cette persona n'existe plus." };
  if (persona.bots.length > 0) {
    const names = persona.bots.map((b) => `@${b.username}`).join(", ");
    return {
      ok: false,
      error: `Suppression impossible : ${persona.bots.length > 1 ? "les bots" : "le bot"} ${names} ${persona.bots.length > 1 ? "l'utilisent" : "l'utilise"}. Dans Réglages → Bots, liez une autre persona (ou repassez le bot en bot normal), puis supprimez-la.`,
    };
  }
  await prisma.persona.delete({ where: { id } });
  await audit({
    userId: user.id,
    action: "persona.deleted",
    entityType: "Persona",
    entityId: id,
    metadata: { name: persona.name },
  });
  return {
    ok: true,
    message: `Persona ${persona.name ? `« ${persona.name} » ` : ""}supprimée. Ses conversations restent dans la boîte de réception.`,
  };
}
