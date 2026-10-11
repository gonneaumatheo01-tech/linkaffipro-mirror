/**
 * Règle d'une demande selon sa provenance (phase 11) : résolution, canaux à rejoindre effectifs, absence de règle,
 * relecture de la règle d'une demande enregistrée. Exemple du client (11 octobre) : « Zone Interdite » accepte au bout
 * de 5 minutes après « Zone Roulette » et « Tir Cadré », sauf les personnes venues du bouton « canal à rejoindre » de
 * « Tir Cadré », acceptées au bout de 1 jour ; « Tir Cadré » exige « Zone Interdite ».
 */
import { describe, expect, it } from "vitest";
import type { ProvenanceLink } from "@linkaffipro/core";
import {
  approveAtAfterGate,
  computeInitialState,
  hasGate,
  isDirectEntry,
  isNoRule,
  loadRuleForMembership,
  NO_RULE,
  NO_RULE_DIRECT,
  noGatesOf,
  provenanceOfMembership,
  resolveRuleForProvenance,
  ruleFromRow,
  withEffectiveGates,
  type RuleLoaders,
  type ScopedRuleRow,
} from "./rules";

const ZONE = "cZone";
const TIR = "cTir";
const ROULETTE = "cRoulette";

function rule(over: Partial<ScopedRuleRow> & { id: string }): ScopedRuleRow {
  return {
    name: over.id,
    scope: "DEFAULT",
    isDefault: false,
    inviteLinkId: null,
    sourceChannelId: null,
    sourceKind: null,
    sortOrder: 0,
    label: null,
    sendWelcome: true,
    mode: "DELAY",
    delaySeconds: 0,
    gateChannelIds: [],
    gateMode: "NONE",
    reminderAfterMinutes: [60],
    maxReminders: 1,
    expireAfterHours: null,
    expireAction: "KEEP",
    sendAcceptedMessage: true,
    isActive: true,
    ...over,
  };
}

/** Règles de « Zone Interdite » : par défaut 5 minutes après Roulette et Tir Cadré ; venu de Tir Cadré → 1 jour. */
const zoneDefault = rule({
  id: "z_def",
  isDefault: true,
  delaySeconds: 300,
  gateMode: "REQUIRED",
  gateChannelIds: [ROULETTE, TIR],
});
const zoneFromTir = rule({
  id: "z_tir",
  scope: "SOURCE_CHANNEL",
  sourceChannelId: TIR,
  label: "Venu de « Tir Cadré »",
  delaySeconds: 86_400,
});
const zoneRules = [zoneDefault, zoneFromTir];

const gateFromTir: ProvenanceLink = {
  id: "l_gate_tir_zone",
  kind: "GATE",
  sourceChannelId: TIR,
  adPlatform: null,
};
const gateFromRoulette: ProvenanceLink = {
  id: "l_gate_rou_zone",
  kind: "GATE",
  sourceChannelId: ROULETTE,
  adPlatform: null,
};
const adTikTok: ProvenanceLink = {
  id: "l_ad",
  kind: "AD_ENTRY",
  sourceChannelId: null,
  adPlatform: "TIKTOK",
};
const prov = (l: ProvenanceLink | null) => provenanceOfMembership({}, l);
const t0 = new Date("2026-10-11T10:00:00Z");

