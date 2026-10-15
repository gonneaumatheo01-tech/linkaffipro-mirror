/**
 * Phase 15 : liens d'invitation des sources d'une page d'atterrissage (Telegram simulé, sans base) — ordre des bots
 * (bot de l'univers du canal d'abord, puis repli), nom tronqué, refus expliqué en français, Telegram injoignable,
 * aucun doublon, révocation par le bot créateur.
 */
import { describe, expect, it } from "vitest";
import {
  ensureLandingLinks,
  landingLinkCandidates,
  landingLinkErrorText,
  revokeLandingLinks,
  type LandingLinkApi,
  type LandingLinkBot,
  type LandingLinkDeps,
  type LandingPageLinks,
  type LandingLinkToRevoke,
} from "./links";

const casino: LandingLinkBot = {
  botId: "b_casino",
  username: "casinobot",
  vertical: "CASINO",
  canInvite: true,
};
const sports: LandingLinkBot = {
  botId: "b_sports",
  username: "sportsbot",
  vertical: "SPORTS",
  canInvite: true,
};
const dating: LandingLinkBot = {
  botId: "b_dating",
  username: "datingbot",
  vertical: "DATING",
  canInvite: null,
};

describe("bots qui créent le lien d'une source", () => {
  it("bot de l'univers du canal d'abord, même s'il n'est pas le bot principal ; puis le bot principal, puis les autres", () => {
    const order = landingLinkCandidates({ vertical: "CASINO", primaryBotId: "b_sports" }, [
      sports,
      dating,
      casino,
    ]).map((b) => b.username);
    expect(order).toEqual(["casinobot", "sportsbot", "datingbot"]);
  });

  it("droit d'inviter refusé : essayé en dernier ; droit inconnu : après les droits connus", () => {
    const refused = { ...casino, canInvite: false };
    const unknown = { ...sports, botId: "b_sports2", username: "sports2", canInvite: null };
    const order = landingLinkCandidates({ vertical: "CASINO", primaryBotId: null }, [
      refused,
      unknown,
      sports,
    ]).map((b) => b.username);
    expect(order).toEqual(["sportsbot", "sports2", "casinobot"]);
  });

  it("canal sans univers : le bot principal (ou le premier administrateur) d'abord", () => {
    expect(
      landingLinkCandidates({ vertical: null, primaryBotId: "b_dating" }, [casino, dating]).map(
        (b) => b.username,
      ),
    ).toEqual(["datingbot", "casinobot"]);
    expect(
      landingLinkCandidates({ vertical: null, primaryBotId: null }, [sports, casino]).map(
        (b) => b.username,
      ),
    ).toEqual(["sportsbot", "casinobot"]);
  });
});

describe("refus de Telegram en français", () => {
  it("droits, jeton refusé, Telegram injoignable", () => {
    expect(
      landingLinkErrorText(
        { error_code: 400, description: "Bad Request: not enough rights" },
        "casinobot",
        "Casino VIP",
      ),
    ).toBe(
      "Telegram refuse que @casinobot crée le lien dans « Casino VIP ». Ajoutez @casinobot comme administrateur de « Casino VIP » avec le droit « Inviter via un lien ». Nouvel essai automatique dans quelques minutes.",
    );
    expect(
      landingLinkErrorText({ error_code: 401, description: "Unauthorized" }, "casinobot", "X"),
    ).toContain("n'est plus reconnu par Telegram");
    expect(
      landingLinkErrorText(
        { error_code: 429, description: "Too Many Requests: retry after 5" },
        "casinobot",
        "X",
      ),
    ).toBe(
      "Telegram ne répond pas pour l'instant : nouvel essai automatique dans quelques minutes.",
    );
  });
});

type Saved = {
  sourceId: string;
  botId: string;
  url: string;
  name: string;
  /** Pub figée sur le lien (celle de la source au moment de l'enregistrement, comme `saveLink` en base). */
  adId: string | null;
};

