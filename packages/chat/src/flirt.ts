/**
 * Série de photos de chauffe en DM (persona fille). Le moteur n'envoie rien parce qu'un seuil est atteint : il arme une
 * intention, et l'intention ne part qu'a une porte franchie. Tant que la porte n'est pas la, chaque reponse est une
 * accroche. Au bout de PATIENCE tours sans porte, elle propose d'elle-meme, une seule fois.
 *
 * Aucune dependance a la base, au reseau ou a l'horloge : tout est calcule ici, l'appelant persiste l'etape et envoie.
 */

/** Etapes de la serie. `SENTn` = photo n envoyee ; `TEASEn` = accroche pour la photo n, on attend sa reponse. */
export const FLIRT_STEPS = [
  "NONE",
  "LOCKED",
  "TEASE1",
  "SENT1",
  "TEASE2",
  "SENT2",
  "TEASE3",
  "SENT3",
  "OFFER_PENDING",
  "OFFER_SENT",
  "EXPLAINED",
  "TEASE4",
  "SENT4",
  "TEASE5",
  "SENT5",
  "WRAP",
  "DONE",
] as const;
export type FlirtStep = (typeof FLIRT_STEPS)[number];

/** Ce que la reponse doit porter. */
export type FlirtDirective =
  | "none"
  /** « j'envoie pas de photos ici d'habitude » : il demande une photo, elle fait genre. */
  | "play_hard"
  /** Une accroche sur la photo armee, sans l'envoyer. */
  | "tease"
  /** Repondre normalement, sans parler de l'appli : la serie est finie, on laisse venir. */
  | "wait"
  /** Le pretexte du pas securise, puis le lien. */
  | "link"
  /** Il a refuse : une explication, pas un second lien, puis le tease de la 4. */
  | "explain"
  /** « bon je reponds que la-bas ». */
  | "wrap";

export type FlirtInput = {
  step: FlirtStep;
  /** Messages entrants recents, du plus ancien au plus recent (3 suffisent). */
  recent: readonly string[];
  /** Message de ce tour. */
  text: string;
  /** Accroches deja faites a cette etape. */
  teases: number;
};

export type FlirtDecision = {
  step: FlirtStep;
  /** Photo a envoyer maintenant (1 a 5), ou null. */
  sendPhoto: number | null;
  directive: FlirtDirective;
  teases: number;
};

/** Nombre d'accroches sans reponse avant qu'elle envoie d'elle-meme. */
export const PATIENCE = 3;

const FORTS = [
  "bz", "bais", "niqu", "bite", "queue", "doigt", "tremp", "mouill", "bander", "bande",
  "sucer", "suce", "seins", "nichons", "foutre", "jouir", "orgasme", "chatte", "a poil",
  "a poils", "nue", "nu ", "excite", "excitant", "bandante", "levrette", "penetr",
];

const DOUX = [
  "chaud", "chaude", "envie", "corps", "peau", "caresse", "caresser", "embrass",
  "langue", "collant", "collante", "bonne", "jolie", "sexy", "desirable",
];

const OUI = [
  "oui", "ouais", "vas y", "vas-y", "montre", "envoie", "balance", "fais voir",
  "jveux voir", "je veux voir", "go", "carrement", "grave",
];

const NON = [
  "non", "nan", "pas envie", "jveux pas", "je veux pas", "pas maintenant",
  "plus tard", "la flemme", "pas besoin", "bof", "pas chaud",
];

const PHOTO = ["photo", "photos", "pic", "image", "selfie", "montre toi", "montre-moi toi", "tu ressembles"];

/** Minuscules sans accents, pour comparer sans se soucier de la saisie. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function has(text: string, mots: readonly string[]): boolean {
  const n = ` ${normalize(text)} `;
  return mots.some((m) => n.includes(m));
}

export function isSexTalk(text: string): boolean {
  return has(text, FORTS);
}

/** Vrai si la conversation est chaude : un mot fort suffit, deux mots doux dans les trois derniers messages aussi. */
export function isHot(recent: readonly string[], text: string): boolean {
  const texts = [...recent.slice(-3), text];
  if (texts.some((t) => isSexTalk(t))) return true;
  return texts.filter((t) => has(t, DOUX)).length >= 2;
}

export function asksPhoto(text: string): boolean {
  return has(text, PHOTO);
}

export function isYes(text: string): boolean {
  return has(text, OUI);
}

export function isRefusal(text: string): boolean {
  return has(text, NON);
}

