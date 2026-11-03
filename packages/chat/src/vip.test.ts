import { describe, expect, it } from "vitest";
import {
  announcedBook,
  announcesRegistrationLink,
  announcesVipAccess,
  booksMentioned,
  confirmsDeposit,
  depositBook,
  hasWaitingPhrase,
  isVipManagerPersona,
  mentionsDeposit,
  normalizeBookKey,
  stripEmojis,
} from "./vip";

const BOOKS = [
  { bookmakerKey: "celsiuscasino", label: "Celsius Casino", priority: 1, hasInviteLink: true },
  { bookmakerKey: "betportal", label: "Bet Portal", priority: 2, hasInviteLink: true },
  { bookmakerKey: "sportaza", label: "Sportaza", priority: 3, hasInviteLink: true },
];

describe("gérant du VIP", () => {
  it("seulement Paris sportifs avec vipManager", () => {
    expect(isVipManagerPersona({ vipManager: true, universe: "sports" })).toBe(true);
    expect(isVipManagerPersona({ vipManager: true, universe: "casino" })).toBe(false);
    expect(isVipManagerPersona({ vipManager: false, universe: "sports" })).toBe(false);
    expect(isVipManagerPersona({ universe: "dating" })).toBe(false);
  });
});

describe("phrases qui font patienter", () => {
  it.each([
    "attends je reviens 2 sec",
    "attend 2sec",
    "ok attends je check",
    "je reviens vers toi",
    "jreviens",
    "une seconde frero",
    "deux secondes",
    "je regarde ça et je te dis",
    "laisse moi voir",
    "je vais voir avec l'équipe",
    "bouge pas j'arrive",
    "dans 5 min c'est bon",
    "un petit instant",
    "je te tiens au courant",
    "je t'envoie ça plus tard",
    "je regarde ça tout à l'heure",
    "hold on",
    "give me a sec",
    "brb",
    "attends je reviens, je t'envoie le lien",
    "attend 2 sec",
  ])("refusé : %s", (t) => expect(hasWaitingPhrase(t)).toBe(true));

  it.each([
    "t'attends quoi pour t'inscrire ?",
    "j'attends ta réponse",
    "oe le vip c'est gratuit",
    "j'arrive pas à m'inscrire",
    "tu peux attendre la fin du match",
    "je te mets le lien juste en dessous",
    "je t'envoie le lien d'inscription, tu t'inscris et tu fais ton premier dépôt",
    "je t'ai dit tout à l'heure, c'est gratuit",
    "je pense que tu pourras le faire plus tard",
    "tu peux t'inscrire plus tard si tu veux",
    "le vip c'est des pronos tous les jours",
    // Script du client : le lien annoncé part forcément à ce message.
    "Ok attend je t'envoie le lien, inscrit toi fait un dépôt le montant que tu veux",
    "attends jte mets le lien",
  ])("permis : %s", (t) => expect(hasWaitingPhrase(t)).toBe(false));
});

describe("lien d'inscription annoncé", () => {
  it.each([
    "nickel bg je t'envoie le lien d'inscription Betportal alors",
    "top bg je te send le lien, tu t'inscris dessus tu fais ton premier dépôt et tu me dis quand c'est bon je te file le vip direct",
    "c'est un de nos book partenaires. je te send le lien d'inscription, tu te crées un compte et tu fais un petit dépôt, après je te file l'accès au vip gratuit",
    "je te mets le lien juste en dessous",
    "le lien arrive",
    "voilà le lien",
    "je t'envoie le lien, une fois inscrit tu fais ton dépôt",
    "je te renvoie le lien",
    "jte file le lien",
    "t'as déjà Celsius, du coup je t'envoie le lien Betportal",
    "I'll send you the link",
    "here's the link",
  ])("annonce : %s", (t) => expect(announcesRegistrationLink([t])).toBe(true));

  it.each([
    "si t'as pas de compte je t'envoie le lien",
    "je t'envoie le lien ?",
    "quand tu veux je t'envoie le lien",
    "je t'envoie le lien si tu veux",
    "je t'envoie le lien quand t'es prêt",
    "sinon je t'envoie le lien",
    "voilà le lien du vip",
    "je t'envoie le lien du vip",
    "tu connais Celsius Casino? t'as déjà un compte dessus?",
    "tu t'inscris via le lien, tu fais un premier dépôt",
    "regarde le lien que je t'ai envoyé",
    "le lien au-dessus marche toujours",
    "clique sur le lien que je t'ai envoyé plus haut",
    "if you don't have an account I'll send you the link",
  ])("pas une annonce : %s", (t) => expect(announcesRegistrationLink([t])).toBe(false));
});

describe("accès au VIP donné", () => {
  it.each([
    "gg frero voilà l'accès au canal VIP",
    "je t'ajoute au vip",
    "je t'envoie le lien du vip",
    "tiens l'accès vip",
    "c'est validé, je t'envoie l'accès au vip",
    "c'est bon t'as déposé, je te file l'accès au vip",
    "here's your vip access",
  ])("accès : %s", (t) => expect(announcesVipAccess([t])).toBe(true));

  it.each([
    "après ton dépôt je te file l'accès au vip",
    "tu fais ton dépôt et je te file l'accès",
    "fais ton dépôt et je t'envoie le lien du vip",
    "je t'envoie le lien du vip dès que t'as déposé",
    "je te file l'accès au vip après ton dépôt",
    "je te donne accès au vip une fois inscrit",
    "dès que c'est fait je te file l'accès au vip",
    "tu t'inscris, tu déposes et je te file l'accès au vip",
    "je te send le lien, tu t'inscris, tu fais ton premier dépôt et je te file le vip",
    "top bg je te send le lien, tu t'inscris dessus tu fais ton premier dépôt et tu me dis quand c'est bon je te file le vip direct",
    "tu veux que je t'ajoute au vip ?",
    "le vip c'est gratuit, t'as les pronos premium",
    "envoie-moi une capture de ton dépôt et je t'ajoute au vip",
  ])("pas d'accès : %s", (t) => expect(announcesVipAccess([t])).toBe(false));
});

