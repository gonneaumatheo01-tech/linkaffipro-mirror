/**
 * Série de photos de chauffe en DM (persona fille).
 *
 * Le code décide de ce qui est PERMIS à ce tour (rien / photo n / lien) à partir d'une petite machine à états ; le
 * prompt dit au modèle ce qui est permis ; le modèle choisit son action et écrit le texte en conséquence. Une action
 * interdite est ramenée par le code à ce qui est permis (sans nouvel appel, sauf une photo non permise : régénérée), et
 * un texte qui refuse alors que la photo part garde son refus sans la photo : le texte colle donc toujours à ce qui part
 * réellement. Une annonce du lien sans lien est impossible (voir `runTurn`).
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
  "none" | "play_hard" | "tease" | "wait" | "sell" | "link" | "explain" | "gift" | "wrap";

export type FlirtDecision = {
  /** État mis à jour (échanges comptés). */
  state: FlirtState;
  /** Actions autorisées ce tour, dans l'ordre de préférence. Une seule action autre que « rien » : obligatoire. */
  allow: FlirtAction[];
  /** Photo armée si l'action « photo » est permise. */
  photoSlot: number | null;
  directive: FlirtDirective;
  /** Elle vend l'app à ce tour sans lien : le lien est armé et part au tour suivant, annoncé dans ce tour-là. */
  armLink?: boolean;
  /** Refus ferme et photos épuisées : plus aucune réponse, ni relance (ce n'est pas un /stop). */
  silent?: boolean;
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
  /** Lien armé au tour précédent (fait `ARMED_LINK_FACT`) : il part à ce tour. */
  linkArmed?: boolean;
  /** Offre liée à la persona (absent = oui) : sans offre, jamais de lien. */
  hasOffer?: boolean;
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

// Début de mot (voir `hasWord`) : « niqu » ne trouve plus « unique », ni « nue » « continue ». Un espace final exige
// le mot entier (« cul » sans « culture »).
const FORTS = [
  "bz",
  "baise",
  "baiser",
  "baiz",
  "niqu",
  "bite",
  "ma queue",
  "ta queue",
  "sa queue",
  "doigte",
  "doigter",
  "trempee",
  "mouille",
  "mouiller",
  "bander",
  "je bande",
  "jbande",
  "tu bandes",
  "sucer",
  "suce",
  "pipe",
  "seins",
  "nichons",
  "foutre",
  "jouir",
  "orgasme",
  "chatte",
  "a poil",
  "nue",
  "nu ",
  "nus ",
  "excit",
  "bandante",
  "levrette",
  "envie de toi",
  "envie de te ",
  "penetr",
  "branl",
  "sexe",
  "sex ",
  "cul ",
  "fesses",
  "t es bonne",
  "tes bonne",
  "trop bonne",
  "tellement bonne",
  "grave bonne",
  "es chaude",
  "suis chaud",
  "jsuis chaud",
  "me chauffe",
  "tu portes quoi",
  "t as quoi sur toi",
  "sous vet",
  "lingerie",
  "string",
  "culotte",
  "soutif",
  "lecher",
  "se voir",
  "on se voit",
  "se rencontrer",
  "te rencontrer",
  "viens chez",
  "venir chez",
  "plan cul",
];

const DOUX = [
  "chaud",
  "chauff",
  "envie",
  "corps",
  "peau",
  "caresse",
  "embrass",
  "bisou",
  "calin",
  "langue",
  "collant",
  "bonne",
  "jolie",
  "belle",
  "canon",
  "mignonne",
  "magnifique",
  "craquante",
  "charmante",
  "sublime",
  "bombe",
  "sexy",
  "desirable",
  "coquin",
  "dispo",
  "seule",
  "bb",
  "bebe",
  "cherie",
  "tu me plais",
  "tu me fais",
  "tu fais quoi la",
  "tu fais quoi ce soir",
  "au lit",
  "ton lit",
];

/** Formules de politesse retirées avant de compter les mots doux : « bonne nuit » ou « belle journée » ne chauffent pas. */
const POLITESSES =
  /\b(bonne|belle) (nuit|journee|soiree|chance|annee|fete|semaine|continuation|matinee|aprem)\b/g;

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

// Début de mot aussi : « pic » ne trouve plus « typique », ni « envoie » seul « je t'envoie un message ».
const PHOTO = [
  "photo",
  "pic ",
  "pics",
  "image",
  "selfie",
  "nude",
  "montre",
  "envoie moi",
  "envoie une",
  "envoie des",
  "envoie en",
  "envoie ca",
  "fais voir",
  "fait voir",
  "a quoi tu ressembles",
  "voir ta tete",
  "voir ton corps",
];

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

