import { describe, expect, it } from "vitest";
import type { ChannelInfo } from "./deps";
import {
  checkCandidates,
  checkGateMembership,
  gateButtonsOf,
  gateProblemsOf,
  inviteCandidates,
  resolveGateLink,
  resolveGateLinks,
  telegramErrorText,
  type GateBot,
  type GateLinkApi,
  type GateLinkDeps,
} from "./gate-links";
import { canInviteFromRights } from "./prisma-gate-links";

const gate: ChannelInfo = {
  id: "g1",
  title: "Canal à rejoindre",
  username: null,
  language: "fr",
  telegramChatId: -100777n,
  primaryBotId: null,
  isActive: true,
};

function api(ok: boolean, calls: string[], name: string): GateLinkApi {
  return {
    async createChatInviteLink(chatId) {
      calls.push(`${name} ${chatId}`);
      if (!ok)
        throw Object.assign(new Error("refus"), {
          error_code: 400,
          description: "Bad Request: CHAT_ADMIN_REQUIRED",
        });
      return { invite_link: `https://t.me/+${name}` };
    },
    async getChatMember() {
      if (!ok) throw new Error("Forbidden");
      return { status: "member" };
    },
  };
}

function deps(
  admins: GateBot[],
  apis: Record<string, GateLinkApi>,
): GateLinkDeps & {
  saved: Array<{ botId: string; url: string }>;
  warnings: Array<Record<string, unknown>>;
} {
  const saved: Array<{ botId: string; url: string }> = [];
  const warnings: Array<Record<string, unknown>> = [];
  return {
    saved,
    warnings,
    findGateLink: async () => null,
    saveGateLink: async ({ botId, url }) => {
      saved.push({ botId, url });
    },
    adminBots: async () => admins,
    apiFor: async (id) => apis[id] ?? null,
    warn: (_m, d) => {
      warnings.push(d);
    },
  };
}

describe("ordre des bots essayés", () => {
  const admins: GateBot[] = [
    { botId: "b_inconnu", username: "inconnu", canInvite: null },
    { botId: "b_refus", username: "refus", canInvite: false },
    { botId: "b_ok", username: "ok", canInvite: true },
  ];

  it("lien : le bot de la demande d'abord, puis le droit d'inviter, puis le droit inconnu ; jamais le droit refusé", () => {
    expect(inviteCandidates({ botId: "src", username: "src" }, admins).map((b) => b.botId)).toEqual(
      ["src", "b_ok", "b_inconnu"],
    );
    // Le bot de la demande n'est pas répété s'il est aussi administrateur.
    expect(inviteCandidates({ botId: "b_ok", username: "ok" }, admins).map((b) => b.botId)).toEqual(
      ["b_ok", "b_inconnu"],
    );
    expect(inviteCandidates(null, []).length).toBe(0);
  });

  it("vérification : nos administrateurs d'abord (le droit d'inviter n'est pas nécessaire), le bot de la demande ensuite", () => {
    // Un bot non administrateur peut répondre « left » sans pouvoir lire la liste des membres : il passe en dernier.
    expect(checkCandidates({ botId: "src", username: "src" }, admins).map((b) => b.botId)).toEqual([
      "b_inconnu",
      "b_refus",
      "b_ok",
      "src",
    ]);
    // Le bot de la demande, s'il est administrateur, passe en premier (son API est déjà ouverte).
    expect(checkCandidates({ botId: "b_ok", username: "ok" }, admins).map((b) => b.botId)).toEqual([
      "b_ok",
      "b_inconnu",
      "b_refus",
    ]);
  });
});

describe("resolveGateLink", () => {
  it("échec du premier bot journalisé avec l'erreur exacte, lien créé et mémorisé par le suivant", async () => {
    const calls: string[] = [];
    const d = deps([{ botId: "b2", username: "deux", canInvite: true }], {
      b2: api(true, calls, "deux"),
    });
    const r = await resolveGateLink(d, { id: "src", title: "Source" }, gate, {
      botId: "b1",
      username: "un",
      api: api(false, calls, "un"),
    });
    expect(r).toEqual({
      button: { channelId: "g1", title: gate.title, url: "https://t.me/+deux" },
    });
    expect(calls).toEqual(["un -100777", "deux -100777"]);
    expect(d.saved).toEqual([{ botId: "b2", url: "https://t.me/+deux" }]);
    expect(d.warnings[0]).toMatchObject({
      bot: "un",
      error: "400 Bad Request: CHAT_ADMIN_REQUIRED",
    });
  });

  it("aucun bot ne peut : problème avec les bots essayés, les erreurs et le bot à ajouter", async () => {
    const calls: string[] = [];
    const d = deps([], {});
    const r = await resolveGateLink(d, { id: "src", title: "Source" }, gate, {
      botId: "b1",
      username: "un",
      api: api(false, calls, "un"),
    });
    expect(r).toEqual({
      problem: {
        channelId: "g1",
        title: gate.title,
        error: "@un : 400 Bad Request: CHAT_ADMIN_REQUIRED",
        tried: ["@un"],
        suggestedBot: "un",
      },
    });
  });

  it("aucun bot du tout : explication en clair", async () => {
    const r = await resolveGateLink(deps([], {}), { id: "src", title: "Source" }, gate, null);
    expect(r).toMatchObject({
      problem: {
        error: "aucun de nos bots n'est administrateur de ce canal avec le droit d'inviter",
        tried: [],
      },
    });
  });
});

