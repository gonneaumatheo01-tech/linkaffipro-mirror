import { describe, expect, it } from "vitest";
import { extractMentions, extractTmeLinks, normalizeProspectUrl } from "./normalize";

describe("normalizeProspectUrl", () => {
  it("toutes les formes d'un canal public → https://t.me/<nom> en minuscules", () => {
    for (const s of ["@Pronos_Du_Coin", "pronos_du_coin", "t.me/Pronos_du_coin", "https://t.me/s/pronos_du_coin", "https://t.me/pronos_du_coin/123?single", "http://telegram.me/pronos_du_coin", "www.t.me/pronos_du_coin#x", "tg://resolve?domain=pronos_du_coin", "«https://t.me/pronos_du_coin».", "https://t.me/boost/pronos_du_coin"])
      expect(normalizeProspectUrl(s), s).toEqual({ channelUrl: "https://t.me/pronos_du_coin", username: "pronos_du_coin", invite: false, folder: null });
  });

  it("lien d'invitation → invite (hash gardé tel quel), jamais de username", () => {
    expect(normalizeProspectUrl("https://t.me/+AbCdEf123456")).toEqual({ channelUrl: "https://t.me/+AbCdEf123456", username: null, invite: true, folder: null });
    expect(normalizeProspectUrl("t.me/joinchat/ZyXwVu987654")).toEqual({ channelUrl: "https://t.me/+ZyXwVu987654", username: null, invite: true, folder: null });
  });

  it("dossier addlist → folder", () => {
    expect(normalizeProspectUrl("https://t.me/addlist/PaRiS42xyz")).toEqual({ channelUrl: "https://t.me/addlist/PaRiS42xyz", username: null, invite: false, folder: "PaRiS42xyz" });
  });

  it("bots, chemins réservés, autres sites et textes illisibles → null", () => {
    for (const s of ["@casino_promo_bot", "t.me/SupportBot", "t.me/share/url?url=x", "t.me/c/123456/7", "https://t.me/", "https://exemple.fr/pronos", "abc", "", "t.me/proxy?server=x", "t.me/+x"])
      expect(normalizeProspectUrl(s), s).toBeNull();
  });
});

describe("extractTmeLinks / extractMentions", () => {
  it("liens d'un HTML : normalisés, sans doublon, faux domaines écartés", () => {
    const html = `<a href="https://t.me/pronos_du_coin">x</a> https://t.me/s/Pronos_Du_Coin t.me/+AbCdEf123456 bet.me/pas_un_canal
      <a href="https://t.me/addlist/PaRiS42xyz">dossier</a> telegram.me/le_tipster &amp; t.me/aide_bot`;
    expect(extractTmeLinks(html)).toEqual(["https://t.me/pronos_du_coin", "https://t.me/+AbCdEf123456", "https://t.me/addlist/PaRiS42xyz", "https://t.me/le_tipster"]);
  });

  it("mentions : usernames, pas les emails ni les bots", () => {
    expect(extractMentions("Pub : @Admin_Pub, écris à contact@exemple.fr ou @promo_bot. Merci @le_tipster.")).toEqual(["admin_pub", "le_tipster"]);
  });
});
