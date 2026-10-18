import { beforeEach, describe, expect, it, vi } from "vitest";

// Fil en direct d'une conversation : même contrôle que requireUser (compte actif, session à jour), sinon 401, base non
// lue ; 404 si la conversation n'existe plus ; sinon les nouveaux messages depuis `after`, jamais mis en cache. On
// simule la session (`@/auth`) et la base ; la vraie fonction `apiUser` et le vrai calcul du fil sont exécutés.
type DbUser = { id: string; role: "ADMIN" | "MANAGER"; isActive: boolean; sessionVersion: number };
const m = vi.hoisted(() => ({
  session: null as { user: { id: string; sessionVersion?: number } } | null,
  dbUser: null as DbUser | null,
  conversation: null as null | Record<string, unknown>,
  messages: [] as Array<Record<string, unknown>>,
  findMany: vi.fn(),
  convFind: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => m.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => m.dbUser) },
    conversation: { findUnique: m.convFind },
    conversationMessage: { findMany: m.findMany },
    memberBotState: { findUnique: vi.fn(async () => ({ blockedAt: null })) },
    assistantOfferLink: {
      findMany: vi.fn(async () => [
        { subId: "AbCdEf123456", firstOpenedAt: new Date("2026-10-18T10:05:00Z"), opens: 1 },
      ]),
    },
    conversationEvent: { count: vi.fn(async () => 0) },
  },
}));

import { GET } from "./route";

const get = (query = "") =>
  GET(new Request(`http://localhost/api/conversations/conv1/messages${query}`), {
    params: Promise.resolve({ id: "conv1" }),
  } as never);

beforeEach(() => {
  m.session = { user: { id: "u1", sessionVersion: 1 } };
  m.dbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 1 };
  m.conversation = {
    id: "conv1",
    botId: "b1",
    memberId: "mem1",
    status: "HUMAN",
    stage: "LINK_SENT",
    closedReason: null,
    stoppedAt: null,
    isMinor: false,
    takenOverById: "u1",
    persona: { name: "Léa", gender: "F" },
    bot: { isActive: true },
  };
  m.messages = [
    {
      id: "msg2",
      direction: "OUT",
      author: "TEAM",
      text: "Coucou, c'est l'équipe",
      media: null,
      meta: {},
      createdAt: new Date("2026-10-18T10:02:00Z"),
      teamUser: { name: "Marie" },
      outboundMessage: { status: "QUEUED", error: null },
    },
    {
      id: "msg1",
      direction: "IN",
      author: "MEMBER",
      text: "",
      media: { kind: "photo" },
      meta: {},
      createdAt: new Date("2026-10-18T10:01:00Z"),
      teamUser: null,
      outboundMessage: null,
    },
  ];
  m.convFind.mockReset();
  m.convFind.mockImplementation(async () => m.conversation);
  m.findMany.mockReset();
  m.findMany.mockImplementation(async () => m.messages);
});

describe("GET /api/conversations/[id]/messages", () => {
  it("sans session, compte désactivé ou session révoquée : 401, base non lue", async () => {
    m.session = null;
    expect((await get()).status).toBe(401);
    m.session = { user: { id: "u1", sessionVersion: 1 } };
    m.dbUser = { ...m.dbUser!, isActive: false };
    expect((await get()).status).toBe(401);
    m.dbUser = { ...m.dbUser!, isActive: true, sessionVersion: 2 };
    expect((await get()).status).toBe(401);
    expect(m.convFind).not.toHaveBeenCalled();
  });

  it("conversation supprimée : 404", async () => {
    m.conversation = null;
    const res = await get("?after=2026-10-18T10:00:00.000Z");
    expect(res.status).toBe(404);
  });

  it("manager : nouveaux messages depuis `after` (une minute de marge), dans l'ordre, jamais en cache", async () => {
    const res = await get("?after=2026-10-18T10:01:30.000Z");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const where = m.findMany.mock.calls[0]![0].where;
    expect(where.conversationId).toBe("conv1");
    expect(where.createdAt.gte.toISOString()).toBe("2026-10-18T10:00:30.000Z");
    const body = await res.json();
    expect(body.messages.map((x: { id: string }) => x.id)).toEqual(["msg1", "msg2"]);
    expect(body.messages[0]).toMatchObject({ side: "in", text: "[photo]" });
    expect(body.messages[1]).toMatchObject({
      side: "out",
      authorLabel: "Équipe · Marie",
      delivery: "QUEUED",
    });
    expect(body.cursor).toBe("2026-10-18T10:02:00.000Z");
    // Tout message affiché daté d'après le début de la marge et absent de la réponse n'existe plus (retiré du fil).
    expect(body.windowStart).toBe("2026-10-18T10:00:30.000Z");
    expect(body.offers).toEqual({
      AbCdEf123456: { openedAt: "2026-10-18T10:05:00.000Z", opens: 1 },
    });
    // Qui répond | étape | raison | /stop | mineur | bot bloqué | qui a la main | nombre de /reset.
    expect(body.stateKey).toBe("HUMAN|LINK_SENT|||||u1|0");
  });

  it("sans curseur lisible : tout le fil récent (aucune borne de date)", async () => {
    const body = await (await get("?after=nimporte")).json();
    expect(m.findMany.mock.calls[0]![0].where.createdAt).toBeUndefined();
    expect(body.windowStart).toBe("1970-01-01T00:00:00.000Z");
    await get();
    expect(m.findMany.mock.calls[1]![0].where.createdAt).toBeUndefined();
  });
});
