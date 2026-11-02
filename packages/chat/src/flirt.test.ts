// Série de photos de chauffe : ce qui est permis à chaque tour, et l'état après une action réellement partie.
import { describe, expect, it } from "vitest";
import {
  applyAction,
  asksPhoto,
  decideFlirt,
  decodeState,
  encodeProgress,
  isHookQuestion,
  isPushAnswer,
  isRefusal,
  isSexTalk,
  MAX_PHOTOS,
  MIN_ECHANGES_APRES_REFUS,
  MIN_ECHANGES_ENTRE_PHOTOS,
  type FlirtInput,
  type FlirtPhase,
} from "./flirt";

const photos = [1, 2, 3, 4, 5];

const tour = (
  step: FlirtPhase,
  text: string,
  teases = 0,
  hasPhotos: number[] = photos,
): FlirtInput => ({
  step,
  teases,
  recent: [],
  text,
  hasPhotos,
});

/** Progressions lisibles : `PHOTOS` avec 2 photos déjà parties. */
const apres = (phase: FlirtPhase, lastPhoto: number, exchanges: number) =>
  lastPhoto * 100 + exchanges;

describe("lecture du message", () => {
  it("reconnaît le sexe et les demandes de photo", () => {
    expect(isSexTalk("j'ai envie de me branler")).toBe(true);
    expect(isSexTalk("ça va et toi")).toBe(false);
    expect(asksPhoto("envoie une photo")).toBe(true);
    expect(isRefusal("non je reste ici")).toBe(true);
  });
});

describe("état rangé dans deux colonnes", () => {
  it("aller-retour sans perte", () => {
    const s = { phase: "PHOTOS" as const, lastPhoto: 2, exchanges: 1 };
    expect(decodeState(s.phase, encodeProgress(s))).toEqual(s);
  });

  it("valeur inconnue ramenée à NONE", () => {
    expect(decodeState("BIDULE", 0).phase).toBe("NONE");
  });
});

describe("démarrage", () => {
  it("rien ne démarre sans sexe", () => {
    const d = decideFlirt(tour("NONE", "ça va et toi"));
    expect(d.allow).toEqual(["rien"]);
    expect(d.photoSlot).toBeNull();
  });

  it("une demande de photo démarre la série", () => {
    const d = decideFlirt(tour("NONE", "envoie une photo"));
    expect(d.directive).toBe("tease");
    expect(d.allow).toContain("photo");
    expect(d.photoSlot).toBe(1);
    expect(d.state.phase).toBe("PHOTOS");
  });

  it("mots FORTS élargis : « t'es bonne » et « tu portes quoi » démarrent", () => {
    expect(isSexTalk("t'es bonne")).toBe(true);
    expect(isSexTalk("tu portes quoi")).toBe(true);
    expect(isSexTalk("ça te dit de te montrer")).toBe(true);
    expect(isSexTalk("plan cul")).toBe(true);
    expect(isSexTalk("envoie des nudes")).toBe(true);
  });

  it("« salut ça va » ne déclenche rien", () => {
    expect(isSexTalk("salut ça va")).toBe(false);
    const d = decideFlirt(tour("NONE", "salut ça va"));
    expect(d.allow).toEqual(["rien"]);
  });

  it("play_hard en phase DONE quand il demande une photo", () => {
    const d = decideFlirt(tour("DONE", "envoie une photo"));
    expect(d.directive).toBe("play_hard");
    expect(d.allow).toEqual(["rien"]);
  });

  it("le sexe démarre la série et arme la photo 1", () => {
    const d = decideFlirt(tour("NONE", "j'ai envie de toi"));
    expect(d.state.phase).toBe("PHOTOS");
    expect(d.allow).toContain("photo");
    expect(d.photoSlot).toBe(1);
  });

  it("sans photo disponible, elle accroche quand même", () => {
    const d = decideFlirt(tour("NONE", "j'ai envie de toi", 0, []));
    expect(d.allow).toEqual(["rien"]);
    expect(d.photoSlot).toBeNull();
  });
});

