/**
 * Phase 33, chantier C — annuaire des agents (`docs/AGENTS-ARCHITECTURE.md`) : chaque agent nommable par son nom ou
 * en français courant (« l'agent des paris », « celui qui écrit », « le correcteur », « celui des heures »), son
 * équipe, son Chef et sa clé dans le code. `findAgent(text)` retrouve un agent (fautes et accents tolérés ; plusieurs
 * candidats → liste, jamais de devinette). `agentCard(deps, clé)` : sa fiche (rôle, ce qu'il a fait aujourd'hui, ce
 * qu'il va faire, ses réglages actuels, ce qu'on peut lui demander), en LECTURE SEULE.
 *
 * Aucun agent ne reçoit d'ordre directement : « dis à l'agent X de … » passe par Kevin (chantier B) → Grand Chef →
 * Chef de X (capacité du registre). L'annuaire ne sert qu'à nommer et à décrire.
 */
import { nowOf, readSetting } from "../admin/journal";
import { editDistance, normName } from "../boss/resolve";
import { ACTIVE_STATUSES, parsePayload, parseSteps } from "../missions/mission";
import { parisDay } from "../rules/time";
import { parseSportsSettings } from "../sports/settings";
import { TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";
import type { Capability, OrderTeamKey } from "./contract";
import { capabilitiesForAgent } from "./registry";
import { dayLabel, hourLabel, plainPreview, readTeamState, slotRange, type DaySlot, type ViewResult } from "./view/common";

export type AgentKind = "direction" | "chef" | "agent";

export type AgentEntry = {
  /** Clé dans le code (`AgentKey` pour les agents des chaînes ; `grand-chef`, `chef-<équipe>`, `conversation`…). */
  key: string;
  label: string;
  kind: AgentKind;
  /** Équipes où il travaille (les métiers communs sont dans plusieurs équipes). */
  teams: OrderTeamKey[];
  /** Clé de son Chef dans l'annuaire (le Grand Chef pour les Chefs et l'agent Ads). */
  chief: string | null;
  /** Une ligne en français courant. */
  role: string;
  /** Façons de le nommer (sans article, normalisées à la lecture). */
  synonyms: string[];
  /** Faux = emplacement réservé (l'équipe arrive dans une phase suivante). */
  available: boolean;
  /** Pour un emplacement réservé : quand il arrive. */
  arrives?: string;
};

const e = (x: Omit<AgentEntry, "available"> & { available?: boolean }): AgentEntry => ({ available: true, ...x });

/** Annuaire complet, dans l'ordre de `docs/AGENTS-ARCHITECTURE.md`. */
export const AGENT_DIRECTORY: readonly AgentEntry[] = [
  e({
    key: "grand-chef",
    label: "Grand Chef",
    kind: "direction",
    teams: ["transverse"],
    chief: null,
    role: "Fixe le plan du jour de chaque canal, tient les budgets, évite les collisions et met une équipe en pause après 3 échecs.",
    synonyms: ["grand chef", "chef de la production", "le chef de tout", "directeur", "patron des agents", "orchestrateur"],
  }),
  e({
    key: "chef-dating",
    label: "Chef Rencontres",
    kind: "chef",
    teams: ["dating"],
    chief: "grand-chef",
    role: "Transforme le plan du jour des canaux Rencontres en posts et les fait passer par ses agents, dans l'ordre.",
    synonyms: ["chef rencontres", "chef rencontre", "chef dating", "chef des rencontres", "chef de l'equipe rencontres"],
  }),
  e({
    key: "chef-casino",
    label: "Chef Casino",
    kind: "chef",
    teams: ["casino"],
    chief: "grand-chef",
    role: "Transforme le plan du jour des canaux Casino en posts, uniquement avec tes médias.",
    synonyms: ["chef casino", "chef du casino", "chef de l'equipe casino"],
  }),
  e({
    key: "chef-sports",
    label: "Chef Paris sportifs",
    kind: "chef",
    teams: ["sports"],
    chief: "grand-chef",
    role: "Lance la recherche de paris à chaque passage (10 h, 15 h, 18 h par défaut) et fait suivre chaque pari jusqu'à la publication.",
    synonyms: ["chef paris", "chef paris sportifs", "chef des paris", "chef sport", "chef sports", "chef de l'equipe paris"],
  }),
  e({
    key: "chef-algo",
    label: "Chef Algorithme",
    kind: "chef",
    teams: ["algo"],
    chief: "grand-chef",
    role: "Mesure ce qui marche et règle les autres équipes dans leurs bornes ; ne publie rien.",
    synonyms: ["chef algorithme", "chef algo", "chef de l'algo", "chef de l'equipe algorithme"],
  }),
  e({
    key: "mediatheque",
    label: "Médiathèque",
    kind: "agent",
    teams: ["dating", "casino"],
    chief: "chef-dating",
    role: "Range tes vidéos et photos, choisit le prochain média pas encore utilisé et te demande des vidéos quand il en manque.",
    synonyms: ["mediatheque", "bibliotheque", "videotheque", "celui qui range les videos", "celui des medias", "stock de medias", "videos"],
  }),
  e({
    key: "media-ia",
    label: "Média IA",
    kind: "agent",
    teams: ["dating"],
    chief: "chef-dating",
    role: "Fabrique les vidéos et photos du personnage (Rencontres seulement), dans le plafond du mois.",
    synonyms: ["media ia", "medias ia", "videos ia", "photos ia", "celui qui fait les videos", "celui qui fabrique les photos", "face swap", "faceswap", "videos"],
  }),
  e({
    key: "redaction",
    label: "Rédaction",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Écrit les légendes des posts : très courtes, dans le ton du canal et de la persona, sans se répéter.",
    synonyms: ["redaction", "redacteur", "redactrice", "celui qui ecrit", "celle qui ecrit", "ecrivain", "plume", "legendes", "textes", "copywriter"],
  }),
  e({
    key: "cotes",
    label: "Cotes et sélection",
    kind: "agent",
    teams: ["sports"],
    chief: "chef-sports",
    role: "Cherche les matchs à venir, compare les cotes des bookmakers et retient les paris les plus intéressants de chaque catégorie.",
    synonyms: ["cotes", "cotes et selection", "selection", "agent des paris", "agent des paris sportifs", "agent paris", "agent paris sportifs", "celui qui choisit les paris", "celui des cotes", "pronostiqueur", "agent des matchs"],
  }),
  e({
    key: "capture",
    label: "Capture du pari",
    kind: "agent",
    teams: ["sports"],
    chief: "chef-sports",
    role: "Demande à l'équipe la capture du pari et la cote exacte sur le site du bookmaker, puis les joint au post.",
    synonyms: ["capture", "capture ecran", "capture d'ecran", "captures", "screenshot", "celui qui fait les captures", "photographe"],
  }),
  e({
    key: "planification",
    label: "Planification",
    kind: "agent",
    teams: ["dating", "casino"],
    chief: "chef-dating",
    role: "Choisit l'heure de chaque post : fenêtre du canal, meilleurs horaires, espacement, heures calmes.",
    synonyms: ["planification", "planificateur", "planning", "agenda", "celui qui programme", "celui qui choisit l'heure"],
  }),
  e({
    key: "controle",
    label: "Contrôle qualité",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Dernier filtre avant la publication : longueur, mots interdits, doublons, média, cote ; publie, fait refaire ou te demande.",
    synonyms: ["controle", "controle qualite", "correcteur", "correctrice", "relecteur", "qualite", "celui qui verifie", "celui qui relit", "filtre", "moderateur"],
  }),
  e({
    key: "publication",
    label: "Publication",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Programme le post dans la plateforme, qui l'envoie par le bot ou par le compte connecté.",
    synonyms: ["publication", "publieur", "celui qui publie", "celui qui envoie", "diffusion", "envoi"],
  }),
  e({
    key: "conversation",
    label: "Conversation",
    kind: "agent",
    teams: ["dating"],
    chief: "chef-dating",
    role: "L'assistante qui répond en privé aux personnes qui écrivent au bot de conversation (Rencontres).",
    synonyms: ["conversation", "assistante", "assistante de conversation", "celle qui discute", "celui qui repond en prive", "chatbot", "messages prives"],
  }),
  e({
    key: "ads",
    label: "Ads",
    kind: "agent",
    teams: ["ads"],
    chief: "grand-chef",
    role: "Lit les pubs Meta et TikTok et nos chiffres, et propose chaque jour quoi arrêter, augmenter ou tester ; ne touche jamais aux pubs.",
    synonyms: ["ads", "pubs", "publicites", "agent pub", "agent pubs", "agent des pubs", "celui des pubs", "meta", "tiktok"],
  }),
  e({
    key: "posts",
    label: "Posts",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Fait la fiche de résultats de chaque post (vues, clics, inscriptions) et classe ce qui marche par canal.",
    synonyms: ["posts", "agent des posts", "analyste des posts", "celui qui analyse les posts", "resultats des posts"],
  }),
  e({
    key: "horaires",
    label: "Horaires",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Calcule les meilleures heures de publication de chaque canal et les fenêtres conseillées.",
    synonyms: ["horaires", "horaire", "heures", "celui des heures", "agent des heures", "meilleures heures", "creneaux", "meilleurs horaires"],
  }),
  e({
    key: "conversations",
    label: "Conversations",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Mesure les conversations de chaque persona (réponses, décrochage, inscriptions) et propose des réglages.",
    synonyms: ["conversations", "analyste des conversations", "celui qui analyse les conversations", "agent des conversations"],
  }),
  e({
    key: "experimentation",
    label: "Expérimentation",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Monte des tests A/B propres, attend assez de données et déclare un gagnant ou « pas de différence ».",
    synonyms: ["experimentation", "experimentations", "tests ab", "test ab", "tests a b", "celui des tests", "experiences"],
  }),
  e({
    key: "synthese",
    label: "Synthèse et réglages",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Transforme les analyses en réglages concrets par canal, chiffres à l'appui, et écrit le rapport « Ce qui marche ».",
    synonyms: ["synthese", "synthese et reglages", "reglages", "celui qui regle", "celui des reglages", "rapport de la semaine"],
  }),
  // Phase 28 : équipe Montage (vidéo longue du client → shorts, chaque short validé par le client avant tout envoi).
  e({
    key: "chef-montage",
    label: "Chef Montage",
    kind: "chef",
    teams: ["montage"],
    chief: "grand-chef",
    role: "Fait passer chaque vidéo que tu m'envoies par la découpe, le montage, l'habillage et le contrôle, puis t'envoie chaque short à valider.",
    synonyms: ["chef montage", "chef du montage", "montage", "equipe montage", "l'equipe montage", "shorts", "reels", "montage video"],
  }),
  e({
    key: "montage-reception",
    label: "Réception",
    kind: "agent",
    teams: ["montage"],
    chief: "chef-montage",
    role: "Reçoit la vidéo que tu m'envoies, note sa durée et sa qualité, et lit tes consignes (durée, format, cam, sous-titres).",
    synonyms: ["reception", "reception video", "reception des videos", "celui qui recoit les videos", "celui qui lit les consignes"],
  }),
  e({
    key: "montage-decoupe",
    label: "Découpe",
    kind: "agent",
    teams: ["montage"],
    chief: "chef-montage",
    role: "Regarde la vidéo image par image et propose le plan de coupe : les moments les plus forts, avec une note sur 10.",
    synonyms: ["decoupe", "decoupe ia", "decoupeur", "plan de coupe", "celui qui choisit les moments", "celui qui decoupe"],
  }),
  e({
    key: "montage-monteur",
    label: "Monteur",
    kind: "agent",
    teams: ["montage"],
    chief: "chef-montage",
    role: "Monte chaque short en un seul passage : coupe, cam incrustée, format vertical ou carré, vitesse, sans perte de qualité.",
    synonyms: ["monteur", "monteuse", "celui qui monte les videos", "celui qui monte les shorts", "montage des shorts"],
  }),
  e({
    key: "montage-habillage",
    label: "Habillage",
    kind: "agent",
    teams: ["montage"],
    chief: "chef-montage",
    role: "Écrit les sous-titres d'après le son, les fait relire mot à mot, te demande en cas de doute, et ajoute le texte demandé.",
    synonyms: ["habillage", "habilleur", "sous-titres", "sous titres", "celui des sous-titres", "celui qui met les sous-titres", "texte incruste"],
  }),
  e({
    key: "montage-controle",
    label: "Contrôle qualité montage",
    kind: "agent",
    teams: ["montage"],
    chief: "chef-montage",
    role: "Vérifie chaque short avant de te l'envoyer : durée, qualité 1080p, écrans noirs, son, lisibilité des sous-titres, poids.",
    synonyms: ["controle qualite montage", "controle montage", "qc montage", "controle des shorts", "celui qui verifie les shorts"],
  }),
  // Phase 29 : équipe Analystes (marché externe : veille, règles des plateformes pub, stratégie, rapports). Elle
  // recommande seulement ; l'Agent Ads, lui, lit les chiffres des pubs du client.
  e({
    key: "chef-analystes",
    label: "Chef Analystes",
    kind: "chef",
    teams: ["analystes"],
    chief: "grand-chef",
    role: "Organise la veille du marché, les règles des plateformes pub et le rapport du lundi. Ne touche jamais aux pubs.",
    synonyms: ["chef analystes", "chef des analystes", "analystes", "analyste", "analyste marche", "analystes marche", "equipe analystes", "l'equipe analystes", "etude de marche", "analyse du marche"],
  }),
  e({
    key: "veille",
    label: "Veille",
    kind: "agent",
    teams: ["analystes"],
    chief: "chef-analystes",
    role: "Lit les forums, Reddit, Telegram public, X et l'actualité de chaque pays, dans la langue locale. Elle en garde un résumé sourcé.",
    synonyms: ["veille", "veille web", "veille du marche", "agent de veille", "celui qui lit les forums", "celui qui surveille les forums", "forums", "sources de veille"],
  }),
  e({
    key: "compliance",
    label: "Compliance",
    kind: "agent",
    teams: ["analystes"],
    chief: "chef-analystes",
    role: "Tient les règles de Meta, TikTok et des autres plateformes par pays, preuves à l'appui. Elle prévient tout de suite d'un risque de bannissement.",
    synonyms: ["compliance", "agent compliance", "conformite", "regles pub", "regles des plateformes", "celui des regles", "celui qui dit ce qui fait bannir", "bannissements"],
  }),
  e({
    key: "stratege",
    label: "Stratège",
    kind: "agent",
    teams: ["analystes"],
    chief: "chef-analystes",
    role: "Croise la veille, les règles et tes chiffres de pubs. Il conseille le type de pub, l'angle, le format et le pays.",
    synonyms: ["stratege", "strategiste", "agent strategie", "strategie", "strategie ads", "strategie pub", "celui qui conseille les pubs", "conseiller pub"],
  }),
  e({
    key: "rapporteur",
    label: "Rapporteur",
    kind: "agent",
    teams: ["analystes"],
    chief: "chef-analystes",
    role: "Écrit le rapport du marché du lundi, les briefings à la demande et les alertes envoyées par Kevin.",
    synonyms: ["rapporteur", "rapporteuse", "rapport du marche", "rapport hebdo du marche", "briefing", "briefings", "celui qui fait le rapport du marche"],
  }),
  // Phase 30 : contrôle qualité global, le dernier verrou avant toute sortie (toutes équipes). Rattaché au Grand Chef.
  e({
    key: "qa",
    label: "QA Global",
    kind: "agent",
    teams: ["qa"],
    chief: "grand-chef",
    role: "Relit tout ce qui sort, toutes équipes confondues, après leur propre contrôle : il accepte ou il bloque, sans jamais rien modifier.",
    synonyms: ["qa", "qa global", "controle global", "controle qualite global", "assurance qualite", "dernier verrou", "celui qui verifie tout", "celui qui bloque"],
  }),
  // Phase 31 : équipe Prospection (canaux Telegram publics d'affiliés casino et paris en Europe). Elle trouve, lit,
  // note et classe ; elle ne contacte jamais personne, c'est le client qui fait le commercial.
  e({
    key: "chef-prospection",
    label: "Chef Prospection",
    kind: "chef",
    teams: ["prospection"],
    chief: "grand-chef",
    role: "Organise la recherche d'affiliés : la découverte de nuit, la lecture des canaux, la note et la liste du matin. Elle ne contacte jamais personne.",
    synonyms: ["chef prospection", "prospection", "equipe prospection", "l'equipe prospection", "prospecteur", "prospectrice", "chercheur d'affilies", "recrutement d'affilies", "recrutement", "affilies"],
  }),
  e({
    key: "sourceur",
    label: "Sourceur",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "Trouve les canaux casino et paris d'Europe dans les annuaires, la recherche web, les réseaux sociaux et les canaux qui se citent entre eux.",
    synonyms: ["sourceur", "sourceuse", "celui qui trouve les canaux", "celui qui cherche les canaux", "chercheur de canaux", "decouverte", "annuaires"],
  }),
  e({
    key: "enrichisseur",
    label: "Enrichisseur",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "Lit la page publique de chaque canal : vraie audience, langue, pays, marques poussées, contacts publics, faux abonnés.",
    synonyms: ["enrichisseur", "enrichisseuse", "lecteur de canaux", "celui qui lit les canaux", "celui qui mesure l'audience", "enrichissement"],
  }),
  e({
    key: "evaluateur",
    label: "Évaluateur",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "Note chaque canal sur 100 avec le détail du calcul, le classe de A à D et écrit le dossier des meilleurs.",
    synonyms: ["evaluateur", "evaluatrice", "celui qui note les canaux", "notation", "score des prospects", "dossiers des prospects"],
  }),
  e({
    key: "pipeline-prospection",
    label: "Pipeline",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "T'envoie la liste du matin avec les boutons, suit qui est contacté ou signé, te rappelle les relances et fait le point du lundi.",
    synonyms: ["pipeline", "agent pipeline", "suivi des prospects", "liste du matin", "top du jour", "relances des affilies", "celui qui suit les contacts"],
  }),
  // Phase 32 : la prospection avancée (veille dans le temps, valeur estimée, vrais résultats Link Affi).
  e({
    key: "veilleur",
    label: "Veilleur",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "Relit les prospects et les affiliés signés à intervalles réguliers, repère ce qui change (marque lâchée, hausse, silence, concurrent) et t'envoie les alertes du matin. Il regroupe aussi les canaux tenus par la même personne.",
    synonyms: ["veilleur", "veilleuse", "agent de veille", "veille des prospects", "celui qui surveille les canaux", "alertes de prospection", "reseaux de canaux"],
  }),
  e({
    key: "valorisateur",
    label: "Valorisateur",
    kind: "agent",
    teams: ["prospection"],
    chief: "chef-prospection",
    role: "Estime ce que chaque canal pourrait rapporter par mois avec ton offre, en fourchette, puis compare aux vrais résultats Link Affi des affiliés signés pour proposer des réglages.",
    synonyms: ["valorisateur", "valorisatrice", "celui qui estime la valeur", "valeur des prospects", "estimation en euros", "calibrage", "resultats des affilies"],
  }),
];

const BY_KEY = new Map(AGENT_DIRECTORY.map((a) => [a.key, a]));

/** Tout l'annuaire (copie). */
export function agentDirectory(): AgentEntry[] {
  return AGENT_DIRECTORY.map((a) => ({ ...a, teams: [...a.teams], synonyms: [...a.synonyms] }));
}

export function agentEntry(key: string): AgentEntry | null {
  return BY_KEY.get(key) ?? null;
}

export type FindAgentResult =
  | { status: "found"; agent: AgentEntry }
  | { status: "ambiguous"; candidates: AgentEntry[] }
  | { status: "unknown"; known: string[] };

/** Mots qui ne nomment pas un agent (« dis à l'agent … », « il fait quoi ? »). */
const FILLER = new Set(["l", "le", "la", "les", "un", "une", "des", "du", "de", "d", "a", "au", "agent", "agents", "dis", "demande", "il", "elle", "fait", "quoi", "stp"]);

const forms = (a: AgentEntry): string[] => [...new Set([a.label, a.key.replace(/-/g, " "), ...a.synonyms].map(normName).filter(Boolean))];

/** Tolérance aux fautes : 0 sous 4 lettres, 1 jusqu'à 6, 2 au-delà. */
function close(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  const max = len < 4 ? 0 : len <= 6 ? 1 : 2;
  return editDistance(a, b) <= max;
}

const contains = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/**
 * Retrouve un agent dans une phrase (« l'agent Rédaction », « celui des heures », « le corecteur ») : forme exacte
 * (articles et « agent » retirés), puis plus longue expression contenue dans la phrase, puis fautes tolérées mot à
 * mot. Plusieurs agents au même niveau → `ambiguous` (liste à proposer), aucun → `unknown` avec les noms connus.
 */
export function findAgent(text: string): FindAgentResult {
  const n = normName(text);
  const known = AGENT_DIRECTORY.map((a) => a.label);
  if (!n) return { status: "unknown", known };
  const core = n
    .split(" ")
    .filter((w) => !FILLER.has(w))
    .join(" ");
  const done = (list: AgentEntry[]): FindAgentResult | null => {
    const uniq = [...new Map(list.map((a) => [a.key, a])).values()];
    if (uniq.length === 1) return { status: "found", agent: uniq[0]! };
    if (uniq.length > 1) return { status: "ambiguous", candidates: uniq };
    return null;
  };
  // 1. Forme exacte.
  const exact = AGENT_DIRECTORY.filter((a) => forms(a).some((f) => f === n || f === core));
  const r1 = done(exact);
  if (r1) return r1;
  // 2. Expression contenue dans la phrase : la plus longue gagne.
  let best = 0;
  let hits: AgentEntry[] = [];
  for (const a of AGENT_DIRECTORY)
    for (const f of forms(a)) {
      if (!contains(n, f) && !contains(core, f)) continue;
      if (f.length > best) {
        best = f.length;
        hits = [a];
      } else if (f.length === best) hits.push(a);
    }
  const r2 = done(hits);
  if (r2) return r2;
  // 3. Fautes : chaque mot (significatif) d'une forme retrouvé dans la phrase à une faute près ; la plus petite
  // distance totale gagne (« corecteur » → correcteur à 1, pas directeur à 2).
  const words = core.split(" ").filter(Boolean);
  const scoreOf = (f: string): number | null => {
    const fw = f.split(" ").filter((w) => !FILLER.has(w));
    if (!fw.length) return null;
    let total = 0;
    for (const w of fw) {
      const d = Math.min(...words.map((x) => (x === w ? 0 : w.length >= 4 && close(x, w) ? editDistance(x, w) : Infinity)));
      if (!Number.isFinite(d)) return null;
      total += d;
    }
    return total;
  };
  let bestScore = Infinity;
  let fuzzy: AgentEntry[] = [];
  for (const a of AGENT_DIRECTORY) {
    const sc = Math.min(...forms(a).map((f) => scoreOf(f) ?? Infinity));
    if (!Number.isFinite(sc)) continue;
    if (sc < bestScore) {
      bestScore = sc;
      fuzzy = [a];
    } else if (sc === bestScore) fuzzy.push(a);
  }
  return done(fuzzy) ?? { status: "unknown", known };
}

/** Libellé de l'équipe (« Rencontres », « Ads », « transverse »). */
export function orderTeamLabel(t: OrderTeamKey): string {
  if (t === "ads") return "Ads";
  if (t === "montage") return "Montage";
  if (t === "analystes") return "Analystes";
  if (t === "qa") return "Contrôle qualité";
  if (t === "prospection") return "Prospection";
  if (t === "transverse") return "toutes les équipes";
  return TEAM_LABELS[t as TeamKey] ?? t;
}

/** Ce qu'on peut demander à cet agent (registre des capacités, chantier A) ; vide si le registre n'en a pas. */
export function agentAbilities(agentKey: string): Capability[] {
  try {
    // Les plus propres à cet agent d'abord (une capacité de toute une équipe le concerne moins).
    return [...(capabilitiesForAgent(agentKey) as Capability[])].sort((a, b) => a.agents.length - b.agents.length);
  } catch {
    return [];
  }
}

export type AgentCardOptions = { channelId?: string | null; day?: string | null; slot?: DaySlot | null };

type RunRow = { id: string; missionId: string; agentKey: string; status: string; startedAt: Date; outputSummary: string | null; error: string | null };
type MissionLite = { id: string; teamKey: string; channelId: string | null; status: string; currentStep: number; steps: unknown; payload: unknown; scheduledFor: Date | null };

const PLURAL = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Fiche d'un agent (lecture seule) : rôle, Chef, ce qu'il a fait ce jour-là (passages enregistrés, `AgentRun`), ce
 * qu'il a en cours (posts dont il est la prochaine étape), ses réglages actuels, ce qu'on peut lui demander.
 */
export async function agentCard(deps: AgentsDeps, agentKey: string, opts: AgentCardOptions = {}): Promise<ViewResult & { agent: AgentEntry | null }> {
  const agent = agentEntry(agentKey);
  if (!agent) return { agent: null, facts: { agent: agentKey, connu: false }, lines: [`Je ne connais pas d'agent « ${agentKey} ».`] };
  const chief = agent.chief ? agentEntry(agent.chief) : null;
  const teamText = agent.teams.length ? agent.teams.map(orderTeamLabel).join(", ") : null;
  if (!agent.available) {
    return {
      agent,
      facts: { agent: agent.label, disponible: false, arrive: agent.arrives ?? null },
      lines: [`${agent.label} n'est pas encore là : il arrive avec la ${agent.arrives ?? "prochaine phase"}.`, `Il ${agent.role.charAt(0).toLowerCase()}${agent.role.slice(1)}`],
    };
  }
  // Phase 29 : l'équipe Analystes travaille sur la veille, les règles et les rapports (pas des posts).
  if (agent.teams.includes("analystes")) {
    const { analystsAgentCard } = await import("../analysts/kevin-view");
    const card = await analystsAgentCard(deps, agent.key);
    const abilities = agentAbilities(agent.key).map((c) => c.description);
    const lines = [`${agent.label}${teamText ? ` (${teamText}${chief ? `, sous le ${chief.label}` : ""})` : ""} : ${agent.role}`, ...card.lines];
    if (abilities.length) lines.push(`Tu peux par exemple lui demander de ${lowerFirst(shortAbility(abilities[0]!))}.`);
    return { agent, facts: { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, ...card.facts, peutFaire: abilities }, lines };
  }
  // Phase 31 : l'équipe Prospection travaille sur des canaux d'affiliés (pas des posts).
  if (agent.teams.includes("prospection")) {
    const { prospectionAgentCard } = await import("../prospection/kevin-view");
    const card = await prospectionAgentCard(deps, agent.key);
    const abilities = agentAbilities(agent.key).map((c) => c.description);
    const lines = [`${agent.label}${teamText ? ` (${teamText}${chief ? `, sous le ${chief.label}` : ""})` : ""} : ${agent.role}`, ...card.lines];
    if (abilities.length) lines.push(`Tu peux par exemple lui demander de ${lowerFirst(shortAbility(abilities[0]!))}.`);
    return { agent, facts: { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, ...card.facts, peutFaire: abilities }, lines };
  }
  // Phase 30 : le contrôle qualité global vérifie des contenus (pas des posts) : sa fiche vient de ses vérifications.
  if (agent.key === "qa") {
    const { qaAgentCard } = await import("../qa/kevin-view");
    const card = await qaAgentCard(deps);
    const abilities = agentAbilities(agent.key).map((c) => c.description);
    const lines = [`${agent.label}${chief ? ` (sous le ${chief.label})` : ""} : ${agent.role}`, ...card.lines];
    lines.push("Tu peux par exemple me demander « montre-moi les refus de cette semaine » ou « pourquoi ce post a été refusé ? ».");
    return { agent, facts: { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, ...card.facts, peutFaire: abilities }, lines };
  }
  // Phase 28 : l'équipe Montage travaille sur des montages (pas des posts) : sa fiche vient de ses montages et shorts.
  if (agent.teams.includes("montage")) {
    const { isMontageAgentKey, montageAgentCard } = await import("../montage/kevin-view");
    if (isMontageAgentKey(agent.key)) {
      const card = await montageAgentCard(deps, agent.key, opts.day ?? null);
      const abilities = agentAbilities(agent.key).map((c) => c.description);
      const lines = [`${agent.label}${teamText ? ` (${teamText}${chief ? `, sous le ${chief.label}` : ""})` : ""} : ${agent.role}`, ...card.lines];
      if (abilities.length) lines.push(`Tu peux par exemple lui demander de ${lowerFirst(shortAbility(abilities[0]!))}.`);
      return { agent, facts: { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, ...card.facts, peutFaire: abilities }, lines };
    }
  }
  const now = nowOf(deps);
  const day = opts.day ?? parisDay(now);
  const range = slotRange(day, opts.slot ?? null);
  const facts: Record<string, unknown> = { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, jour: day, moment: opts.slot ?? null };
  const lines: string[] = [];
  lines.push(`${agent.label}${teamText ? ` (${teamText}${chief ? `, sous le ${chief.label}` : ""})` : ""} : ${agent.role}`);

  // Ce qu'il a fait (passages des agents des chaînes).
  const runs = (await deps.prisma.agentRun.findMany({
    where: { agentKey: agent.key, startedAt: { gte: range.from, lt: range.to } },
    orderBy: { startedAt: "asc" },
    take: 200,
  })) as RunRow[];
  const missionIds = [...new Set(runs.map((r) => r.missionId))];
  const missions = missionIds.length
    ? ((await deps.prisma.agentMission.findMany({ where: { id: { in: missionIds } } })) as MissionLite[])
    : [];
  const missionById = new Map(missions.map((m) => [m.id, m]));
  const scoped = opts.channelId ? runs.filter((r) => missionById.get(r.missionId)?.channelId === opts.channelId) : runs;
  const ok = scoped.filter((r) => r.status === "OK").length;
  const failed = scoped.filter((r) => r.status === "ERROR").length;
  facts.fait = { passages: scoped.length, reussis: ok, rates: failed };
  const when = `${dayLabel(day, now)}${opts.slot ? ` (${slotWord(opts.slot)})` : ""}`;
  if (scoped.length) {
    lines.push(`${capitalize(when)} : ${PLURAL(ok, "passage réussi", "passages réussis")}${failed ? `, ${PLURAL(failed, "raté")}` : ""}.`);
    if (agent.key === "redaction") {
      const texts = scoped
        .filter((r) => r.status === "OK")
        .map((r) => missionById.get(r.missionId))
        .filter((m): m is MissionLite => !!m)
        .map((m) => ({ m, text: plainPreview(String(parsePayload(m.payload).text ?? ""), 90) }))
        .filter((x) => x.text);
      facts.textes = texts.slice(0, 3).map((x) => x.text);
      for (const x of texts.slice(0, 3)) lines.push(`« ${x.text} »`);
    } else {
      const last = scoped.filter((r) => r.outputSummary).slice(-2);
      for (const r of last) lines.push(`${hourLabel(r.startedAt)} : ${plainPreview(r.outputSummary ?? "", 110)}`);
    }
  } else lines.push(`${capitalize(when)} : rien fait pour le moment.`);

  // Ce qu'il va faire : posts en cours dont il est la prochaine étape.
  const active = (await deps.prisma.agentMission.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, ...(opts.channelId ? { channelId: opts.channelId } : {}) },
    take: 300,
  })) as MissionLite[];
  const queued = active.filter((m) => parseSteps(m.steps)[m.currentStep]?.agent === agent.key);
  facts.enAttente = queued.length;
  if (queued.length) lines.push(`Il a ${PLURAL(queued.length, "post")} à traiter juste après.`);

  // Réglages actuels.
  const settings = await agentSettingsLines(deps, agent, opts.channelId ?? null);
  facts.reglages = settings.facts;
  lines.push(...settings.lines);

  // Ce qu'on peut lui demander (registre des capacités).
  const abilities = agentAbilities(agent.key).map((c) => c.description);
  facts.peutFaire = abilities;
  if (abilities.length) lines.push(`Tu peux par exemple lui demander de ${lowerFirst(shortAbility(abilities[0]!))}.`);
  return { agent, facts, lines };
}