/** Reponse qui montre qu'il suit : une question, ou trois mots. Un « ok » seul ne suffit pas. */
export function isEngaged(text: string): boolean {
  const t = normalize(text);
  return t.includes("?") || t.split(" ").filter(Boolean).length >= 3;
}

/** Une photo est-elle deja partie ? A partir de la, l'offre n'est plus decidee par les regles generales. */
export function hasStarted(step: FlirtStep): boolean {
  return step !== "NONE";
}

/** Le moteur peut-il poser son lien de lui-meme ? Non des qu'une photo est partie, sauf a l'etape dediee. */
export function offerAllowed(step: FlirtStep): boolean {
  return step === "OFFER_PENDING";
}

const TEASE_SUIVANTE: Partial<Record<FlirtStep, FlirtStep>> = {
  TEASE1: "TEASE2",
  TEASE2: "TEASE3",
  TEASE4: "TEASE5",
  TEASE5: "WRAP",
};

const SENT_DE: Partial<Record<FlirtStep, number>> = { TEASE1: 1, TEASE2: 2, TEASE3: 3, TEASE4: 4, TEASE5: 5 };

const SUITE = ["suite", "apres", "autres", "plus", "reste", "encore"];

/**
 * Decide de la suite. Regle generale : on n'envoie une photo que si la porte est franchie, sinon on accroche ; au bout de
 * PATIENCE accroches, on envoie quand meme avec une ligne douce.
 */
export function flirtAction(input: FlirtInput): FlirtDecision {
  const { step, recent, text } = input;
  const teases = input.teases;
  const repondu = isYes(text) || isEngaged(text);
  const photo = SENT_DE[step] ?? null;

  // Rien en cours : la serie ne demarre que sur du sexe. Une demande de photo seule laisse jouer l'autre script.
  if (step === "NONE") {
    if (isSexTalk(text) || isHot(recent, text))
      return { step: "TEASE1", sendPhoto: null, directive: "tease", teases: 0 };
    if (asksPhoto(text)) return { step: "LOCKED", sendPhoto: null, directive: "play_hard", teases: 0 };
    return { step, sendPhoto: null, directive: "none", teases };
  }

  // Il a demande une photo et elle a fait genre : des qu'il chauffe, la serie demarre.
  if (step === "LOCKED") {
    if (isSexTalk(text) || isHot(recent, text) || has(text, DOUX))
      return { step: "TEASE1", sendPhoto: null, directive: "tease", teases: 0 };
    if (asksPhoto(text) && teases + 1 >= PATIENCE)
      return { step: "TEASE2", sendPhoto: 1, directive: "tease", teases: 0 };
    return { step, sendPhoto: null, directive: "play_hard", teases: teases + 1 };
  }

  // Une photo est armee : elle part sur une porte, sinon on accroche.
  if (photo !== null) {
    if (repondu || teases + 1 >= PATIENCE) {
      const suite = photo === 3 ? "OFFER_PENDING" : (TEASE_SUIVANTE[step] ?? step);
      return { step: suite, sendPhoto: photo, directive: photo === 3 ? "wait" : "tease", teases: 0 };
    }
    return { step, sendPhoto: null, directive: "tease", teases: teases + 1 };
  }

  // Serie finie : on parle, on ne pousse pas l'appli.
  if (step === "OFFER_PENDING") {
    const demande = asksPhoto(text) || has(text, SUITE);
    if (demande || isSexTalk(text) || teases + 1 >= PATIENCE)
      return { step: "OFFER_SENT", sendPhoto: null, directive: "link", teases: 0 };
    return { step, sendPhoto: null, directive: "wait", teases: teases + 1 };
  }

  // Refus : une explication, pas de second lien, puis le tease de la 4.
  if (step === "OFFER_SENT") {
    if (isRefusal(text)) return { step: "EXPLAINED", sendPhoto: null, directive: "explain", teases: 0 };
    return { step, sendPhoto: null, directive: "none", teases: 0 };
  }

  if (step === "EXPLAINED") {
    if (repondu) return { step: "TEASE5", sendPhoto: 4, directive: "tease", teases: 0 };
    return { step, sendPhoto: null, directive: "tease", teases: teases + 1 };
  }

  if (step === "WRAP") return { step: "DONE", sendPhoto: null, directive: "wrap", teases: 0 };

  // SENT4 et SENT5 ne durent qu'un tour : on enchaine sur la suite.
  if (step === "SENT4") return { step: "TEASE5", sendPhoto: null, directive: "tease", teases: 0 };
  if (step === "SENT5") return { step: "WRAP", sendPhoto: null, directive: "none", teases: 0 };

  return { step, sendPhoto: null, directive: "none", teases };
}
