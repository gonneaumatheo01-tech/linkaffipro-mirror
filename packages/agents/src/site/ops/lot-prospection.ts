/**
 * Phase 31 — métadonnées pour Kevin des opérations de la page Agents → Prospection (règle de la phase 34, voir
 * `../contract.ts`). Cœurs : `apps/web/lib/site-ops/ops/lot-prospection.ts`. Les entrées de catalogue de l'équipe
 * (`prospects_top`, `prospect_statut`, `prospect_note`, `prospection_offres`…) restent les raccourcis de Kevin ; ces
 * opérations sont celles des boutons du site, avec les mêmes refus. AUCUNE ne contacte un canal ou une personne : le
 * client contacte lui-même, il note ici ce qu'il a fait.
 * « Ne plus montrer », réglages, pauses de sources, validation des marques et repères : administrateurs. Réglages : OUI
 * (plafonds, dépense de l'IA). Le reste : pas de confirmation (rien n'est envoyé, rien n'est effacé).
 */
import type { SiteOpMeta } from "../contract";

type Schema = Record<string, unknown>;
const s = (description: string): Schema => ({ type: "string", description });
const n = (description: string): Schema => ({ type: "number", description });
const b = (description: string): Schema => ({ type: "boolean", description });
const list = (description: string): Schema => ({ type: "array", items: { type: "string" }, description });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const WEB = (fn: string) => `app/(admin)/agents/prospection/actions.ts#${fn}`;

const CANAL = s("Canal de la prospection : son @nom, son lien t.me, son titre ou son identifiant");
const OFFRE = s("Offre : le nom de la marque (« Celsius ») ou son identifiant");

