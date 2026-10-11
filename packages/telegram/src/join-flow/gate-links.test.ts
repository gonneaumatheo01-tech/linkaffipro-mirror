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
  it("échec des premiers bots journalisé avec l'erreur exacte, lien créé et mémorisé par le suivant", async () => {
    const calls: string[] = [];
    // « deux » traite les demandes du canal à rejoindre (premier administrateur) : essayé d'abord, puis le bot de la
    // demande, puis les autres administrateurs.
    const d = deps(
      [
        { botId: "b2", username: "deux", canInvite: true },
        { botId: "b3", username: "trois", canInvite: true },
      ],
      { b2: api(false, calls, "deux"), b3: api(true, calls, "trois") },
    );
    const r = await resolveGateLink(d, { id: "src", title: "Source" }, gate, {
      botId: "b1",
      username: "un",
      api: api(false, calls, "un"),
    });
    expect(r).toEqual({
      button: { channelId: "g1", title: gate.title, url: "https://t.me/+trois" },
    });
    expect(calls).toEqual(["deux -100777", "un -100777", "trois -100777"]);
    expect(d.saved).toEqual([{ botId: "b3", url: "https://t.me/+trois" }]);
    expect(d.warnings.map((w) => [w.bot, w.error])).toEqual([
      ["deux", "400 Bad Request: CHAT_ADMIN_REQUIRED"],
      ["un", "400 Bad Request: CHAT_ADMIN_REQUIRED"],
    ]);
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

describe("phase 11 : liens avec demande d'adhésion, demande en attente comptée comme rejointe", () => {
  function recordingApi(
    calls: Array<{ method: string; chatId: number | string; other?: unknown }>,
  ) {
    return {
      async createChatInviteLink(
        chatId: number | string,
        other?: { name?: string; creates_join_request?: boolean },
      ) {
        calls.push({ method: "createChatInviteLink", chatId, other });
        return { invite_link: `https://t.me/+req${String(chatId).slice(-3)}` };
      },
      async getChatMember(chatId: number | string) {
        calls.push({ method: "getChatMember", chatId });
        // Telegram répond « left » tant qu'une demande d'adhésion attend.
        return { status: "left" };
      },
    } satisfies GateLinkApi;
  }

  it("nouveau lien d'un canal à rejoindre : créé AVEC demande d'adhésion, mémorisé comme tel, ancien lien à entrée directe ignoré", async () => {
    const calls: Array<{ method: string; chatId: number | string; other?: unknown }> = [];
    const asked: unknown[] = [];
    const saved: Array<{ createsJoinRequest: boolean }> = [];
    const d: GateLinkDeps = {
      findGateLink: async (_s, _g, opts) => {
        asked.push(opts);
        return null;
      },
      saveGateLink: async (input) => {
        saved.push({ createsJoinRequest: input.createsJoinRequest });
      },
      adminBots: async () => [],
      apiFor: async () => null,
      warn: () => undefined,
    };
    const r = await resolveGateLink(d, { id: "src", title: "Tir Cadré" }, gate, {
      botId: "b1",
      username: "un",
      api: recordingApi(calls),
    });
    expect(r).toEqual({
      button: { channelId: "g1", title: gate.title, url: "https://t.me/+req777" },
    });
    expect(asked).toEqual([{ createsJoinRequest: true }]);
    expect(calls[0]).toEqual({
      method: "createChatInviteLink",
      chatId: -100777,
      other: { name: "gate Tir Cadré", creates_join_request: true },
    });
    expect(saved).toEqual([{ createsJoinRequest: true }]);
  });

  it("canal à rejoindre désactivé chez nous : lien à entrée directe, comme avant (sa demande ne serait jamais traitée)", async () => {
    const calls: Array<{ method: string; chatId: number | string; other?: unknown }> = [];
    const asked: unknown[] = [];
    const saved: boolean[] = [];
    const d: GateLinkDeps = {
      findGateLink: async (_s, _g, opts) => (asked.push(opts), null),
      saveGateLink: async (input) => {
        saved.push(input.createsJoinRequest);
      },
      adminBots: async () => [],
      apiFor: async () => null,
      warn: () => undefined,
    };
    await resolveGateLink(
      d,
      { id: "src", title: "Source" },
      { ...gate, isActive: false },
      {
        botId: "b1",
        username: "un",
        api: recordingApi(calls),
      },
    );
    expect(asked).toEqual([{ createsJoinRequest: false }]);
    expect(calls[0]!.other).toMatchObject({ creates_join_request: false });
    expect(saved).toEqual([false]);
  });

  it("« ✅ J'ai rejoint » : une demande à nous en cours dans le canal obligatoire suffit, lue avant Telegram", async () => {
    const calls: Array<{ method: string; chatId: number | string }> = [];
    const other: ChannelInfo = { ...gate, id: "g2", title: "Autre", telegramChatId: -100888n };
    const lookups: Array<[string, string[]]> = [];
    const d: GateLinkDeps = {
      ...deps([], {}),
      requestedChannelIds: async (memberId, ids) => {
        lookups.push([memberId, ids]);
        return ["g1"];
      },
    };
    const first = { botId: "b1", username: "un", api: recordingApi(calls) };
    const r = await checkGateMembership(d, [gate, other], 42, first, { memberId: "m42" });
    expect(lookups).toEqual([["m42", ["g1", "g2"]]]);
    // g1 : demande en attente (Telegram dirait « left ») → satisfait sans appel ; g2 : vérifié, pas rejoint.
    expect(r.requested).toEqual(["g1"]);
    expect(r.missing.map((c) => c.id)).toEqual(["g2"]);
    expect(calls.filter((c) => c.method === "getChatMember").map((c) => c.chatId)).toEqual([
      -100888,
    ]);
  });

  it("sans membre connu, ou sans canal à vérifier : nos demandes ne sont pas consultées", async () => {
    let asked = 0;
    const d: GateLinkDeps = {
      ...deps([], {}),
      requestedChannelIds: async () => (asked++, ["g1"]),
    };
    const first = { botId: "b1", username: "un", api: recordingApi([]) };
    const r = await checkGateMembership(d, [gate], 42, first);
    expect(r.missing.map((c) => c.id)).toEqual(["g1"]);
    await checkGateMembership(d, [], 42, first, { memberId: "m42" });
    expect(asked).toBe(0);
  });
});

describe("lien avec demande d'adhésion : créé par le bot qui traite les demandes du canal à rejoindre", () => {
  // Telegram masque la fin d'un lien créé par un AUTRE administrateur (« https://t.me/+AbCd… ») : le bot qui reçoit
  // la demande ne retrouverait pas le lien, la provenance serait perdue (règle par défaut au lieu de l'exception).
  const roulette: ChannelInfo = { ...gate, primaryBotId: "b_casino" };
  const dating: GateBot = { botId: "b_dating", username: "dating", canInvite: true };
  const casino: GateBot = { botId: "b_casino", username: "casino", canInvite: true };

  function world(found: Record<string, string> = {}) {
    const calls: string[] = [];
    const asked: unknown[] = [];
    const d = deps([dating, casino], {
      b_dating: api(true, calls, "dating"),
      b_casino: api(true, calls, "casino"),
    });
    // Lien existant par bot créateur (« * » : n'importe lequel de nos bots).
    d.findGateLink = async (_s, _g, opts) => {
      asked.push(opts);
      return found[opts?.botId ?? "*"] ?? null;
    };
    const first = { botId: "b_dating", username: "dating", api: api(true, calls, "dating") };
    return { d, calls, asked, first };
  }

  it("le bot principal du canal à rejoindre crée le lien, même si le bot de la demande en est aussi administrateur", async () => {
    const { d, calls, asked, first } = world();
    const r = await resolveGateLink(d, { id: "src", title: "Zone" }, roulette, first);
    expect(r).toEqual({
      button: { channelId: "g1", title: gate.title, url: "https://t.me/+casino" },
    });
    expect(calls).toEqual(["casino -100777"]);
    expect(d.saved).toEqual([{ botId: "b_casino", url: "https://t.me/+casino" }]);
    expect(asked).toEqual([{ createsJoinRequest: true, botId: "b_casino" }]);
  });

  it("sans bot principal administrateur : le premier de nos bots administrateurs (même règle que le bot qui agit)", async () => {
    const { d, calls, first } = world();
    await resolveGateLink(
      d,
      { id: "src", title: "Zone" },
      { ...gate, primaryBotId: "b_autre" },
      first,
    );
    expect(calls).toEqual(["dating -100777"]);
    expect(d.saved).toEqual([{ botId: "b_dating", url: "https://t.me/+dating" }]);
  });

  it("lien existant d'un autre de nos bots : pas réutilisé, un lien du bot du canal le remplace ; le sien est réutilisé", async () => {
    const other = world({ "*": "https://t.me/+ancienDating" });
    await resolveGateLink(other.d, { id: "src", title: "Zone" }, roulette, other.first);
    expect(other.calls).toEqual(["casino -100777"]);
    const own = world({ b_casino: "https://t.me/+casinoExistant" });
    const r = await resolveGateLink(own.d, { id: "src", title: "Zone" }, roulette, own.first);
    expect(r).toMatchObject({ button: { url: "https://t.me/+casinoExistant" } });
    expect(own.calls).toEqual([]);
  });

  it("le bot du canal n'y arrive pas : un lien existant de n'importe lequel de nos bots sert, sinon un autre bot le crée", async () => {
    const reuse = world({ "*": "https://t.me/+existant" });
    reuse.d.apiFor = async (id) => (id === "b_casino" ? api(false, reuse.calls, "casino") : null);
    const r = await resolveGateLink(reuse.d, { id: "src", title: "Zone" }, roulette, reuse.first);
    expect(r).toMatchObject({ button: { url: "https://t.me/+existant" } });
    expect(reuse.calls).toEqual(["casino -100777"]);
    expect(reuse.asked).toEqual([
      { createsJoinRequest: true, botId: "b_casino" },
      { createsJoinRequest: true },
    ]);

    const create = world();
    create.d.apiFor = async (id) => (id === "b_casino" ? api(false, create.calls, "casino") : null);
    const r2 = await resolveGateLink(
      create.d,
      { id: "src", title: "Zone" },
      roulette,
      create.first,
    );
    expect(r2).toMatchObject({ button: { url: "https://t.me/+dating" } });
    expect(create.calls).toEqual(["casino -100777", "dating -100777"]);
  });

  it("bot du canal sans le droit d'inviter : ni attendu ni essayé, n'importe quel lien existant sert", async () => {
    const { d, calls, asked, first } = world({ "*": "https://t.me/+existant" });
    d.adminBots = async () => [dating, { ...casino, canInvite: false }];
    const r = await resolveGateLink(d, { id: "src", title: "Zone" }, roulette, first);
    expect(r).toMatchObject({ button: { url: "https://t.me/+existant" } });
    expect(asked).toEqual([{ createsJoinRequest: true }]);
    expect(calls).toEqual([]);
  });

  it("canal à rejoindre désactivé (lien à entrée directe, sans demande) : ordre d'avant, le bot de la demande d'abord", async () => {
    const { d, calls, asked, first } = world();
    await resolveGateLink(d, { id: "src", title: "Zone" }, { ...roulette, isActive: false }, first);
    expect(calls).toEqual(["dating -100777"]);
    expect(asked).toEqual([{ createsJoinRequest: false }]);
  });
});
