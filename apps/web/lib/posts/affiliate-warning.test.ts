import { describe, expect, it } from "vitest";
import {
  AFFILIATE_POST_WARNING,
  affiliatePostWarningChannels,
  affiliateWarningDetail,
} from "./affiliate-warning";

const titles: Record<string, string> = { vip: "Casino VIP", foot: "Pronos Foot", grp: "Groupe" };
const base = {
  modeA: "account" as const,
  modeB: null,
  channelIdsA: ["vip", "foot"],
  channelIdsB: [],
  affiliateMembers: { vip: 12, foot: 0 },
  titleOf: (id: string) => titles[id] ?? id,
  isChannel: (id: string) => id !== "grp",
  isTemplate: false,
};

describe("avertissement : post sans bouton d'offre dans un canal avec des membres d'affiliés", () => {
  it("texte exact du cahier des charges", () => {
    expect(AFFILIATE_POST_WARNING).toBe(
      "Les dépôts venant de ce post ne pourront pas être crédités aux affiliés : utilisez un bouton d'offre.",
    );
  });

  it("publié par le compte dans un canal qui compte des membres d'affiliés : averti", () => {
    expect(affiliatePostWarningChannels(base)).toEqual(["Casino VIP"]);
  });

  it("publié par le bot (boutons possibles), modèle, groupe, ou canal sans membre d'affilié : rien", () => {
    expect(affiliatePostWarningChannels({ ...base, modeA: "bot" })).toEqual([]);
    expect(affiliatePostWarningChannels({ ...base, modeA: "fallback" })).toEqual([]);
    expect(affiliatePostWarningChannels({ ...base, isTemplate: true })).toEqual([]);
    expect(
      affiliatePostWarningChannels({ ...base, channelIdsA: ["grp"], affiliateMembers: { grp: 3 } }),
    ).toEqual([]);
    expect(affiliatePostWarningChannels({ ...base, channelIdsA: ["foot"] })).toEqual([]);
  });

  it("version B publiée par le compte dans un autre canal ; sans doublon", () => {
    expect(
      affiliatePostWarningChannels({
        ...base,
        modeA: "bot",
        modeB: "account",
        channelIdsB: ["vip"],
      }),
    ).toEqual(["Casino VIP"]);
    expect(
      affiliatePostWarningChannels({
        ...base,
        modeB: "account",
        channelIdsB: ["vip"],
        affiliateMembers: { vip: 1, foot: 2 },
      }),
    ).toEqual(["Casino VIP", "Pronos Foot"]);
  });

  it("précision : le ou les canaux en cause", () => {
    expect(affiliateWarningDetail([])).toBeNull();
    expect(affiliateWarningDetail(["Casino VIP"])).toBe(
      "« Casino VIP » compte des membres amenés par des affiliés Link Affi ; ce message sera publié par votre compte Telegram, sans boutons.",
    );
    expect(affiliateWarningDetail(["A", "B", "C"])).toMatch(/^« A », « B » et « C » comptent/);
  });
});
