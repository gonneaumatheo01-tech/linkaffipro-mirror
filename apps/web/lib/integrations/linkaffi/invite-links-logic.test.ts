import { describe, expect, it } from "vitest";
import {
  decideInviteLinkCreation,
  decideInviteLinkPatch,
  type CreateRequest,
  type LinkaffiLinkRow,
} from "./invite-links-logic";

const req: CreateRequest = {
  campaignKey: "paul1",
  campaignName: "Paul Zone",
  affiliateId: "aff-paul",
  affiliateName: "Paul",
  channelId: "ch-zone",
  attributionDays: null,
};
const row = (patch: Partial<LinkaffiLinkRow> = {}): LinkaffiLinkRow => ({
  id: "l1",
  channelId: "ch-zone",
  isActive: true,
  telegramInviteLink: "https://t.me/+abc",
  linkaffiAffiliateId: "aff-paul",
  linkaffiCampaignName: "Paul Zone",
  linkaffiAffiliateName: "Paul",
  attributionDays: null,
  ...patch,
});

describe("POST /invite-links : idempotence et règles", () => {
  it("aucune ligne pour la clé : création", () => {
    expect(decideInviteLinkCreation(req, [])).toEqual({ kind: "create" });
  });
  it("même clé + même canal : le même lien, sans rien changer", () => {
    expect(decideInviteLinkCreation(req, [row()])).toEqual({
      kind: "existing",
      link: row(),
      updates: {},
    });
  });
  it("même clé + même canal avec un nouveau nom ou une nouvelle durée : même lien, champs mis à jour", () => {
    const d = decideInviteLinkCreation(
      { ...req, campaignName: "Paul Zone v2", affiliateName: "Paul D.", attributionDays: 30 },
      [row()],
    );
    expect(d).toEqual({
      kind: "existing",
      link: row(),
      updates: {
        linkaffiCampaignName: "Paul Zone v2",
        linkaffiAffiliateName: "Paul D.",
        attributionDays: 30,
      },
    });
  });
  it("nom d'affilié ou durée omis dans la relance : rien ne change ; null explicite : à vie, sans nom", () => {
    const existing = row({ linkaffiAffiliateName: "Sarah K.", attributionDays: 30 });
    const { affiliateName: _n, attributionDays: _d, ...omitted } = req;
    // toStrictEqual : une clé présente à `undefined` effacerait la valeur en base.
    expect(decideInviteLinkCreation(omitted, [existing])).toStrictEqual({
      kind: "existing",
      link: existing,
      updates: {},
    });
    expect(
      decideInviteLinkCreation(
        { ...omitted, affiliateName: undefined, attributionDays: undefined },
        [existing],
      ),
    ).toStrictEqual({ kind: "existing", link: existing, updates: {} });
    expect(
      decideInviteLinkCreation({ ...req, affiliateName: null, attributionDays: null }, [existing]),
    ).toMatchObject({ updates: { linkaffiAffiliateName: null, attributionDays: null } });
  });
  it("même clé pour un autre canal : un nouveau lien pour ce canal", () => {
    expect(decideInviteLinkCreation(req, [row({ channelId: "ch-tir" })])).toEqual({
      kind: "create",
    });
  });
  it("une clé = un affilié : la même clé pour un autre affilié est refusée, sur tout canal", () => {
    for (const channelId of ["ch-zone", "ch-tir"])
      expect(
        decideInviteLinkCreation(req, [row({ channelId, linkaffiAffiliateId: "aff-marc" })]).kind,
      ).toBe("affiliate_mismatch");
  });
  it("lien désactivé pour ce canal : pas de retour possible", () => {
    expect(decideInviteLinkCreation(req, [row({ isActive: false })]).kind).toBe("disabled");
    // Un lien désactivé ailleurs n'empêche pas un nouveau canal.
    expect(
      decideInviteLinkCreation(req, [row({ isActive: false, channelId: "ch-tir" })]).kind,
    ).toBe("create");
  });
});

describe("PATCH /invite-links/{id} : désactivation", () => {
  it("désactiver un lien actif : révocation ; déjà désactivé : rien à faire", () => {
    expect(decideInviteLinkPatch({ isActive: true }, false)).toEqual({ kind: "revoke" });
    expect(decideInviteLinkPatch({ isActive: false }, false)).toEqual({
      kind: "already_inactive",
    });
  });
  it("réactiver : refusé pour un lien désactivé, rien à faire pour un lien actif", () => {
    expect(decideInviteLinkPatch({ isActive: false }, true)).toEqual({
      kind: "reactivation_refused",
    });
    expect(decideInviteLinkPatch({ isActive: true }, true)).toEqual({ kind: "already_active" });
  });
});