describe("checkGateMembership", () => {
  it("aucun bot ne peut vérifier : compté comme non rejoint (jamais d'acceptation sans vérification)", async () => {
    const r = await checkGateMembership(deps([], {}), [gate], 42, {
      botId: "b1",
      username: "un",
      api: api(false, [], "un"),
    });
    expect(r.missing.map((c) => c.id)).toEqual(["g1"]);
    expect(r.unverified[0]).toMatchObject({
      channelId: "g1",
      error: "@un : Forbidden",
      tried: ["@un"],
    });
  });

  it("le bot de la demande (non administrateur) répond « left », le bot administrateur « member » : le membre a rejoint", async () => {
    const calls: string[] = [];
    const statusApi = (name: string, status: string): GateLinkApi => ({
      async createChatInviteLink() {
        throw new Error("inutile");
      },
      async getChatMember(chatId) {
        calls.push(`${name} ${chatId}`);
        return { status };
      },
    });
    const d = deps([{ botId: "b_casino", username: "casino", canInvite: true }], {
      b_casino: statusApi("casino", "member"),
    });
    const r = await checkGateMembership(d, [gate], 42, {
      botId: "b_source",
      username: "source",
      api: statusApi("source", "left"),
    });
    expect(r).toEqual({ missing: [], unverified: [] });
    expect(calls).toEqual(["casino -100777"]);
  });

  it("un bot impossible à ouvrir (jeton illisible) : erreur notée, le bot suivant vérifie", async () => {
    const d = deps(
      [
        { botId: "b_casse", username: "casse", canInvite: true },
        { botId: "b_ok", username: "ok", canInvite: true },
      ],
      { b_ok: api(true, [], "ok") },
    );
    d.apiFor = async (id) => {
      if (id === "b_casse") throw new Error("Unsupported state or unable to authenticate data");
      return id === "b_ok" ? api(true, [], "ok") : null;
    };
    expect(await checkGateMembership(d, [gate], 42, null)).toEqual({ missing: [], unverified: [] });
    d.apiFor = async () => {
      throw new Error("base injoignable");
    };
    const r = await checkGateMembership(d, [gate], 42, null);
    expect(r.unverified[0]!.error).toBe(
      "@casse : bot impossible à ouvrir (base injoignable) ; @ok : bot impossible à ouvrir (base injoignable)",
    );
  });
});

describe("un bot impossible à ouvrir ne bloque jamais la demande", () => {
  it("lien : erreur « bot impossible à ouvrir » notée, le bot suivant crée le lien", async () => {
    const calls: string[] = [];
    const d = deps(
      [
        { botId: "b_casse", username: "casse", canInvite: true },
        { botId: "b_ok", username: "ok", canInvite: true },
      ],
      {},
    );
    d.apiFor = async (id) => {
      if (id === "b_casse") throw new Error("Unsupported state or unable to authenticate data");
      return api(true, calls, "ok");
    };
    const r = await resolveGateLink(d, { id: "src", title: "Source" }, gate, null);
    expect(r).toEqual({
      button: { channelId: "g1", title: gate.title, url: "https://t.me/+ok" },
    });
    expect(d.warnings[0]).toMatchObject({
      bot: "casse",
      error: "bot impossible à ouvrir (Unsupported state or unable to authenticate data)",
    });
  });

  it("une erreur inattendue sur un canal (base, Telegram) devient un problème de ce canal, les autres continuent", async () => {
    const other: ChannelInfo = { ...gate, id: "g2", title: "Autre", telegramChatId: -100888n };
    const d = deps([{ botId: "b_ok", username: "ok", canInvite: true }], {
      b_ok: api(true, [], "ok"),
    });
    d.adminBots = async (id) => {
      if (id === "g1") throw new Error("connexion à la base perdue");
      return [{ botId: "b_ok", username: "ok", canInvite: true }];
    };
    const r = await resolveGateLinks(d, { id: "src", title: "Source" }, [gate, other], {
      botId: "b_src",
      username: "src",
      api: api(false, [], "src"),
    });
    expect(r.gates.map((g) => g.channelId)).toEqual(["g2"]);
    expect(r.missing).toEqual([
      {
        channelId: "g1",
        title: gate.title,
        error: "erreur inattendue : connexion à la base perdue",
        tried: [],
        suggestedBot: "src",
      },
    ]);
  });
});

describe("lectures prudentes", () => {
  it("telegramErrorText : code et description de Telegram, sinon le message", () => {
    expect(telegramErrorText({ error_code: 403, description: "Forbidden: bot was kicked" })).toBe(
      "403 Forbidden: bot was kicked",
    );
    expect(telegramErrorText(new Error("réseau"))).toBe("réseau");
    expect(telegramErrorText("x")).toBe("x");
  });

  it("source d'une demande : boutons et problèmes relus sans planter", () => {
    expect(gateButtonsOf({ gates: [{ channelId: "a", title: "A", url: "u" }, null, 3] })).toEqual([
      { channelId: "a", title: "A", url: "u" },
    ]);
    expect(gateButtonsOf({})).toEqual([]);
    expect(
      gateProblemsOf({ gateLinksMissing: [{ channelId: "a", title: "A", error: "e" }, "x"] }),
    ).toEqual([{ channelId: "a", title: "A", error: "e", tried: [], suggestedBot: null }]);
    expect(gateProblemsOf({ gateLinksMissing: "x" })).toEqual([]);
  });

  it("droit d'inviter d'après les droits enregistrés", () => {
    expect(canInviteFromRights({ status: "creator" })).toBe(true);
    expect(canInviteFromRights({ status: "administrator", can_invite_users: true })).toBe(true);
    expect(canInviteFromRights({ status: "administrator", can_invite_users: false })).toBe(false);
    expect(canInviteFromRights({ status: "administrator" })).toBeNull();
    expect(canInviteFromRights(null)).toBeNull();
  });
});
