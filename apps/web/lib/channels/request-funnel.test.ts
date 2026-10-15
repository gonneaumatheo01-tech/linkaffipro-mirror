import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const {
  EMPTY_FUNNEL,
  BLOCKED_HINT,
  blockedWarning,
  buildRequestFunnel,
  funnelRequestFromRow,
  funnelSteps,
  funnelView,
  groupSummary,
  joinedKey,
  provenanceGroupOf,
  requestGateChannelIds,
  requestOutcome,
  requestsBetween,
  sumFunnels,
  unreachableNote,
} = await import("./request-funnel");

type Req = Parameters<typeof requestOutcome>[0];

const ZONE = "zone";
const ROULETTE = "roulette";
const TIR = "tir";
const T0 = new Date("2026-10-14T16:41:00Z");

const adLink = (id: string, adName: string) => ({
  id,
  kind: "AD_ENTRY" as const,
  sourceChannelId: null,
  adPlatform: "TIKTOK",
  name: `Dating test 1 semaine — ${adName}`,
  adName,
});

/** Demande de Zone Interdite (pub TikTok, canaux obligatoires Zone Roulette et Tir Cadré), comme le bot l'enregistre. */
function req(over: Partial<Req> = {}): Req {
  return {
    id: Math.random().toString(36).slice(2),
    memberId: "m1",
    channelId: ZONE,
    status: "PENDING_GATE",
    requestedAt: T0,
    gateSatisfiedAt: null,
    approvedAt: null,
    joinedAt: null,
    provenance: {
      type: "AD",
      inviteLinkId: "pub1",
      sourceChannelId: null,
      adPlatform: "TIKTOK",
      label: "Venu d'une pub TikTok",
    },
    link: adLink("pub1", "Pub 1"),
    gates: [
      { channelId: ROULETTE, title: "Zone Roulette", url: "https://t.me/+a" },
      { channelId: TIR, title: "Tir Cadré", url: "https://t.me/+b" },
    ],
    gateLinksMissing: [],
    noGates: false,
    gateMode: "REQUIRED",
    rule: { scope: "DEFAULT", gateChannelIds: [ROULETTE, TIR] },
    welcomed: true,
    blocked: false,
    refused: false,
    ...over,
  };
}

describe("canaux à rejoindre d'une demande", () => {
  it("ceux de son accueil, y compris les canaux restés sans lien, sans doublon ni le canal lui-même", () => {
    expect(
      requestGateChannelIds(
        req({
          gates: [{ channelId: ROULETTE }, { channelId: ZONE }],
          gateLinksMissing: [{ channelId: TIR, title: "Tir Cadré" }, { channelId: ROULETTE }],
        }),
      ),
    ).toEqual([ROULETTE, TIR]);
  });

  it("canaux proposés : comptés aussi (on voit si les personnes les rejoignent)", () => {
    expect(requestGateChannelIds(req({ gateMode: "SOFT" }))).toEqual([ROULETTE, TIR]);
  });

  it("aucun : règle sans canaux, ou personne à qui ils n'étaient pas imposés (venue d'un canal obligatoire)", () => {
    expect(requestGateChannelIds(req({ gateMode: "NONE" }))).toEqual([]);
    expect(requestGateChannelIds(req({ gateMode: null }))).toEqual([]);
    expect(requestGateChannelIds(req({ noGates: true }))).toEqual([]);
  });

  it("ancienne demande sans canaux enregistrés : ceux de sa règle, sans le canal d'origine ni le canal lui-même", () => {
    const old = req({
      gates: null,
      gateLinksMissing: null,
      provenance: null,
      link: {
        id: "s1",
        kind: "SHARE",
        sourceChannelId: TIR,
        adPlatform: null,
        name: "Post",
        adName: null,
      },
      rule: { scope: "SOURCE_KIND", gateChannelIds: [ROULETTE, TIR, ZONE] },
    });
    expect(requestGateChannelIds(old)).toEqual([ROULETTE]);
    // Venue du bouton « canal à rejoindre » et règle par défaut : rien d'imposé (phase 11).
    expect(
      requestGateChannelIds({
        ...old,
        link: {
          id: "g1",
          kind: "GATE",
          sourceChannelId: TIR,
          adPlatform: null,
          name: "g",
          adName: null,
        },
        rule: { scope: "DEFAULT", gateChannelIds: [ROULETTE, TIR] },
      }),
    ).toEqual([]);
    expect(requestGateChannelIds({ ...old, rule: null })).toEqual([]);
  });
});

