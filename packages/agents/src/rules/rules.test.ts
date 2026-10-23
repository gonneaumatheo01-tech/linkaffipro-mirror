import { describe, expect, it } from "vitest";
import { checkContent, foreignLinks, forbiddenWordsIn, mentionsAi } from "./content";
import { findDuplicate, similarity, stripSimulationHeader } from "./similarity";
import { inQuietHours, pickSlot, preferredFromBestHours, preferredKey, type SlotPlan } from "./slots";
import { fromParis, parisDay, parisMinutes, parisMonth, parisOffsetMinutes, parisWeekday } from "./time";

describe("règles de contenu : mention d'IA ou d'assistant (6 langues)", () => {
  const refused = [
    "Ce texte a été généré par une intelligence artificielle",
    "Je suis l'IA du canal 😉",
    "Written by AI, enjoy",
    "As an AI, I can't say",
    "Creado con inteligencia artificial",
    "Texto gerado por inteligência artificial",
    "Mit künstlicher Intelligenz erstellt — KI rocks",
    "Scritto con l'intelligenza artificiale",
    "Demande à notre bot",
    "Ton assistante du soir",
    "Tu asistente personal",
    "La tua assistente",
    "Deine Assistentin",
    "Ask ChatGPT",
    "Une fille virtuelle t'attend",
  ];
  for (const t of refused) it(`refuse : ${t}`, () => expect(mentionsAi(t)).not.toBeNull());

  const accepted = [
    "J'ai une surprise pour toi ce soir 🔥",
    "Vai ai tavoli stasera",
    "Bottes et talons, ce soir on sort",
    "Laisse-toi tenter, tu ne le regretteras pas",
    "Robert t'attend", // pas « robot »
    "Gagne gros au jackpot",
  ];
  for (const t of accepted) it(`accepte : ${t}`, () => expect(mentionsAi(t)).toBeNull());

  it("cherche aussi dans le HTML (texte visible seulement)", () => {
    expect(mentionsAi('<a href="https://go.goolink.eu/ia">Clique</a>')).toBeNull();
    expect(mentionsAi("<b>IA</b> du canal")).not.toBeNull();
  });
});

describe("règles de contenu : liens", () => {
  it("accepte nos liens suivis", () => {
    expect(foreignLinks('<a href="https://go.goolink.eu/abc">ici</a>')).toEqual([]);
    expect(foreignLinks("Va sur https://go.goolink.eu/x")).toEqual([]);
  });
  it("refuse tout autre lien, domaine nu, t.me ou @canal", () => {
    expect(foreignLinks('<a href="https://evil.com/x">ici</a>')).toEqual(["evil.com"]);
    expect(foreignLinks("Va sur www.exemple.fr maintenant")).toEqual(["exemple.fr"]);
    expect(foreignLinks("Tape monsite.bet dans ton navigateur")).toEqual(["monsite.bet"]);
    expect(foreignLinks("Rejoins t.me/moncanal")).toContain("t.me");
    expect(foreignLinks("Suis @moncanal_vip")).toContain("@moncanal_vip");
  });
  it("hôtes autorisés réglables", () => {
    expect(foreignLinks("https://exemple.org", ["exemple.org"])).toEqual([]);
  });
});

describe("règles de contenu : longueur, mots interdits, HTML, vide", () => {
  it("longueur comptée sur le texte visible, 900 par défaut", () => {
    const ok = `<b>${"a".repeat(900)}</b>`;
    expect(checkContent(ok).ok).toBe(true);
    const long = "a".repeat(901);
    expect(checkContent(long).problems.map((p) => p.code)).toEqual(["too_long"]);
    expect(checkContent("a".repeat(50), { maxLength: 40 }).problems[0]?.code).toBe("too_long");
  });
  it("mots interdits sans accents ni casse, mot entier", () => {
    expect(forbiddenWordsIn("Gagne GRATUIT ce soir", ["gratuit"])).toEqual(["gratuit"]);
    expect(forbiddenWordsIn("Un cadeau garanti", ["garantî"])).toEqual(["garantî"]);
    expect(forbiddenWordsIn("gratuitement", ["gratuit"])).toEqual([]);
    expect(checkContent("Gagne gratuit", { forbiddenWords: ["gratuit"] }).problems[0]?.code).toBe("forbidden_word");
  });
  it("HTML Telegram invalide refusé", () => {
    expect(checkContent("<div>salut</div>").problems[0]?.code).toBe("html");
    expect(checkContent("<b>salut").problems[0]?.code).toBe("html");
  });
  it("texte vide refusé", () => {
    expect(checkContent("  ").problems[0]?.code).toBe("empty");
    expect(checkContent("<b> </b>").ok).toBe(false);
  });
  it("texte correct accepté, motifs cumulés sinon", () => {
    expect(checkContent("Ce soir c'est <b>chaud</b> 🔥 https://go.goolink.eu/abc")).toEqual({ ok: true, problems: [] });
    const r = checkContent("Notre IA te conseille evil.com");
    expect(r.problems.map((p) => p.code).sort()).toEqual(["ai_mention", "foreign_link"]);
  });
});