/** Comme `has`, mais chaque entrée doit commencer un mot (ponctuation ignorée). */
function hasWord(text: string, mots: readonly string[]): boolean {
  const n = ` ${normalize(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  return mots.some((m) => n.includes(` ${m}`));
}

/** Nombre d'entrées de la liste trouvées dans le texte (début de mot). */
function countWords(text: string, mots: readonly string[]): number {
  return mots.filter((m) => hasWord(text, [m])).length;
}

export function isSexTalk(text: string): boolean {
  return hasWord(text, FORTS);
}

/**
 * Vrai si la conversation est chaude : un mot fort suffit (phrase cash, au premier message comme ailleurs), deux mots
 * doux dans les trois derniers messages aussi (« t'es belle, tu me plais »).
 */
export function isHot(recent: readonly string[], text: string): boolean {
  const texts = [...recent.slice(-3), text];
  if (texts.some((t) => isSexTalk(t))) return true;
  return texts.reduce((n, t) => n + countWords(normalize(t).replace(POLITESSES, " "), DOUX), 0) >= 2;
}

export function asksPhoto(text: string): boolean {
  return hasWord(text, PHOTO);
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
    // Rien en cours : la chauffe ou une demande de photo démarre la série à ce tour, sans condition d'échanges (le soft
    // s'arrête net). Sans photo 1, une demande de photo seule fait genre.
    case "NONE": {
      // Sans aucune photo de chauffe (Casino, Paris, persona sans série), la série n'existe pas : rien ne bouge.
      if (input.hasPhotos.length === 0) return rien();
      const chaud = isSexTalk(input.text) || isHot(input.recent, input.text);
      if (!chaud && asksPhoto(input.text) && !photo(1)) return rien("play_hard");
      if (chaud || asksPhoto(input.text)) {
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

    // La 3 est partie : elle vend l'app (sans lien) et le lien est armé ; il part au tour suivant, annoncé dans ce
    // tour-là. S'il en réclame déjà, il part tout de suite. Jamais collé sans phrase d'amenée.
    case "OFFER": {
      if (isRefusal(input.text))
        return rien("explain", { ...state, phase: "REFUSED", exchanges: 0 });
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      if (input.hasOffer === false) return rien("wait", s);
      if (input.linkArmed || (s.exchanges >= 1 && (asksPhoto(input.text) || has(input.text, SUITE))))
        return { state: s, allow: ["lien"], photoSlot: null, directive: "link" };
      return { ...rien("sell", s), armLink: true };
    }

    // Lien parti : on discute. Un refus bascule sur les cadeaux ; une demande de photo, la suite est sur l'app.
    case "LINKED": {
      if (isRefusal(input.text))
        return rien("explain", { ...state, phase: "REFUSED", exchanges: 0 });
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      return rien(asksPhoto(input.text) ? "play_hard" : "none", s);
    }

    // Il a refusé le site : on discute d'abord, puis un cadeau, après MIN_ECHANGES_APRES_REFUS.
    case "REFUSED": {
      const s: FlirtState = { ...state, exchanges: state.exchanges + 1 };
      const suivant = state.lastPhoto + 1;
      if (s.exchanges < MIN_ECHANGES_APRES_REFUS)
        return rien(asksPhoto(input.text) ? "play_hard" : "wait", s);
      if (suivant > MAX_PHOTOS) return rien(asksPhoto(input.text) ? "play_hard" : "wait", s);
      return photoDispo(s, suivant, "gift");
    }

    // Après la 5 : une ligne pour dire qu'on continue là-bas.
    case "WRAP":
      return rien("wrap", { phase: "DONE", lastPhoto: state.lastPhoto, exchanges: 0 });

    // Refus ferme et photos épuisées : sa dernière ligne est partie, elle ne répond plus du tout.
    case "DONE":
      return { ...rien("none", state), silent: true };

    default:
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
    "Il réclame une photo mais tu n'en envoies plus ici : dis-le en jouant (« la suite c'est sur l'appli, j'envoie pas plus sur telegram »), sans lien.",
  tease:
    "Ça chauffe : tu rentres dedans tout de suite, sans transition molle, et tu annonces la photo en une ligne (« tiens », « juste une », « jte montre »), sans tout décrire.",
  wait: "Rien à envoyer ce tour : réagis à ce qu'il vient de dire et tease, sans promettre de photo tout de suite et sans revenir aux questions de base (ville, taf, âge).",
  sell: "Tu lui vends l'app, sans lien à ce tour : t'es chaude de fou, mais t'aimes pas être trop chaude sur telegram parce que t'y es pas à l'aise, et sur l'appli où t'es, là-bas t'es grave chaude (« jsuis chaude de fou la », « mais j'aime pas trop etre chaude sur telegram jsuis pas a l'aise ici », « sur l'appli ou jsuis la bas jsuis grave chaude »). Pas de « jsuis plus à l'aise là-bas » tout sec, et tu ne dis jamais ce qu'est l'app (pas « une appli pour parler »). N'annonce pas le lien : il part tout seul au message suivant.",
  link: "Tu envoies l'app maintenant (action lien). Si tu ne l'as pas encore vendue : t'es chaude de fou, mais t'aimes pas être trop chaude sur telegram (pas à l'aise ici), et sur l'appli où t'es, là-bas t'es grave chaude. Tu ne dis jamais ce qu'est l'app (pas « une appli pour parler ») et tu ne présentes pas le lien : le système l'envoie tout seul, dans son propre message.",
  explain:
    "Il refuse l'app : c'est un argument, pas une porte fermée (« dommage, j'envoie pas de photos sur telegram », « j'aime bien en envoyer mais que sur l'appli »), sans renvoyer de lien.",
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
  if (d.allow.length === 1 && d.allow[0] === "rien") lines.push(`N'envoie rien : action "rien".`);
  else if (d.allow.length === 1) lines.push(`Action obligatoire ce tour : "${d.allow[0]}".`);
  const hint = DIRECTIVE_HINT[d.directive];
  if (hint) lines.push(hint);
  return lines;
}