describe("une photo tous les deux échanges", () => {
  it("un seul échange après la photo 1 : rien", () => {
    const d = decideFlirt(tour("PHOTOS", "ptn t'es bonne", apres("PHOTOS", 1, 0)));
    expect(d.allow).toEqual(["rien"]);
    expect(d.state.exchanges).toBe(1);
  });

  it("deux échanges : la photo 2 est armée", () => {
    const d = decideFlirt(tour("PHOTOS", "j'adore", apres("PHOTOS", 1, 1)));
    expect(d.allow).toContain("photo");
    expect(d.photoSlot).toBe(2);
  });

  it("jamais plus de 3 photos gratuites", () => {
    const d = decideFlirt(tour("PHOTOS", "encore", apres("PHOTOS", 3, 5)));
    expect(d.photoSlot).toBeNull();
  });

  it("la photo 3 fait passer en attente de lien", () => {
    expect(applyAction({ phase: "PHOTOS", lastPhoto: 2, exchanges: 2 }, "photo").phase).toBe(
      "OFFER",
    );
  });
});

describe("le lien", () => {
  it("pas de lien sur un ok sec", () => {
    const d = decideFlirt(tour("OFFER", "ok", 0));
    expect(d.allow).toEqual(["rien"]);
  });

  it("pas de lien sur le message qui suit la photo 3", () => {
    const d = decideFlirt(tour("OFFER", "t'es une chienne", 0));
    expect(d.allow).toEqual(["rien"]);
  });

  it("le lien s'arme quand il en veut plus", () => {
    const d = decideFlirt(tour("OFFER", "t'as plus rien à montrer ?", 0));
    expect(d.allow).toContain("lien");
    expect(d.directive).toBe("link");
  });
});

describe("refus du site", () => {
  it("un refus bascule en cadeaux et explique", () => {
    const d = decideFlirt(tour("OFFER", "non je veux rester ici", 0));
    expect(d.state.phase).toBe("REFUSED");
    expect(d.directive).toBe("explain");
    expect(d.allow).toEqual(["rien"]);
  });

  it("pas de photo juste après le refus", () => {
    const d = decideFlirt(tour("REFUSED", "pourquoi ?", 0));
    expect(d.allow).toEqual(["rien"]);
  });

  it(`la photo 4 arrive après ${MIN_ECHANGES_APRES_REFUS} échanges, en cadeau`, () => {
    const d = decideFlirt(
      tour("REFUSED", "ok vas y montre", apres("REFUSED", 3, MIN_ECHANGES_APRES_REFUS - 1)),
    );
    expect(d.allow).toContain("photo");
    expect(d.photoSlot).toBe(4);
    expect(d.directive).toBe("gift");
  });

  it("la photo 5 après un nouveau délai", () => {
    const d = decideFlirt(
      tour("REFUSED", "encore", apres("REFUSED", 4, MIN_ECHANGES_APRES_REFUS - 1)),
    );
    expect(d.photoSlot).toBe(5);
  });
});

describe("fin de série", () => {
  it("après la photo 5, une ligne puis terminé", () => {
    const wrap = decideFlirt(tour("WRAP", "bon"));
    expect(wrap.directive).toBe("wrap");
    expect(wrap.state.phase).toBe("DONE");
    expect(decideFlirt(tour("DONE", "ok")).allow).toEqual(["rien"]);
  });

  it("le compteur d'échanges repart à zéro après une photo", () => {
    expect(applyAction({ phase: "PHOTOS", lastPhoto: 1, exchanges: 4 }, "photo").exchanges).toBe(0);
  });

  it("la photo 5 termine la série", () => {
    expect(applyAction({ phase: "REFUSED", lastPhoto: 4, exchanges: 2 }, "photo").phase).toBe(
      "WRAP",
    );
  });
});

describe("sécurité", () => {
  it("mineur : plus rien ne part", () => {
    const d = decideFlirt({
      ...tour("PHOTOS", "j'ai envie", apres("PHOTOS", 1, 5)),
      isMinor: true,
    });
    expect(d.allow).toEqual(["rien"]);
    expect(d.photoSlot).toBeNull();
  });
});

