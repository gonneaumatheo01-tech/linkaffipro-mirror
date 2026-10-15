import { describe, expect, it } from "vitest";
import {
  alignGate,
  gateCheckFlash,
  gateLinkRows,
  gateLinksSummary,
  type GateCheckResult,
} from "./gate-links";

describe("alignGate : l'exigence suit toujours les canaux choisis", () => {
  it("aucun canal → aucune exigence", () => {
    expect(alignGate("REQUIRED", [], "src")).toEqual({ gateMode: "NONE", gateChannelIds: [] });
    // Le canal lui-même ne compte pas.
    expect(alignGate("SOFT", ["src"], "src")).toEqual({ gateMode: "NONE", gateChannelIds: [] });
  });
  it("des canaux sans exigence (ancien bug des trois choix) → obligatoires", () => {
    expect(alignGate("NONE", ["a", "b"], "src")).toEqual({
      gateMode: "REQUIRED",
      gateChannelIds: ["a", "b"],
    });
  });
  it("obligatoires ou proposés : le réglage est gardé, doublons retirés", () => {
    expect(alignGate("SOFT", ["a", "a", "src", "b"], "src")).toEqual({
      gateMode: "SOFT",
      gateChannelIds: ["a", "b"],
    });
    expect(alignGate("REQUIRED", ["a"], "src").gateMode).toBe("REQUIRED");
  });
});

const base = {
  gateMode: "REQUIRED" as const,
  solutionBot: "womendatingoobot",
  channels: [
    { id: "roulette", title: "LA ZONE ROULETTE 🎰", username: null },
    { id: "tir", title: "🎯 TIR CADRÉ ⚡", username: null },
  ],
};