function slotWord(s: DaySlot): string {
  return s === "apres-midi" ? "après-midi" : s;
}
/** Début d'une description de capacité (avant « : » ou « ( »), 12 mots au plus. */
function shortAbility(d: string): string {
  const head = d.split(/\s*[:(;]\s*/)[0]!.trim();
  const words = head.split(/\s+/);
  return words.length > 12 ? words.slice(0, 12).join(" ") : head;
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type PlanLite = { channelId: string; teamKey: string; enabled: boolean; postsPerDay: number; windowStart: string; windowEnd: string; minSpacingMinutes: number; suggestedWindows: unknown; styleNotes: string | null };

const WEEKDAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Réglages actuels d'un agent, en lignes courtes (lecture seule). */
async function agentSettingsLines(deps: AgentsDeps, agent: AgentEntry, channelId: string | null): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const facts: Record<string, unknown> = {};
  const lines: string[] = [];
  const firstTeam = agent.teams.find((t): t is TeamKey => t === "dating" || t === "casino" || t === "sports" || t === "algo");
  const team = firstTeam ? await readTeamState(deps, firstTeam) : null;
  const plans = (await deps.prisma.channelAgentPlan.findMany({ where: channelId ? { channelId } : {}, take: 200 })) as PlanLite[];
  const titles = await channelTitles(deps, plans.map((p) => p.channelId));
  switch (agent.key) {
    case "redaction": {
      if (team) facts.longueurMax = team.settings.maxTextLength;
      const notes = plans.filter((p) => p.styleNotes && p.styleNotes.trim());
      facts.consignes = notes.map((p) => ({ canal: titles.get(p.channelId) ?? p.channelId, consignes: plainPreview(p.styleNotes ?? "", 120) }));
      if (team) lines.push(`Textes de ${team.settings.maxTextLength} caractères au plus${team.settings.styleGuidelines.trim() ? `, consignes de l'équipe : ${plainPreview(team.settings.styleGuidelines, 80)}` : ""}.`);
      for (const p of notes.slice(0, 2)) lines.push(`Sur ${titles.get(p.channelId) ?? "ce canal"} : ${plainPreview(p.styleNotes ?? "", 100)}`);
      break;
    }
    case "controle": {
      if (team) {
        facts.motsInterdits = team.settings.forbiddenWords;
        facts.longueurMax = team.settings.maxTextLength;
        lines.push(
          team.settings.forbiddenWords.length
            ? `Mots interdits (${team.label}) : ${team.settings.forbiddenWords.slice(0, 8).join(", ")}${team.settings.forbiddenWords.length > 8 ? "…" : ""}.`
            : `Aucun mot interdit réglé pour l'équipe ${team.label}.`,
        );
      }
      break;
    }
    case "horaires": {
      const advised: Array<{ canal: string; jour: string; debut: string; fin: string }> = [];
      for (const p of plans) {
        const w = Array.isArray(p.suggestedWindows) ? (p.suggestedWindows as Array<{ day?: number; start?: string; end?: string; score?: number }>) : [];
        const top = [...w].filter((x) => typeof x.start === "string" && typeof x.end === "string").sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
        if (top) advised.push({ canal: titles.get(p.channelId) ?? p.channelId, jour: WEEKDAYS[Number(top.day)] ?? "chaque jour", debut: top.start!, fin: top.end! });
      }
      for (const p of plans) {
        if (advised.some((a) => a.canal === (titles.get(p.channelId) ?? p.channelId))) continue;
        const best = (await readSetting(deps, `besthours.${p.channelId}`)) as { categories?: Record<string, { recommendation?: { day: number; hour: number } | null }> } | null;
        const rec = best?.categories?.all?.recommendation;
        if (rec) advised.push({ canal: titles.get(p.channelId) ?? p.channelId, jour: WEEKDAYS[rec.day] ?? "", debut: `${rec.hour} h`, fin: `${(rec.hour + 1) % 24} h` });
      }
      facts.conseils = advised;
      if (advised.length) for (const a of advised.slice(0, 4)) lines.push(`${a.canal} : plutôt le ${a.jour} entre ${a.debut} et ${a.fin}.`);
      else lines.push("Pas encore assez de posts mesurés pour conseiller une heure.");
      break;
    }
    case "planification": {
      facts.plans = plans.map((p) => ({ canal: titles.get(p.channelId) ?? p.channelId, postsParJour: p.postsPerDay, debut: p.windowStart, fin: p.windowEnd, espacement: p.minSpacingMinutes, actif: p.enabled }));
      for (const p of plans.filter((x) => x.enabled).slice(0, 3))
        lines.push(`${titles.get(p.channelId) ?? "Canal"} : ${PLURAL(p.postsPerDay, "post")} par jour entre ${p.windowStart} et ${p.windowEnd}, ${p.minSpacingMinutes} min d'écart au moins.`);
      break;
    }
    case "cotes":
    case "capture": {
      const s = parseSportsSettings((await readTeamState(deps, "sports")).settings.settings);
      facts.passages = s.runHours;
      facts.appelsMax = s.maxApiCallsPerMonth;
      const cats = (await deps.prisma.betCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })) as Array<{ name: string; minOdds: number; maxOdds: number; picksPerDay: number }>;
      facts.categories = cats.map((c) => ({ nom: c.name, coteMin: c.minOdds, coteMax: c.maxOdds, parisParJour: c.picksPerDay }));
      if (agent.key === "cotes") {
        lines.push(`Passages à ${s.runHours.map((h) => `${h} h`).join(", ")}, matchs jusqu'à ${s.lookaheadHours} h à l'avance.`);
        if (cats.length) lines.push(`Catégories actives : ${cats.slice(0, 4).map((c) => `${c.name} (cotes ${c.minOdds} à ${c.maxOdds})`).join(", ")}.`);
        else lines.push("Aucune catégorie de paris active.");
      } else lines.push("Je ne lis jamais les sites des bookmakers : l'équipe m'envoie la capture et la cote de chaque pari.");
      break;
    }
    case "media-ia": {
      if (team) {
        const b = team.settings.monthlyBudgetCents;
        facts.plafonds = b;
        lines.push(`Plafonds du mois : vidéo ${euros(b.video)}, photo ${euros(b.image)}.`);
      }
      break;
    }
    default: {
      if (team) {
        facts.equipe = { pourDeFaux: team.simulation, pause: team.paused, niveau: team.level };
        lines.push(`Équipe ${team.label} : ${team.paused ? "en pause" : team.simulation ? "pour de faux (canal Test)" : "pour de vrai"}, niveau ${team.level}.`);
      }
    }
  }
  return { facts, lines };
}

const euros = (c: number | undefined) => (typeof c === "number" ? `${(c / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €` : "sans plafond");

export async function channelTitles(deps: Pick<AgentsDeps, "prisma">, ids: readonly string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = (await deps.prisma.channel.findMany({ where: { id: { in: uniq } }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>;
  return new Map(rows.map((r) => [r.id, r.title]));
}
