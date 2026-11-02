// Série de photos de chauffe : ce qui est permis à chaque tour, et l'état après une action réellement partie.
import { describe, expect, it } from "vitest";
import {
  applyAction,
  asksPhoto,
  decideFlirt,
  decodeState,
  encodeProgress,
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

  // Tâche 2 : formulations réelles de mecs qui parlent direct, au premier message.
  it.each([
    "t'es bonne",
    "tu portes quoi",
    "ça te dit de te montrer",
    "on peut se voir ?",
    "t'as un gros cul",
    "ça me chauffe grave",
    "jsuis chaud là",
    "tu me fais bander",
    "t'es excitée ?",
    "envoie moi une pic",
  ])("« %s » démarre la série au premier message", (text) => {
    const d = decideFlirt(tour("NONE", text));
    expect(d.state.phase).toBe("PHOTOS");
    expect(d.photoSlot).toBe(1);
  });

  it("« tu fais quoi là » seul reste doux ; avec un deuxième signal doux, la série démarre", () => {
    expect(decideFlirt(tour("NONE", "tu fais quoi là")).state.phase).toBe("NONE");
    expect(decideFlirt(tour("NONE", "tu fais quoi là bb ?")).state.phase).toBe("PHOTOS");
    expect(
      decideFlirt({ step: "NONE", teases: 0, recent: ["t'es trop belle"], text: "tu fais quoi là", hasPhotos: photos })
        .state.phase,
    ).toBe("PHOTOS");
  });

  it.each([
    "salut ça va",
    "slt cv ?",
    "bonne nuit, belle journée demain",
    "je fais la queue à la poste",
    "c'est unique comme truc",
    "je continue demain",
    "une bande de potes",
    "je t'envoie un message plus tard",
    "c'est typique de paris",
    "j'ai envie de dormir",
  ])("« %s » ne démarre pas la série", (text) => {
    expect(decideFlirt(tour("NONE", text)).state.phase).toBe("NONE");
  });

  it("une persona sans photo de chauffe (Casino, Paris) n'entre jamais dans la série", () => {
    const d = decideFlirt(tour("NONE", "t'es bonne, envoie une photo", 0, []));
    expect(d.state.phase).toBe("NONE");
    expect(d.allow).toEqual(["rien"]);
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

  // Changé volontairement (tâche 1) : une demande de photo démarre la série au lieu de la fermer.
  it("une demande de photo démarre la série et arme la photo 1", () => {
    const d = decideFlirt(tour("NONE", "envoie une photo"));
    expect(d.state.phase).toBe("PHOTOS");
    expect(d.directive).toBe("tease");
    expect(d.allow).toContain("photo");
    expect(d.photoSlot).toBe(1);
  });

  it("une demande de photo sans photo 1 fait genre", () => {
    const d = decideFlirt(tour("NONE", "envoie une photo", 0, [2, 3]));
    expect(d.directive).toBe("play_hard");
    expect(d.allow).toEqual(["rien"]);
  });

  it("série épuisée ou refusée : une demande de photo fait genre", () => {
    expect(decideFlirt(tour("REFUSED", "envoie une photo", apres("REFUSED", 5, 3))).directive).toBe(
      "play_hard",
    );
    expect(decideFlirt(tour("LINKED", "montre moi encore", apres("LINKED", 3, 0))).directive).toBe(
      "play_hard",
    );
  });

  it("bascule immédiate : en pleine discussion tiède, la chauffe démarre la série à ce tour", () => {
    const d = decideFlirt({
      step: "NONE",
      teases: 7,
      recent: ["je sors du taf", "ouais tranquille", "paris et toi"],
      text: "t'as un gros cul toi",
      hasPhotos: photos,
    });
    expect(d.state.phase).toBe("PHOTOS");
    expect(d.photoSlot).toBe(1);
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

describe("réglages", () => {
  it("le délai entre photos est bien de 2", () => {
    expect(MIN_ECHANGES_ENTRE_PHOTOS).toBe(2);
    expect(MAX_PHOTOS).toBe(5);
  });
});