describe("règle selon la provenance (exemple du client)", () => {
  it("venu du bouton « canal à rejoindre » de Tir Cadré : exception 1 jour, sans canaux à rejoindre", () => {
    const r = resolveRuleForProvenance(zoneRules, prov(gateFromTir), ZONE);
    expect(r).toMatchObject({
      id: "z_tir",
      scope: "SOURCE_CHANNEL",
      label: "Venu de « Tir Cadré »",
      delaySeconds: 86_400,
    });
    expect(hasGate(r)).toBe(false);
    const s = computeInitialState(r, t0);
    expect(s.status).toBe("SCHEDULED");
    expect(s.approveAt!.getTime() - t0.getTime()).toBe(86_400_000);
  });

  it("venu d'ailleurs (pub, lien inconnu, aucun lien) : règle par défaut, Roulette et Tir Cadré à rejoindre, puis 5 minutes", () => {
    for (const l of [adTikTok, null]) {
      const r = resolveRuleForProvenance(zoneRules, prov(l), ZONE);
      expect(r.id).toBe("z_def");
      expect(r.gateChannelIds).toEqual([ROULETTE, TIR]);
      expect(r.noGates).toBeUndefined();
      expect(computeInitialState(r, t0).status).toBe("PENDING_GATE");
      // Délai après « ✅ J'ai rejoint » : démarre au clic.
      expect(approveAtAfterGate(r, t0).getTime() - t0.getTime()).toBe(300_000);
    }
  });

  it("venu du bouton « canal à rejoindre » d'un autre canal, sans exception : règle par défaut sans aucun canal imposé (délai de la règle)", () => {
    const r = resolveRuleForProvenance(zoneRules, prov(gateFromRoulette), ZONE);
    expect(r.id).toBe("z_def");
    expect(r.noGates).toBe(true);
    expect(r.gateChannelIds).toEqual([]);
    const s = computeInitialState(r, t0);
    expect(s.status).toBe("SCHEDULED");
    expect(s.approveAt!.getTime() - t0.getTime()).toBe(300_000);
  });

  it("exception qui demande des canaux : jamais le canal d'où vient la personne ni le canal lui-même (exigences croisées sans boucle)", () => {
    const anyChannel = rule({
      id: "z_any",
      scope: "SOURCE_KIND",
      sourceKind: "ANY_CHANNEL",
      gateMode: "REQUIRED",
      gateChannelIds: [TIR, ZONE, ROULETTE, ROULETTE],
    });
    const r = resolveRuleForProvenance([zoneDefault, anyChannel], prov(gateFromTir), ZONE);
    expect(r.id).toBe("z_any");
    expect(r.gateChannelIds).toEqual([ROULETTE]);
    expect(r.noGates).toBeUndefined();
  });

  it("canal sans règle : validation à la main, sauf venu d'un canal obligatoire (entrée tout de suite, sans message)", () => {
    expect(resolveRuleForProvenance([], prov(adTikTok), ROULETTE)).toBe(NO_RULE);
    const direct = resolveRuleForProvenance([], prov(gateFromTir), ROULETTE);
    expect(direct).toBe(NO_RULE_DIRECT);
    expect(isNoRule(direct)).toBe(false);
    expect(isDirectEntry(direct)).toBe(true);
    expect(direct).toMatchObject({ sendWelcome: false, sendAcceptedMessage: false });
    expect(computeInitialState(direct, t0)).toEqual({
      status: "SCHEDULED",
      approveAt: t0,
      expiresAt: null,
    });
    // Règles inactives : comme aucune règle.
    expect(
      resolveRuleForProvenance([{ ...zoneDefault, isActive: false }], prov(gateFromTir), ZONE),
    ).toBe(NO_RULE_DIRECT);
  });

  it("une exception « venu d'un canal obligatoire → tout de suite, sans message » (reprise D7) garde le comportement d'avant", () => {
    const d7 = rule({
      id: "z_d7",
      scope: "SOURCE_KIND",
      sourceKind: "GATE",
      mode: "IMMEDIATE",
      sendWelcome: false,
      sendAcceptedMessage: false,
    });
    const r = resolveRuleForProvenance([zoneDefault, d7], prov(gateFromRoulette), ZONE);
    expect(r).toMatchObject({ id: "z_d7", sendWelcome: false, sendAcceptedMessage: false });
    expect(computeInitialState(r, t0)).toMatchObject({ status: "SCHEDULED", approveAt: t0 });
    // L'exception du canal d'origine (plus précise) passe avant.
    expect(
      resolveRuleForProvenance([zoneDefault, d7, zoneFromTir], prov(gateFromTir), ZONE).id,
    ).toBe("z_tir");
  });

  it("règle d'un lien précis enregistrée sans portée (écrivain d'avant la phase 11) : jamais ignorée, prioritaire", () => {
    const linkRule = rule({ id: "z_link", inviteLinkId: adTikTok.id, delaySeconds: 30 });
    expect(linkRule.scope).toBe("DEFAULT");
    const r = resolveRuleForProvenance([zoneDefault, linkRule], prov(adTikTok), ZONE);
    expect(r).toMatchObject({ id: "z_link", scope: "INVITE_LINK", delaySeconds: 30 });
    expect(resolveRuleForProvenance([zoneDefault, linkRule], prov(null), ZONE).id).toBe("z_def");
  });

  it("ruleFromRow : portée, texte, message à l'arrivée (anciennes lignes : défauts)", () => {
    expect(ruleFromRow(zoneFromTir)).toMatchObject({
      scope: "SOURCE_CHANNEL",
      label: "Venu de « Tir Cadré »",
      sendWelcome: true,
    });
    const old = ruleFromRow({
      ...zoneDefault,
      isDefault: false,
      scope: undefined,
      label: undefined,
      sendWelcome: undefined,
      inviteLinkId: "l1",
    });
    expect(old).toMatchObject({ scope: "INVITE_LINK", label: null, sendWelcome: true });
    expect(ruleFromRow({ ...zoneDefault, sendWelcome: false }).sendWelcome).toBe(false);
  });

  it("withEffectiveGates : la décision mémorisée (noGates) l'emporte, l'absence de règle reste telle quelle", () => {
    const def = ruleFromRow(zoneDefault);
    expect(withEffectiveGates(def, prov(adTikTok), ZONE, true)).toMatchObject({
      gateChannelIds: [],
      noGates: true,
    });
    expect(withEffectiveGates(def, prov(adTikTok), ZONE).gateChannelIds).toEqual([ROULETTE, TIR]);
    expect(withEffectiveGates(NO_RULE, prov(gateFromTir), ZONE)).toBe(NO_RULE);
  });
});

