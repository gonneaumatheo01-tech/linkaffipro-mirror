/**
 * Série de photos de chauffe en DM (persona fille).
 *
 * Le code décide de ce qui est PERMIS à ce tour (rien / photo n / lien) à partir d'une petite machine à états ; le
 * prompt dit au modèle ce qui est permis ; le modèle choisit son action et écrit le texte en conséquence. Une action
 * interdite est refusée et le message est régénéré, et un texte qui refuse alors que la photo part est refusé aussi :
 * le texte colle donc toujours à ce qui part réellement.
 *
 * Aucune dépendance à la base, au réseau ou à l'horloge : l'appelant persiste l'état et envoie.
 */

// ------------------------------------------------------------------
// RÉGLAGES (tout se change ici)
// ------------------------------------------------------------------

/** Échanges minimum avant la toute première photo. 1 = il a chauffé, elle peut envoyer tout de suite après. */
export const MIN_ECHANGES_AVANT_PREMIERE = 1;
/** Échanges minimum entre deux photos : elle attend qu'il réagisse avant de renvoyer. */
export const MIN_ECHANGES_ENTRE_PHOTOS = 2;
/** Nombre de photos de la série. */
export const MAX_PHOTOS = 5;
/** Dernière photo « gratuite » : au-delà, on ne montre la suite que par l'app. */
export const DERNIERE_PHOTO_GRATUITE = 3;
/** Échanges minimum après un refus du site avant le cadeau suivant. */
export const MIN_ECHANGES_APRES_REFUS = 2;

// ------------------------------------------------------------------
// État
// ------------------------------------------------------------------

/** Phases. `PHOTOS` = série en cours, `OFFER` = la 3 est partie, on attend qu'il en veuille plus. */
export const FLIRT_PHASES = [
  "NONE",
  "PHOTOS",
  "OFFER",
  "LINKED",
  "REFUSED",
  "WRAP",
  "DONE",
] as const;
export type FlirtPhase = (typeof FLIRT_PHASES)[number];
/** Ancien nom, gardé pour les types de l'appelant. */
export type FlirtStep = FlirtPhase;

/** Actions possibles d'un tour. */
export const FLIRT_ACTIONS = ["rien", "photo", "lien"] as const;
export type FlirtAction = (typeof FLIRT_ACTIONS)[number];

export type FlirtState = {
  phase: FlirtPhase;
  /** Dernière photo envoyée (0 : aucune). */
  lastPhoto: number;
  /** Messages de la personne depuis la dernière photo (ou depuis le début). */
  exchanges: number;
};

/** Consigne de rédaction pour ce tour (voir `flirtPromptBlock`). */
export type FlirtDirective =
  "none" | "play_hard" | "hook" | "push" | "tease" | "wait" | "link" | "explain" | "gift" | "wrap";

export type FlirtDecision = {
  /** État mis à jour (échanges comptés). */
  state: FlirtState;
  /** Actions autorisées ce tour, dans l'ordre de préférence. */
  allow: FlirtAction[];
  /** Photo armée si l'action « photo » est permise. */
  photoSlot: number | null;
  directive: FlirtDirective;
};

export type FlirtInput = {
  step: string;
  teases: number;
  /** Messages entrants récents, du plus ancien au plus récent. */
  recent: readonly string[];
  /** Message de ce tour. */
  text: string;
  /** Emplacements de photos réellement disponibles. */
  hasPhotos: readonly number[];
  isMinor?: boolean;
  /** Premier tour de réponse de l'assistante (GIRL illusion). */
  isFirstTurn?: boolean;
  /** Dernier message de l'assistante (pour détecter la question d'accroche). */
  lastAssistantText?: string;
};

/** Nombre d'accroches sans envoi avant de forcer (compatibilité). */
export const PATIENCE = MIN_ECHANGES_ENTRE_PHOTOS;

