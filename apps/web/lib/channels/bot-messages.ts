import { mentionsRequiredStep, textsMentionRequiredStep } from "@linkaffipro/core";
import { hasGate, isRuleInForce, type EntryFormState, type EntryRule } from "./entry-rule";

/**
 * « Ce que dit le bot » (fiche canal, ex-« Messages du bot ») : un moment par message privé du bot, en langage courant.
 * Fonctions pures, sans dépendance serveur (les libellés des boutons Telegram sont passés par la page).
 */

/** Les cinq moments, dans l'ordre du parcours (mêmes clés que `SEQUENCE_TRIGGERS` du paquet telegram). */
export const BOT_MOMENTS = [
  "JOIN_REQUEST",
  "GATE_REMINDER",
  "GATE_SATISFIED",
  "APPROVED",
  "OFFER_REPLY",
] as const;
export type BotMoment = (typeof BOT_MOMENTS)[number];

export const BOT_MOMENT_TEXT: Record<BotMoment, { title: string; when: string }> = {
  JOIN_REQUEST: {
    title: "Accueil à la demande",
    when: "Envoyé en privé dès qu'une personne demande à entrer dans le canal.",
  },
  GATE_REMINDER: {
    title: "Rappel",
    when: "Envoyé aux personnes qui n'ont pas encore rejoint les canaux demandés, selon les rappels de la règle. Après 5 minutes, seulement aux personnes qui ont déjà écrit au bot.",
  },
  GATE_SATISFIED: {
    title: "Canaux rejoints",
    when: "Envoyé quand la personne a rejoint tous les canaux obligatoires (le bot le voit tout seul, ou elle appuie sur « ✅ J'ai rejoint »), si le bot peut encore lui écrire.",
  },
  APPROVED: {
    title: "Accepté",
    when: "Envoyé quand la demande est acceptée, si le bot peut encore lui écrire (elle a démarré le bot, ou sa demande date de moins de 5 minutes).",
  },
  OFFER_REPLY: {
    title: "Réponse à un clic sur une offre",
    when: "Réponse quand un membre appuie sur un bouton « Offre » d'un message du canal.",
  },
};

/** Libellés des langues des messages du bot. */
export const BOT_LANG_LABELS: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
  pt: "Portugais",
  de: "Allemand",
  it: "Italien",
  ar: "Arabe",
  tr: "Turc",
  nl: "Néerlandais",
  pl: "Polonais",
  ro: "Roumain",
  ru: "Russe",
};

export function langLabel(lang: string): string {
  return BOT_LANG_LABELS[lang] ?? lang.toUpperCase();
}

/**
 * Langues proposées pour un canal (Réglages du canal), en toutes lettres : celles des messages du bot, et la langue
 * actuelle du canal si elle n'en fait pas partie (pour ne jamais la perdre en enregistrant). Valeur = code envoyé à
 * l'action serveur, comme avant (« fr », « en »…).
 */
export function channelLanguageOptions(current: string): Array<{ value: string; label: string }> {
  const options = Object.entries(BOT_LANG_LABELS).map(([value, label]) => ({ value, label }));
  const code = current.trim().toLowerCase();
  if (code && !(code in BOT_LANG_LABELS)) options.push({ value: code, label: langLabel(code) });
  return options;
}

/** Langues d'un message : le français d'abord (obligatoire), puis les autres par ordre alphabétique. */
export function messageLangs(texts: Record<string, string>): string[] {
  return [
    "fr",
    ...Object.keys(texts)
      .filter((l) => l !== "fr")
      .sort(),
  ];
}

/**
 * Pourquoi ce message n'est pas envoyé avec la règle actuelle du canal (null s'il l'est) : une phrase courte sur la
 * carte, pour ne pas faire travailler l'équipe sur un texte que personne ne recevra.
 */
export function momentNote(moment: BotMoment, rule: EntryRule | null | undefined): string | null {
  const inForce = isRuleInForce(rule);
  switch (moment) {
    case "JOIN_REQUEST":
      return inForce ? null : "Pas envoyé tant que le canal n'a pas de règle d'entrée.";
    case "GATE_REMINDER":
      if (!inForce || !hasGate(rule) || rule.gateMode !== "REQUIRED")
        return "Envoyé seulement si des canaux sont obligatoires (« Après avoir rejoint ces canaux »).";
      // Validation à la main : la demande attend l'équipe, pas les canaux ; le worker ne relance personne.
      if (rule.mode === "MANUAL")
        return "Pas envoyé : aucun rappel quand vous validez vous-même chaque demande (bloc « Avancé »).";
      return rule.maxReminders === 0 || rule.reminderAfterMinutes.length === 0
        ? "Aucun rappel prévu dans la règle (bloc « Avancé »)."
        : null;
    case "GATE_SATISFIED":
      if (!inForce || !hasGate(rule))
        return "Envoyé seulement avec « Après avoir rejoint ces canaux ».";
      // Canaux proposés : la demande est déjà programmée et l'accueil n'a plus de bouton « ✅ J'ai rejoint » (phase 14).
      return rule.gateMode === "SOFT" && rule.mode !== "MANUAL"
        ? "Pas envoyé avec des canaux proposés : la personne est acceptée de toute façon, l'accueil n'a pas de bouton « ✅ J'ai rejoint »."
        : null;
    case "APPROVED":
      return inForce && !rule.sendAcceptedMessage
        ? "Pas envoyé : la règle ne prévoit pas ce message (bloc « Avancé »)."
        : null;
    default:
      return null;
  }
}