describe("règle d'une demande enregistrée (« ✅ J'ai rejoint », rappels, renvoi de l'accueil)", () => {
  const rows: Record<string, ScopedRuleRow> = { z_def: zoneDefault, z_tir: zoneFromTir };
  const links: Record<string, ProvenanceLink> = {
    [gateFromRoulette.id]: gateFromRoulette,
    [gateFromTir.id]: gateFromTir,
  };
  const calls: string[] = [];
  const loaders: RuleLoaders = {
    ruleById: async (id) => (calls.push(`rule ${id}`), rows[id] ?? null),
    channelRules: async (id) => (calls.push(`channel ${id}`), id === ZONE ? zoneRules : []),
    linkById: async (id) => (calls.push(`link ${id}`), links[id] ?? null),
  };

  it("jamais un canal que l'accueil n'a pas demandé (noGates mémorisé), même si la règle change ensuite", async () => {
    const r = await loadRuleForMembership(
      {
        channelId: ZONE,
        approvalRuleId: "z_def",
        inviteLinkId: gateFromRoulette.id,
        source: {
          provenance: {
            type: "GATE",
            inviteLinkId: gateFromRoulette.id,
            sourceChannelId: ROULETTE,
          },
          appliedRule: { id: "z_def", scope: "DEFAULT", label: null, noGates: true },
        },
      },
      loaders,
    );
    expect(r.gateChannelIds).toEqual([]);
    expect(hasGate(r)).toBe(false);
  });

  it("le canal d'où vient la personne n'est jamais demandé (provenance mémorisée)", async () => {
    const anyChannel = rule({
      id: "z_any",
      scope: "SOURCE_KIND",
      sourceKind: "ANY_CHANNEL",
      gateMode: "REQUIRED",
      gateChannelIds: [TIR, ROULETTE],
    });
    rows.z_any = anyChannel;
    const r = await loadRuleForMembership(
      {
        channelId: ZONE,
        approvalRuleId: "z_any",
        inviteLinkId: null,
        source: {
          provenance: { type: "GATE", sourceChannelId: TIR, inviteLinkId: gateFromTir.id },
        },
      },
      loaders,
    );
    expect(r.gateChannelIds).toEqual([ROULETTE]);
  });

  it("ancienne demande sans provenance : déduite de son lien d'invitation", async () => {
    calls.length = 0;
    const r = await loadRuleForMembership(
      { channelId: ZONE, approvalRuleId: "z_def", inviteLinkId: gateFromTir.id, source: {} },
      loaders,
    );
    expect(calls).toContain(`link ${gateFromTir.id}`);
    // Lien GATE, règle par défaut : aucun canal imposé.
    expect(r.noGates).toBe(true);
    calls.length = 0;
    await loadRuleForMembership(
      {
        channelId: ZONE,
        approvalRuleId: "z_def",
        inviteLinkId: gateFromTir.id,
        source: { provenance: { type: "AD", adPlatform: "META" } },
      },
      loaders,
    );
    expect(calls.some((c) => c.startsWith("link"))).toBe(false);
  });

  it("règle supprimée depuis : celle que la provenance retient aujourd'hui", async () => {
    const r = await loadRuleForMembership(
      {
        channelId: ZONE,
        approvalRuleId: null,
        inviteLinkId: null,
        source: { provenance: { type: "GATE", sourceChannelId: TIR } },
      },
      loaders,
    );
    expect(r.id).toBe("z_tir");
    expect(
      await loadRuleForMembership(
        { channelId: ROULETTE, approvalRuleId: null, inviteLinkId: null, source: null },
        loaders,
      ),
    ).toBe(NO_RULE);
  });

  it("noGatesOf lit prudemment la demande", () => {
    expect(noGatesOf({ appliedRule: { noGates: true } })).toBe(true);
    expect(noGatesOf({ appliedRule: null })).toBe(false);
    expect(noGatesOf({ appliedRule: { noGates: "oui" } })).toBe(false);
    expect(noGatesOf(undefined)).toBe(false);
  });
});