function world(
  opts: {
    sources?: LandingPageLinks["sources"];
    admins?: LandingLinkBot[];
    vertical?: string | null;
    primaryBotId?: string | null;
    pageName?: string;
    /** Réponse forcée d'un bot à createChatInviteLink. */
    fail?: Record<string, { error_code: number; description: string }>;
    /** saveLink perd la course pour ces sources (lien déjà posé par un autre passage). */
    lose?: Set<string>;
  } = {},
) {
  const calls: Array<{ bot: string; method: string; args: unknown[] }> = [];
  const saved: Saved[] = [];
  const errors: Record<string, string | null> = {};
  const published: unknown[] = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const inactive: string[] = [];
  const tried: string[][] = [];
  let n = 0;
  const page: LandingPageLinks = {
    id: "p1",
    name: opts.pageName ?? "Promo",
    language: "fr",
    channel: {
      id: "c1",
      title: "Casino VIP",
      telegramChatId: -1001n,
      vertical: opts.vertical === undefined ? "CASINO" : opts.vertical,
      primaryBotId: opts.primaryBotId ?? null,
    },
    sources: opts.sources ?? [
      {
        id: "s0",
        key: "",
        isActive: true,
        inviteLinkId: null,
        linkActive: false,
        linkError: null,
        adId: null,
        linkAdId: null,
      },
      {
        id: "s1",
        key: "tk01",
        isActive: true,
        inviteLinkId: null,
        linkActive: false,
        linkError: null,
        adId: "ad1",
        linkAdId: null,
      },
      {
        id: "s2",
        key: "exo1",
        isActive: true,
        inviteLinkId: null,
        linkActive: false,
        linkError: null,
        adId: null,
        linkAdId: null,
      },
    ],
  };
  const apiOf = (botId: string): LandingLinkApi => ({
    async createChatInviteLink(chatId, other) {
      calls.push({ bot: botId, method: "createChatInviteLink", args: [chatId, other] });
      const f = opts.fail?.[botId];
      if (f) throw Object.assign(new Error(f.description), f);
      return { invite_link: `https://t.me/+${botId}x${++n}` };
    },
    async revokeChatInviteLink(chatId, link) {
      calls.push({ bot: botId, method: "revokeChatInviteLink", args: [chatId, link] });
      return true;
    },
  });
  const deps: LandingLinkDeps = {
    loadPage: async (id) => (id === page.id ? page : null),
    adminBots: async () => opts.admins ?? [casino, sports],
    apiFor: async (botId) => apiOf(botId),
    saveLink: async (input) => {
      if (opts.lose?.has(input.sourceId))
        return {
          won: false,
          inviteLinkId: "l_other",
          url: "https://t.me/+autre",
          ownInviteLinkId: "l_mine",
        };
      const s = page.sources.find((x) => x.id === input.sourceId)!;
      saved.push({
        sourceId: input.sourceId,
        botId: input.botId,
        url: input.url,
        name: input.name,
        adId: s.adId,
      });
      const replaced = s.inviteLinkId && s.linkActive ? s.inviteLinkId : null;
      s.inviteLinkId = `l${saved.length}`;
      s.linkActive = true;
      s.linkAdId = s.adId;
      s.linkError = null;
      return {
        won: true,
        inviteLinkId: s.inviteLinkId,
        url: input.url,
        ownInviteLinkId: s.inviteLinkId,
        replacedInviteLinkId: replaced,
      };
    },
    setLinkError: async (sourceId, error) => {
      errors[sourceId] = error;
      const s = page.sources.find((x) => x.id === sourceId);
      if (s) s.linkError = error;
    },
    markLinkInactive: async (id) => {
      inactive.push(id);
    },
    markTried: async (ids) => {
      tried.push([...ids]);
    },
    publishInvalidate: async (msg) => {
      published.push(msg);
      return true;
    },
    recordEvent: async (e) => {
      events.push({ type: e.type, payload: e.payload });
    },
    warn: () => undefined,
  };
  return { deps, page, calls, saved, errors, published, events, inactive, tried };
}

