import { describe, expect, it } from "vitest";
import { copiedSequence } from "./copy-check";
import type { ReferencePostInput } from "./contract";
import { postFeatures } from "./features";
import { readWebPreview } from "./sources/web-preview";
import { fakeSleep, FIXTURE_CHANNELS, FIXTURE_NOW, fixtureFetch } from "./testing/fixtures";

const post = (text: string | null, extra: Partial<ReferencePostInput> = {}): ReferencePostInput => ({
  externalId: 1,
  postedAt: FIXTURE_NOW,
  text,
  mediaKind: "text",
  views: null,
  hasButton: false,
  linkCount: 0,
  ...extra,
});

describe("caractéristiques d'un post de référence", () => {
  it("forme : longueur, lignes, emojis, hashtags, mentions, questions, majuscules, lien", () => {
    const c = postFeatures(post("🔥 NOUVEAU ce soir ?\n\n#roulette #live avec @lumiere_vip 👉 https://exemple.invalid/x ??", { mediaKind: "photo", hasButton: true }), "casino");
    expect(c).toMatchObject({ lines: 2, emojiCount: 2, mediaKind: "photo", hasLink: true, hasButton: true });
    expect(c.length).toBe([..."🔥 NOUVEAU ce soir ?\n\n#roulette #live avec @lumiere_vip 👉 https://exemple.invalid/x ??"].length);
    expect(c.features).toMatchObject({ hashtags: 2, mentions: 1, questions: 2, linkCount: 1 });
    expect(c.features.capsRatio).toBeGreaterThan(0.1);
    expect(c.keywords).toEqual(expect.arrayContaining(["roulette", "live"]));
  });

  it("casino : bonus, code promo, gratuit, annonce de gains signalée, prix", () => {
    const bonus = postFeatures(post("🎁 Bonus de bienvenue 100 % jusqu'à 200 €\nCode promo : LUMIERE200\n+50 tours gratuits"), "casino");
    expect(bonus).toMatchObject({ hasPrice: true, hasOdds: false });
    expect(bonus.features).toMatchObject({ bonus: true, promoCode: true, free: true, gainClaim: false, betResult: null });
    expect(bonus.keywords).toEqual(expect.arrayContaining(["bonus", "code promo", "tours gratuits"]));
    expect(postFeatures(post("JACKPOT 🤑 Un membre vient de gagner 2 300 € !"), "casino").features.gainClaim).toBe(true);
    expect(postFeatures(post("Big win x500 on Sweet Bonanza"), "casino").features.gainClaim).toBe(true);
    expect(postFeatures(post("FREE SPINS today only, no deposit"), "casino").features).toMatchObject({ free: true, bonus: true, urgency: true });
  });

  it("paris : cotes (« cote 1,85 », « @2.10 »), série pari → résultat en français et en anglais", () => {
    const pick = postFeatures(post("⚽ Lyon – Nantes ce soir\nCote 1,85 🔥\nMise conseillée : 2 % de la bankroll"), "sports");
    expect(pick).toMatchObject({ hasOdds: true });
    expect(pick.features.odds).toEqual([1.85]);
    expect(pick.keywords).toEqual(expect.arrayContaining(["cote", "mise", "bankroll"]));
    expect(postFeatures(post("Pick: Arsenal over 3.5 shots on target\nOdds @2.10"), "sports").features.odds).toEqual([2.1]);
    expect(postFeatures(post("✅ Cote passée ! Gagné à 1,85"), "sports").features.betResult).toBe("won");
    expect(postFeatures(post("✅ WON! cashed"), "sports").features.betResult).toBe("won");
    expect(postFeatures(post("❌ Perdu ce soir, on repart demain"), "sports").features.betResult).toBe("lost");
    expect(postFeatures(post("❌ Lost tonight"), "sports").features.betResult).toBe("lost");
    expect(pick.features.match).toBe(true);
    expect(postFeatures(post("Arsenal vs Chelsea tonight"), "sports").features.match).toBe(true);
    expect(postFeatures(post("Bilan de la semaine"), "sports").features.match).toBe(false);
    // Mention d'IA : signalée (interdite chez nous).
    expect(postFeatures(post("Nos pronos sont faits par une IA 🤖"), "sports").features.aiMention).toBe(true);
    expect(postFeatures(post("J'ai gagné hier"), "sports").features.aiMention).toBe(false);
    // Hors Paris sportifs, un « ✅ » de liste n'est pas un résultat.
    expect(postFeatures(post("✅ Bonus actif"), "casino").features.betResult).toBeNull();
  });

  it("rencontres : appels au VIP (DM, écris-moi, places limitées, privé), payant, en français et en anglais", () => {
    const fr = postFeatures(post("Écris-moi en privé si tu veux discuter ce soir 💬"), "dating");
    expect(fr.hasVipCall).toBe(true);
    expect(fr.keywords).toEqual(expect.arrayContaining(["écris-moi", "en privé", "discuter"]));
    expect(postFeatures(post("DM me if you want to chat, limited spots in my private group"), "dating")).toMatchObject({ hasVipCall: true });
    expect(postFeatures(post("Places limitées pour la soirée de samedi ⏳"), "dating").features.urgency).toBe(true);
    expect(postFeatures(post("Accès privé : 9,99 €/mois"), "dating")).toMatchObject({ hasPrice: true, features: expect.objectContaining({ paid: true }) });
    expect(postFeatures(post("Coucou 😘 qui est réveillé ?"), "dating")).toMatchObject({ hasVipCall: false, emojiCount: 1 });
  });

  it("empreintes : texte haché, suites de 8 mots pour le contrôle de copie ; média seul sans texte", () => {
    const text = "Cote boostée ce soir sur le match, écris-moi en DM pour le VIP";
    const c = postFeatures(post(text), "sports");
    expect(c.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(c.shingles.length).toBeGreaterThan(0);
    expect(copiedSequence("Bonjour : cote boostée ce soir sur le match, écris-moi en DM", c.shingles)).toBeTruthy();
    expect(postFeatures(post(null, { mediaKind: "video" }), "dating")).toMatchObject({ text: null, length: 0, lines: 0, textHash: null, shingles: [] });
  });

  it("sur les 3 canaux enregistrés : chaque univers trouve son vocabulaire", async () => {
    const counts: Record<string, number> = {};
    for (const [universe, name] of [["casino", FIXTURE_CHANNELS.casino], ["sports", FIXTURE_CHANNELS.sports], ["dating", FIXTURE_CHANNELS.dating]] as const) {
      const r = await readWebPreview(fixtureFetch(), name, { now: FIXTURE_NOW, sleep: fakeSleep() });
      if (!r.ok) throw new Error(r.message);
      const cols = r.posts.map((p) => postFeatures(p, universe));
      counts[`${universe}.vip`] = cols.filter((c) => c.hasVipCall).length;
      counts[`${universe}.odds`] = cols.filter((c) => c.hasOdds).length;
      counts[`${universe}.won`] = cols.filter((c) => c.features.betResult === "won").length;
      counts[`${universe}.lost`] = cols.filter((c) => c.features.betResult === "lost").length;
      counts[`${universe}.gain`] = cols.filter((c) => c.features.gainClaim).length;
      counts[`${universe}.bonus`] = cols.filter((c) => c.features.bonus).length;
    }
    // 14 paris annoncés + 2 résultats en anglais qui rappellent la cote (« Odds @1.90 cashed »).
    expect(counts["sports.odds"]).toBe(16);
    expect(counts["sports.won"]).toBe(11);
    expect(counts["sports.lost"]).toBe(3);
    expect(counts["casino.bonus"]).toBe(5);
    expect(counts["casino.gain"]).toBeGreaterThanOrEqual(3);
    expect(counts["casino.odds"]).toBe(0);
    expect(counts["dating.vip"]).toBeGreaterThanOrEqual(4);
  });
});
