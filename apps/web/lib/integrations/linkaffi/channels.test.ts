import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
const { canProposeChannel } = await import("./channels");

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