/** État rangé dans deux colonnes : la phase dans `flirtStep`, `lastPhoto * 100 + exchanges` dans `flirtTeases`. */
export function decodeState(step: string, teases: number): FlirtState {
  const phase = (FLIRT_PHASES as readonly string[]).includes(step) ? (step as FlirtPhase) : "NONE";
  const n = Number.isFinite(teases) && teases > 0 ? Math.floor(teases) : 0;
  return {
    phase,
    lastPhoto: Math.min(MAX_PHOTOS, Math.floor(n / 100)),
    exchanges: Math.min(99, n % 100),
  };
}

export function encodeProgress(state: FlirtState): number {
  return state.lastPhoto * 100 + Math.min(99, Math.max(0, state.exchanges));
}

/** Une photo est-elle déjà partie ? À partir de là, le lien n'est plus posé par les règles générales. */
export function hasStarted(phase: FlirtPhase): boolean {
  return phase !== "NONE";
}

// ------------------------------------------------------------------
// Lecture du message
// ------------------------------------------------------------------

const FORTS = [
  "bz",
  "bais",
  "niqu",
  "bite",
  "queue",
  "doigt",
  "tremp",
  "mouill",
  "bander",
  "bande",
  "sucer",
  "suce",
  "seins",
  "nichons",
  "foutre",
  "jouir",
  "orgasme",
  "chatte",
  "a poil",
  "a poils",
  "nue",
  "nu ",
  "excite",
  "excitant",
  "bandante",
  "levrette",
  "envie de toi",
  "penetr",
  "branl",
  "t es bonne",
  "portes quoi",
  "te montrer",
  "deshabill",
  "a quatre pattes",
  "a 4 pattes",
  "te toucher",
  "te caresser",
  "plan cul",
  "nudes",
  "nude",
  "te mater",
  "cochonne",
  "salope",
  "sexe",
];

const DOUX = [
  "chaud",
  "chaude",
  "envie",
  "corps",
  "peau",
  "caresse",
  "caresser",
  "embrass",
  "langue",
  "collant",
  "collante",
  "bonne",
  "jolie",
  "sexy",
  "desirable",
  "mignonne",
  "canon",
  "charmante",
  "attirante",
  "sensuelle",
  "tentation",
  "plaire",
  "craquer",
  "coquin",
  "coquine",
  "magnifique",
  "irresistible",
  "aguich",
];

const OUI = ["oui", "ouais", "vas y", "vas-y", "go", "carrement", "grave", "ok"];

const NON = [
  "non",
  "nan",
  "pas envie",
  "jveux pas",
  "je veux pas",
  "pas maintenant",
  "plus tard",
  "la flemme",
  "pas besoin",
  "bof",
  "pas chaud",
  "rester ici",
];

const PHOTO = ["photo", "photos", "pic", "image", "selfie", "montre", "montrer", "envoie"];

const SUITE = ["suite", "apres", "autres", "plus", "reste", "encore", "d autres"];

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

/** Il en veut plus : il réclame une photo ou la suite. */
export function wantsMore(text: string): boolean {
  return asksPhoto(text) || has(text, SUITE) || isYes(text);
}

/** Réponse qui montre qu'il suit : une question, ou trois mots. */
export function isEngaged(text: string): boolean {
  const t = normalize(text);
  return t.includes("?") || t.split(" ").filter(Boolean).length >= 3;
}

/** Vrai si le texte contient la question d'accroche du premier tour. */
export function isHookQuestion(text: string): boolean {
  return normalize(text).includes("cherches quoi");
}

/** Vrai si le texte est la réponse push (« du sexe alors ? » ou variante). */
export function isPushAnswer(text: string): boolean {
  const t = normalize(text);
  return t.includes("du sexe") || t.includes("sexe alors") || t.includes("moi oui en tout cas");
}

// ------------------------------------------------------------------
// Décision
// ------------------------------------------------------------------

