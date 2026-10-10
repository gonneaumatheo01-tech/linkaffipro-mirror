import { describe, expect, it } from "vitest";
import { findChannelLinkInText, parseChannelLink } from "./username";

describe("parseChannelLink", () => {
  it("accepte les quatre formes", () => {
    for (const input of [
      "t.me/mon_canal",
      "https://t.me/mon_canal",
      "http://t.me/mon_canal/",
      "@mon_canal",
      "mon_canal",
      " https://telegram.me/mon_canal?x=1 ",
      "https://t.me/mon_canal/42",
    ]) {
      expect(parseChannelLink(input)).toEqual({ kind: "username", username: "mon_canal" });
    }
  });
  it("accepte l'aperçu web t.me/s/<nom> (lien copié depuis le navigateur)", () => {
    for (const input of [
      "https://t.me/s/mon_canal",
      "t.me/s/mon_canal/",
      "https://t.me/s/mon_canal/42",
      "https://t.me/s/mon_canal?before=10",
    ]) {
      expect(parseChannelLink(input)).toEqual({ kind: "username", username: "mon_canal" });
    }
  });
  it("reconnaît un lien d'invitation privé", () => {
    expect(parseChannelLink("https://t.me/+AbCdEf123")).toEqual({ kind: "invite" });
    expect(parseChannelLink("t.me/joinchat/AbCdEf123")).toEqual({ kind: "invite" });
  });
  it("reconnaît le lien d'un message de canal privé t.me/c/<chiffres>/… (oriente vers la méthode 1)", () => {
    expect(parseChannelLink("https://t.me/c/1234567890/5")).toEqual({ kind: "private" });
    expect(parseChannelLink("t.me/c/1234567890")).toEqual({ kind: "private" });
    expect(parseChannelLink("https://t.me/c/1234567890/5?thread=2")).toEqual({ kind: "private" });
  });
  it("refuse les noms invalides", () => {
    for (const input of [
      "",
      "   ",
      "ab",
      "1abc",
      "nom avec espace",
      "nom-avec-tiret",
      "https://autre.site/x",
      "t.me/s/",
    ]) {
      expect(parseChannelLink(input).kind).toBe("invalid");
    }
  });
  it("un canal nommé « c… » ou « s… » reste un nom de canal", () => {
    expect(parseChannelLink("t.me/canal_vip")).toEqual({ kind: "username", username: "canal_vip" });
    expect(parseChannelLink("@sport_vip")).toEqual({ kind: "username", username: "sport_vip" });
  });
});

describe("parseChannelLink : ponctuation autour du lien", () => {
  it("ignore la ponctuation finale ou les parenthèses autour du lien", () => {
    for (const input of [
      "t.me/mon_canal.",
      "(t.me/mon_canal)",
      "https://t.me/mon_canal !",
      "« @mon_canal »",
      "t.me/mon_canal,",
      "<https://t.me/mon_canal>",
    ]) {
      expect(parseChannelLink(input)).toEqual({ kind: "username", username: "mon_canal" });
    }
  });
});

describe("findChannelLinkInText", () => {
  it("un message réduit au lien (ou au @nom), ponctuation autour comprise", () => {
    expect(findChannelLinkInText("https://t.me/mon_canal")).toBe("https://t.me/mon_canal");
    expect(findChannelLinkInText("  t.me/mon_canal. ")).toBe("t.me/mon_canal");
    expect(findChannelLinkInText("(t.me/mon_canal)")).toBe("t.me/mon_canal");
    expect(findChannelLinkInText("t.me/mon_canal !")).toBe("t.me/mon_canal");
    expect(findChannelLinkInText("t.me/c/123456/7")).toBe("t.me/c/123456/7");
    expect(findChannelLinkInText("  @mon_canal ")).toBe("@mon_canal");
    expect(findChannelLinkInText("@mon_canal.")).toBe("@mon_canal");
  });
  it("un lien au milieu d'une phrase n'est pas une demande d'ajout (réponse au dialogue, canal d'un autre)", () => {
    expect(findChannelLinkInText("voici le canal https://t.me/mon_canal merci")).toBeNull();
    expect(findChannelLinkInText("regarde t.me/canal_concurrent")).toBeNull();
    expect(findChannelLinkInText("t.me/mon_canal, merci")).toBeNull();
  });
  it("un lien de bot (offre ?start=…, nom en « bot ») n'est pas un canal", () => {
    expect(findChannelLinkInText("https://t.me/casinobot?start=oAbC123")).toBeNull();
    expect(findChannelLinkInText("https://t.me/autre_canal?start=x")).toBeNull();
    expect(findChannelLinkInText("t.me/Casino_Bot")).toBeNull();
    expect(findChannelLinkInText("@sportbot")).toBeNull();
  });
  it("ignore un texte ordinaire", () => {
    expect(findChannelLinkInText("fait")).toBeNull();
    expect(findChannelLinkInText("écris à @mon_canal demain")).toBeNull();
    expect(findChannelLinkInText("1")).toBeNull();
  });
});
