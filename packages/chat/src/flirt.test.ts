import { describe, expect, it } from "vitest";
import {
  asksPhoto,
  flirtAction,
  hasStarted,
  isEngaged,
  isHot,
  isRefusal,
  isSexTalk,
  offerAllowed,
  PATIENCE,
  type FlirtInput,
  type FlirtStep,
} from "./flirt";

const tour = (step: FlirtStep, text: string, teases = 0, recent: string[] = []): FlirtInput => ({
  step,
  text,
  teases,
  recent,
});

describe("detection", () => {
  it("reconnait le sexe, meme sans accents", () => {
    expect(isSexTalk("j'ai trop envie de me faire bz")).toBe(true);
    expect(isSexTalk("tu me fais bander")).toBe(true);
    expect(isSexTalk("jsuis toute trempee")).toBe(true);
    expect(isSexTalk("il fait beau aujourd'hui")).toBe(false);
  });

  it("deux mots doux suffisent a rendre la conversation chaude, un seul non", () => {
    expect(isHot(["t'es jolie"], "j'ai chaud")).toBe(true);
    expect(isHot([], "j'ai chaud")).toBe(false);
  });

  it("un ok seul n'est pas un engagement, une question ou trois mots oui", () => {
    expect(isEngaged("ok")).toBe(false);
    expect(isEngaged("t'es de ou toi ?")).toBe(true);
    expect(isEngaged("jvais pas tarder a dormir")).toBe(true);
  });

  it("reconnait un refus", () => {
    expect(isRefusal("non pas envie")).toBe(true);
    expect(isRefusal("la flemme la")).toBe(true);
    expect(isRefusal("vas y")).toBe(false);
  });

  it("reconnait une demande de photo", () => {
    expect(asksPhoto("envoie une photo")).toBe(true);
    expect(asksPhoto("montre toi")).toBe(true);
    expect(asksPhoto("tu fais quoi")).toBe(false);
  });
});

describe("demarrage", () => {
  it("ne demarre pas sur une conversation normale", () => {
    const d = flirtAction(tour("NONE", "tu fais quoi de beau"));
    expect(d.step).toBe("NONE");
    expect(d.sendPhoto).toBeNull();
  });

  it("fait genre quand il demande une photo sans chauffer", () => {
    const d = flirtAction(tour("NONE", "envoie une photo"));
    expect(d.step).toBe("LOCKED");
    expect(d.directive).toBe("play_hard");
    expect(d.sendPhoto).toBeNull();
  });

  it("demarre des le premier mot de sexe, sur une accroche", () => {
    const d = flirtAction(tour("NONE", "j'ai envie de te bz"));
    expect(d.step).toBe("TEASE1");
    expect(d.directive).toBe("tease");
    expect(d.sendPhoto).toBeNull();
  });

  it("une fois verrouille, il chauffe et la serie demarre", () => {
    const d = flirtAction(tour("LOCKED", "j'ai trop envie la", 1));
    expect(d.step).toBe("TEASE1");
    expect(d.directive).toBe("tease");
  });
});

describe("envoi des photos", () => {
  it("un ok sec n'envoie rien, il compte une accroche", () => {
    const d = flirtAction(tour("TEASE1", "ok"));
    expect(d.sendPhoto).toBeNull();
    expect(d.teases).toBe(1);
    expect(d.directive).toBe("tease");
  });

  it("envoie la photo 1 quand il repond vraiment", () => {
    const d = flirtAction(tour("TEASE1", "vas y montre"));
    expect(d.sendPhoto).toBe(1);
    expect(d.step).toBe("TEASE2");
    expect(d.teases).toBe(0);
  });

  it("envoie quand meme au bout de la patience", () => {
    const d = flirtAction(tour("TEASE2", "ok", PATIENCE - 1));
    expect(d.sendPhoto).toBe(2);
    expect(d.step).toBe("TEASE3");
  });

  it("une seule photo par tour", () => {
    let etape: FlirtStep = "TEASE1";
    const vues: number[] = [];
    for (const texte of ["oui", "oui", "oui"]) {
      const d = flirtAction(tour(etape, texte));
      etape = d.step;
      if (d.sendPhoto) vues.push(d.sendPhoto);
    }
    expect(vues).toEqual([1, 2, 3]);
  });

describe("le lien", () => {
  it("apres la photo 3, on parle encore, sans lien", () => {
    const d = flirtAction(tour("TEASE3", "oui"));
    expect(d.sendPhoto).toBe(3);
    expect(d.step).toBe("OFFER_PENDING");
    expect(d.directive).toBe("wait");
  });

  it("le lien ne part pas sur un ok sec", () => {
    const d = flirtAction(tour("OFFER_PENDING", "ok"));
    expect(d.directive).toBe("wait");
    expect(d.step).toBe("OFFER_PENDING");
  });

  it("le lien part quand il demande la suite", () => {
    const d = flirtAction(tour("OFFER_PENDING", "t'as d'autres photos ?"));
    expect(d.directive).toBe("link");
    expect(d.step).toBe("OFFER_SENT");
  });

  it("le lien part au bout de la patience", () => {
    const d = flirtAction(tour("OFFER_PENDING", "ok", PATIENCE - 1));
    expect(d.directive).toBe("link");
  });

  it("le verrou ne tombe que sur l'etape dediee", () => {
    expect(offerAllowed("NONE")).toBe(false);
    expect(offerAllowed("TEASE2")).toBe(false);
    expect(offerAllowed("OFFER_PENDING")).toBe(true);
    expect(hasStarted("NONE")).toBe(false);
    expect(hasStarted("TEASE1")).toBe(true);
  });
});

describe("le refus", () => {
  it("une explication, pas un second lien", () => {
    const d = flirtAction(tour("OFFER_SENT", "non pas envie de m'inscrire"));
    expect(d.directive).toBe("explain");
    expect(d.step).toBe("EXPLAINED");
    expect(d.sendPhoto).toBeNull();
  });

  it("un message qui n'est pas un refus ne declenche rien", () => {
    const d = flirtAction(tour("OFFER_SENT", "jvais voir"));
    expect(d.directive).toBe("none");
    expect(d.step).toBe("OFFER_SENT");
  });

  it("la photo 4 part quand il se reengage, pas dans la foulee du refus", () => {
    const d = flirtAction(tour("EXPLAINED", "bon montre"));
    expect(d.sendPhoto).toBe(4);
    expect(d.step).toBe("TEASE5");
  });

  it("la photo 5 part au tour suivant, puis la sortie", () => {
    const d5 = flirtAction(tour("TEASE5", "vas y"));
    expect(d5.sendPhoto).toBe(5);
    expect(d5.step).toBe("WRAP");
    const fin = flirtAction(tour(d5.step, "merci"));
    expect(fin.directive).toBe("wrap");
    expect(fin.step).toBe("DONE");
  });
});

});