/** Permissions d'un tour. Le modèle choisit dans `allow`, jamais en dehors. */
export function decideFlirt(input: FlirtInput): FlirtDecision {
  const state = decodeState(input.step, input.teases);
  const photo = (n: number) => input.hasPhotos.includes(n);
  const rien = (directive: FlirtDirective = "none", s: FlirtState = state): FlirtDecision => ({
    state: s,
    allow: ["rien"],
    photoSlot: null,
    directive,
  });
  const photoDispo = (s: FlirtState, n: number, directive: FlirtDirective): FlirtDecision =>
    photo(n) ? { state: s, allow: ["photo", "rien"], photoSlot: n, directive } : rien("wait", s);

  // Moins de 18 ans : plus rien ne part, ni photo ni lien.
  if (input.isMinor) return rien();

  switch (state.phase) {
    // Rien en cours : accroche au premier tour, puis réponse à l'accroche, puis série sur du sexe.
    case "NONE": {
      // Premier tour : directive hook (prénom + « tu cherches quoi toi ? »).
      if (input.isFirstTurn) return rien("hook");

      // Tour suivant l'accroche : sa réponse au « cherches quoi ».
      // N'importe quelle réponse sexuelle → série directe ; sinon → push.
      if (input.lastAssistantText && isHookQuestion(input.lastAssistantText)) {
        if (isSexTalk(input.text)) {
          const s: FlirtState = { phase: "PHOTOS", lastPhoto: 0, exchanges: 1 };
          return photoDispo(s, 1, "tease");
        }
        return rien("push");
      }

      // Tour suivant le push (« du sexe alors ? ») : N'IMPORTE QUELLE réponse lance la série.
      if (input.lastAssistantText && isPushAnswer(input.lastAssistantText)) {
        const s: FlirtState = { phase: "PHOTOS", lastPhoto: 0, exchanges: 1 };
        return photoDispo(s, 1, "tease");
      }

      if (isSexTalk(input.text) || isHot(input.recent, input.text) || asksPhoto(input.text)) {
        const s: FlirtState = { phase: "PHOTOS", lastPhoto: 0, exchanges: 1 };
        return photoDispo(s, 1, "tease");
      }
      return rien();
    }

    // Série en cours : une photo tous les MIN_ECHANGES_ENTRE_PHOTOS messages, pas plus.
    case "PHOTOS": {
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      const suivant = state.lastPhoto + 1;
      const seuil = state.lastPhoto === 0 ? MIN_ECHANGES_AVANT_PREMIERE : MIN_ECHANGES_ENTRE_PHOTOS;
      if (s.exchanges < seuil) return rien("wait", s);
      if (suivant > DERNIERE_PHOTO_GRATUITE) return rien("wait", s);
      return photoDispo(s, suivant, "tease");
    }

    // La 3 est partie : on parle, on tease, et le lien attend qu'il en veuille vraiment plus.
    case "OFFER": {
      if (isRefusal(input.text))
        return rien("explain", { ...state, phase: "REFUSED", exchanges: 0 });
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      if (s.exchanges >= 1 && (asksPhoto(input.text) || has(input.text, SUITE)))
        return { state: s, allow: ["lien", "rien"], photoSlot: null, directive: "link" };
      return rien("wait", s);
    }

    // Lien parti : on discute. Un refus bascule sur les cadeaux.
    case "LINKED": {
      if (isRefusal(input.text))
        return rien("explain", { ...state, phase: "REFUSED", exchanges: 0 });
      return rien("none", { ...state, exchanges: state.exchanges + 1 });
    }

    // Il a refusé le site : on discute d'abord, puis un cadeau, après MIN_ECHANGES_APRES_REFUS.
    case "REFUSED": {
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      const suivant = state.lastPhoto + 1;
      if (s.exchanges < MIN_ECHANGES_APRES_REFUS) return rien("wait", s);
      if (suivant > MAX_PHOTOS) return rien("wait", s);
      return photoDispo(s, suivant, "gift");
    }

    // Après la 5 : une ligne pour dire qu'on continue là-bas.
    case "WRAP":
      return rien("wrap", { phase: "DONE", lastPhoto: state.lastPhoto, exchanges: 0 });

    default:
      if (asksPhoto(input.text)) return rien("play_hard", { ...state, exchanges: state.exchanges + 1 });
      return rien("none", { ...state, exchanges: state.exchanges + 1 });
  }
}

