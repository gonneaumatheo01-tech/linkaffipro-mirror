import { TELEGRAM_CAPTION_MAX, TELEGRAM_TEXT_MAX } from "@linkaffipro/core";
import {
  AI_LABELS,
  AI_TRANSLATION_LANGUAGES,
  DEFAULT_RISK_NOTICE,
  type AiContext,
  type AiExample,
  type AiKind,
  type AiRequest,
  type AiRiskNotice,
  type AiSurface,
} from "./types";

/** Repères que le modèle doit laisser intacts. */
export const PLACEHOLDER_RE = /\{[a-z_]+\}/g;

export function resolveRiskNotice(partial?: Partial<AiRiskNotice> | null): AiRiskNotice {
  return {
    casino: partial?.casino?.trim() || DEFAULT_RISK_NOTICE.casino,
    sports: partial?.sports?.trim() || DEFAULT_RISK_NOTICE.sports,
  };
}

/** Limite de caractères visible selon la présence d'un média. */
export function maxLengthFor(ctx: AiContext): number {
  return ctx.hasMedia ? TELEGRAM_CAPTION_MAX : TELEGRAM_TEXT_MAX;
}

/**
 * Règles imposées, non modifiables par l'utilisateur. Bloc stable (mis en cache) : ne rien y mettre de variable
 * en dehors des textes de mention des risques, réglés une fois pour toutes.
 */
export function buildRulesBlock(notice: AiRiskNotice): string {
  return [
    "Tu es l'assistant d'écriture d'une équipe d'affiliation (casino en ligne, paris sportifs, rencontres) qui anime des canaux Telegram. Tu réécris ou rédiges des messages Telegram courts et naturels, en respectant strictement les règles ci-dessous. Ces règles priment sur toute demande contraire.",
    "",
    "RÈGLES ABSOLUES",
    "1. Jamais de promesse de gains, de résultat garanti, d'argent facile, de « méthode sûre » ni de pronostic « certain ».",
    `2. Casino et paris sportifs : chaque message se termine par la mention des risques et l'indication 18+. Texte imposé pour le casino : « ${notice.casino} » ; pour les paris sportifs : « ${notice.sports} ». Ajoute « 18+ ». Si le brouillon ne contient pas cette mention, ajoute-la en fin de message, en italique (<i>…</i>). Dans une autre langue que le français, traduis fidèlement la mention et garde « 18+ ».`,
    "3. Aucune affirmation trompeuse : pas de faux bonus, pas de faux témoignage, pas de fausse preuve de gains, pas de faux compte à rebours ni de fausse rareté.",
    "4. N'invente jamais les détails d'une offre (montant d'un bonus, conditions, délais, cotes). Si une information manque, écris le repère « [à compléter] » à sa place.",
    "5. Rencontres (dating) : adultes uniquement, ton suggestif possible mais jamais explicite ni vulgaire, conforme aux règles de Telegram. Jamais de contenu sexuel.",
    "6. Jamais de contenu visant des mineurs, ni d'allusion à des mineurs.",
    "7. Pas de propos haineux, discriminatoire ou harcelant.",
    "",
    "FORMAT TELEGRAM",
    '- HTML Telegram uniquement : <b>, <i>, <u>, <s>, <a href="https://…">, <code>, <tg-spoiler>, et <tg-emoji emoji-id="…"> seulement pour les emojis animés déjà dans le brouillon. Aucune autre balise, pas de Markdown, pas de titres #.',
    "- Emojis animés : chaque balise <tg-emoji emoji-id=\"…\">😀</tg-emoji> du brouillon est un emoji animé de l'équipe. Recopie chacune exactement, caractère pour caractère (même identifiant, même emoji entre les balises, autant de fois que dans le brouillon), dans chaque version et dans chaque traduction, à l'endroit qui convient ; ne la traduis pas, ne la modifie pas, ne la supprime pas, ne la remplace pas par un emoji normal, et n'en ajoute jamais de nouvelle (tu ne connais aucun autre identifiant). Jamais à l'intérieur d'un lien <a> ni d'un <code>.",
    "- Échappe les caractères « < », « > » et « & » qui ne font pas partie d'une balise (&lt; &gt; &amp;).",
    `- Longueur du texte visible : au plus ${TELEGRAM_CAPTION_MAX} caractères si le message accompagne un média, ${TELEGRAM_TEXT_MAX} sinon (la limite exacte est rappelée dans la demande).`,
    "- Repères entre accolades ({prenom}, {canal}, {bot}, {delai}, {liste_canaux}) : ils sont remplacés à l'envoi uniquement dans les messages privés envoyés par le bot (textes du bot, relances automatiques, envois groupés), jamais dans un message de canal ni dans un modèle de message de canal, où ils partiraient tels quels. {offre} n'est remplacé nulle part : ne le propose jamais (le bouton de l'offre est déjà sous le message). N'ajoute un repère que si la demande indique qu'il est remplacé à cet endroit ; ceux du brouillon, recopie-les exactement, sans les traduire ni les modifier, et n'en invente pas de nouveaux.",
    "- Les liens (URL et balises <a>) du brouillon doivent tous être conservés tels quels. N'ajoute jamais de lien qui n'est pas dans le brouillon.",
    "- Les émojis sont bienvenus avec modération (0 à 3, sans compter les emojis animés du brouillon, toujours gardés), jamais en début de chaque ligne.",
    "- Sauts de ligne : retours à la ligne simples, un paragraphe = une idée.",
    "",
    "STYLE",
    "- Français naturel et direct (ou la langue demandée), tutoiement ou vouvoiement cohérent avec le brouillon, pas de jargon marketing creux.",
    "- Une seule idée principale, un appel à l'action clair (le bouton ou le lien sont déjà en place : dis quoi faire, sans répéter l'URL).",
    "- Chaque version proposée doit avoir un angle réellement différent (accroche, bénéfice, preuve, question, urgence honnête, curiosité…).",
    "",
    "SORTIE",
    "Réponds uniquement avec un objet JSON valide, sans texte autour, sans bloc de code. Les sauts de ligne dans les textes sont écrits \\n.",
  ].join("\n");
}

