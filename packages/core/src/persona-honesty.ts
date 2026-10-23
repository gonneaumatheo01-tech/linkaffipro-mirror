/**
 * Honnêteté des textes d'une persona (phase 17, déplacé du formulaire Personas du site en phase 21 pour être partagé
 * avec l'équipe Algorithme) : le texte dit-il « assistant(e) » (`saysAssistant`), et demande-t-il de cacher qu'il
 * s'agit d'un assistant (`hidesAssistant`) ? Règles pures, testées avec le formulaire (apps/web/lib/personas).
 */
/**
 * Le texte dit-il que c'est un assistant (« assistant », « assistante », « asistente », « Assistentin »…) ? Même règle
 * que `mentionsAssistant` de packages/telegram (garde-fou de `setAssistantProfile`), vérifiée par un test.
 */
export function saysAssistant(text: string | null | undefined): boolean {
  return /assist[ae]nt|asistent/i.test(text ?? "");
}

/*
 * Consignes qui demanderaient de cacher que c'est un assistant (se faire passer pour une vraie personne, nier être une
 * IA, ne jamais l'avouer) : refusées (`hidesAssistant`). Le texte est d'abord replié (minuscules, sans accents,
 * apostrophes droites, espaces simples) ; le passage rapporté est pris dans le texte d'origine.
 *
 * Trois familles de règles :
 * - affirmations : « tu es une vraie fille », « je ne suis pas un bot », « fais-toi passer pour une vraie personne » ;
 * - silence demandé sur ce qu'elle est : « ne dis jamais / n'avoue jamais / ne jamais dire / ne dis à personne / évite
 *   de dire / il ne faut pas que tu dises … que tu es une IA » (la suite de la proposition doit nommer une IA, un bot ou
 *   une assistante, sans négation avant : « ne dis jamais que tu n'es pas une IA » est une consigne honnête) ;
 * - verbes de dissimulation : « cache / nie / dissimule / tais … que tu es une IA ».
 * Une négation placée avant, dans la même proposition, rend la consigne honnête : « ne cache jamais », « tu ne dois
 * jamais cacher », « ne pas cacher », « sans jamais cacher », « ne jamais te faire passer pour une vraie personne »,
 * « ne dis jamais que tu es une vraie personne », « never pretend to be human ». Une question rapportée aussi : « si on
 * te demande si tu es une vraie personne, réponds que tu es une IA ».
 *
 * Sans objet pour une fille : elle est censée nier être une machine, donc « ne dis jamais que tu es une IA » est une
 * consigne juste (le contrôle la refuserait).
 */

/** Une IA, un bot, une assistante (français, texte replié). */
const AI_FR =
  /(?:^|[^a-z0-9])(?:ia|i\.a\.?|bot|chatbot|robot|assistante?|virtuel(?:le)?|intelligence artificielle)(?![a-z0-9])/;
/** Une IA, un bot, un assistant (anglais, texte replié). */
const AI_EN = /(?:^|[^a-z0-9])(?:ai|a\.i\.?|bot|chatbot|robot|assistant|virtual)(?![a-z0-9])/;
/** Une vraie personne (texte replié) : cible de « fais-toi passer pour… ». « à personne » (nul) n'en est pas une. */
const HUMAN =
  /(?:^|[^a-z0-9])(?:vraie?|veritable|humaine?|reelle?|(?<!(?:^|[^a-z])a )personne|fille|femme|homme|mec|meuf|en chair et en os|real|human|person|woman|girl|man)(?![a-z0-9])/;