describe("script de chauffe (fille en illusion)", () => {
  const script = (text: string, extra: Partial<FlirtInput> = {}): FlirtInput => ({
    ...tour("NONE", text),
    scripted: true,
    ...extra,
  });

  it("premier tour → accroche, pas de photo", () => {
    const d = decideFlirt(script("salut ça va", { isFirstTurn: true }));
    expect(d.directive).toBe("hook");
    expect(d.allow).toEqual(["rien"]);
    expect(d.photoSlot).toBeNull();
  });

  it("hors script (assistante), le premier tour n'a pas d'accroche", () => {
    const d = decideFlirt({ ...tour("NONE", "salut"), isFirstTurn: true });
    expect(d.directive).toBe("none");
  });

  it("accroche jamais posée (conversation déjà commencée) → elle la pose", () => {
    const d = decideFlirt(script("oui et toi ça va", { lastAssistantText: "slt ca va?" }));
    expect(d.directive).toBe("rehook");
    expect(d.allow).toEqual(["rien"]);
  });

  it("isHookQuestion détecte la question d'accroche", () => {
    expect(isHookQuestion("moi c'est Léa, tu cherches quoi toi ?")).toBe(true);
    expect(isHookQuestion("et sinon tu cherches quoi ici ? 😏")).toBe(true);
    expect(isHookQuestion("I'm Léa, what are you looking for? 😏")).toBe(true);
    expect(isHookQuestion("ça va bien")).toBe(false);
  });

  it("isPushAnswer détecte la relance sur le sexe", () => {
    expect(isPushAnswer("du sexe alors ? 😏")).toBe(true);
    expect(isPushAnswer("moi c'est du sexe que jcherche, et toi ?")).toBe(true);
    expect(isPushAnswer("moi oui en tout cas")).toBe(true);
    expect(isPushAnswer("t'es sexy toi")).toBe(false);
    expect(isPushAnswer("salut ca va")).toBe(false);
  });

  it("réponse sexuelle à l'accroche → la photo 1 part", () => {
    const d = decideFlirt(
      script("du sexe", { lastAssistantText: "moi c'est Léa, tu cherches quoi toi ?" }),
    );
    expect(d.directive).toBe("tease");
    expect(d.allow).toEqual(["photo"]);
    expect(d.photoSlot).toBe(1);
    expect(d.state.phase).toBe("PHOTOS");
  });

  it("réponse vague à l'accroche → relance sur le sexe", () => {
    const d = decideFlirt(
      script("je sais pas trop", { lastAssistantText: "moi c'est Léa, tu cherches quoi toi ?" }),
    );
    expect(d.directive).toBe("push");
    expect(d.allow).toEqual(["rien"]);
  });

  it("accroche posée plus tôt (pas au dernier message) → relance sur le sexe", () => {
    const d = decideFlirt(script("mdr", { lastAssistantText: "jsuis a lyon", hookAsked: true }));
    expect(d.directive).toBe("push");
  });

  it("après la relance, n'importe quelle réponse lance la série et la photo 1 part", () => {
    const d = decideFlirt(
      script("ouais pourquoi pas", { lastAssistantText: "du sexe alors ? 😏" }),
    );
    expect(d.directive).toBe("tease");
    expect(d.allow).toEqual(["photo"]);
    expect(d.state.phase).toBe("PHOTOS");
    const plusTard = decideFlirt(script("hein ?", { lastAssistantText: "mdr", pushDone: true }));
    expect(plusTard.allow).toEqual(["photo"]);
  });

  it("photo laissée passer une fois → elle part au tour suivant", () => {
    const choix = decideFlirt({ ...tour("PHOTOS", "mmh", apres("PHOTOS", 1, 1)), scripted: true });
    expect(choix.allow).toEqual(["photo", "rien"]);
    const force = decideFlirt({ ...tour("PHOTOS", "mmh", apres("PHOTOS", 1, 2)), scripted: true });
    expect(force.allow).toEqual(["photo"]);
    expect(force.photoSlot).toBe(2);
  });

  it("« sexe » est un mot FORT, « venu » ou « continue » non", () => {
    expect(isSexTalk("du sexe")).toBe(true);
    expect(isSexTalk("t déjà venu")).toBe(false);
    expect(isSexTalk("j'adore, continue")).toBe(false);
    expect(isSexTalk("une bande de potes")).toBe(false);
    expect(isSexTalk("je fais la queue")).toBe(false);
    expect(isSexTalk("t'es toute nue ?")).toBe(true);
    expect(isSexTalk("ça me fait bander")).toBe(true);
  });

  it("hors script, « du sexe » lance la série avec le choix de la photo", () => {
    const d = decideFlirt(tour("NONE", "du sexe"));
    expect(d.directive).toBe("tease");
    expect(d.allow).toEqual(["photo", "rien"]);
    expect(d.state.phase).toBe("PHOTOS");
  });
});

describe("réglages", () => {
  it("le délai entre photos est bien de 2", () => {
    expect(MIN_ECHANGES_ENTRE_PHOTOS).toBe(2);
    expect(MAX_PHOTOS).toBe(5);
  });
});