describe("gateLinkRows : état de chaque canal à rejoindre dans l'éditeur", () => {
  it("lien prêt (créé par un autre de nos bots) : OK", () => {
    const rows = gateLinkRows({
      ...base,
      links: { roulette: "casinogamblingoobot", tir: "sportbettingoobot" },
      admins: {
        roulette: [{ username: "casinogamblingoobot", canInvite: true }],
        tir: [{ username: "sportbettingoobot", canInvite: true }],
      },
      lastCheck: null,
    });
    expect(rows.map((r) => r.state)).toEqual(["ok", "ok"]);
    expect(rows[0]!.text).toBe("Prêt : le lien est créé par @casinogamblingoobot.");
    expect(gateLinksSummary(rows)).toEqual({
      ok: true,
      text: "Tout est prêt : le bot envoie un bouton par canal et « ✅ J'ai rejoint ».",
    });
    expect(gateLinksSummary(rows, "REQUIRED").text).toBe(
      "Tout est prêt : le bot envoie un bouton par canal et « ✅ J'ai rejoint ».",
    );
  });

  it("canaux « Proposés » : tout est prêt, sans promettre « ✅ J'ai rejoint » (le bot ne l'envoie pas)", () => {
    const rows = gateLinkRows({
      ...base,
      gateMode: "SOFT",
      links: { roulette: "casinogamblingoobot", tir: "sportbettingoobot" },
      admins: {},
      lastCheck: null,
    });
    expect(gateLinksSummary(rows, "SOFT")).toEqual({
      ok: true,
      text: "Tout est prêt : le bot envoie un bouton par canal.",
    });
    // Un problème reste signalé de la même façon.
    const bad = gateLinkRows({ ...base, gateMode: "SOFT", links: {}, admins: {}, lastCheck: null });
    expect(gateLinksSummary(bad, "SOFT").ok).toBe(false);
  });

  it("aucun bot administrateur : le canal en cause et la solution en français clair", () => {
    const rows = gateLinkRows({ ...base, links: {}, admins: {}, lastCheck: null });
    expect(rows[0]).toEqual({
      channelId: "roulette",
      title: "LA ZONE ROULETTE 🎰",
      state: "problem",
      text: "Le bot ne peut pas créer de lien vers ce canal.",
      solution:
        "Ajoutez @womendatingoobot comme administrateur de « LA ZONE ROULETTE 🎰 » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    });
    expect(gateLinksSummary(rows)).toEqual({
      ok: false,
      text: "2 canaux posent problème : les personnes ne recevront pas leur lien.",
    });
  });

  it("dernière vérification refusée par Telegram : problème, même si la base croit le bot administrateur", () => {
    const lastCheck: GateCheckResult[] = [
      {
        channelId: "roulette",
        title: "LA ZONE ROULETTE 🎰",
        status: "no_link",
        tried: ["@womendatingoobot", "@casinogamblingoobot"],
      },
    ];
    const rows = gateLinkRows({
      ...base,
      links: { tir: "sportbettingoobot" },
      admins: {
        roulette: [{ username: "casinogamblingoobot", canInvite: true }],
        tir: [{ username: "sportbettingoobot", canInvite: true }],
      },
      lastCheck,
    });
    expect(rows[0]!.state).toBe("problem");
    expect(rows[0]!.text).toBe(
      "Telegram a refusé de créer le lien (essayé avec @womendatingoobot, @casinogamblingoobot).",
    );
    expect(rows[1]!.state).toBe("ok");
  });

  it("bot administrateur mais lien pas encore créé : à vérifier", () => {
    const rows = gateLinkRows({
      ...base,
      channels: [base.channels[0]!],
      links: {},
      admins: { roulette: [{ username: "casinogamblingoobot", canInvite: true }] },
      lastCheck: null,
    });
    expect(rows[0]).toMatchObject({
      state: "pending",
      text: "Lien pas encore créé : cliquez « Vérifier les liens ».",
    });
    expect(gateLinksSummary(rows).ok).toBe(false);
  });

  it("canal public sans bot : lien public, mais obligatoire = impossible à vérifier", () => {
    const pub = [{ id: "pub", title: "Canal public", username: "canalpublic" }];
    const required = gateLinkRows({
      ...base,
      channels: pub,
      links: {},
      admins: {},
      lastCheck: null,
    });
    expect(required[0]).toMatchObject({
      state: "problem",
      text: "Le lien public du canal est envoyé, mais le bot ne peut pas vérifier que la personne l'a rejoint.",
    });
    const soft = gateLinkRows({
      ...base,
      gateMode: "SOFT",
      channels: pub,
      links: {},
      admins: {},
      lastCheck: null,
    });
    expect(soft[0]).toMatchObject({
      state: "ok",
      text: "Prêt : le lien public du canal est envoyé.",
    });
  });

  it("canal source sans bot : la solution propose « un de nos bots »", () => {
    const rows = gateLinkRows({
      ...base,
      solutionBot: null,
      channels: [base.channels[0]!],
      links: {},
      admins: {},
      lastCheck: null,
    });
    expect(rows[0]!.solution).toBe(
      "Ajoutez un de nos bots comme administrateur de « LA ZONE ROULETTE 🎰 » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    );
  });
});

describe("gateCheckFlash : message après l'enregistrement ou « Vérifier les liens »", () => {
  it("tout est prêt", () => {
    expect(
      gateCheckFlash(
        [
          { channelId: "a", title: "A", status: "ok", tried: [] },
          { channelId: "b", title: "B", status: "public", tried: [] },
        ],
        "bot_x",
      ),
    ).toEqual({ ok: "Liens des canaux à rejoindre vérifiés : tout est prêt." });
  });
  it("un canal en cause : nom du canal et solution", () => {
    expect(
      gateCheckFlash(
        [
          { channelId: "a", title: "A", status: "ok", tried: [] },
          { channelId: "b", title: "B", status: "no_link", tried: ["@bot_x"] },
        ],
        "bot_x",
      ),
    ).toEqual({
      error:
        "Le bot ne peut pas créer le lien de « B » : ajoutez @bot_x comme administrateur de « B » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    });
    expect(
      gateCheckFlash([{ channelId: "c", title: "C", status: "cannot_verify", tried: [] }], null),
    ).toEqual({
      error:
        "Le bot ne peut pas vérifier que la personne a rejoint « C » : ajoutez un de nos bots comme administrateur de « C » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    });
  });
  it("aucun canal à rejoindre : rien à dire", () => {
    expect(gateCheckFlash([], "bot_x")).toEqual({});
  });
});
