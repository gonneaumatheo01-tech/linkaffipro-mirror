/**
 * Phase 34 — métadonnées des opérations du lot C pour Kevin (voir `../contract.ts`) : campagnes, liens, offres,
 * affiliés, imports, membres, envois groupés, relances automatiques, conversations, personas, recalcul des
 * statistiques. Les cœurs sont dans `apps/web/lib/site-ops/ops/lot-c/*` (mêmes validations que le site). Pur.
 */
import type { SiteOpMeta } from "../contract";

type Schema = Record<string, unknown>;
const str = (description: string, extra: Schema = {}): Schema => ({
  type: "string",
  description,
  ...extra,
});
const num = (description: string, extra: Schema = {}): Schema => ({
  type: "number",
  description,
  ...extra,
});
const int = (description: string, extra: Schema = {}): Schema => ({
  type: "integer",
  description,
  ...extra,
});
const bool = (description: string): Schema => ({ type: "boolean", description });
const en = (description: string, values: readonly string[]): Schema => ({
  type: "string",
  enum: [...values],
  description,
});
const strs = (description: string): Schema => ({
  type: "array",
  items: { type: "string" },
  description,
});
function obj(properties: Record<string, Schema>, required: string[] = []): Schema {
  return { type: "object", properties, required, additionalProperties: false };
}

const F = {
  campaigns: "app/(admin)/campaigns/actions.ts",
  links: "app/(admin)/campaigns/links/actions.ts",
  import: "app/(admin)/campaigns/import/actions.ts",
  wizard: "app/(admin)/campaigns/new/actions.ts",
  affiliates: "app/(admin)/campaigns/affiliates/actions.ts",
  member: "app/(admin)/members/[id]/actions.ts",
  broadcasts: "app/(admin)/members/broadcasts/actions.ts",
  automations: "app/(admin)/members/automations/actions.ts",
  conversation: "app/(admin)/conversations/[id]/actions.ts",
  personas: "app/(admin)/conversations/personas/actions.ts",
  personaMedia: "app/(admin)/conversations/personas/[id]/media-actions.ts",
  dashboard: "app/(admin)/dashboard/actions.ts",
} as const;
const sa = (file: keyof typeof F, ...fns: string[]) => fns.map((f) => `${F[file]}#${f}`);

const CAMPAIGN = {
  campaign: str("Notre campagne : son nom (ex. « Celsius FR ») ou son identifiant."),
};
const PLATFORM = en("Plateforme des pubs.", ["TIKTOK", "META", "OTHER"]);
const DAY = (what: string) =>
  str(`${what} au format AAAA-MM-JJ (jour de Paris).`, { pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const PARIS_TIME = str(
  "Date et heure de Paris au format AAAA-MM-JJTHH:mm (ex. 2026-10-26T20:00).",
  {
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
  },
);
const MEMBER = {
  member: str(
    "Le membre : prénom et nom, @pseudo, identifiant Telegram ou identifiant de la fiche.",
  ),
};
const BROADCAST = { broadcast: str("L'envoi groupé : son nom ou son identifiant.") };
const RULE = {
  rule: str("La relance : son nom ou son identifiant."),
  templateKey: en("Ou la relance prête à l'emploi (carte) visée.", [
    "welcome",
    "offer_no_signup",
    "signup_no_deposit",
    "inactive_7d",
    "first_deposit_thanks",
    "vip",
  ]),
};
const CONVERSATION = {
  id: str("Identifiant de la conversation, si connu."),
  member: str("Ou la personne (prénom, @pseudo) : sa conversation la plus récente."),
};
const PERSONA = { persona: str("La persona : son prénom ou son identifiant.") };
const FILE = obj(
  {
    fileName: str("Nom du fichier."),
    text: str("Contenu du fichier CSV (rempli par Kevin depuis le document reçu)."),
  },
  ["text"],
);
const FORWARDED = {
  type: "object",
  description:
    "Message transféré à Kevin, repris tel quel (texte HTML et emojis animés jamais réécrits ; rempli par Kevin).",
  properties: {
    html: { type: "string" },
    media: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string" }, fileId: { type: "string" } },
        required: ["kind", "fileId"],
        additionalProperties: false,
      },
    },
    from: { type: ["string", "null"] },
    receivedAt: { type: "string" },
  },
  required: ["html", "media", "receivedAt"],
  additionalProperties: false,
};
const SEGMENT = {
  channels: strs("Canaux dont les membres reçoivent le message (noms ou identifiants)."),
  campaigns: strs("Ou membres arrivés par ces campagnes (noms)."),
  membershipStatuses: strs(
    "Statuts d'adhésion (APPROVED = membre accepté, REQUESTED, PENDING_GATE, LEFT…) ; vide = tous.",
  ),
  languages: str("Langues des membres, séparées par des virgules (fr, en…)."),
  tags: str("Étiquettes des membres, séparées par des virgules."),
  inactiveDays: int("Seulement les membres sans activité depuis ce nombre de jours."),
  spendLevels: strs("Niveaux de dépense (AUCUN, INSCRIT, DEPOSANT, REGULIER, VIP)."),
};
const CARD = {
  templateKey: RULE.templateKey,
  text: str(
    "Texte du message du bot (HTML Telegram ; {prenom} et {canal} sont remplacés pour chaque membre).",
  ),
  delay: str("Délai : « now » (tout de suite) ou un nombre d'heures (1 à 2160)."),
  inactiveDays: int("Relance des inactifs : nombre de jours sans activité (1 à 365)."),
  level: str("Relance VIP : seuil de dépense (DEPOSANT, REGULIER, VIP)."),
  channels: strs("Canaux concernés (noms) ; vide = tous les canaux."),
  bot: str("Bot qui écrit (nom ou @nom) ; par défaut celui du canal."),
  mediaAssetId: str("Média de la médiathèque joint au message (identifiant)."),
};