describe("création des liens des sources", () => {
  it("une page, 3 sources → 3 liens avec demande d'adhésion, par le bot de l'univers, nommés « <page>-<source> »", async () => {
    const w = world({ pageName: "Promo Casino Bonus Été 2026 ultra longue" });
    const report = await ensureLandingLinks(w.deps, "p1");
    expect(report.created).toBe(3);
    expect(report.failed).toBe(0);
    expect(w.calls.map((c) => [c.bot, c.args[0], c.args[1]])).toEqual([
      ["b_casino", -1001, { name: "Promo Casino Bonus Été 2026 ultr", creates_join_request: true }],
      ["b_casino", -1001, { name: "Promo Casino Bonus Été 2026-tk01", creates_join_request: true }],
      ["b_casino", -1001, { name: "Promo Casino Bonus Été 2026-exo1", creates_join_request: true }],
    ]);
    for (const c of w.calls)
      expect(Array.from((c.args[1] as { name: string }).name).length).toBeLessThanOrEqual(32);
    // Pub reliée à la source figée sur son lien (D9).
    expect(w.saved.map((s) => s.adId)).toEqual([null, "ad1", null]);
    // Les trois sources comptent comme essayées (reprise du worker : chacune à son tour).
    expect(w.tried).toEqual([["s0", "s1", "s2"]]);
    // Le HTML de la page change (nouveau lien du bouton) : une invalidation.
    expect(w.published).toEqual([{ pageId: "p1" }]);
    expect(w.events.map((e) => e.type)).toEqual([
      "invite_link.landing_created",
      "invite_link.landing_created",
      "invite_link.landing_created",
    ]);
  });

  it("relancé : aucun nouveau lien, aucun appel à Telegram, aucune invalidation", async () => {
    const w = world();
    await ensureLandingLinks(w.deps, "p1");
    const before = w.calls.length;
    const again = await ensureLandingLinks(w.deps, "p1");
    expect(w.calls.length).toBe(before);
    expect(again.created).toBe(0);
    expect(again.sources.every((s) => s.status === "ok")).toBe(true);
    expect(w.published).toHaveLength(1);
    // Rien en attente : aucune source marquée comme essayée.
    expect(w.tried).toHaveLength(1);
  });

  it("pub de la source changée : un nouveau lien pour la nouvelle pub remplace l'ancien (qui garde la sienne)", async () => {
    const w = world({
      sources: [
        {
          id: "s1",
          key: "tk01",
          isActive: true,
          inviteLinkId: "l_x",
          linkActive: true,
          linkError: null,
          // Lien créé pour la pub X ; la source est maintenant reliée à la pub Y.
          adId: "adY",
          linkAdId: "adX",
        },
        {
          id: "s2",
          key: "tk02",
          isActive: true,
          inviteLinkId: "l_z",
          linkActive: true,
          linkError: null,
          // Pub retirée de la source : un nouveau lien sans pub.
          adId: null,
          linkAdId: "adZ",
        },
        {
          id: "s3",
          key: "tk03",
          isActive: true,
          inviteLinkId: "l_ok",
          linkActive: true,
          linkError: null,
          adId: "adW",
          linkAdId: "adW",
        },
      ],
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r).toMatchObject({ created: 2, replaced: 2, failed: 0 });
    expect(w.saved.map((s) => [s.sourceId, s.adId])).toEqual([
      ["s1", "adY"],
      ["s2", null],
    ]);
    expect(
      r.sources.map((s) => [s.key, s.status, s.status === "ok" && s.replaced === true]),
    ).toEqual([
      ["tk01", "ok", true],
      ["tk02", "ok", true],
      ["tk03", "ok", false],
    ]);
    expect(w.events.map((e) => e.payload)).toEqual([
      expect.objectContaining({ sourceKey: "tk01", adId: "adY", replacedInviteLinkId: "l_x" }),
      expect.objectContaining({ sourceKey: "tk02", adId: null, replacedInviteLinkId: "l_z" }),
    ]);
    // Le bouton change de lien : la page est invalidée ; l'ancien lien n'est pas révoqué ici (liens détachés ensuite).
    expect(w.published).toEqual([{ pageId: "p1" }]);
    expect(w.calls.map((c) => c.method)).toEqual(["createChatInviteLink", "createChatInviteLink"]);
    // Relancé : la pub du lien est celle de la source, plus rien à faire.
    expect((await ensureLandingLinks(w.deps, "p1")).created).toBe(0);
  });

  it("lien de la source bon : un ancien refus gardé sur la source est effacé", async () => {
    const w = world({
      sources: [
        {
          id: "s1",
          key: "tk01",
          isActive: true,
          inviteLinkId: "l1",
          linkActive: true,
          linkError: "Telegram refuse que @casinobot crée le lien…",
          adId: "ad1",
          linkAdId: "ad1",
        },
      ],
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(0);
    expect(w.errors).toEqual({ s1: null });
    expect(w.calls).toEqual([]);
  });

  it("source retirée ou désactivée : pas de lien créé", async () => {
    const w = world({
      sources: [
        {
          id: "s1",
          key: "tk01",
          isActive: false,
          inviteLinkId: null,
          linkActive: false,
          linkError: null,
          adId: null,
          linkAdId: null,
        },
      ],
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(0);
    expect(w.calls).toEqual([]);
  });

  it("lien actuel révoqué (source réactivée) : un nouveau lien", async () => {
    const w = world({
      sources: [
        {
          id: "s1",
          key: "tk01",
          isActive: true,
          inviteLinkId: "l_old",
          linkActive: false,
          linkError: null,
          adId: null,
          linkAdId: null,
        },
      ],
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(1);
  });

  it("le bot de l'univers est refusé : repli sur un autre de nos bots administrateurs", async () => {
    const w = world({
      fail: { b_casino: { error_code: 400, description: "Bad Request: not enough rights" } },
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(3);
    expect(w.saved.every((s) => s.botId === "b_sports")).toBe(true);
    expect(w.calls.filter((c) => c.bot === "b_casino")).toHaveLength(3);
  });

  it("tous nos bots refusés : refus en français gardé sur la source (texte du premier bot), aucune invalidation", async () => {
    const refused = { error_code: 400, description: "Bad Request: not enough rights" };
    const w = world({ fail: { b_casino: refused, b_sports: refused } });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(0);
    expect(r.failed).toBe(3);
    expect(w.errors.s1).toBe(landingLinkErrorText(refused, "casinobot", "Casino VIP"));
    expect(w.published).toEqual([]);
    expect(w.events.map((e) => e.type)).toEqual([
      "invite_link.landing_failed",
      "invite_link.landing_failed",
      "invite_link.landing_failed",
    ]);
    // Même refus au passage suivant : rien de neuf dans le journal.
    await ensureLandingLinks(w.deps, "p1");
    expect(w.events).toHaveLength(3);
  });

  it("Telegram injoignable (429) : on s'arrête tout de suite, les sources gardent « nouvel essai automatique »", async () => {
    const w = world({
      fail: { b_casino: { error_code: 429, description: "Too Many Requests: retry after 30" } },
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(w.calls).toHaveLength(1);
    expect(r.failed).toBe(3);
    expect(r.sources.every((s) => s.status === "error" && s.transient)).toBe(true);
    expect(w.errors.s2).toContain("nouvel essai automatique");
  });

  it("bot de l'univers refusé puis bot de repli surchargé (429) : le vrai refus reste affiché, la reprise continue", async () => {
    const refused = { error_code: 400, description: "Bad Request: not enough rights" };
    const w = world({
      fail: {
        b_casino: refused,
        b_sports: { error_code: 429, description: "Too Many Requests: retry after 30" },
      },
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.failed).toBe(3);
    // La consigne utile (« Ajoutez @casinobot… ») et non « Telegram ne répond pas » ; pas une panne générale.
    expect(w.errors.s0).toBe(landingLinkErrorText(refused, "casinobot", "Casino VIP"));
    expect(r.sources.every((s) => s.status === "error" && !s.transient)).toBe(true);
    // Chaque source est essayée (pas d'arrêt de toute la page sur le 429 d'un bot de repli).
    expect(w.calls.filter((c) => c.bot === "b_casino")).toHaveLength(3);
  });

  it("aucun de nos bots administrateur : explication en français, aucun appel", async () => {
    const w = world({ admins: [] });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(w.calls).toEqual([]);
    expect(r.failed).toBe(3);
    expect(w.errors.s0).toContain("Aucun de nos bots n'est administrateur de « Casino VIP »");
  });

  it("un autre passage a posé le lien entre-temps : notre lien en trop est révoqué chez Telegram", async () => {
    const w = world({
      sources: [
        {
          id: "s1",
          key: "tk01",
          isActive: true,
          inviteLinkId: null,
          linkActive: false,
          linkError: null,
          adId: null,
          linkAdId: null,
        },
      ],
      lose: new Set(["s1"]),
    });
    const r = await ensureLandingLinks(w.deps, "p1");
    expect(r.created).toBe(0);
    expect(r.sources[0]).toMatchObject({ status: "ok", url: "https://t.me/+autre" });
    expect(w.calls.map((c) => c.method)).toEqual(["createChatInviteLink", "revokeChatInviteLink"]);
    expect(w.inactive).toEqual(["l_mine"]);
  });

  it("page inconnue : rien", async () => {
    const w = world();
    expect((await ensureLandingLinks(w.deps, "nope")).found).toBe(false);
  });
});

describe("révocation des liens (source retirée, page supprimée)", () => {
  const link = (over: Partial<LandingLinkToRevoke> = {}): LandingLinkToRevoke => ({
    id: "l1",
    channelId: "c1",
    telegramChatId: -1001n,
    telegramInviteLink: "https://t.me/+abc",
    botId: "b_casino",
    botUsername: "casinobot",
    botActive: true,
    landingPageId: "p1",
    landingSource: "tk01",
    ...over,
  });

  function revokeWorld(errs: Record<string, unknown> = {}) {
    const calls: Array<[string, unknown, unknown]> = [];
    const inactive: Array<[string, string | null]> = [];
    const events: string[] = [];
    const deps = {
      apiFor: async (botId: string): Promise<LandingLinkApi> => ({
        createChatInviteLink: async () => ({ invite_link: "x" }),
        async revokeChatInviteLink(chatId, url) {
          calls.push([botId, chatId, url]);
          const e = errs[url];
          if (e) throw e;
          return true;
        },
      }),
      markLinkInactive: async (id: string, error: string | null) => {
        inactive.push([id, error]);
      },
      recordEvent: async (e: { type: string }) => {
        events.push(e.type);
      },
      warn: () => undefined,
    };
    return { deps, calls, inactive, events };
  }

  it("révoqué par le bot qui l'a créé, puis inactif ici", async () => {
    const w = revokeWorld();
    const r = await revokeLandingLinks(w.deps, [link()]);
    expect(w.calls).toEqual([["b_casino", -1001, "https://t.me/+abc"]]);
    expect(w.inactive).toEqual([["l1", null]]);
    expect(r).toMatchObject({ revoked: 1, disabledOnly: 0, retryLater: 0 });
    expect(w.events).toEqual(["invite_link.landing_revoked"]);
  });

  it("lien déjà retiré chez Telegram : acquis ; bot désactivé : inactif ici sans appel ; Telegram injoignable : plus tard", async () => {
    const w = revokeWorld({
      "https://t.me/+gone": { error_code: 400, description: "Bad Request: INVITE_HASH_EXPIRED" },
      "https://t.me/+down": { error_code: 502, description: "Bad Gateway" },
    });
    const r = await revokeLandingLinks(w.deps, [
      link({ id: "l_gone", telegramInviteLink: "https://t.me/+gone" }),
      link({ id: "l_off", botActive: false }),
      link({ id: "l_down", telegramInviteLink: "https://t.me/+down" }),
    ]);
    expect(r).toMatchObject({ revoked: 1, disabledOnly: 1, retryLater: 1 });
    expect(w.inactive.map(([id]) => id)).toEqual(["l_gone", "l_off"]);
    expect(w.calls.map(([, , url]) => url)).toEqual(["https://t.me/+gone", "https://t.me/+down"]);
  });
});