describe("ce qu'est devenue une demande", () => {
  it("vrai blocage et refus sans blocage : jamais les deux à la fois", () => {
    const none = new Set<string>();
    expect(requestOutcome(req({ blocked: true, refused: true }), none)).toMatchObject({
      blocked: true,
      unreachable: false,
    });
    expect(requestOutcome(req({ refused: true }), none)).toMatchObject({
      blocked: false,
      unreachable: true,
    });
    expect(requestOutcome(req({ welcomed: false }), none).welcomed).toBe(false);
  });

  it("canaux rejoints d'après nos données ; canaux validés par le bot = tous rejoints", () => {
    const one = new Set([joinedKey("m1", ROULETTE)]);
    expect(requestOutcome(req(), one)).toMatchObject({
      hasGates: true,
      oneJoined: true,
      allJoined: false,
    });
    const both = new Set([joinedKey("m1", ROULETTE), joinedKey("m1", TIR)]);
    expect(requestOutcome(req(), both)).toMatchObject({ oneJoined: true, allJoined: true });
    // Les canaux d'une autre personne ne comptent pas.
    expect(requestOutcome(req({ memberId: "m2" }), both)).toMatchObject({
      oneJoined: false,
      allJoined: false,
    });
    expect(
      requestOutcome(req({ gateSatisfiedAt: new Date(T0.getTime() + 60_000) }), new Set()),
    ).toMatchObject({ oneJoined: true, allJoined: true });
    expect(requestOutcome(req({ gateMode: "NONE" }), both)).toMatchObject({
      hasGates: false,
      oneJoined: false,
      allJoined: false,
    });
  });

  it("acceptée (bot, à la main ou entrée) et partie (départ volontaire, pas une exclusion)", () => {
    const none = new Set<string>();
    expect(requestOutcome(req({ status: "APPROVED", approvedAt: T0 }), none).accepted).toBe(true);
    expect(requestOutcome(req({ status: "PENDING_GATE", joinedAt: T0 }), none).accepted).toBe(true);
    expect(requestOutcome(req({ status: "LEFT" }), none)).toMatchObject({
      accepted: true,
      left: true,
    });
    expect(requestOutcome(req({ status: "KICKED" }), none)).toMatchObject({
      accepted: true,
      left: false,
    });
    expect(requestOutcome(req({ status: "SCHEDULED" }), none).accepted).toBe(false);
    expect(requestOutcome(req({ status: "DECLINED" }), none).accepted).toBe(false);
  });
});

describe("provenance d'une demande dans le parcours", () => {
  const titles = { [TIR]: "Tir Cadré" };
  it("chaque pub par son nom, chaque canal d'origine, chaque lien, puis « Autres liens »", () => {
    expect(provenanceGroupOf(req(), titles).label).toBe("Pub TikTok « Pub 1 »");
    expect(provenanceGroupOf(req(), titles)).toMatchObject({ key: "ad:pub1", kind: "ad" });
    /** Libellé de la provenance d'une demande (guillemets à espaces insécables, comme à l'écran). */
    const labelOf = (over: Partial<Req>) => provenanceGroupOf(req(over), titles).label;
    expect(
      labelOf({
        link: { ...adLink("pub2", "Pub 2"), adName: null, name: "Lien pub 2" },
        provenance: null,
      }),
    ).toBe("Pub TikTok « Lien pub 2 »");
    const gate = provenanceGroupOf(
      req({
        provenance: { type: "GATE", inviteLinkId: "g1", sourceChannelId: TIR, adPlatform: null },
        link: null,
      }),
      titles,
    );
    expect(gate).toMatchObject({ key: `gate:${TIR}`, kind: "channel" });
    expect(gate.label).toBe("Bouton « canal à rejoindre » de « Tir Cadré »");
    expect(
      labelOf({
        provenance: { type: "GATE", inviteLinkId: "g1", sourceChannelId: "gone", adPlatform: null },
        link: null,
      }),
    ).toBe("Bouton « canal à rejoindre » d'un de nos canaux");
    const plain = { sourceChannelId: null, adPlatform: null, adName: null };
    expect(
      labelOf({ provenance: null, link: { ...plain, id: "s1", kind: "SHARE", name: "Story" } }),
    ).toBe("Lien de partage « Story »");
    expect(
      labelOf({ provenance: null, link: { ...plain, id: "l1", kind: "MANUAL", name: "Bio" } }),
    ).toBe("Lien « Bio »");
    expect(
      labelOf({
        provenance: {
          type: "LINKAFFI",
          inviteLinkId: "la1",
          sourceChannelId: null,
          adPlatform: null,
          linkaffi: {
            campaignKey: "k",
            campaignName: "VIP",
            affiliateId: "a1",
            affiliateName: "Paul",
          },
        },
        link: null,
      }),
    ).toBe("Affilié « Paul »");
    expect(provenanceGroupOf(req({ provenance: null, link: null }))).toEqual({
      key: "other",
      label: "Autres liens",
      kind: "other",
    });
  });
});