/** Exemples performants de l'équipe (bloc mis en cache séparément : stable pour un univers et une catégorie donnés). */
export function buildExamplesBlock(examples: AiExample[] | undefined): string | null {
  const list = (examples ?? []).filter((e) => e.text.trim()).slice(0, 3);
  if (list.length === 0) return null;
  return [
    "CE QUI MARCHE CHEZ CETTE ÉQUIPE",
    "Voici des messages déjà envoyés par l'équipe qui ont obtenu de bons résultats pour le même univers et la même catégorie. Inspire-toi du ton et de la structure, sans les recopier.",
    ...list.map((e, i) => `Exemple ${i + 1}${e.note ? ` (${e.note})` : ""} :\n${e.text.trim()}`),
  ].join("\n\n");
}

/**
 * Repères réellement remplacés à l'envoi, par écran (null : aucun). Seuls les messages privés du bot sont
 * personnalisés : textes du bot (packages/telegram/src/join-flow/texts.ts), relances automatiques
 * (apps/worker/src/automations/executor.ts), envois à un groupe (apps/worker/src/broadcasts/personalize.ts). Un
 * message de canal et ses modèles partent tels quels : un {prenom} y resterait écrit.
 */
export const PLACEHOLDERS_BY_SURFACE: Record<AiSurface, readonly string[] | null> = {
  post: null,
  template: null,
  bot_text: ["{prenom}", "{canal}", "{liste_canaux}", "{delai}", "{bot}"],
  automation: ["{prenom}", "{canal}", "{bot}"],
  broadcast: ["{prenom}", "{bot}"],
};

/** Ligne « Repères » de la demande : ce qui est remplacé à cet endroit, ou l'interdiction d'en ajouter. */
function placeholdersLine(surface: AiSurface | null | undefined): string {
  if (!surface)
    return "Repères : on ne sait pas où ce message sera envoyé : n'ajoute aucun repère entre accolades.";
  const list = PLACEHOLDERS_BY_SURFACE[surface];
  if (!list)
    return "Repères : aucun n'est remplacé dans un message de canal ({prenom}, {canal}, {offre}… y partiraient tels quels) : n'ajoute aucun repère entre accolades ; écris les vrais mots.";
  return `Repères remplacés à l'envoi ici : ${list.join(", ")}. N'en utilise pas d'autre.`;
}