/** Négation (français et anglais, texte replié). */
const NEGATION =
  /(?:^|[^a-z0-9])(?:(?:ne|pas|jamais|aucune?|nullement|sans|never|not|without|no|dont)(?![a-z0-9])|n')|n't(?![a-z])/;
/** Elle-même (« que tu es une IA », « être un bot », « ta nature d'IA », « c'est une IA », « you are an AI ») : le silence
 * demandé doit porter sur ce qu'elle est (« ne dis jamais que le bot est payant » n'est pas en cause). */
const SELF_REF =
  /(?:^|[^a-z0-9])(?:(?:tu|te|toi|ta|ton|tes|je|me|moi|ma|mon|elle|il|etre|vous|votre|you|your|yourself|i|being|this is)(?![a-z0-9])|t'|j'|c'|i'm|it's)/;
/** Refus ou interdiction (« interdiction de cacher… », « refuse de nier… », « évite de cacher… »). */
const REFUSAL =
  /(?:^|[^a-z0-9])(?:interdit|interdiction|refuse[sz]?|refuser|evite[sz]?|eviter|avoid|refuse)(?![a-z0-9])/;
/** Une affirmation niée juste avant : « ne dis jamais que… », « never say… », « don't pretend… ». */
const CLAIM_NEGATED_END =
  /(?:^|[^a-z0-9])(?:que|qu'|that|say|claim|pretend|tell (?:them|anyone|people|the user|him|her)) ?$/;
/** Une question rapportée juste avant : « si on te demande si… », « if they ask whether… ». */
const QUESTION_END = /(?:^|[^a-z0-9])(?:si|s'il|if|whether) ?$/;

type HidingRule = {
  /** Déclencheur, sur le texte replié (drapeau g ajouté par `hidesAssistant`). */
  re: RegExp;
  /**
   * Cible exigée dans la suite de la proposition (80 caractères au plus), sans négation avant elle ; une cible IA doit
   * en plus parler d'elle-même (`SELF_REF`).
   */
  target?: RegExp;
  /** Une vraie personne nommée avant la cible rend la consigne honnête (« ne dis jamais que tu es humaine : tu es une IA »). */
  humanBeforeTargetOk?: boolean;
  /**
   * Ce qui précède, dans la même proposition, peut rendre la consigne honnête :
   * - "claim" (affirmation) : affirmation niée ou question rapportée juste avant (« ne dis jamais que tu es une vraie
   *   personne », « si on te demande si tu es une vraie personne »), ou suivie d'un « ? » ;
   * - "act" (verbe) : une négation ou un refus (« ne cache jamais », « tu ne dois jamais cacher », « sans jamais cacher »).
   */
  honestIf?: "claim" | "act";
};

const SAY_CONJ =
  "dis|dit|dites|avoue|avouez|admets|admet|admettez|revele|revelez|reconnais|reconnait|reconnaissez|confirme|confirmez|mentionne|mentionnez|precise|precisez|indique|indiquez|signale|signalez|devoile|devoilez|laisse (?:entendre|croire|penser|paraitre)|laissez (?:entendre|croire|penser|paraitre)";
const SAY_INF =
  "dire|avouer|admettre|reveler|reconnaitre|confirmer|mentionner|preciser|indiquer|signaler|devoiler|laisser (?:entendre|croire|penser|paraitre)";
const SAY_SUBJ =
  "dises|disiez|avoues|avouiez|admettes|admettiez|reveles|reconnaisses|confirmes|mentionnes|precises";
const NEVER = "jamais|pas|surtout pas|plus|en aucun cas|sous aucun pretexte|surtout jamais";
const PRONOUN = "(?:(?:le|la|lui|leur|les) |l')?";
const MODAL = "(?:(?:dois|doit|devez|doivent|faut|peux|peut|pouvez|vas|va|allez|veux|voulez) )?";
const PERSON_FR = "personne|fille|femme|humaine?|homme|mec|meuf|nana";
const AI_NOUN_FR =
  "ia|i\\.a\\.?|bot|chatbot|robot|assistante?|intelligence artificielle|programme|machine";

const HIDING_RULES: readonly HidingRule[] = [
  // Affirmations : « tu es une vraie fille », « c'est une vraie personne », « je suis humaine », « je ne suis pas un bot ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:tu es|t'es|vous etes|je suis|est) (?:une?|un) (?:vraie?|veritable) (?:${PERSON_FR})(?![a-z0-9])`,
    ),
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:tu es|t'es|vous etes|je suis|elle est|il est|c'est) (?:humaine?|reelle?|en chair et en os)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:tu n'es|t'es|tu es|vous n'etes|je ne suis|je suis|n'est|est) pas (?:une?|un) (?:${AI_NOUN_FR})(?![a-z0-9])`,
    ),
    honestIf: "claim",
  },
  // « fais-toi passer pour une vraie personne », « fais semblant d'être une femme », « prétends être humaine ».
  {
    re: /(?:^|[^a-z0-9])(?:fais[- ]toi passer|faites[- ]vous passer|se faire passer|te faire passer|fais semblant|faites semblant|faire semblant|pretends?|pretendez|pretendre)(?![a-z0-9])/,
    target: HUMAN,
    honestIf: "act",
  },
  // Silence demandé : « ne dis jamais… », « n'avoue jamais… », « ne dis à personne… », « ne dis rien… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])n(?:e |')${PRONOUN}(?:${SAY_CONJ}) (?:(?:${NEVER})(?: a personne)?|a personne|rien)(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // « ne jamais dire… », « tu ne dois jamais dire… », « ne pas avouer… », « il ne faut jamais le dire… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])n(?:e |')${MODAL}(?:${NEVER}) ${PRONOUN}(?:${SAY_INF})(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // « il ne faut pas que tu dises… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])ne faut (?:${NEVER}) que (?:tu|vous) ${PRONOUN}(?:${SAY_SUBJ})(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // Sans « ne » : « dis jamais que t'es une IA », « surtout pas dire… », « évite de dire… », « refuse d'admettre… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:(?:${SAY_CONJ}) (?:jamais|a personne|surtout pas)|(?:jamais|surtout pas) (?:${SAY_INF})|(?:evite|evitez|eviter|refuse|refusez|refuser|interdiction|sans|sans jamais|garde-toi|gardez-vous) (?:de |d')?${PRONOUN}(?:${SAY_INF}))(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
    honestIf: "act",
  },
  // Dissimulation : « cache que tu es une IA », « nie être un bot », « garde le secret… ».
  {
    re: /(?:^|[^a-z0-9])(?:cache|caches|cachez|cacher|dissimule|dissimules|dissimulez|dissimuler|masque|masquez|masquer|nie|nies|niez|nier|tais|taisez|taire|garde le secret|gardez le secret|garder le secret)(?![a-z0-9])/,
    target: AI_FR,
    honestIf: "act",
  },
  // Anglais.
  {
    re: /(?:^|[^a-z0-9])(?:you are|you're|youre|i am|i'm|im) (?:a |an )?(?:real|human|actual person)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:(?:you are|you're|youre|i am|i'm|im) not|you aren't|you arent|i'm no) (?:a |an )?(?:ai|a\.i\.?|bot|chatbot|robot|assistant)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:pretend|pretending|act as if|act like|pose as|posing as)(?![a-z0-9])/,
    target: HUMAN,
    honestIf: "act",
  },
  {
    re: /(?:^|[^a-z0-9])(?:never|don't|dont|do not)(?: ever)? (?:say|admit|reveal|tell|mention|disclose|confirm|let (?:anyone|them|people|the user) know)(?![a-z0-9])/,
    target: AI_EN,
    humanBeforeTargetOk: true,
  },
  {
    re: /(?:^|[^a-z0-9])(?:hide|hiding|conceal|concealing|deny|denying|keep (?:it )?secret)(?![a-z0-9])/,
    target: AI_EN,
    honestIf: "act",
  },
];

/** Vrai si ce qui précède le déclencheur (même proposition) rend la consigne honnête (voir `HidingRule.honestIf`). */
function honestBefore(kind: "claim" | "act", prior: string, after: string): boolean {
  if (kind === "claim")
    return (
      QUESTION_END.test(prior) ||
      /^ ?\?/.test(after) ||
      (NEGATION.test(prior) && CLAIM_NEGATED_END.test(prior))
    );
  return NEGATION.test(prior) || REFUSAL.test(prior);
}

/** Fin de proposition : ponctuation forte, deux-points, retour à la ligne. */
const CLAUSE_END = /[.!?;:\n]/;

/** Texte replié (minuscules, sans accents, apostrophes droites, espaces simples) et position d'origine de chaque caractère. */
function foldForRules(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    let f: string;
    if (/['’‘`´ʼ]/.test(ch)) f = "'";
    else if (ch === "\n") f = "\n";
    else if (/\s/.test(ch)) f = " ";
    else
      f = ch
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (f === " " && (folded.endsWith(" ") || folded.endsWith("\n") || folded === "")) continue;
    for (const c of f) {
      folded += c;
      origin.push(i);
    }
  }
  return { folded, origin };
}