describe("parcours des demandes : le cas du 15 octobre (Zone Interdite, pub TikTok)", () => {
  // Pub 1 : 10 demandes, accueil envoyé à toutes, 4 vrais blocages, 3 refus sans blocage (rappels jamais reçus),
  // 2 ont rejoint les deux canaux (dont 1 acceptée puis partie), 2 un seul canal. Pub 2 : 4 demandes, 1 blocage, 2
  // acceptées. Plus 2 demandes « Autres liens » sans canaux à rejoindre (règle d'une exception), acceptées.
  const rows: Req[] = [];
  const joined = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const memberId = `p1-${i}`;
    rows.push(
      req({
        memberId,
        blocked: i < 4,
        refused: i >= 4 && i < 7,
        status: i === 7 ? "LEFT" : i === 8 ? "SCHEDULED" : "PENDING_GATE",
        approvedAt: i === 7 ? T0 : null,
        gateSatisfiedAt: i === 7 || i === 8 ? T0 : null,
      }),
    );
    if (i === 9 || i === 6) joined.add(joinedKey(memberId, ROULETTE));
  }
  for (let i = 0; i < 4; i++)
    rows.push(
      req({
        memberId: `p2-${i}`,
        link: adLink("pub2", "Pub 2"),
        provenance: {
          type: "AD",
          inviteLinkId: "pub2",
          sourceChannelId: null,
          adPlatform: "TIKTOK",
        },
        blocked: i === 0,
        status: i >= 2 ? "APPROVED" : "PENDING_GATE",
        approvedAt: i >= 2 ? T0 : null,
        gateSatisfiedAt: i >= 2 ? T0 : null,
      }),
    );
  for (let i = 0; i < 2; i++)
    rows.push(
      req({
        memberId: `o-${i}`,
        provenance: null,
        link: null,
        gateMode: "NONE",
        gates: [],
        status: "APPROVED",
        approvedAt: T0,
        welcomed: i === 0,
      }),
    );
  const data = buildRequestFunnel(rows, joined);

  it("totaux étape par étape", () => {
    expect(data.totals).toEqual({
      requests: 16,
      welcomed: 15,
      blocked: 5,
      unreachable: 3,
      withGates: 14,
      oneJoined: 6,
      allJoined: 4,
      accepted: 5,
      left: 1,
    });
  });

  it("par provenance, les plus nombreuses d'abord, « Autres liens » en dernier", () => {
    expect(data.groups.map((g) => [g.label, g.counts.requests, g.counts.blocked])).toEqual([
      ["Pub TikTok « Pub 1 »", 10, 4],
      ["Pub TikTok « Pub 2 »", 4, 1],
      ["Autres liens", 2, 0],
    ]);
    expect(sumFunnels(data.groups.map((g) => g.counts))).toEqual(data.totals);
  });

  it("étapes affichées : part des demandes, part des demandes avec des canaux, part des acceptées", () => {
    const steps = funnelSteps(data.totals);
    expect(steps.map((s) => [s.label, s.value, s.note && s.note])).toEqual([
      ["Demandes", 16, null],
      ["Accueil envoyé", 15, "94 % des demandes"],
      ["Ont bloqué le bot", 5, "31 % des demandes"],
      ["Au moins un canal rejoint", 6, "43 % des 14 demandes avec des canaux à rejoindre"],
      ["Tous les canaux rejoints", 4, "29 % des 14 demandes avec des canaux à rejoindre"],
      ["Acceptées", 5, "31 % des demandes"],
      ["Parties du canal", 1, "20 % des acceptées"],
    ]);
    expect(steps.find((s) => s.key === "blocked")).toMatchObject({
      favorable: "down",
      hint: BLOCKED_HINT,
    });
    expect(steps.find((s) => s.key === "left")?.favorable).toBe("down");
  });

  it("toutes les demandes avaient des canaux : « des demandes » ; aucune : pas d'étape « canaux »", () => {
    const all = funnelSteps({ ...data.totals, withGates: 16 });
    expect(all.find((s) => s.key === "oneJoined")!.note!).toBe("38 % des demandes");
    const noGate = funnelSteps({ ...EMPTY_FUNNEL, requests: 3, welcomed: 3, accepted: 3 });
    expect(noGate.map((s) => s.key)).toEqual([
      "requests",
      "welcomed",
      "blocked",
      "accepted",
      "left",
    ]);
    // Rien sur la période : aucune part.
    expect(funnelSteps(EMPTY_FUNNEL).every((s) => s.note === null)).toBe(true);
  });

  it("avertissement au-delà de 25 % de vrais blocages sur au moins 10 demandes, avec la provenance la plus touchée", () => {
    expect(blockedWarning(data, { requiredGates: true })!).toBe(
      "40 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot (4 sur 10). Telegram peut limiter un bot signalé : adoucissez le message d'accueil ou passez les canaux en « Proposés ».",
    );
    // Une seule provenance : « des personnes ».
    const single = buildRequestFunnel(rows.slice(0, 10), joined);
    expect(funnelView(single, null, { requiredGates: true }).warning!).toMatch(
      /passez les canaux en « Proposés »\.$/,
    );
    expect(blockedWarning(single)!).toMatch(/^40 % des personnes ont bloqué le bot \(4 sur 10\)/);
    // Moins de 10 demandes, ou 25 % tout juste : rien.
    expect(blockedWarning(buildRequestFunnel(rows.slice(0, 9), joined))).toBeNull();
    const quarter = buildRequestFunnel(
      Array.from({ length: 12 }, (_, i) => req({ memberId: `q${i}`, blocked: i < 3 })),
      joined,
    );
    expect(blockedWarning(quarter)).toBeNull();
    // Moins de 25 % sur l'ensemble, mais une pub d'au moins 10 demandes au-dessus : elle est nommée.
    const diluted = buildRequestFunnel(
      [
        ...rows.slice(0, 10),
        ...Array.from({ length: 10 }, (_, i) =>
          req({ memberId: `d${i}`, provenance: null, link: null }),
        ),
      ],
      joined,
    );
    expect(diluted.totals).toMatchObject({ requests: 20, blocked: 4 });
    expect(blockedWarning(diluted)!).toMatch(
      /^40 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot \(4 sur 10\)/,
    );
    // Une provenance de moins de 10 demandes très touchée ne suffit pas.
    const small = buildRequestFunnel(
      [
        ...Array.from({ length: 4 }, (_, i) => req({ memberId: `s${i}`, blocked: i < 3 })),
        ...Array.from({ length: 16 }, (_, i) =>
          req({ memberId: `t${i}`, provenance: null, link: null }),
        ),
      ],
      joined,
    );
    expect(blockedWarning(small)).toBeNull();
  });

  it("canaux déjà « Proposés » ou aucun canal à rejoindre : seulement « adoucissez le message d'accueil »", () => {
    const soft =
      "40 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot (4 sur 10). Telegram peut limiter un bot signalé : adoucissez le message d'accueil.";
    expect(blockedWarning(data, { requiredGates: false })).toBe(soft);
    // Sans précision : jamais un conseil peut-être déjà suivi.
    expect(blockedWarning(data)).toBe(soft);
    expect(funnelView(data, null, { requiredGates: false }).warning).toBe(soft);
    expect(funnelView(data).warning).toBe(soft);
    // Sous le seuil : toujours rien.
    expect(
      blockedWarning(buildRequestFunnel(rows.slice(0, 9), joined), { requiredGates: true }),
    ).toBeNull();
  });

  it("refus sans blocage dit à part, jamais compté comme un blocage", () => {
    expect(unreachableNote(data.totals)!).toBe(
      "3 personnes n'ont pas reçu un message du bot sans l'avoir bloqué : elles n'avaient jamais appuyé sur « Démarrer » et les 5 minutes après leur demande étaient passées. Ce n'est pas compté comme un blocage.",
    );
    expect(unreachableNote({ ...EMPTY_FUNNEL, unreachable: 1 })!).toMatch(
      /^1 personne n'a pas reçu/,
    );
    expect(unreachableNote(EMPTY_FUNNEL)).toBeNull();
  });

  it("une provenance en une ligne", () => {
    expect(groupSummary(data.groups[0]!.counts)).toBe(
      "10 demandes · 4 ont bloqué le bot (40 %) · 1 acceptée (10 %)",
    );
    expect(groupSummary({ ...EMPTY_FUNNEL, requests: 1, blocked: 1 })).toBe(
      "1 demande · 1 a bloqué le bot (100 %) · 0 acceptée (0 %)",
    );
  });
});