/**
 * Boutons que le bot ajoute sous le message (aperçu) : canaux à rejoindre pour l'accueil et le rappel quand la règle en
 * prévoit, plus « ✅ J'ai rejoint » seulement si ces canaux sont obligatoires (phase 14 : avec des canaux proposés,
 * le bouton ne servirait à rien), « Ouvrir l'offre » pour la réponse à une offre.
 */
export function previewButtons(
  moment: BotMoment,
  rule: EntryRule | null | undefined,
  gateTitles: string[],
  labels: { join: string; joined: string; offer: string },
): Array<Array<{ text: string }>> {
  if (moment === "OFFER_REPLY") return [[{ text: labels.offer }]];
  if (moment !== "JOIN_REQUEST" && moment !== "GATE_REMINDER") return [];
  if (!isRuleInForce(rule) || !hasGate(rule)) return [];
  const rows = gateTitles.map((t) => [{ text: `${labels.join} ${t}` }]);
  // Comme le bot : avec des canaux obligatoires, « ✅ J'ai rejoint » est toujours là (même sans canal encore listé).
  return rule.gateMode === "REQUIRED" ? [...rows, [{ text: labels.joined }]] : rows;
}

/** Clé courte d'un texte : le champ est recréé quand son texte enregistré change (ex. traductions de l'IA). */
export function textKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}-${h}`;
}

/** Exemples des mots magiques pour l'aperçu (`{prenom}`, `{canal}`, `{liste_canaux}`, `{delai}`, `{bot}`). */
export type PlaceholderExamples = Partial<
  Record<"prenom" | "canal" | "liste_canaux" | "delai" | "bot", string>
>;

/** Remplace les mots magiques par des exemples (même liste que le bot ; un mot sans exemple reste tel quel). */
export function fillExamples(template: string, examples: PlaceholderExamples): string {
  return template.replace(
    /\{(prenom|canal|liste_canaux|delai|bot)\}/g,
    (m, k: keyof PlaceholderExamples) => examples[k] ?? m,
  );
}

/**
 * Mots à insérer en un clic sous le texte d'un message du bot : le bot les remplace pour chaque personne (même liste
 * que `fillExamples` et que le bot). Libellés en langage courant ; le mot exact s'insère dans le texte.
 */
export const PLACEHOLDER_CHIPS: ReadonlyArray<{ key: keyof PlaceholderExamples; label: string }> = [
  { key: "prenom", label: "Prénom" },
  { key: "canal", label: "Nom du canal" },
  { key: "liste_canaux", label: "Canaux à rejoindre" },
  { key: "delai", label: "Délai d'acceptation" },
  { key: "bot", label: "Nom du bot" },
];

/**
 * Avertissement des canaux proposés (phase 14) : la personne est acceptée de toute façon, mais l'accueil lui dit de
 * rejoindre les canaux pour entrer.
 */
export const SOFT_WELCOME_WARNING =
  "Vos canaux sont proposés : la personne est acceptée de toute façon. Votre message d'accueil dit qu'elle doit les rejoindre : pensez à l'adapter.";

/**
 * Repérage d'un accueil qui parle d'une étape obligatoire (« J'ai rejoint » dans les six langues du bot, « pour être
 * accepté », « dernière étape », « obligatoire »…) : règle unique du paquet core (`mentionsRequiredStep`,
 * `textsMentionRequiredStep`), la même que celle du paquet telegram.
 */
export { mentionsRequiredStep, textsMentionRequiredStep };

/** Règle appliquée (hors validation à la main) avec des canaux proposés ? */
function isSoftGate(rule: EntryRule | null | undefined): boolean {
  return isRuleInForce(rule) && hasGate(rule) && rule.gateMode === "SOFT" && rule.mode !== "MANUAL";
}

/**
 * Carte « Accueil à la demande » : avertissement si une règle du canal (par défaut ou exception active) propose ses
 * canaux sans les imposer alors que l'accueil dit qu'il faut les rejoindre. Null sinon.
 */
export function softWelcomeWarning(
  rules: ReadonlyArray<EntryRule | null | undefined>,
  texts: Record<string, string> | null | undefined,
): string | null {
  return rules.some(isSoftGate) && textsMentionRequiredStep(texts) ? SOFT_WELCOME_WARNING : null;
}

/**
 * Formulaire de la règle : avertissement en direct quand « Proposés » est choisi et que l'accueil du canal parle d'une
 * étape obligatoire (`welcomeMentionsStep`, relu par le serveur). Null sinon.
 */
export function softGateWarning(
  state: Pick<EntryFormState, "choice" | "gateMode" | "manual" | "gateIds">,
  welcomeMentionsStep: boolean,
): string | null {
  return welcomeMentionsStep &&
    state.choice === "gate" &&
    state.gateMode === "SOFT" &&
    !state.manual &&
    state.gateIds.length > 0
    ? SOFT_WELCOME_WARNING
    : null;
}