export const LOT_PROSPECTION_OPS: SiteOpMeta[] = [
  {
    key: "agents.prospection_statut",
    domain: "agents",
    description:
      "Noter où en est un canal de la prospection (contacté, a répondu, en discussion, signé avec ses conditions, actif, a arrêté, pas intéressé, reprendre, plus tard, ne plus montrer) ; rien n'est envoyé au canal",
    examples: ["j'ai contacté @parisfoot", "@tipsitalia a signé prime par joueur 100", "plus tard @casinoking dans 3 jours", "blacklist @arnaque"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        canal: CANAL,
        statut: {
          type: "string",
          enum: ["contacté", "a répondu", "en discussion", "signé", "actif", "a arrêté", "pas intéressé", "reprendre", "plus tard", "ne plus montrer"],
          description: "Nouveau statut (« ne plus montrer » : administrateurs)",
        },
        type_accord: { type: "string", enum: ["prime par joueur", "part du revenu", "mixte"], description: "Signé : type d'accord (facultatif)" },
        prime_par_joueur: n("Signé : prime par joueur en euros (facultatif)"),
        part_du_revenu: n("Signé : part du revenu en % (facultatif)"),
        notes_accord: s("Signé : précisions sur l'accord (facultatif)"),
        jours: n("Plus tard : dans combien de jours le canal revient (7 par défaut)"),
      },
      ["canal", "statut"],
    ),
    serverActions: [WEB("setProspectStatusAction")],
  },
  {
    key: "agents.prospection_statut_lot",
    domain: "agents",
    description: "Marquer plusieurs canaux de la prospection d'un coup comme contactés, ou les ignorer (pas intéressé)",
    examples: ["marque @a, @b et @c comme contactés", "ignore @x et @y"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        canaux: list("Canaux : leurs @noms ou liens t.me"),
        action: { type: "string", enum: ["contactés", "ignorer"], description: "Marquer contactés, ou ignorer" },
      },
      ["canaux", "action"],
    ),
    serverActions: [WEB("bulkProspectStatusAction")],
  },
  {
    key: "agents.prospection_note",
    domain: "agents",
    description: "Ajouter une note sur un canal de la prospection",
    examples: ["note @parisfoot : veut des visuels mardi", "ajoute une note sur @tipsitalia : préfère la part du revenu"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ canal: CANAL, note: s("Texte de la note (1 000 caractères au plus)") }, ["canal", "note"]),
    serverActions: [WEB("addProspectNoteAction")],
  },
  {
    key: "agents.prospection_ajouter",
    domain: "agents",
    description: "Ajouter à la main un canal Telegram public à la prospection (il est lu en priorité, jamais rejoint ni contacté)",
    examples: ["ajoute t.me/pronosfoot à la prospection", "regarde ce canal pour la prospection : @casinolive"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({ lien: s("Lien public du canal (t.me/nom) ou @nom ; jamais un lien d'invitation privé") }, ["lien"]),
    serverActions: [WEB("addManualProspectAction")],
  },
  {
    key: "agents.prospection_offre",
    domain: "agents",
    description: "Créer ou modifier une offre aux affiliés (marque, marché, pays acceptés, prime par joueur, part du revenu, mixte)",
    examples: ["ajoute une offre : Celsius, FR BE, prime par joueur 120", "change l'offre Celsius : part du revenu 35"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj({
      offre: s("Offre à modifier (vide pour en créer une)"),
      marque: s("Nom de la marque"),
      marche: { type: "string", enum: ["paris sportifs", "casino", "les deux"], description: "Marché de l'offre" },
      pays: list("Pays acceptés (codes de deux lettres : FR, BE…)"),
      prime_par_joueur: n("Prime par joueur en euros"),
      part_du_revenu: n("Part du revenu en %"),
      mixte_prime: n("Mixte : prime par joueur en euros"),
      mixte_part: n("Mixte : part du revenu en %"),
      motif_lien: s("Motif qui reconnaît nos liens de cette marque (facultatif)"),
      notes: s("Notes (facultatif)"),
    }),
    serverActions: [WEB("saveOfferAction")],
  },
  {
    key: "agents.prospection_offre_activer",
    domain: "agents",
    description: "Activer ou désactiver une offre aux affiliés (désactivée : elle ne sert plus à noter les canaux, rien n'est effacé)",
    examples: ["désactive l'offre Celsius", "réactive l'offre Betano"],
    kind: "setting",
    role: "MANAGER",
    confirm: "none",
    params: obj({ offre: OFFRE, active: b("true pour activer, false pour désactiver") }, ["offre", "active"]),
    serverActions: [WEB("toggleOfferAction")],
  },
  {
    key: "agents.prospection_repere_proposer",
    domain: "agents",
    description: "Proposer d'ajouter une marque, un repère de lien d'affiliation, un raccourcisseur ou un mot de code promo / de contact aux repères de la prospection (validé ensuite par un administrateur)",
    examples: ["ajoute la marque Celsius (FR) aux repères de la prospection", "propose le raccourcisseur lnk.to"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: obj(
      {
        genre: { type: "string", enum: ["marque", "paramètre", "chemin", "raccourcisseur", "code promo", "contact"], description: "Ce qu'il faut ajouter" },
        valeur: s("La valeur (nom de la marque, ref, /aff/, bit.ly, « code promo »…)"),
        pays: s("Marque : pays (FR) ou GLOBAL"),
        type_marque: { type: "string", enum: ["bookmaker", "casino", "both"], description: "Marque : bookmaker, casino ou les deux" },
        licence: { type: "string", enum: ["local", "offshore"], description: "Marque : licence du pays ou hors licence locale" },
        langue: s("Mot de code promo ou de contact : langue (fr, it…)"),
        note: s("Pourquoi (facultatif)"),
      },
      ["genre", "valeur"],
    ),
    serverActions: [WEB("proposeDictAction")],
  },
  {
    key: "agents.prospection_repere_valider",
    domain: "agents",
    description: "Valider ou refuser une proposition d'ajout aux repères de la prospection",
    examples: ["valide la proposition 1 des repères", "refuse la marque proposée"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj(
      {
        id: s("Identifiant de la proposition"),
        numero: s("Numéro dans la liste des propositions à valider (la plus ancienne = 1)"),
        decision: { type: "string", enum: ["valider", "refuser"], description: "Valider ou refuser" },
      },
      ["decision"],
    ),
    serverActions: [WEB("decideDictAction")],
  },
  {
    key: "agents.prospection_source_pause",
    domain: "agents",
    description: "Mettre en pause (1, 7 ou 30 jours) ou reprendre une source de découverte de la prospection (annuaires, recherche internet, réseaux sociaux, canaux cités, Analystes)",
    examples: ["mets les annuaires en pause une semaine", "reprends la recherche internet de la prospection"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: obj(
      {
        source: { type: "string", enum: ["directories", "web_search", "social", "graph", "analysts", "manual"], description: "Source" },
        action: { type: "string", enum: ["pause", "reprendre"], description: "Pause ou reprise" },
        jours: n("Pause : 1, 7 ou 30 jours (7 par défaut)"),
      },
      ["source", "action"],
    ),
    serverActions: [WEB("toggleSourcePauseAction")],
  },
  {
    key: "agents.prospection_reglages",
    domain: "agents",
    description:
      "Changer les réglages de la prospection : activée, pays et marchés cherchés, nombre et heure de la liste du matin, notes des niveaux, poids de la note, rappels, plafonds par jour et dépense mensuelle de l'IA",
    examples: ["envoie-moi 15 canaux le matin au lieu de 10", "ajoute la Turquie aux pays de la prospection", "coupe la prospection"],
    kind: "setting",
    role: "ADMIN",
    confirm: "yes",
    params: obj({
      activee: b("Prospection activée"),
      nombre_du_top: n("Canaux dans la liste du matin (1 à 30)"),
      heure_du_top: n("Heure de la liste du matin, heure de Paris (0 à 23)"),
      posts_30j_min: n("Posts sur 30 jours au moins"),
      vues_min: n("Vues par post au moins"),
      profondeur: n("Profondeur de recherche de canal en canal (0 à 5)"),
      note_minimale: n("Note minimale pour être gardé (0 à 100)"),
      note_niveau_b: n("Note du niveau B"),
      note_niveau_a: n("Note du niveau A"),
      relance_jours: n("Relance après un contact sans réponse, en jours"),
      rappel_discussion_jours: n("Rappel d'une discussion qui dure, en jours"),
      rappels_par_jour: n("Rappels par jour au plus"),
      rappels_week_end: b("Rappels le week-end"),
      decouvertes_par_jour: n("Nouveaux canaux trouvés par jour au plus"),
      lectures_par_jour: n("Canaux lus par jour au plus"),
      dossiers_par_semaine: n("Dossiers détaillés par semaine au plus"),
      budget_mensuel_euros: n("Dépense mensuelle de l'IA au plus, en euros"),
      idees_de_message: b("Deux idées de premier message dans les dossiers (jamais envoyées)"),
      poids: {
        type: "object",
        description: "Poids de la note (somme 100) : audience, engagement, fit, openness, competition, reach",
        properties: { audience: n("Audience"), engagement: n("Réactions"), fit: n("Adéquation"), openness: n("Ouverture"), competition: n("Concurrence"), reach: n("Facilité à joindre") },
        additionalProperties: false,
      },
      marches: list("Marchés cherchés : paris sportifs, casino"),
      pays: list("Pays (codes de deux lettres)"),
      pays_mode: { type: "string", enum: ["remplacer", "ajouter", "retirer"], description: "Pays : remplacer la liste, ajouter ou retirer ces pays" },
    }),
    serverActions: [WEB("saveProspectionSettingsAction")],
  },
];