describe("périodes et lecture en base", () => {
  it("demandes de la période : début inclus, fin exclue", () => {
    const rows = [
      { requestedAt: new Date("2026-10-13T21:59:59Z") },
      { requestedAt: new Date("2026-10-13T22:00:00Z") },
      { requestedAt: new Date("2026-10-14T21:59:59Z") },
      { requestedAt: new Date("2026-10-14T22:00:00Z") },
    ];
    expect(
      requestsBetween(rows, new Date("2026-10-13T22:00:00Z"), new Date("2026-10-14T22:00:00Z")),
    ).toEqual([rows[1], rows[2]]);
  });

  it("ligne de la base → demande : lien et pub relus, règle relue", () => {
    const row: Parameters<typeof funnelRequestFromRow>[0] = {
      id: "ms1",
      memberId: "m1",
      channelId: ZONE,
      status: "PENDING_GATE",
      requestedAt: T0,
      gateSatisfiedAt: null,
      approvedAt: null,
      joinedAt: null,
      provenance: null,
      gates: null,
      gateLinksMissing: null,
      noGates: false,
      gateMode: "REQUIRED",
      ruleScope: "DEFAULT",
      ruleGateChannelIds: [ROULETTE],
      linkId: "pub1",
      linkKind: "AD_ENTRY",
      linkSourceChannelId: null,
      linkAdPlatform: "TIKTOK",
      linkName: "Lien pub",
      adName: "Pub 1",
      linkaffiCampaignKey: null,
      linkaffiCampaignName: null,
      linkaffiAffiliateId: null,
      linkaffiAffiliateName: null,
      welcomed: true,
      blocked: false,
      refused: true,
    };
    const r = funnelRequestFromRow(row);
    expect(r.link).toMatchObject({
      id: "pub1",
      kind: "AD_ENTRY",
      adName: "Pub 1",
      name: "Lien pub",
    });
    expect(r.rule).toEqual({ scope: "DEFAULT", gateChannelIds: [ROULETTE] });
    expect(provenanceGroupOf(r).label).toBe("Pub TikTok « Pub 1 »");
    expect(requestGateChannelIds(r)).toEqual([ROULETTE]);
    expect(requestOutcome(r, new Set()).unreachable).toBe(true);
    const bare = funnelRequestFromRow({ ...row, linkId: null, linkKind: null, ruleScope: null });
    expect(bare.link).toBeNull();
    expect(bare.rule).toBeNull();
    expect(requestGateChannelIds(bare)).toEqual([]);
  });
});