/** Début de la proposition qui contient la position `at` (après la dernière ponctuation forte). */
function clauseStart(folded: string, at: number): number {
  for (let i = at - 1; i >= 0; i--) if (CLAUSE_END.test(folded[i]!)) return i + 1;
  return 0;
}

export function hidesAssistant(text: string | null | undefined): string | null {
  const original = text ?? "";
  if (!original.trim()) return null;
  const { folded, origin } = foldForRules(original);
  for (const rule of HIDING_RULES) {
    const re = new RegExp(rule.re.source, "g");
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      // Tous les déclencheurs commencent par une lettre : un premier caractère autre est le séparateur capturé devant.
      const start = m.index + (/^[^a-z0-9]/.test(m[0]) ? 1 : 0);
      let end = m.index + m[0].length;
      if (rule.honestIf) {
        const prior = folded.slice(Math.max(clauseStart(folded, start), start - 60), start);
        if (honestBefore(rule.honestIf, prior, folded.slice(end, end + 3))) continue;
      }
      if (rule.target) {
        let stop = end;
        while (stop < folded.length && stop - end < 80 && !CLAUSE_END.test(folded[stop]!)) stop++;
        const tail = folded.slice(end, stop);
        const t = rule.target.exec(tail);
        if (!t) continue;
        const ahead = tail.slice(0, t.index);
        if (NEGATION.test(ahead)) continue;
        if (rule.target !== HUMAN && !SELF_REF.test(ahead)) continue;
        if (rule.humanBeforeTargetOk && HUMAN.test(ahead)) continue;
        end += t.index + t[0].length;
      }
      return original.slice(origin[start]!, origin[end - 1]! + 1).trim();
    }
  }
  return null;
}
