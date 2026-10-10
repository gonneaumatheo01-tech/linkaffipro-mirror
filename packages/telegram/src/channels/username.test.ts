import { describe, expect, it } from "vitest";
import { parseChannelLink } from "./username";

describe("parseChannelLink", () => {
  it("accepte les quatre formes", () => {
    for (const input of ["t.me/mon_canal", "https://t.me/mon_canal", "http://t.me/mon_canal/", "@mon_canal", "mon_canal", " https://telegram.me/mon_canal?x=1 ", "https://t.me/mon_canal/42"]) {
      expect(parseChannelLink(input)).toEqual({ kind: "username", username: "mon_canal" });
    }
  });
  it("reconnaît un lien d'invitation privé", () => {
    expect(parseChannelLink("https://t.me/+AbCdEf123")).toEqual({ kind: "invite" });
    expect(parseChannelLink("t.me/joinchat/AbCdEf123")).toEqual({ kind: "invite" });
  });
  it("refuse les noms invalides", () => {
    for (const input of ["", "   ", "ab", "1abc", "nom avec espace", "nom-avec-tiret", "https://autre.site/x"]) {
      expect(parseChannelLink(input).kind).toBe("invalid");
    }
  });
});
