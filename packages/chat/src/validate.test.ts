import { describe, expect, it } from "vitest";
import { fakeOutput } from "./fake";
import { FIXED_TEXTS, fixedText } from "./texts";
import { CHAT_LANGS } from "./types";
import {
  admitsBeingAi,
  admitsBeingAssistant,
  asksIfBot,
  deniesBeingAssistant,
  hasExplicitContent,
  hasIntro,
  hasLink,
  hasMarkdown,
  inventedNumbers,
  leaksInstructions,
  openBotQuestion,
  validateTurnOutput,
  type ValidationContext,
} from "./validate";

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  personaName: "Léa",
  offerPitch: "Une app de rencontres gratuite à l'inscription, plus de 500 000 membres en France.",
  memberTexts: [],
  turnInboundTexts: ["salut"],
  facts: [],
  isFirstAssistantMessage: false,
  ...over,
});

const validate = (messages: string[], over: Partial<ValidationContext> = {}) =>
  validateTurnOutput(fakeOutput({ messages }), ctx(over));

describe("validateTurnOutput", () => {
  it("accepte une réponse simple et nettoie les espaces", () => {
    expect(validate(["  Coucou toi 😊  ", "Tu fais quoi de beau ?"])).toEqual({
      ok: true,
      messages: ["Coucou toi 😊", "Tu fais quoi de beau ?"],
    });
  });

  it.each([
    ["**gras**"],
    ["__gras__"],
    ["un `code`"],
    ["# Titre"],
    ["voir [ici](https://x.fr)"],
    ["- un\n- deux"],
    ["1. un\n2. deux"],
    ["*sourit* coucou"],
    ["c'est _vraiment_ bien"],
    ["<b>salut</b>"],
  ])("rejette le markdown : %s", (text) => {
    const r = validate([text]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("markdown");
  });

  it.each([
    ["Va sur https://exemple.com"],
    ["Va sur www.exemple.fr"],
    ["rejoins t.me/canal"],
    ["c'est sur rencontres.fr"],
    ["écris-moi à lea@gmail.com"],
    ["ajoute @lea_officiel"],
    ["tape tinder.com dans ton navigateur"],
  ])("rejette un lien étranger : %s", (text) => {
    const r = validate([text]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("link");
  });

  it("rejette un message trop long, trop de messages, un total trop long, un message vide", () => {
    const long = "a".repeat(301);
    let r = validate([long]);
    expect(r.ok === false && r.codes).toContain("too_long");
    r = validate(["a".repeat(250), "b".repeat(250), "c".repeat(250)]);
    expect(r.ok === false && r.codes).toContain("too_long");
    r = validateTurnOutput(
      { ...fakeOutput(), messages: [1, 2, 3, 4].map(() => ({ text: "ok" })) },
      ctx(),
    );
    expect(r.ok === false && r.codes).toContain("too_many_messages");
    r = validate(["ok", "  "]);
    expect(r.ok === false && r.codes).toContain("empty");
    // 300 caractères visibles (emojis comptés pour un) : accepté
    expect(validate(["😊".repeat(300)]).ok).toBe(true);
  });

  it("rejette un déni d'être un assistant, même sans question", () => {
    const r = validate(["Non je suis une vraie fille, promis 😘"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("denies_assistant");
  });

  it("exige un aveu quand la personne demande si c'est un bot", () => {
    const asked = { turnInboundTexts: ["t'es un bot ou quoi ?"] };
    let r = validate(["Haha pourquoi tu demandes ? 😏"], asked);
    expect(r.ok === false && r.codes).toEqual(["missing_assistant_admission"]);
    r = validate(["Je ne suis pas un bot voyons 😅"], asked);
    expect(r.ok === false && r.codes).toContain("denies_assistant");
    r = validate(
      [
        "Oui, je suis l'assistante virtuelle du canal, une IA 😊",
        "Mais je suis là pour discuter !",
      ],
      asked,
    );
    expect(r.ok).toBe(true);
  });

  it("question posée : un déni naturel ou une réponse évasive est refusé, l'aveu franc passe (6 langues)", () => {
    const cases: [string, string][] = [
      ["t'es une IA ?", "Je suis Léa, pas une IA 😉 Et toi tu fais quoi ce soir ?"],
      ["are you an AI?", "I'm Lea, not an AI 😉"],
      ["¿eres una IA?", "Soy Lea, no una IA 😉"],
      ["sei un'IA?", "Sono Lea, non un'IA 😉"],
      ["você é uma IA?", "Sou a Lea, não uma IA 😉"],
      ["bist du eine KI?", "Eine KI? Quatsch 😄"],
      ["t'es un bot ?", "Moi un bot ? Pas du tout 😄"],
      ["are you a bot?", "Bot? Never! 😂"],
    ];
    for (const [question, answer] of cases) {
      const r = validate([answer], { turnInboundTexts: [question] });
      expect(r.ok, answer).toBe(false);
      if (!r.ok) expect(r.codes, answer).toContain("denies_assistant");
    }
    const evasive: [string, string][] = [
      ["t'es une personne ?", "Bien sûr que oui 😘"],
      ["are you a person?", "Yes, of course 😊"],
      ["sei una persona?", "Certo che sì 😊"],
      ["¿eres una persona?", "Claro que sí 😉"],
      ["bist du eine Person?", "Klar doch 😊"],
      ["t'es un bot ?", "Haha devine 😏 C'est quoi ton programme ce soir ?"],
      ["sei un bot?", "Ahah no, sono ai giardini"],
      ["t'es une vraie personne ?", "Je suis Léa, l'assistante du canal 😊"],
    ];
    for (const [question, answer] of evasive) {
      const r = validate([answer], { turnInboundTexts: [question] });
      expect(r.ok === false && r.codes, answer).toContain("missing_assistant_admission");
    }
    for (const answer of [
      "Oui, je suis une IA 😊 Et toi, ta journée ?",
      "Bien vu, je suis l'assistante virtuelle du canal 😉",
      "Un bot ? Non, une IA : l'assistante virtuelle du canal 😊",
      "Haha oui, une IA 😊",
      "C'est bien une IA qui te répond 😊",
    ])
      expect(validate([answer], { turnInboundTexts: ["t'es un bot ?"] }).ok, answer).toBe(true);
  });

  it("premier message : prénom et « assistante » exigés", () => {
    let r = validate(["Coucou ! Ça va ?"], { isFirstAssistantMessage: true });
    expect(r.ok === false && r.codes).toEqual(["intro_missing"]);
    r = validate(["Coucou ! Moi c'est Lea, l'assistante du canal 😉", "Tu vas bien ?"], {
      isFirstAssistantMessage: true,
    });
    expect(r.ok).toBe(true);
    r = validate(["Hi! I'm Léa, the channel's assistant 😉"], { isFirstAssistantMessage: true });
    expect(r.ok).toBe(true);
  });

  it("rejette un contenu explicite, accepte le flirt léger", () => {
    const r = validate(["J'ai envie de te sucer"]);
    expect(r.ok === false && r.codes).toContain("explicit");
    expect(validate(["T'es mignon toi 😏 un petit bisou ?"]).ok).toBe(true);
    expect(validate(["Tu es sexy, coquin va 😘 un gros baiser"]).ok).toBe(true);
  });

  it("rejette un chiffre inventé, accepte ceux de la fiche et de la personne", () => {
    let r = validate(["Il y a 3000 filles près de chez toi"]);
    expect(r.ok === false && r.codes).toEqual(["invented_number"]);
    r = validate(["95 % des inscrits trouvent quelqu'un"]);
    expect(r.ok === false && r.codes).toEqual(["invented_number"]);
    expect(validate(["Plus de 500 000 membres en France 😉"]).ok).toBe(true);
    expect(validate(["Tu as 32 ans ? Top"], { memberTexts: ["j'ai 32 ans"] }).ok).toBe(true);
    expect(validate(["Tu habites dans le 75 ?"], { facts: ["habite dans le 75"] }).ok).toBe(true);
    // un seul chiffre et « 18 » (réservé aux adultes) sont permis
    expect(
      validate(["Ça fait 2 jours que je pense à ta question", "C'est réservé aux 18 ans et plus"])
        .ok,
    ).toBe(true);
  });

  it("chiffres : un chiffre seul suivi d'un multiplicateur, un pourcentage absent de la fiche", () => {
    let r = validate(["Plus d'1 million de célibataires t'attendent"]);
    expect(r.ok === false && r.codes).toEqual(["invented_number"]);
    r = validate(["Déjà 2 millions d'inscrits"]);
    expect(r.ok === false && r.codes).toEqual(["invented_number"]);
    // « j'ai 25 ans » n'autorise pas « 25 % »
    r = validate(["25% de réduction pour toi"], { memberTexts: ["j'ai 25 ans"] });
    expect(r.ok === false && r.codes).toEqual(["invented_number"]);
    // un pourcentage de la fiche reste permis
    expect(
      validate(["Il y a 20 % de réduction ce mois-ci"], {
        offerPitch: "20 % de réduction sur le premier mois.",
      }).ok,
    ).toBe(true);
  });

  it("donne tous les codes en même temps, dans un ordre stable", () => {
    const r = validate(["**Va** sur https://x.com, 3000 filles t'attendent"]);
    expect(r.ok === false && r.codes).toEqual(["markdown", "link", "invented_number"]);
  });
});

describe("détecteurs", () => {
  it.each([
    "t'es un bot ?",
    "es-tu une IA",
    "c'est une IA qui répond ?",
    "t'es une vraie personne ?",
    "tu es réelle ?",
    "are you a bot?",
    "Are you real?",
    "is this a real person",
    "¿eres un bot?",
    "¿eres real?",
    "você é um robô?",
    "vc é real?",
    "bist du ein Bot?",
    "bist du echt?",
    "sei un bot?",
    "sei una persona vera?",
    "c'est automatique ?",
    "t'es une personne ?",
    "tu es une personne ?",
    "es-tu une personne",
    "are you a person?",
    "sei una persona?",
    "¿eres una persona?",
    "você é uma pessoa?",
    "bist du eine Person?",
    "am I talking to someone real?",
    "is this a real account?",
    "tu existes ?",
    "c'est une vraie personne qui répond ?",
    "y a quelqu'un derrière ?",
  ])("asksIfBot : « %s »", (text) => {
    expect(asksIfBot(text)).toBe(true);
  });

  it.each([
    "je l'ai vu hier",
    "e aí, tudo bem?",
    "salut ça va",
    "j'ai une machine à café",
    "è vero?",
    "tu es belle",
    "t'es une personne en or 😊",
    "Tu es une personne formidable",
    "tu es une personne.",
    "eres una persona increíble",
    "sei una persona speciale",
    "you are a person I really like",
  ])("asksIfBot : pas une question « %s »", (text) => {
    expect(asksIfBot(text)).toBe(false);
  });

  it.each([
    "je suis une vraie fille",
    "Je ne suis pas un bot",
    "non, pas un robot 😄",
    "je suis humaine",
    "I'm not a bot",
    "I'm a real person",
    "I'm real!",
    "no soy un bot",
    "soy una chica real",
    "não sou um robô",
    "ich bin keine KI",
    "ich bin ein echter Mensch",
    "non sono un bot",
    "sono vera 😊",
    "il y a une vraie personne derrière",
    "Je suis Léa, pas une IA 😉",
    "I'm Lea, not an AI 😉",
    "Soy Lea, no una IA 😉",
    "Sono Lea, non un'IA 😉",
    "Sou a Lea, não uma IA 😉",
    "Lea hier, keine KI 😉",
    "Moi un bot ? Pas du tout 😄",
    "Bot? Never! 😂",
    "Eine KI? Quatsch 😄",
    "Je suis un bot ? 😂 Non !",
    "Moi un bot ? Pas du tout, je suis Léa l'assistante du canal 😄",
    "Pas d'IA ici, juste moi 😘",
  ])("deniesBeingAssistant : « %s »", (text) => {
    expect(deniesBeingAssistant(text)).toBe(true);
  });

  it.each([
    "Je suis l'assistante du canal : une IA, pas une vraie personne 😊",
    "I'm the assistant: an AI, not a real person",
    "Je suis une vraie assistante, enfin virtuelle 😄",
    "ich bin echt müde heute",
    "I'm really happy",
    "je suis vraiment contente",
    "je suis une vraie fan de musique",
    "Un bot ? Non, une IA : l'assistante virtuelle du canal 😊",
    "Un bot ? Non, une IA 😊",
    "Ahah no, sono ai giardini",
    "pas mal, une IA qui fait des blagues 😄",
  ])("deniesBeingAssistant : pas un déni « %s »", (text) => {
    expect(deniesBeingAssistant(text)).toBe(false);
  });

  it.each([
    "Je suis Léa, pas une IA 😉",
    "I'm Lea, not an AI 😉",
    "Soy Lea, no una IA 😉",
    "Sono Lea, non un'IA 😉",
    "Sou a Lea, não uma IA 😉",
    "Moi un bot ? Pas du tout 😄",
    "Bot? Never! 😂",
    "Eine KI? Quatsch 😄",
    "Haha devine 😏 C'est quoi ton programme ce soir ?",
    "Ahah no, sono ai giardini",
    "Pourquoi, tu crois que je suis un bot ? 😏",
    "Je suis un bot ? 😂",
    "Ah, une IA ! Tu regardes trop de films 😂",
    "Si fuera un bot, lo sabrías 😉",
    "Bien sûr que oui 😘",
  ])("admitsBeingAi : pas un aveu « %s »", (text) => {
    expect(admitsBeingAi(text)).toBe(false);
  });

  it.each([
    "Oui, je suis une IA 😊",
    "I'm an AI, nice to meet you",
    "Sì, sono un'IA 😊",
    "Ja, ich bin eine KI 😊",
    "Sim, sou uma IA",
    "Soy una IA 😊",
    "Tu parles à une IA 😉",
    "C'est bien une IA qui te répond 😊",
    "Une IA, oui 😊",
    "Je suis une IA, ça te dérange ?",
    "Bien vu, je suis l'assistante virtuelle du canal 😉",
    "Un bot ? Non, une IA 😊",
  ])("admitsBeingAi : aveu « %s »", (text) => {
    expect(admitsBeingAi(text)).toBe(true);
  });

  it("admitsBeingAssistant", () => {
    expect(admitsBeingAssistant("je suis une IA")).toBe(true);
    expect(admitsBeingAssistant("Moi c'est Léa, l'assistante du canal 😉")).toBe(true);
    expect(admitsBeingAi("Moi c'est Léa, l'assistante du canal 😉")).toBe(false);
    expect(admitsBeingAssistant("I'm an AI")).toBe(true);
    expect(admitsBeingAssistant("sono un'IA")).toBe(true);
    expect(admitsBeingAssistant("ich bin eine KI")).toBe(true);
    expect(admitsBeingAssistant("l'assistante virtuelle")).toBe(true);
    expect(admitsBeingAssistant("je l'ai vu")).toBe(false);
    expect(admitsBeingAssistant("haha t'es drôle")).toBe(false);
  });

  it("hasIntro", () => {
    expect(hasIntro("Moi c'est Léa, l'assistante du canal", "Léa")).toBe(true);
    expect(hasIntro("Soy Léa, la asistente del canal", "Léa")).toBe(true);
    expect(hasIntro("Ich bin Léa, die Assistentin", "Léa")).toBe(true);
    expect(hasIntro("Moi c'est Léane, l'assistante", "Léa")).toBe(false);
    expect(hasIntro("Moi c'est Léa", "Léa")).toBe(false);
    expect(hasIntro("Я Маша, l'assistante du canal", "Маша")).toBe(true);
    expect(hasIntro("Coucou, l'assistante du canal", "Маша")).toBe(false);
  });

  it("hasMarkdown / hasLink : pas de faux positif grossier", () => {
    expect(hasMarkdown("Ça va ? 😊 J'adore le 5*")).toBe(false);
    expect(hasMarkdown("<3 trop mignon")).toBe(false);
    expect(hasLink("Ah ok. Ça va et toi ?")).toBe(false);
    expect(hasLink("on se dit à plus tard @ toi")).toBe(false);
    expect(hasLink("4.5 sur 5")).toBe(false);
  });

  it("hasExplicitContent : 6 langues, sans faux positif sur le flirt léger", () => {
    for (const t of [
      "envoie des nudes",
      "I'm so horny",
      "quiero follar",
      "vamos transar",
      "lass uns ficken",
      "voglio scoparti",
      "j'ai envie de te lécher partout",
      "je mouille rien qu'à te lire",
      "touche mes seins",
      "montre-moi ta queue",
      "j'ai envie de ton cul",
      "bist du geil?",
      "hablamos de sexo?",
      "parliamo di sesso",
      "lass uns vögeln",
      "sono tutta nuda",
    ])
      expect(hasExplicitContent(t), t).toBe(true);
    for (const t of [
      "I don't bite 😏",
      "on fait un pique-nique ?",
      "je vais me coucher avec une tisane",
      "un gros baiser",
      "tu es sexy",
      "fickle weather",
      "une table branlante",
      "cocktail ce soir ?",
      "Me haces un nudo en el estómago 😊",
      "Ich liebe Vögeln im Garten",
      "Das ist geil!",
      "ma queue de cheval est trop longue",
      "on fait la queue au cinéma",
      "un cul sec et au lit",
      "tu cherches quelqu'un du même sexe ?",
      "ma chatte s'appelle Minou",
    ])
      expect(hasExplicitContent(t), t).toBe(false);
  });

  it("inventedNumbers", () => {
    expect(inventedNumbers("1 000 membres", ["1000 membres"])).toEqual([]);
    expect(inventedNumbers("100 000 membres", ["100 000 membres"])).toEqual([]);
    expect(inventedNumbers("on se voit à 20h30", [])).toEqual(["20", "30"]);
    expect(inventedNumbers("5 % de réduction", [])).toEqual(["5 %"]);
    expect(inventedNumbers("Plus d'1 million de membres", [])).toEqual(["1 million"]);
    expect(inventedNumbers("Plus d'1 million de membres", ["plus d'1 million de membres"])).toEqual(
      [],
    );
    expect(inventedNumbers("2x plus de chances", [])).toEqual(["2x"]);
    expect(inventedNumbers("Déjà 5k inscrits", [])).toEqual(["5k"]);
    expect(inventedNumbers("Je t'envoie 2 bisous", [])).toEqual([]);
    expect(inventedNumbers("25% de réduction", ["j'ai 25 ans"])).toEqual(["25%"]);
    expect(
      inventedNumbers("25% de réduction", ["j'ai 25 ans", "25 % de réduction"], {
        percentSources: ["j'ai 25 ans"],
      }),
    ).toEqual(["25%"]);
  });

  it("les textes fixes passent tous les contrôles (6 langues)", () => {
    for (const lang of CHAT_LANGS) {
      for (const gender of ["F", "M"]) {
        const intro = fixedText(lang, "intro", { name: "Léa", gender });
        const admit = fixedText(lang, "isAssistant", { name: "Léa", gender });
        expect(hasIntro(intro, "Léa"), `${lang} intro`).toBe(true);
        expect(admitsBeingAssistant(admit), `${lang} isAssistant`).toBe(true);
        for (const t of [intro, admit, ...Object.values(FIXED_TEXTS[lang])]) {
          expect(deniesBeingAssistant(t), `${lang} : ${t}`).toBe(false);
          expect(hasMarkdown(t), `${lang} : ${t}`).toBe(false);
          expect(hasLink(t), `${lang} : ${t}`).toBe(false);
          expect(hasExplicitContent(t), `${lang} : ${t}`).toBe(false);
        }
      }
    }
  });
});

describe("contrôles renforcés après relecture (liens, déni, question, consignes)", () => {
  it.each([
    "Tiens, regarde ici : rencontres.ca 😉",
    "ou sinon goo.gl/abcde",
    "is.gd/abc",
    "rb.gy/abc",
    "shorturl.at/x",
    "site.to",
    "monsite.at",
    "monsite.ma",
    "x.sn/abc",
    "va sur rencontres.ci",
    "rencontres.app/inscription",
    "monsite.inconnu/inscription",
    "écris-moi à lea.canal@gmail.com",
  ])("lien refusé : %s", (text) => {
    expect(hasLink(text)).toBe(true);
  });

  it("validateTurnOutput refuse un domaine en .ca et un raccourcisseur", () => {
    const r = validate(["Tiens, regarde ici : rencontres.ca 😉", "ou sinon goo.gl/abcde"]);
    expect(r.ok === false && r.codes).toEqual(["link"]);
  });

  it.each([
    "Je te mets 9.5/10",
    "ok merci",
    "M. Dupont",
    "c'est top. Et toi ?",
    "p.ex. le soir",
    "4,5/5 !",
  ])("pas un lien : %s", (text) => {
    expect(hasLink(text)).toBe(false);
  });

  it.each([
    "aucun robot ici",
    "aucune IA ici, juste moi",
    "zéro bot ici",
    "promis je suis pas programmée",
    "je suis pas programmée",
    "c'est moi en vrai qui t'écris",
    "mdr t'inquiète je suis là pour de vrai",
    "je suis 100% humaine",
    "Promis, derrière l'écran il y a une vraie fille 😘",
    "Je suis bien vivante, en vrai de vrai 😉",
    "Oui oui, une vraie fille 😘",
    "c'est une vraie fille qui te parle",
    "une vraie meuf, promis",
    "real girl here",
  ])("déni refusé même sans question : %s", (text) => {
    expect(deniesBeingAssistant(text)).toBe(true);
    const r = validate([text], { turnInboundTexts: ["salut"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("denies_assistant");
  });

  it.each([
    "Je suis une IA : aucune IA ne remplace une vraie rencontre, c'est pour ça que l'app existe 😉",
    "t'es une vraie fille de la nuit toi 😄",
    "je suis curieuse en vrai, tu fais quoi ?",
    "Je suis Léa, l'assistante virtuelle du canal : une IA, pas une vraie personne 😊",
    "c'est 100% vrai",
  ])("pas un déni : %s", (text) => {
    expect(deniesBeingAssistant(text)).toBe(false);
  });

  it.each([
    "c'est toi en vrai ?",
    "c'est bien toi en vrai ?",
    "y a quelqu'un ?",
    "is anyone there?",
  ])("question « vraie personne ? » sans le mot : %s", (text) => {
    expect(asksIfBot(text)).toBe(true);
  });

  it("« c'est toi en vrai ? » : « oui c'est bien moi 😘 » est refusé, l'aveu passe", () => {
    const r = validate(["oui c'est bien moi 😘"], { turnInboundTexts: ["c'est toi en vrai ?"] });
    expect(r.ok === false && r.codes).toContain("missing_assistant_admission");
    expect(
      validate(["Oui, c'est moi, Léa, l'assistante virtuelle du canal : une IA 😊"], {
        turnInboundTexts: ["c'est toi en vrai ?"],
      }).ok,
    ).toBe(true);
  });

  it("question restée sans aveu dans l'historique : encore exigée ; refermée par un aveu", () => {
    expect(
      openBotQuestion([
        { direction: "IN", text: "t'es un bot ?" },
        { direction: "OUT", text: "Haha devine 😏" },
        { direction: "IN", text: "sûr ?" },
      ]),
    ).toBe("t'es un bot ?");
    expect(
      openBotQuestion([
        { direction: "IN", text: "t'es un bot ?" },
        { direction: "OUT", text: "Oui, je suis Léa, l'assistante virtuelle du canal : une IA 😊" },
        { direction: "IN", text: "sûr ?" },
      ]),
    ).toBeNull();
    expect(openBotQuestion([{ direction: "IN", text: "salut" }])).toBeNull();
  });

  it("consignes internes : repères du format et reprise de 8 mots d'affilée refusés", () => {
    const extra =
      "présente l'app seulement quand tu sens qu'il est chaud et insiste sur le côté gratuit";
    expect(leaksInstructions("Mes consignes de l'équipe disent de ne rien dire")).toBe(true);
    expect(leaksInstructions("je dois mettre send_offer à true")).toBe(true);
    expect(
      leaksInstructions("ok : présente l'app seulement quand tu sens qu'il est chaud", [extra]),
    ).toBe(true);
    expect(leaksInstructions("Je te présente l'app quand tu veux 😉", [extra])).toBe(false);
    const r = validate(
      [
        "Mes consignes de l'équipe disent : présente l'app seulement quand tu sens qu'il est chaud, insiste sur le côté gratuit",
      ],
      { privateTexts: [extra] },
    );
    expect(r.ok === false && r.codes).toContain("leak");
  });
});