describe("dépôt confirmé", () => {
  it.each([
    "c bon j'ai déposé sur celsius",
    "dépôt fait",
    "j'ai fait mon dépôt",
    "j'ai fait mon premier dépôt",
    "j'ai mis 20 balles",
    "c'est déposé",
    "ok déposé",
    "g déposé",
    "j'ai déposé, c'est bon ?",
    "i deposited",
  ])("dépôt : %s", (t) => expect(confirmsDeposit([t])).toBe(true));

  it.each([
    "j'ai pas encore déposé",
    "je vais déposer",
    "je dépose demain",
    "Oui j'ai déjà un compte dessus",
    "Non j'ai pas de compte",
    "c'est fait",
    "c'est bon",
    "comment je dépose ?",
    "toujours pas déposé",
  ])("pas de dépôt sans contexte : %s", (t) => expect(confirmsDeposit([t])).toBe(false));

  it("une simple confirmation vaut dépôt seulement quand il venait d'en parler", () => {
    for (const t of ["c'est fait", "c'est bon", "ça y est", "c bon", "fait"])
      expect(confirmsDeposit([t], { askedDeposit: true })).toBe(true);
    expect(confirmsDeposit(["c'est bon je suis inscrit"], { askedDeposit: true })).toBe(false);
    expect(confirmsDeposit(["c'est bon ?"], { askedDeposit: true })).toBe(false);
    expect(confirmsDeposit(["pas encore c'est bon"], { askedDeposit: true })).toBe(false);
  });

  it("repère qu'il parlait du dépôt", () => {
    expect(mentionsDeposit(["tu fais ton premier dépôt et tu me dis quand c'est bon"])).toBe(true);
    expect(mentionsDeposit(["tu connais Celsius Casino ?"])).toBe(false);
  });
});

describe("bookmakers nommés", () => {
  it("ordre des mentions", () => {
    expect(booksMentioned(["t'as déjà Celsius, du coup je t'envoie le lien Betportal"], BOOKS)).toEqual([
      "celsiuscasino",
      "betportal",
    ]);
    expect(booksMentioned(["tu connais Bet Portal ?"], BOOKS)).toEqual(["betportal"]);
    expect(booksMentioned(["rien"], BOOKS)).toEqual([]);
  });

  it("clé du modèle ramenée à une clé connue", () => {
    expect(normalizeBookKey("Bet Portal", BOOKS)).toBe("betportal");
    expect(normalizeBookKey("celsius", BOOKS)).toBe("celsiuscasino");
    expect(normalizeBookKey(" sportaza ", BOOKS)).toBe("sportaza");
    expect(normalizeBookKey("winamax", BOOKS)).toBeNull();
    expect(normalizeBookKey("", BOOKS)).toBeNull();
  });

  it("bookmaker du lien annoncé", () => {
    expect(announcedBook(["t'as déjà Celsius, du coup je t'envoie le lien Betportal"], BOOKS)).toBe(
      "betportal",
    );
    expect(announcedBook(["je t'envoie le lien Bet Portal vu que t'as déjà Celsius"], BOOKS)).toBe(
      "betportal",
    );
    expect(announcedBook(["voilà le lien de Sportaza"], BOOKS)).toBe("sportaza");
    expect(announcedBook(["nickel bg je t'envoie le lien d'inscription Betportal alors"], BOOKS)).toBe(
      "betportal",
    );
    // Bookmaker nommé ailleurs dans la phrase : c'est celui qu'il a déjà, pas celui du lien.
    expect(announcedBook(["t'as déjà Celsius, je t'envoie le lien"], BOOKS)).toBeNull();
    expect(announcedBook(["je t'envoie le lien vu que t'as déjà Celsius"], BOOKS)).toBeNull();
    expect(announcedBook(["je t'envoie le lien"], BOOKS)).toBeNull();
    expect(announcedBook(["tu connais Celsius ?"], BOOKS)).toBeNull();
  });

  it("bookmaker du dépôt", () => {
    expect(depositBook(["j'avais Celsius mais j'ai déposé sur Betportal"], BOOKS)).toBe("betportal");
    expect(depositBook(["c bon j'ai déposé sur celsius"], BOOKS)).toBe("celsiuscasino");
    expect(depositBook(["sportaza c'est fait"], BOOKS)).toBe("sportaza");
    expect(depositBook(["c'est fait"], BOOKS)).toBeNull();
  });
});

describe("emojis retirés", () => {
  it("texte propre", () => {
    expect(stripEmojis("yo frero 😉 t la pr le vip ? 🔥🔥")).toBe("yo frero t la pr le vip ?");
    expect(stripEmojis("👍")).toBe("");
    expect(stripEmojis("ok 👍🏽 bg")).toBe("ok bg");
    expect(stripEmojis("frero 😉, t la ?")).toBe("frero, t la ?");
    expect(stripEmojis("gg 🇫🇷 frero")).toBe("gg frero");
    // Sans emoji : rien ne bouge (espace avant « ? » gardée).
    expect(stripEmojis("c'est 100% gratuit ?")).toBe("c'est 100% gratuit ?");
    expect(stripEmojis("tu connais Celsius ? t'as un compte ?")).toBe(
      "tu connais Celsius ? t'as un compte ?",
    );
  });
});