describe("similarité (trigrammes, Jaccard)", () => {
  it("identiques = 1, sans rapport ≈ 0", () => {
    expect(similarity("Ce soir on joue", "ce soir, ON JOUE !")).toBe(1);
    expect(similarity("Ce soir on joue", "Le match de demain")).toBeLessThan(0.2);
    expect(similarity("", "abc")).toBe(0);
  });
  it("ignore balises, accents et en-tête de simulation", () => {
    expect(similarity("<b>Été brûlant</b>", "[SIMULATION équipe Dating → Canal] ete brulant")).toBe(1);
    expect(stripSimulationHeader("[SIMULATION équipe Dating → A]\nTexte")).toBe("Texte");
  });
  it("doublon au-delà du seuil réglable", () => {
    const prev = ["Le match de demain soir", "Ce soir on joue au casino avec toi"];
    expect(findDuplicate("Ce soir on joue au casino avec vous", prev)?.index).toBe(1);
    expect(findDuplicate("Rien à voir du tout", prev)).toBeNull();
    expect(findDuplicate("Ce soir on joue au casino avec vous", prev, 0.99)).toBeNull();
  });
});

describe("heure de Paris", () => {
  it("décalage été / hiver et conversions", () => {
    expect(parisOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(120);
    expect(parisOffsetMinutes(new Date("2026-12-01T12:00:00Z"))).toBe(60);
    expect(fromParis("2026-07-01", 9 * 60).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(fromParis("2026-12-01", 9 * 60).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(parisDay(new Date("2026-10-23T22:30:00Z"))).toBe("2026-10-24");
    expect(parisMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(parisWeekday(new Date("2026-10-26T10:00:00Z"))).toBe(1);
  });
});

describe("créneaux", () => {
  const plan: SlotPlan = { postsPerDay: 3, windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: 90 };
  // Vendredi 23 octobre 2026, 10 h 07 à Paris (heure d'été : UTC+2).
  const now = new Date("2026-10-23T08:07:00Z");

  it("premier créneau de la fenêtre après le délai minimal, au pas de 15 min", () => {
    const r = pickSlot({ now, plan });
    expect(r).toEqual({ ok: true, at: new Date("2026-10-23T08:15:00Z") });
  });

  it("avant la fenêtre : début de la fenêtre ; après : lendemain", () => {
    const early = pickSlot({ now: new Date("2026-10-23T04:00:00Z"), plan });
    expect(early.ok && early.at.toISOString()).toBe("2026-10-23T07:00:00.000Z");
    const late = pickSlot({ now: new Date("2026-10-23T20:30:00Z"), plan });
    expect(late.ok && late.at.toISOString()).toBe("2026-10-24T07:00:00.000Z");
  });

  it("espacement minimal avec les posts programmés ou envoyés (collisions)", () => {
    const occupied = [new Date("2026-10-23T08:30:00Z")];
    const r = pickSlot({ now, plan, occupied });
    // 08:15 et jusqu'à 09:45 exclus (90 min autour de 08:30) → 10:00 UTC.
    expect(r.ok && r.at.toISOString()).toBe("2026-10-23T10:00:00.000Z");
  });

  it("quota du jour atteint → jour suivant", () => {
    const agentSlots = [
      new Date("2026-10-23T07:00:00Z"),
      new Date("2026-10-23T12:00:00Z"),
      new Date("2026-10-23T16:00:00Z"),
    ];
    const r = pickSlot({ now, plan, agentSlots });
    expect(r.ok && parisDay(r.at)).toBe("2026-10-24");
  });

  it("quota impossible partout : motif clair", () => {
    const r = pickSlot({ now, plan: { ...plan, postsPerDay: 0 } });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("0 post") });
  });

  it("heures calmes, y compris une plage qui passe minuit", () => {
    expect(inQuietHours(23 * 60, [{ start: "22:00", end: "08:00" }])).toBe(true);
    expect(inQuietHours(7 * 60, [{ start: "22:00", end: "08:00" }])).toBe(true);
    expect(inQuietHours(12 * 60, [{ start: "22:00", end: "08:00" }])).toBe(false);
    const r = pickSlot({ now, plan, quietHours: [{ start: "10:00", end: "14:00" }] });
    expect(r.ok && parisMinutes(r.at)).toBe(14 * 60);
  });

  it("meilleurs horaires : le meilleur score du jour l'emporte", () => {
    const preferred = preferredFromBestHours({
      categories: { all: { cells: [{ day: 5, hour: 19, ctr: 0.12 }, { day: 5, hour: 12, ctr: 0.05 }] } },
    });
    expect(preferred.get(preferredKey(5, 19))).toBe(0.12);
    const r = pickSlot({ now, plan, preferred });
    expect(r.ok && parisMinutes(r.at)).toBe(19 * 60);
    expect(preferredFromBestHours(null).size).toBe(0);
  });

  it("changement d'heure (25 octobre 2026) : 9 h Paris = 8 h UTC après, 7 h UTC avant", () => {
    const sat = pickSlot({ now: new Date("2026-10-24T03:00:00Z"), plan });
    expect(sat.ok && sat.at.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    const sun = pickSlot({ now: new Date("2026-10-25T03:00:00Z"), plan });
    expect(sun.ok && sun.at.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    // Printemps : 2 h 30 n'existe pas le 29 mars 2026, jamais proposé.
    const spring = pickSlot({
      now: new Date("2026-03-28T23:00:00Z"),
      plan: { ...plan, windowStart: "02:00", windowEnd: "04:00", minSpacingMinutes: 0 },
      stepMinutes: 30,
    });
    expect(spring.ok && parisMinutes(spring.at)).toBe(3 * 60);
  });

  it("pas avant `notBefore` (mission reportée)", () => {
    const r = pickSlot({ now, plan, notBefore: new Date("2026-10-24T00:00:00Z") });
    expect(r.ok && parisDay(r.at)).toBe("2026-10-24");
  });
});