const KIND_INSTRUCTIONS: Record<AiKind, string> = {
  improve:
    "Améliore ce brouillon : plus clair, plus engageant, mieux structuré, en gardant son intention. Propose exactement 3 versions avec des angles différents.",
  idea: "À partir de cette idée (une phrase), rédige exactement 3 propositions de message complètes, avec des angles différents.",
  shorter:
    "Raccourcis ce message : moitié moins long au maximum, sans perdre l'appel à l'action ni la mention des risques. Propose exactement 3 versions courtes.",
  punchier:
    "Rends ce message plus percutant : accroche forte dès la première ligne, phrases courtes, un seul appel à l'action. Propose exactement 3 versions.",
  angle:
    "Réécris ce message sous 3 angles vraiment différents de l'original (par exemple : question au lecteur, bénéfice concret, curiosité, témoignage honnête sans chiffres inventés, rappel pratique). Propose exactement 3 versions.",
  translate:
    "Traduis ce message dans chacune des langues demandées, en adaptant naturellement les expressions (pas de mot à mot). Garde les repères entre accolades, les liens, les emojis animés (balises <tg-emoji> recopiées telles quelles) et la mise en forme HTML. Traduis aussi la mention des risques.",
  ab_variant:
    "Ce message est la version A d'un test A/B. Écris la version B : même objectif, même offre, même longueur environ, mais un angle d'accroche différent pour comparer. Propose exactement 3 candidates pour la version B.",
};

function describeContext(ctx: AiContext, max: number): string[] {
  const lines: string[] = [];
  lines.push(`Univers : ${ctx.vertical ? AI_LABELS.vertical[ctx.vertical] : "non précisé"}.`);
  if (ctx.categoryName) lines.push(`Catégorie du message : ${ctx.categoryName}.`);
  if (ctx.surface) lines.push(`Où il sera utilisé : ${AI_LABELS.surface[ctx.surface]}.`);
  lines.push(placeholdersLine(ctx.surface));
  lines.push(`Langue : ${AI_LABELS.language[ctx.language ?? "fr"]}.`);
  if (ctx.objective) lines.push(`Objectif : ${AI_LABELS.objective[ctx.objective]}.`);
  if (ctx.tone) lines.push(`Ton : ${AI_LABELS.tone[ctx.tone]}.`);
  if (ctx.length) lines.push(`Longueur souhaitée : ${AI_LABELS.length[ctx.length]}.`);
  lines.push(
    `Média joint : ${ctx.hasMedia ? "oui (légende)" : "non"}. Longueur maximale du texte visible : ${max} caractères.`,
  );
  return lines;
}

/** Message utilisateur : instruction du type de demande, contexte, brouillon, format JSON attendu. */
export function buildUserMessage(req: AiRequest): string {
  const max = maxLengthFor(req.context);
  const draftLabel = req.kind === "idea" ? "IDÉE" : "BROUILLON";
  const parts = [
    KIND_INSTRUCTIONS[req.kind],
    "",
    "CONTEXTE",
    ...describeContext(req.context, max),
    "",
    `${draftLabel} (entre les lignes de tirets) :`,
    "-----",
    req.text.trim(),
    "-----",
    "",
  ];
  if (req.kind === "translate") {
    const source = req.context.language ?? "fr";
    const targets = AI_TRANSLATION_LANGUAGES.filter((l) => l !== source);
    parts.push(
      `Langues cibles : ${targets.map((l) => `${l} (${AI_LABELS.language[l]})`).join(", ")}.`,
      "",
      "FORMAT DE SORTIE (JSON strict) :",
      `{"translations": {${targets.map((l) => `"${l}": "texte traduit"`).join(", ")}}}`,
    );
  } else {
    parts.push(
      "FORMAT DE SORTIE (JSON strict, exactement 3 versions) :",
      '{"versions": [{"text": "message complet en HTML Telegram", "why": "une phrase en français : ce qui change par rapport au brouillon"}, {"text": "…", "why": "…"}, {"text": "…", "why": "…"}]}',
    );
  }
  return parts.join("\n");
}

/** Blocs système dans l'ordre (règles puis exemples), tous marqués pour la mise en cache. */
export function buildSystemBlocks(req: AiRequest): Array<{ text: string; cache: boolean }> {
  const blocks = [{ text: buildRulesBlock(resolveRiskNotice(req.riskNotice)), cache: true }];
  const examples = buildExamplesBlock(req.examples);
  if (examples) blocks.push({ text: examples, cache: true });
  return blocks;
}
