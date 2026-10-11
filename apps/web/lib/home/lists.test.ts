import { describe, expect, it } from "vitest";
import { activeCampaigns, excerpt, postPreview, whenLabel, type CampaignRowLike } from "./lists";

describe("Prochains messages", () => {
  const now = new Date("2026-10-10T08:00:00Z"); // samedi 10 octobre, 10:00 à Paris

  it("heure de Paris : aujourd'hui, demain, puis le jour", () => {
    expect(whenLabel(new Date("2026-10-10T16:30:00Z"), now)).toBe("Aujourd'hui 18:30");
    // 23:30 UTC le 10 = 01:30 le 11 à Paris : demain.
    expect(whenLabel(new Date("2026-10-10T23:30:00Z"), now)).toBe("Demain 01:30");
    expect(whenLabel(new Date("2026-10-13T07:00:00Z"), now)).toBe("mar. 13 oct. 09:00");
  });

  it("début du texte sans balises, coupé au mot", () => {
    expect(excerpt("<b>Bonus</b> du soir : <i>100 %</i>")).toBe("Bonus du soir : 100 %");
    expect(excerpt("a&amp;b")).toBe("a&b");
    // Une ligne de titre puis le texte : séparés par « · ».
    expect(excerpt("<b>Combiné du week-end</b>\n\nQuatre matchs,  une cote\n")).toBe(
      "Combiné du week-end · Quatre matchs, une cote",
    );
    const long =
      "Ce soir grand tournoi de poker avec un bonus exceptionnel pour tous les membres du canal VIP";
    const out = excerpt(long, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).toBe("Ce soir grand tournoi de poker avec un…");
    // Pas de séparateur ni de ponctuation juste avant « … ».
    expect(excerpt("Titre du message\nDeuxième ligne assez longue", 18)).toBe("Titre du message…");
    expect(excerpt("Un, deux, trois, quatre", 9)).toBe("Un, deux…");
    expect(excerpt("Fin de phrase. Suite du texte", 15)).toBe("Fin de phrase…");
  });

  it("message sans texte", () => {
    expect(postPreview("", 0)).toBe("Message sans texte");
    expect(postPreview("  ", 1)).toBe("Média sans texte");
    expect(postPreview("", 3)).toBe("3 médias sans texte");
    expect(postPreview("Salut", 2)).toBe("Salut");
  });
});

describe("Campagnes actives", () => {
  const row = (
    id: string,
    gains: number,
    extra: Partial<CampaignRowLike> = {},
    spend = 10,
  ): CampaignRowLike => ({
    id,
    name: `Campagne ${id}`,
    vertical: "CASINO",
    status: "ACTIVE",
    importedFrom: null,
    metrics: { spend, members: 3, gains },
    ...extra,
  });

  it("seulement les actives, hors campagnes pub importées, les plus gros gains d'abord", () => {
    const { rows, total } = activeCampaigns([
      row("a", 50),
      row("b", -20),
      row("c", 300),
      row("d", 999, { status: "PAUSED" }),
      row("e", 999, { importedFrom: "META" }),
      row("f", 50, {}, 40),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c", "f", "a", "b"]);
    expect(total).toBe(4);
    expect(rows[0]).toEqual({
      id: "c",
      name: "Campagne c",
      vertical: "CASINO",
      spend: 10,
      members: 3,
      gains: 300,
    });
  });

  it("limite le nombre de lignes et garde le total", () => {
    const many = Array.from({ length: 8 }, (_, i) => row(String(i), i));
    const { rows, total } = activeCampaigns(many, 3);
    expect(rows.map((r) => r.id)).toEqual(["7", "6", "5"]);
    expect(total).toBe(8);
  });
});
