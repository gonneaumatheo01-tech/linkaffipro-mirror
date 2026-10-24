import { describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn(async (_args: unknown) => [] as unknown[]));
vi.mock("@linkaffipro/db", () => ({ prisma: { channel: { findMany } } }));
const { canProposeChannel, listProposableChannels } = await import("./channels");

/** Canaux proposés à Link Affi : au moins un de nos bots peut (ou pourrait) créer un lien. */
describe("canaux proposables", () => {
  it("droit d'inviter accordé, propriétaire, ou droits pas encore relus : proposé", () => {
    expect(
      canProposeChannel([{ rights: { status: "administrator", can_invite_users: true } }]),
    ).toBe(true);
    expect(canProposeChannel([{ rights: { status: "creator" } }])).toBe(true);
    expect(canProposeChannel([{ rights: {} }])).toBe(true);
  });
  it("aucun bot, ou tous refusés : pas proposé", () => {
    expect(canProposeChannel([])).toBe(false);
    expect(
      canProposeChannel([
        { rights: { status: "administrator", can_invite_users: false } },
        { rights: { can_invite_users: false } },
      ]),
    ).toBe(false);
  });
  it("un seul bot sur deux suffit", () => {
    expect(
      canProposeChannel([
        { rights: { can_invite_users: false } },
        { rights: { can_invite_users: true } },
      ]),
    ).toBe(true);
  });
});

/** Phase 17 : un bot en mode assistant de conversation ne crée jamais de liens, il ne rend pas un canal proposable. */
describe("canaux proposables : jamais par un assistant de conversation", () => {
  it("la base ne compte que les administrateurs actifs et normaux (présence et droits)", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "c1",
        title: "Canal",
        username: null,
        vertical: null,
        isActive: true,
        botAdmins: [{ rights: { can_invite_users: true } }],
      },
    ]);
    const out = await listProposableChannels();
    expect(out.map((c) => c.id)).toEqual(["c1"]);
    const args = findMany.mock.calls.at(-1)![0] as {
      where: { botAdmins: { some: unknown } };
      select: { botAdmins: { where: unknown } };
    };
    const standard = { revokedAt: null, bot: { isActive: true, mode: "STANDARD", role: "CHANNEL" } };
    expect(args.where.botAdmins.some).toEqual(standard);
    expect(args.select.botAdmins.where).toEqual(standard);
  });
});
