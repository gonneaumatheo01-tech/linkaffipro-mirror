/**
 * Bookmakers partenaires d'une persona Paris sportifs (bot VIP) : pour chacun, l'offre Link Affi du lien d'inscription
 * et le lien du canal VIP envoyé quand la personne confirme son dépôt. L'ordre de la liste est l'ordre de proposition
 * (le premier est proposé d'abord, le suivant si la personne a déjà un compte). Règles pures : le brouillon du
 * formulaire, sa lecture et sa vérification ; l'existence des offres et des liens est vérifiée par l'enregistrement.
 */

/** Bookmakers par persona, au plus. */
export const MAX_PERSONA_BOOKMAKERS = 6;
/** Nom affiché d'un bookmaker, au plus. */
export const MAX_BOOKMAKER_LABEL = 60;

/** Une ligne du formulaire (les identifiants restent du texte, "" = rien de choisi). */
export type PersonaBookmakerDraft = {
  /** Clé interne (donnée au modèle) : "" pour un bookmaker ajouté, calculée depuis le nom à l'enregistrement. */
  bookmakerKey: string;
  label: string;
  affiliateCampaignId: string;
  inviteLinkId: string;
};

/** Bookmaker vérifié, prêt à enregistrer (priorité = rang dans la liste, à partir de 1). */
export type PersonaBookmakerData = {
  bookmakerKey: string;
  label: string;
  priority: number;
  affiliateCampaignId: string;
  inviteLinkId: string | null;
};

/** Ligne enregistrée telle que la lit le formulaire. */
export type PersonaBookmakerRecord = {
  bookmakerKey: string;
  label: string;
  priority: number;
  affiliateCampaignId: string | null;
  inviteLinkId: string | null;
};

export function emptyBookmakerDraft(): PersonaBookmakerDraft {
  return { bookmakerKey: "", label: "", affiliateCampaignId: "", inviteLinkId: "" };
}

/** Brouillon depuis les lignes enregistrées, dans l'ordre de proposition. */
export function bookmakersToDraft(
  rows: readonly PersonaBookmakerRecord[] | null | undefined,
): PersonaBookmakerDraft[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({
      bookmakerKey: r.bookmakerKey,
      label: r.label,
      affiliateCampaignId: r.affiliateCampaignId ?? "",
      inviteLinkId: r.inviteLinkId ?? "",
    }));
}

/** Clé interne depuis le nom : « Bet Portal » → « betportal » (lettres et chiffres sans accent). */
export function bookmakerKeyOf(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

const KEY = /^[a-z0-9]{1,40}$/;

export type BookmakersValidation =
  { ok: true; books: PersonaBookmakerData[] } | { ok: false; error: string };

/**
 * Lit la liste du formulaire. Gérant du VIP en Paris sportifs seulement ; chaque bookmaker a un nom et une offre ; le lien du canal VIP
 * est facultatif (sans lui, le bouton du canal VIP ne part pas). Une clé déjà enregistrée est gardée (les conversations
 * en cours la connaissent), une nouvelle est tirée du nom.
 */
export function validateBookmakers(
  raw: readonly PersonaBookmakerDraft[],
  universe: string,
  identityKind: string = "VIP_MANAGER",
): BookmakersValidation {
  if (raw.length === 0) return { ok: true, books: [] };
  if (universe !== "sports")
    return {
      ok: false,
      error:
        "Les bookmakers partenaires ne servent qu'en Paris sportifs : retirez-les, ou repassez la persona en Paris sportifs.",
    };
  if (identityKind !== "VIP_MANAGER")
    return {
      ok: false,
      error:
        "Les bookmakers partenaires sont réservés au gérant du VIP : choisissez « Gérant du VIP » dans « Qui est-elle ? », ou retirez-les.",
    };
  if (raw.length > MAX_PERSONA_BOOKMAKERS)
    return { ok: false, error: `${MAX_PERSONA_BOOKMAKERS} bookmakers au plus.` };
  const books: PersonaBookmakerData[] = [];
  for (const [i, d] of raw.entries()) {
    const n = i + 1;
    const label = d.label.replace(/\s+/g, " ").trim();
    if (!label) return { ok: false, error: `Bookmaker ${n} : écrivez son nom.` };
    if (label.length > MAX_BOOKMAKER_LABEL)
      return {
        ok: false,
        error: `Bookmaker ${n} : nom de ${MAX_BOOKMAKER_LABEL} caractères au plus.`,
      };
    if (!d.affiliateCampaignId)
      return { ok: false, error: `${label} : choisissez l'offre Link Affi du lien d'inscription.` };
    const key = KEY.test(d.bookmakerKey) ? d.bookmakerKey : bookmakerKeyOf(label);
    if (!key)
      return {
        ok: false,
        error: `${label} : le nom doit contenir au moins une lettre ou un chiffre.`,
      };
    if (books.some((b) => b.bookmakerKey === key))
      return { ok: false, error: `${label} est en double : gardez une seule ligne par bookmaker.` };
    books.push({
      bookmakerKey: key,
      label,
      priority: n,
      affiliateCampaignId: d.affiliateCampaignId,
      inviteLinkId: d.inviteLinkId || null,
    });
  }
  return { ok: true, books };
}

/** Même liste enregistrée (ordre, noms, offres, liens) : rien à écrire ni à journaliser. */
export function sameBookmakers(
  a: readonly PersonaBookmakerData[],
  b: readonly PersonaBookmakerData[],
): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        y !== undefined &&
        x.bookmakerKey === y.bookmakerKey &&
        x.label === y.label &&
        x.priority === y.priority &&
        x.affiliateCampaignId === y.affiliateCampaignId &&
        x.inviteLinkId === y.inviteLinkId
      );
    })
  );
}