export const LOT_C_OPS: SiteOpMeta[] = [
  // -------------------------------------------------------------------------------------------------------------
  // Campagnes, liens, offres, affiliés, imports
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "campagnes.creer",
    domain: "campagnes",
    description:
      "Créer une campagne (assistant du site) : nom, univers, offres Link Affi, canaux, plateforme et nombre de pubs (un lien d'entrée par pub), budget, dates ; pays et rémunération notés dans les notes.",
    examples: [
      "crée une campagne pour Celsius en France avec un CPA de 120",
      "nouvelle campagne TikTok Casino Octobre sur Zone Interdite avec 3 pubs",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        name: str("Nom de la campagne (120 caractères au plus), ex. « Celsius FR »."),
        vertical: en("Univers.", ["CASINO", "SPORTS", "DATING"]),
        offers: strs("Offres Link Affi rattachées (noms, clés ou liens linkaffi.me/go/<clé>)."),
        channels: strs("Canaux de la campagne (noms, @noms ou identifiants)."),
        entryChannel: str("Canal que les liens des pubs font rejoindre (un des canaux)."),
        adPlatform: PLATFORM,
        adCount: int("Nombre de pubs (0 à 20) : un lien d'entrée par pub.", {
          minimum: 0,
          maximum: 20,
        }),
        budgetDaily: num("Budget pub par jour, en euros."),
        startAt: DAY("Début"),
        endAt: DAY("Fin"),
        country: str("Pays visé (noté dans les notes de la campagne)."),
        cpa: num(
          "CPA convenu en euros (noté dans les notes ; la commission réelle vient de Link Affi).",
        ),
        revshare: num("Part du revenu en % (notée dans les notes)."),
        notes: str("Notes libres (2000 caractères au plus)."),
        connectionId: str("Compte publicitaire connecté (identifiant), facultatif."),
      },
      ["name"],
    ),
    serverActions: sa("wizard", "createCampaignWizardAction"),
  },
  {
    key: "campagnes.modifier",
    domain: "campagnes",
    description:
      "Modifier une campagne : nom, plateforme, univers, statut, budget par jour, dates, canaux, compte pub, notes (les champs non dits ne changent pas).",
    examples: [
      "mets la campagne Celsius en pause",
      "passe le budget de Celsius FR à 50 € par jour",
    ],
    kind: "setting",
    role: "MANAGER",
    // Budget par jour, statut ACTIVE, compte pub : dépense possible → OUI / NON (règle de la phase 33).
    confirm: "yes",
    params: obj(
      {
        ...CAMPAIGN,
        name: str("Nouveau nom."),
        status: en("Statut.", ["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
        adPlatform: en("Plateforme (vide = aucune).", ["", "TIKTOK", "META", "OTHER"]),
        vertical: en("Univers.", ["", "CASINO", "SPORTS", "DATING"]),
        budgetDaily: str("Budget par jour en euros (vide = aucun)."),
        startAt: str("Début AAAA-MM-JJ (vide = aucun)."),
        endAt: str("Fin AAAA-MM-JJ (vide = aucune)."),
        notes: str("Notes."),
        channels: strs("Canaux de la campagne (liste complète, noms)."),
        connectionId: str("Compte publicitaire connecté (identifiant ; vide = sans compte)."),
      },
      ["campaign"],
    ),
    serverActions: sa("campaigns", "updateCampaignAction"),
  },
  {
    key: "campagnes.supprimer",
    domain: "campagnes",
    description:
      "Supprimer une campagne : groupes, pubs, dépenses et statistiques supprimés ; liens, membres, clics et joueurs gardés.",
    examples: ["supprime la campagne Celsius", "efface la campagne de test TT-octobre"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...CAMPAIGN }, ["campaign"]),
    serverActions: sa("campaigns", "deleteCampaignAction"),
  },
  {
    key: "campagnes.canaux",
    domain: "campagnes",
    description:
      "Choisir les canaux d'une campagne (liste complète, ou ajouter / retirer des canaux).",
    examples: [
      "ajoute Zone Interdite à la campagne Celsius",
      "retire le canal VIP de la campagne Casino Octobre",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...CAMPAIGN,
        channels: strs("Canaux (noms ou identifiants)."),
        mode: en("add = ajouter, remove = retirer, replace = liste complète (par défaut).", [
          "add",
          "remove",
          "replace",
        ]),
      },
      ["campaign", "channels"],
    ),
    serverActions: sa("campaigns", "updateChannelsAction"),
  },
  {
    key: "campagnes.offre_ajouter",
    domain: "campagnes",
    description:
      "Rattacher une offre Link Affi à une campagne (par son nom, ou par un lien linkaffi.me/go/<clé>).",
    examples: [
      "ajoute l'offre Celsius à la campagne Casino Octobre",
      "rattache linkaffi.me/go/47eb8mwc à Celsius FR",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...CAMPAIGN,
        offer: str("Offre Link Affi : son nom ou sa clé."),
        reference: str("Ou le lien d'offre collé (https://linkaffi.me/go/<clé>) ou la clé seule."),
      },
      ["campaign"],
    ),
    serverActions: sa("campaigns", "addOfferAction"),
  },
  {
    key: "campagnes.offre_retirer",
    domain: "campagnes",
    description:
      "Retirer une offre Link Affi d'une campagne (les boutons déjà publiés passent à une autre offre).",
    examples: [
      "retire l'offre Celsius de la campagne Casino Octobre",
      "enlève l'offre Betify de Celsius FR",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...CAMPAIGN, offer: str("Offre Link Affi : son nom ou sa clé.") }, [
      "campaign",
      "offer",
    ]),
    serverActions: sa("campaigns", "removeOfferAction"),
  },
  {
    key: "campagnes.groupe_ajouter",
    domain: "campagnes",
    description: "Ajouter un groupe de pubs à une campagne.",
    examples: [
      "ajoute un groupe « Femmes 25-34 » à la campagne Celsius",
      "crée le groupe Retargeting dans Casino Octobre",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...CAMPAIGN, name: str("Nom du groupe.") }, ["campaign", "name"]),
    serverActions: sa("campaigns", "addAdSetAction"),
  },
  {
    key: "campagnes.groupe_supprimer",
    domain: "campagnes",
    description:
      "Supprimer un groupe de pubs et ses pubs (leurs liens d'entrée restent dans la campagne).",
    examples: [
      "supprime le groupe Retargeting de Celsius",
      "efface le groupe 2 de la campagne Casino Octobre",
    ],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...CAMPAIGN, adSet: str("Nom du groupe.") }, ["campaign", "adSet"]),
    serverActions: sa("campaigns", "deleteAdSetAction"),
  },
  {
    key: "campagnes.pub_ajouter",
    domain: "campagnes",
    description:
      "Ajouter une pub précise dans un groupe (avec, si on veut, un lien d'entrée existant).",
    examples: [
      "ajoute la pub « Vidéo plage » au groupe 1 de Celsius",
      "nouvelle pub Story 2 dans Retargeting",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...CAMPAIGN,
        adSet: str("Groupe de la pub (nom)."),
        name: str("Nom de la pub."),
        link: str("Lien d'entrée à lui rattacher (nom ou adresse courte), facultatif."),
      },
      ["campaign", "adSet", "name"],
    ),
    serverActions: sa("campaigns", "addAdAction"),
  },
  {
    key: "campagnes.pub_supprimer",
    domain: "campagnes",
    description:
      "Supprimer une pub précise (ses dépenses propres ; son lien d'entrée reste dans la campagne).",
    examples: ["supprime la pub Vidéo plage de Celsius", "efface la pub 3 de Casino Octobre"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...CAMPAIGN, ad: str("Nom de la pub.") }, ["campaign", "ad"]),
    serverActions: sa("campaigns", "deleteAdAction"),
  },
  {
    key: "campagnes.pub_lien",
    domain: "campagnes",
    description: "Rattacher un lien d'entrée à une pub précise, ou le détacher.",
    examples: [
      "mets le lien TikTok 26/10 sur la pub Vidéo plage",
      "détache le lien de la pub 2 de Celsius",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...CAMPAIGN,
        ad: str("Nom de la pub."),
        link: str("Lien d'entrée (nom ou adresse courte)."),
        detach: bool("Vrai pour détacher le lien actuel de la pub."),
      },
      ["campaign", "ad"],
    ),
    serverActions: sa("campaigns", "attachLinkAction"),
  },
  {
    key: "campagnes.lien_entree",
    domain: "campagnes",
    description:
      "Ajouter à une campagne une pub et son lien d'entrée (lien goolink + invitation Telegram avec demande d'adhésion).",
    examples: [
      "ajoute un lien d'entrée vers Zone Interdite à la campagne Celsius",
      "nouveau lien TikTok pour la pub 4 de Casino Octobre",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...CAMPAIGN,
        channel: str("Canal que le lien fait rejoindre (nom, @nom ou identifiant)."),
        platform: PLATFORM,
        adName: str("Nom de la pub (par défaut « Pub N »)."),
        adSetName: str("Groupe (par défaut « Groupe 1 »)."),
      },
      ["campaign", "channel"],
    ),
    serverActions: sa("campaigns", "addEntryLinkAction"),
  },
  {
    key: "campagnes.rattacher_pub_importee",
    domain: "campagnes",
    description:
      "Reprendre dans une campagne une campagne pub importée de TikTok / Meta (ses groupes, pubs et dépenses).",
    examples: [
      "rattache la campagne pub TT-celsius-10 à Celsius FR",
      "reprends la campagne Meta importée Casino_oct dans Casino Octobre",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "yes",
    params: obj({ ...CAMPAIGN, imported: str("Campagne pub importée (son nom).") }, [
      "campaign",
      "imported",
    ]),
    serverActions: sa("campaigns", "attachImportedCampaignAction"),
  },
  {
    key: "campagnes.depense_ajouter",
    domain: "campagnes",
    description:
      "Saisir à la main la dépense pub d'un jour (campagne, groupe ou pub) ; refusé si TikTok / Meta l'envoie déjà par l'API.",
    examples: [
      "ajoute 150 € de dépense TikTok hier sur Celsius",
      "la pub Vidéo plage a coûté 42,50 € le 20 octobre",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "yes",
    params: obj(
      {
        ...CAMPAIGN,
        date: DAY("Jour de la dépense"),
        spend: num("Montant dépensé en euros (ex. 150 ou 42.5).", { minimum: 0 }),
        adSet: str("Groupe concerné (nom), facultatif."),
        ad: str("Pub concernée (nom), facultatif."),
        impressions: str("Impressions (facultatif)."),
        clicks: str("Clics (facultatif)."),
      },
      ["campaign", "date", "spend"],
    ),
    serverActions: sa("campaigns", "addManualCostAction"),
  },
  {
    key: "campagnes.lien_suivi",
    domain: "campagnes",
    description:
      "Créer un ou plusieurs liens de suivi d'entrée vers un canal (goolink + invitation Telegram avec demande d'adhésion), un par nom ; Kevin renvoie les adresses.",
    examples: [
      "donne-moi un lien de suivi pour TikTok sur Zone Interdite",
      "crée 3 liens Meta pour Casino VIP : story 1, story 2, reel",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        channel: str("Canal à rejoindre (nom, @nom ou identifiant)."),
        platform: en("Plateforme (TikTok, Meta, autre).", [
          "TIKTOK",
          "META",
          "OTHER",
          "tiktok",
          "meta",
          "facebook",
          "instagram",
          "other",
        ]),
        names: strs("Noms des liens (un lien par nom) ; par défaut « TikTok JJ/MM »."),
        language: str("Langue des membres (fr, en…) ; par défaut celle du canal."),
        adCampaignName: str("Campagne pub (nom chez TikTok / Meta), facultatif."),
        adSetName: str("Groupe de pubs, facultatif."),
        adName: str("Pub, facultatif."),
      },
      ["channel", "platform"],
    ),
    serverActions: sa("links", "createEntryLinksAction"),
  },
  {
    key: "campagnes.lien_generique",
    domain: "campagnes",
    description: "Créer un lien suivi go.goolink.eu vers n'importe quelle adresse https.",
    examples: [
      "fais-moi un lien suivi vers https://exemple.com/promo nommé Promo Noël",
      "crée un lien goolink pour mon site",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ label: str("Nom du lien."), url: str("Adresse complète (https://…).") }, [
      "label",
      "url",
    ]),
    serverActions: sa("links", "createGenericLinkAction"),
  },
  {
    key: "campagnes.lien_activer",
    domain: "campagnes",
    description:
      "Activer ou désactiver un lien suivi (désactivé, il renvoie vers l'accueil du site).",
    examples: ["désactive le lien TikTok 26/10", "réactive le lien Promo Noël"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        link: str("Le lien : son nom ou son adresse courte."),
        active: bool("Vrai = actif, faux = désactivé."),
      },
      ["link", "active"],
    ),
    serverActions: sa("links", "toggleLinkAction"),
  },
  {
    key: "campagnes.import_apercu",
    domain: "campagnes",
    description:
      "Lire un fichier CSV de dépenses TikTok / Meta envoyé à Kevin : plateforme et colonnes détectées, lignes, erreurs, campagnes reconnues (rien n'est importé).",
    examples: [
      "regarde ce fichier de dépenses TikTok",
      "qu'est-ce qu'il y a dans cet export Meta ?",
    ],
    kind: "read",
    role: "MANAGER",
    confirm: "none",
    params: obj({
      file: FILE,
      platform: en("Plateforme (AUTO = détection).", ["AUTO", "TIKTOK", "META", "OTHER"]),
      numberFormat: en("Format des nombres.", ["auto", "fr", "en"]),
      dateFormat: en("Format des dates.", ["auto", "dmy", "mdy", "ymd"]),
    }),
    inputs: ["file"],
    serverActions: sa("import", "previewImportAction"),
  },
  {
    key: "campagnes.importer_couts",
    domain: "campagnes",
    description:
      "Importer les dépenses pub d'un fichier CSV envoyé à Kevin (aperçu : lignes et erreurs, puis OUI) : pubs manquantes créées, dépenses par jour.",
    examples: ["importe ce fichier de dépenses TikTok", "ajoute les coûts Meta de cet export"],
    kind: "create",
    role: "MANAGER",
    confirm: "yes",
    params: obj({
      file: FILE,
      platform: en("Plateforme (AUTO = détection).", ["AUTO", "TIKTOK", "META", "OTHER"]),
      numberFormat: en("Format des nombres.", ["auto", "fr", "en"]),
      dateFormat: en("Format des dates.", ["auto", "dmy", "mdy", "ymd"]),
    }),
    inputs: ["file"],
    serverActions: sa("import", "confirmImportAction"),
  },
  {
    key: "campagnes.tutoriel_affilies_masquer",
    domain: "campagnes",
    description:
      "Ne plus afficher le mini-tutoriel « Affiliés sur vos canaux » sur le site (pour ce compte).",
    examples: [
      "cache le tutoriel des affiliés",
      "je n'ai plus besoin du mode d'emploi des affiliés",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({}),
    serverActions: sa("affiliates", "dismissAffiliatesTutorialAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Statistiques
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "statistiques.recalculer",
    domain: "statistiques",
    description:
      "Relancer le recalcul complet des statistiques journalières (en arrière-plan, une minute).",
    examples: ["recalcule les statistiques", "les chiffres d'hier sont faux, relance le calcul"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({}),
    serverActions: sa("dashboard", "recomputeStatsAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "membres.note_ajouter",
    domain: "membres",
    description: "Ajouter une note sur la fiche d'un membre (2000 caractères au plus).",
    examples: [
      "note sur Paul Martin : a demandé un bonus",
      "ajoute une note à @jeanbet : joueur VIP",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...MEMBER, text: str("Texte de la note.") }, ["member", "text"]),
    serverActions: sa("member", "addNoteAction"),
  },
  {
    key: "membres.note_modifier",
    domain: "membres",
    description:
      "Modifier une note d'un membre (la sienne, ou n'importe laquelle pour un administrateur) ; par défaut la dernière.",
    examples: ["corrige ma dernière note sur Paul : bonus refusé", "modifie la note de @jeanbet"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...MEMBER,
        noteId: str("Identifiant de la note (sinon la dernière du membre)."),
        text: str("Nouveau texte."),
      },
      ["text"],
    ),
    serverActions: sa("member", "editNoteAction"),
  },
  {
    key: "membres.note_supprimer",
    domain: "membres",
    description:
      "Supprimer une note d'un membre (la sienne, ou n'importe laquelle pour un administrateur) ; par défaut la dernière.",
    examples: ["supprime ma dernière note sur Paul", "efface la note de @jeanbet"],
    kind: "delete",
    role: "MANAGER",
    confirm: "delete",
    params: obj({
      ...MEMBER,
      noteId: str("Identifiant de la note (sinon la dernière du membre)."),
    }),
    serverActions: sa("member", "deleteNoteAction"),
  },
  {
    key: "membres.etiquettes",
    domain: "membres",
    description: "Poser ou retirer des étiquettes (de Réglages → Étiquettes) sur un membre.",
    examples: ["mets l'étiquette VIP à Paul Martin", "retire l'étiquette à relancer de @jeanbet"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...MEMBER,
        add: strs("Étiquettes à poser."),
        remove: strs("Étiquettes à retirer."),
        tags: strs("Ou la liste complète des étiquettes du registre."),
      },
      ["member"],
    ),
    serverActions: sa("member", "setMemberTagsAction"),
  },
  {
    key: "membres.anonymiser",
    domain: "membres",
    description:
      "Supprimer un membre à sa demande (anonymisation, irréversible) : identité, notes et conversations effacées ; statistiques gardées sans donnée personnelle.",
    examples: ["supprime le membre Paul Martin, il l'a demandé", "anonymise @jeanbet"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...MEMBER }, ["member"]),
    serverActions: sa("member", "anonymizeMemberAction"),
  },
  {
    key: "membres.affilie_changer",
    domain: "membres",
    description:
      "Rattacher un membre à une autre campagne Telegram d'affilié Link Affi, avec un motif.",
    examples: [
      "Paul Martin vient de l'affilié Max (campagne max-casino), corrige",
      "rattache @jeanbet à la campagne d'affilié promo-oct : erreur de lien",
    ],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj(
      {
        ...MEMBER,
        affiliate: str("Campagne Telegram d'affilié : son nom, sa clé ou le nom de l'affilié."),
        reason: str("Motif de la correction."),
      },
      ["member", "affiliate", "reason"],
    ),
    serverActions: sa("member", "changeMemberAffiliateAction"),
  },
  {
    key: "membres.affilie_retirer",
    domain: "membres",
    description: "Retirer l'affilié d'un membre (plus aucun affilié), avec un motif.",
    examples: [
      "retire l'affilié de Paul Martin, il est venu tout seul",
      "@jeanbet n'a pas d'affilié, enlève-le",
    ],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj({ ...MEMBER, reason: str("Motif.") }, ["member", "reason"]),
    serverActions: sa("member", "removeMemberAffiliateAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Envois groupés (« Écrire à un groupe »)
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "envois.creer",
    domain: "envois",
    description:
      "Écrire à un groupe de membres en privé : message transféré (gardé tel quel) ou texte donné, groupe (canaux, campagnes, statuts, langues, étiquettes…), tout de suite, à une heure, ou en brouillon ; test A/B possible.",
    examples: [
      "envoie ce message à tous les membres de Zone Interdite demain 20 h",
      "écris aux membres de Casino VIP qui parlent anglais : nouveau bonus ce soir",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({
      forwarded: FORWARDED,
      text: str(
        "Texte (HTML Telegram) si aucun message n'est transféré ; {prenom} et {bot} sont remplacés.",
      ),
      name: str("Nom de l'envoi (par défaut « Envoi du JJ/MM (Kevin) »)."),
      bot: str("Bot qui écrit (nom ou @nom) ; par défaut le bot principal du premier canal."),
      ...SEGMENT,
      scheduledAt: PARIS_TIME,
      intent: en("now = tout de suite, schedule = à l'heure dite, draft = brouillon.", [
        "now",
        "schedule",
        "draft",
      ]),
      mediaAssetId: str("Média de la médiathèque joint (identifiant)."),
      buttons: {
        type: "array",
        description: "Rangées de boutons (comme sur le site).",
        items: { type: "array", items: { type: "object" } },
      },
      abEnabled: en("« 1 » pour un test A/B.", ["1"]),
      textB: str("Texte de la version B (test A/B)."),
      abSplit: int("Part de la version A en % (test A/B)."),
    }),
    inputs: ["forwarded"],
    serverActions: sa("broadcasts", "createBroadcastAction"),
  },
  {
    key: "envois.creer_et_tester",
    domain: "envois",
    description:
      "Enregistrer un envoi en brouillon et me l'envoyer en test sur mon Telegram (rien ne part vers les membres).",
    examples: [
      "prépare ce message pour Zone Interdite et envoie-le moi en test",
      "fais un brouillon de cet envoi et montre-le moi sur Telegram",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({
      forwarded: FORWARDED,
      text: str("Texte (HTML Telegram) si aucun message n'est transféré."),
      name: str("Nom de l'envoi."),
      bot: str("Bot qui écrit (nom ou @nom)."),
      ...SEGMENT,
      mediaAssetId: str("Média de la médiathèque joint (identifiant)."),
    }),
    inputs: ["forwarded"],
    serverActions: sa("broadcasts", "createAndTestAction"),
  },
  {
    key: "envois.envoyer_maintenant",
    domain: "envois",
    description: "Lancer tout de suite un envoi en brouillon ou programmé.",
    examples: [
      "lance l'envoi Bonus du soir maintenant",
      "envoie tout de suite le brouillon Promo Halloween",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({ ...BROADCAST }, ["broadcast"]),
    serverActions: sa("broadcasts", "sendNowAction"),
  },
  {
    key: "envois.programmer",
    domain: "envois",
    description: "Programmer un envoi en brouillon (ou changer son heure).",
    examples: [
      "programme l'envoi Promo Halloween samedi 18 h",
      "décale l'envoi Bonus du soir à 21 h",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({ ...BROADCAST, scheduledAt: PARIS_TIME }, ["broadcast", "scheduledAt"]),
    serverActions: sa("broadcasts", "scheduleAction"),
  },
  {
    key: "envois.annuler",
    domain: "envois",
    description:
      "Annuler un envoi programmé ou en cours (les messages encore en attente ne partent pas).",
    examples: ["annule l'envoi Promo Halloween", "stoppe l'envoi en cours"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...BROADCAST }, ["broadcast"]),
    serverActions: sa("broadcasts", "cancelBroadcastAction"),
  },
  {
    key: "envois.tester_sur_moi",
    domain: "envois",
    description:
      "M'envoyer un envoi en message de test sur mon Telegram, personnalisé comme pour un membre.",
    examples: [
      "envoie-moi l'envoi Promo Halloween en test",
      "teste le brouillon Bonus du soir sur moi",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...BROADCAST }, ["broadcast"]),
    serverActions: sa("broadcasts", "testToMeAction"),
  },
  {
    key: "envois.gagnante_au_reste",
    domain: "envois",
    description: "Test A/B : envoyer la version gagnante aux membres du groupe pas encore servis.",
    examples: [
      "envoie la gagnante du test A/B Promo au reste",
      "la version A a gagné, envoie-la aux autres",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({ ...BROADCAST, groupId: str("Identifiant du test A/B, si connu.") }),
    serverActions: sa("broadcasts", "sendWinnerToRestAction"),
  },
  {
    key: "envois.supprimer",
    domain: "envois",
    description: "Supprimer un brouillon ou un envoi annulé.",
    examples: ["supprime le brouillon Promo Halloween", "efface l'envoi annulé Bonus du soir"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...BROADCAST }, ["broadcast"]),
    serverActions: sa("broadcasts", "deleteDraftAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Relances automatiques
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "automatisations.carte",
    domain: "automatisations",
    description:
      "Régler une relance prête à l'emploi (bienvenue, offre sans inscription, inscrit sans dépôt, inactifs, merci du premier dépôt, VIP) : texte, délai, canaux, bot ; créée désactivée la première fois.",
    examples: [
      "change le message de bienvenue : Salut {prenom}, bienvenue !",
      "relance les inscrits sans dépôt après 48 h avec ce texte",
    ],
    kind: "setting",
    role: "MANAGER",
    // Relance déjà active : les prochains membres reçoivent le nouveau texte → aperçu exact + OUI.
    confirm: "send",
    params: obj(CARD, ["templateKey"]),
    serverActions: sa("automations", "saveCardAction"),
  },
  {
    key: "automatisations.enregistrer",
    domain: "automatisations",
    description:
      "Créer ou modifier une relance sur mesure (déclencheur, conditions, parcours à branches ou liste d'actions) ; créée désactivée.",
    examples: [
      "crée une relance pour ceux qui cliquent l'offre sans s'inscrire",
      "renomme la relance Cliqueurs en Cliqueurs octobre",
    ],
    kind: "setting",
    role: "MANAGER",
    // Modifier une relance active change ce que reçoivent les membres → OUI / NON.
    confirm: "yes",
    params: obj(
      {
        rule: str("Relance à modifier (nom), absente pour une création."),
        name: str("Nom (2 caractères au moins)."),
        trigger: en("Déclencheur.", [
          "JOINED",
          "OFFER_CLICKED",
          "REGISTERED",
          "DEPOSITED",
          "INACTIVE",
          "LEFT",
          "SPEND_LEVEL_REACHED",
        ]),
        conditions: str("Conditions en JSON (canaux, jours d'inactivité…)."),
        graph: str("Parcours à branches en JSON (comme l'éditeur du site)."),
        oncePerMember: bool("Une seule fois par membre."),
      },
      ["name", "trigger", "graph"],
    ),
    serverActions: sa("automations", "createRuleAction", "updateRuleAction", "saveRuleAction"),
  },
  {
    key: "automatisations.activer",
    domain: "automatisations",
    description:
      "Activer ou désactiver une relance (activée, elle écrit automatiquement aux membres concernés : aperçu du message avant le OUI).",
    examples: ["active la relance de bienvenue", "coupe la relance des inactifs"],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({ ...RULE, active: bool("Vrai = activer, faux = désactiver.") }, ["active"]),
    serverActions: sa("automations", "toggleRuleAction"),
  },
  {
    key: "automatisations.dupliquer",
    domain: "automatisations",
    description: "Dupliquer une relance (la copie est désactivée).",
    examples: ["duplique la relance Cliqueurs", "fais une copie de la relance de bienvenue"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...RULE }),
    serverActions: sa("automations", "duplicateRuleAction"),
  },
  {
    key: "automatisations.supprimer",
    domain: "automatisations",
    description: "Supprimer une relance.",
    examples: [
      "supprime la relance Cliqueurs octobre",
      "efface la copie de la relance de bienvenue",
    ],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ rule: RULE.rule }, ["rule"]),
    serverActions: sa("automations", "deleteRuleAction"),
  },
  {
    key: "automatisations.tester_sur_moi",
    domain: "automatisations",
    description: "Jouer une relance pour moi seul, en messages de test sur mon Telegram.",
    examples: [
      "teste la relance de bienvenue sur moi",
      "envoie-moi la relance des inactifs pour voir",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "none",
    params: obj({ ...RULE }),
    serverActions: sa("automations", "testRuleOnMeAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Conversations de l'assistante
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "conversations.prendre_la_main",
    domain: "conversations",
    description: "Prendre la main dans une conversation : l'assistante se tait, l'équipe écrit.",
    examples: ["prends la main avec Paul", "je réponds moi-même à @jeanbet"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(CONVERSATION),
    serverActions: sa("conversation", "takeOverAction"),
  },
  {
    key: "conversations.rendre",
    domain: "conversations",
    description: "Rendre une conversation à l'assistante (elle répond aux prochains messages).",
    examples: [
      "rends la conversation de Paul à l'assistante",
      "l'assistante peut reprendre avec @jeanbet",
    ],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(CONVERSATION),
    serverActions: sa("conversation", "releaseAction"),
  },
  {
    key: "conversations.fermer",
    domain: "conversations",
    description: "Fermer une conversation (ni réponse ni relance ; réouvrable).",
    examples: ["ferme la conversation avec Paul", "termine la discussion avec @jeanbet"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(CONVERSATION),
    serverActions: sa("conversation", "closeAction"),
  },
  {
    key: "conversations.bloquer",
    domain: "conversations",
    description:
      "Bloquer une conversation : plus aucun message ne part vers cette personne, définitivement.",
    examples: ["bloque la conversation avec Paul", "plus aucun message pour @spammeur"],
    kind: "setting",
    role: "MANAGER",
    confirm: "yes",
    params: obj(CONVERSATION),
    serverActions: sa("conversation", "blockAction"),
  },
  {
    key: "conversations.marquer_traitee",
    domain: "conversations",
    description: "Marquer une conversation « à traiter » comme traitée (rien d'autre ne change).",
    examples: ["la conversation de Paul est traitée", "marque @jeanbet comme traité"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(CONVERSATION),
    serverActions: sa("conversation", "clearNeedsHumanAction"),
  },
  {
    key: "conversations.ecrire",
    domain: "conversations",
    description:
      "Écrire dans une conversation à la place de l'assistante (l'équipe prend la main).",
    examples: [
      "réponds à Paul : on regarde ton bonus tout de suite",
      "écris à @jeanbet que son retrait est validé",
    ],
    kind: "send",
    role: "MANAGER",
    confirm: "send",
    params: obj({ ...CONVERSATION, text: str("Texte du message (texte simple).") }, ["text"]),
    serverActions: sa("conversation", "sendTeamMessageAction"),
  },
  // -------------------------------------------------------------------------------------------------------------
  // Personas
  // -------------------------------------------------------------------------------------------------------------
  {
    key: "univers.persona_enregistrer",
    domain: "univers",
    description:
      "Créer ou modifier une persona de l'assistante : prénom, âge, personnalité (ville, métier…), ton, langues, centres d'intérêt, offre et moment du lien, bookmakers partenaires d'un bot VIP Paris sportifs (offre d'inscription et lien du canal VIP de chacun, dans l'ordre), activation (créée désactivée).",
    examples: [
      "crée la persona Inès, 24 ans, Lyon, étudiante",
      "rends Inès plus drôle et active-la",
    ],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({
      ...PERSONA,
      name: str("Prénom (40 caractères au plus)."),
      gender: en("F = elle, M = il.", ["F", "M"]),
      identityKind: en("ASSISTANT = assistante déclarée ; GIRL = fille (Rencontres seulement).", [
        "ASSISTANT",
        "GIRL",
      ]),
      universe: en("Univers.", ["dating", "casino", "sports"]),
      age: int("Âge (18 à 99)."),
      personality: str("Personnalité : qui elle est (ville, études, métier, goûts)."),
      tone: str("Ton des messages."),
      styleExamples: str("Exemples de style."),
      languages: strs("Langues (fr, en, es, de, it, pt)."),
      interests: strs("Centres d'intérêt (12 au plus)."),
      affiliateCampaignId: str("Offre Link Affi présentée (identifiant)."),
      campaignId: str("Campagne de la persona (identifiant)."),
      offerPitch: str("Présentation de l'offre."),
      offerButtonText: str("Texte du bouton d'offre."),
      minExchangesBeforeOffer: int("Échanges avant le lien (1 à 20)."),
      maxOfferSends: int("Envois du lien au plus (1 à 3)."),
      followUpAfterHours: int("Relance après N heures (4 à 168)."),
      followUpsMax: int("Relances au plus (0 à 2)."),
      requireInterest: bool("Attendre un intérêt avant le lien."),
      bookmakers: {
        type: "array",
        description:
          "Paris sportifs seulement : bookmakers partenaires dans l'ordre de proposition (la liste entière, elle remplace l'ancienne). Lien du canal VIP facultatif.",
        items: {
          type: "object",
          properties: {
            label: str("Nom du bookmaker (Celsius Casino, Bet Portal…)."),
            affiliateCampaignId: str("Offre Link Affi du lien d'inscription (identifiant)."),
            inviteLinkId: str("Lien d'invitation du canal VIP (identifiant), facultatif."),
            bookmakerKey: str("Clé déjà enregistrée, à garder pour un bookmaker existant."),
          },
          required: ["label", "affiliateCampaignId"],
        },
      },
      extraPrompt: str("Consignes en plus."),
      isActive: bool("Persona activée."),
    }),
    serverActions: sa("personas", "savePersonaAction"),
  },
  {
    key: "univers.persona_supprimer",
    domain: "univers",
    description:
      "Supprimer une persona (refusé tant qu'un bot l'utilise ; ses conversations restent).",
    examples: ["supprime la persona Inès", "efface la persona de test Léa"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: obj({ ...PERSONA }, ["persona"]),
    serverActions: sa("personas", "deletePersonaAction"),
  },
  {
    key: "univers.persona_medias",
    domain: "univers",
    description:
      "Médias du personnage d'une persona : photos de référence envoyées à Kevin (3 au plus), fichier du personnage (LoRA), mot déclencheur, poids, consignes.",
    examples: ["voici les photos d'Inès", "le mot déclencheur d'Inès est ines_v2, poids 0,8"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        ...PERSONA,
        media: strs(
          "Photos reçues (identifiants de la médiathèque) à ajouter aux images de référence.",
        ),
        referenceImageIds: strs(
          "Ou la liste complète des images de référence (identifiants, 3 au plus).",
        ),
        loraUrl: str("Adresse https du fichier du personnage."),
        loraTrigger: str("Mot déclencheur."),
        loraScale: str("Poids (0,1 à 1,5)."),
        mediaNotes: str("Consignes de tenue et d'ambiance."),
      },
      ["persona"],
    ),
    inputs: ["media"],
    serverActions: sa("personaMedia", "savePersonaMediaAction"),
  },
];