/** État après une action réellement partie. */
export function applyAction(state: FlirtState, action: FlirtAction): FlirtState {
  if (action === "photo") {
    const lastPhoto = Math.min(MAX_PHOTOS, state.lastPhoto + 1);
    const phase: FlirtPhase =
      lastPhoto >= MAX_PHOTOS
        ? "WRAP"
        : state.phase === "REFUSED"
          ? "REFUSED"
          : lastPhoto >= DERNIERE_PHOTO_GRATUITE
            ? "OFFER"
            : "PHOTOS";
    return { phase, lastPhoto, exchanges: 0 };
  }
  if (action === "lien") return { phase: "LINKED", lastPhoto: state.lastPhoto, exchanges: 0 };
  return state;
}

// ------------------------------------------------------------------
// Consignes de prompt
// ------------------------------------------------------------------

const ACTION_LABEL: Record<FlirtAction, string> = { rien: "rien", photo: "photo", lien: "lien" };

const DIRECTIVE_HINT: Record<FlirtDirective, string> = {
  none: "",
  play_hard:
    "Il demande une photo mais t'as plus rien ici : « dommage, j'envoie pas de photos sur telegram ». Le reste c'est sur l'app.",
  hook: "Premier message : dis ton prénom et demande-lui « tu cherches quoi toi ? ». Deux lignes max, rien d'autre.",
  push: "Il a répondu au hook : pousse direct. Dis « du sexe alors ? 😏 » ou « moi oui en tout cas ». Tu assumes que c'est du sexe, sans exception. Interdits : « ça dépend », « on verra », « c'est sympa », « à voir », « chacun son truc ».",
  tease: "Fais court : tu chauffes, tu annonces, tu ne décris pas tout.",
  wait: "Rien à envoyer ce tour : réagis à ce qu'il vient de dire et tease, sans promettre de photo tout de suite.",
  link: "Tu envoies l'app : « jsuis pas trop sur cette app » ou « la-bas je suis coquine, viens ». Le lien est ajouté par le système.",
  explain:
    "Il a refusé l'app : « dommage, j'envoie pas de photos sur telegram, n'importe qui peut enregistrer ». Ne renvoie pas de lien, et dis que t'as autre chose à montrer.",
  gift: "C'est un cadeau : présente la photo comme un petit extra (« bon ok, juste pour toi »).",
  wrap: "Tu dis que tu continues là-bas, en une ligne, sans renvoyer de lien.",
};

/** Bloc de prompt du tour : ce qui est permis, et comment le dire. */
export function flirtPromptBlock(d: {
  allow: readonly FlirtAction[];
  photoSlot: number | null;
  directive: FlirtDirective;
  photo: string | null;
}): string[] {
  const lines = ["", "PHOTOS (ce tour)"];
  const permises = d.allow.map((a) =>
    a === "photo" && d.photoSlot ? `photo ${d.photoSlot}` : ACTION_LABEL[a],
  );
  lines.push(`Actions permises : ${permises.join(" / ")}.`);
  lines.push(
    `Tu réponds dans le champ action, une seule valeur, obligatoirement parmi : ${d.allow.join(", ")}.`,
  );
  if (d.photoSlot && d.allow.includes("photo") && d.photo) {
    lines.push(`Photo armée : ${d.photoSlot} (${d.photo}).`);
    lines.push(
      `Si tu l'envoies : action "photo", et ton texte annonce la photo en une ligne (« attends », « juste une », « tiens »). Jamais un refus quand la photo part.`,
    );
  }
  if (d.allow.includes("lien"))
    lines.push(
      `Si tu envoies l'app : action "lien", une phrase qui l'amène, le lien est ajouté par le système.`,
    );
  if (d.allow.length === 1) lines.push(`N'envoie rien : action "rien".`);
  const hint = DIRECTIVE_HINT[d.directive];
  if (hint) lines.push(hint);
  return lines;
}
