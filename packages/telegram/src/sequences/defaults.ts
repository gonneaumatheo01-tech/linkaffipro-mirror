/**
 * Textes par défaut des séquences de messages privés, par univers et par déclencheur.
 * Français, courts, chaleureux, sans promesse de gains. Placeholders : {prenom} {canal} {liste_canaux} {delai} {bot}.
 * Le texte JOIN_REQUEST sert avec ou sans canaux à rejoindre, obligatoires ou proposés : il reste juste dans tous les
 * cas (phase 14 : plus de « appuie sur ✅ J'ai rejoint », bouton absent avec des canaux proposés ; textes d'avant dans
 * `phase14-texts.ts`). Le rappel (GATE_REMINDER) n'existe qu'avec des canaux obligatoires : il garde le bouton.
 */
export const SEQUENCE_TRIGGERS = [
  "JOIN_REQUEST",
  "GATE_REMINDER",
  "GATE_SATISFIED",
  "APPROVED",
  "OFFER_REPLY",
] as const;
export type SequenceTriggerKey = (typeof SEQUENCE_TRIGGERS)[number];

export const TRIGGER_LABELS: Record<SequenceTriggerKey, string> = {
  JOIN_REQUEST: "Accueil (à la demande d'adhésion)",
  GATE_REMINDER: "Rappel (canaux pas encore rejoints)",
  GATE_SATISFIED: "Canaux rejoints (accès planifié)",
  APPROVED: "Accepté dans le canal",
  OFFER_REPLY: "Réponse à un clic sur une offre",
};

export const TRIGGER_HELP: Record<SequenceTriggerKey, string> = {
  JOIN_REQUEST:
    "Envoyé en privé dès qu'un membre demande à rejoindre le canal. Les boutons des canaux à rejoindre sont ajoutés automatiquement si la règle en prévoit, et « ✅ J'ai rejoint » seulement si ces canaux sont obligatoires.",
  GATE_REMINDER:
    "Envoyé selon les rappels de la règle d'adhésion, tant que les canaux obligatoires ne sont pas rejoints.",
  GATE_SATISFIED:
    "Envoyé quand le membre a rejoint tous les canaux obligatoires (le bot le voit tout seul, ou le membre appuie sur « ✅ J'ai rejoint »).",
  APPROVED: "Envoyé quand la demande est acceptée (si la règle l'autorise).",
  OFFER_REPLY:
    "Réponse quand un membre appuie sur un bouton « Offre » d'un message : le bouton « Ouvrir l'offre » est ajouté automatiquement.",
};

export const PLACEHOLDERS: Array<{ key: string; label: string; example: string }> = [
  { key: "{prenom}", label: "prénom du membre", example: "Léa" },
  { key: "{canal}", label: "nom du canal", example: "Casino VIP" },
  {
    key: "{liste_canaux}",
    label: "canaux à rejoindre",
    example: "Bonus du jour, Preuves de gains",
  },
  { key: "{delai}", label: "délai d'acceptation", example: "dans 10 minutes" },
  { key: "{bot}", label: "nom du bot", example: "@casinogamblingoobot" },
];

type VerticalKey = "CASINO" | "SPORTS" | "DATING" | "DEFAULT";

const TEXTS: Record<VerticalKey, Record<SequenceTriggerKey, string>> = {
  CASINO: {
    JOIN_REQUEST:
      "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue 🎰\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les. Ton accès est validé {delai}.",
    GATE_REMINDER:
      "{prenom}, ta place dans <b>{canal}</b> t'attend encore : rejoins {liste_canaux}, puis appuie sur ✅ J'ai rejoint.",
    GATE_SATISFIED:
      "C'est tout bon {prenom} ! Tu seras accepté dans <b>{canal}</b> {delai}. Prépare-toi, les bonus arrivent 🎁",
    APPROVED:
      "Bienvenue dans <b>{canal}</b>, {prenom} ! 🎉 Garde un œil sur les messages du canal, les meilleures offres y sont partagées en premier. Joue toujours de façon responsable.",
    OFFER_REPLY:
      "Voici ton accès personnel à l'offre, {prenom} 👇\nInscris-toi avec ce lien pour qu'elle te soit bien attribuée. Jeu responsable : fixe-toi une limite avant de commencer.",
  },
  SPORTS: {
    JOIN_REQUEST:
      "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue ⚽\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les. Ton accès est validé {delai}.",
    GATE_REMINDER:
      "{prenom}, ta demande pour <b>{canal}</b> est en attente : rejoins {liste_canaux}, puis appuie sur ✅ J'ai rejoint.",
    GATE_SATISFIED:
      "Parfait {prenom} ! Tu seras accepté dans <b>{canal}</b> {delai}. Les prochains pronos t'attendent 📊",
    APPROVED:
      "Bienvenue dans <b>{canal}</b>, {prenom} ! 🏆 Les analyses et les cotes du jour sont publiées directement dans le canal. Parie toujours avec modération.",
    OFFER_REPLY:
      "Voici ton lien personnel pour l'offre, {prenom} 👇\nInscris-toi avec ce lien pour qu'elle te soit bien attribuée. Mise raisonnable, plaisir garanti.",
  },
  DATING: {
    JOIN_REQUEST:
      "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue 💬\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les. Ton accès est validé {delai}.",
    GATE_REMINDER:
      "{prenom}, il ne te manque qu'une étape pour <b>{canal}</b> : rejoins {liste_canaux}, puis appuie sur ✅ J'ai rejoint.",
    GATE_SATISFIED: "Super {prenom} ! Tu seras accepté dans <b>{canal}</b> {delai}. À très vite 😉",
    APPROVED:
      "Bienvenue dans <b>{canal}</b>, {prenom} ! 💌 Les nouvelles rencontres et les bons plans sont partagés directement dans le canal.",
    OFFER_REPLY:
      "Voici ton accès personnel, {prenom} 👇\nInscris-toi avec ce lien pour profiter de l'offre. Reste prudent avec tes informations personnelles.",
  },
  DEFAULT: {
    JOIN_REQUEST:
      "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue.\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les. Ton accès est validé {delai}.",
    GATE_REMINDER:
      "{prenom}, ta demande pour <b>{canal}</b> est en attente : rejoins {liste_canaux}, puis appuie sur ✅ J'ai rejoint.",
    GATE_SATISFIED: "C'est bon {prenom} ! Tu seras accepté dans <b>{canal}</b> {delai}.",
    APPROVED:
      "Bienvenue dans <b>{canal}</b>, {prenom} ! Les nouveautés sont publiées directement dans le canal.",
    OFFER_REPLY:
      "Voici ton lien personnel pour l'offre, {prenom} 👇\nInscris-toi avec ce lien pour qu'elle te soit bien attribuée.",
  },
};

export function defaultSequenceText(
  vertical: string | null | undefined,
  trigger: SequenceTriggerKey,
): string {
  const key: VerticalKey =
    vertical === "CASINO" || vertical === "SPORTS" || vertical === "DATING" ? vertical : "DEFAULT";
  return TEXTS[key][trigger];
}

/** Nom lisible d'une séquence par défaut. */
export function defaultSequenceName(trigger: SequenceTriggerKey): string {
  return TRIGGER_LABELS[trigger];
}

/** Remplace les placeholders par des exemples (aperçu dans l'interface). */
export function previewText(
  template: string,
  overrides: Partial<Record<string, string>> = {},
): string {
  return template.replace(
    /\{(prenom|canal|liste_canaux|delai|bot)\}/g,
    (m, k: string) => overrides[k] ?? PLACEHOLDERS.find((p) => p.key === m)?.example ?? m,
  );
}
