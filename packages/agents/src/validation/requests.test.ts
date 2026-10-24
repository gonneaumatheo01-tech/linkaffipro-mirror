import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_TG_ID, createTestKit } from "../human/test-kit";
import { decideValidation, requestValidation, resendPendingValidations, VALIDATION_RESENT_PREFIX } from "./requests";
import { sweepValidations } from "./sweep";
import { handleAgentsCallback } from "../admin/callbacks";
import { handleAdminText } from "../admin/handle";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);

beforeEach(() => {
  lifecycle.continueMission.mockClear();
  lifecycle.cancelMission.mockClear();
});

async function setup() {
  const kit = createTestKit();
  const m = await kit.mission({ payload: { text: "Salut <b>toi</b>" } });
  const v = await requestValidation(kit.deps, {
    missionId: m.id,
    teamKey: "dating",
    previewText: "Salut <b>toi</b>",
    reason: "premier post du canal",
    channelTitle: "Canal Léa",
    mediaAssetId: "asset_1",
  });
  return { kit, m, v };
}

describe("validation humaine", () => {
  it("aperçu : texte, canal, équipe, motif, numéro, boutons, média ; mission en attente", async () => {
    const { kit, m, v } = await setup();
    expect(kit.tables("agentMission")[0]).toMatchObject({ status: "WAITING_VALIDATION", validationId: v.validationId });
    const msg = kit.sent[0]!;
    expect(msg.html).toContain(`À valider n°${v.number}`);
    expect(msg.html).toContain("équipe Rencontres");
    expect(msg.html).toContain("Canal : Canal Léa");
    expect(msg.html).toContain("Motif : premier post du canal");
    expect(msg.mediaAssetId).toBe("asset_1");
    expect(msg.buttons![0]!.map((b) => b.callbackData)).toEqual([
      `agv:${v.validationId}:ok`,
      `agv:${v.validationId}:edit`,
      `agv:${v.validationId}:no`,
    ]);
    expect(kit.tables("agentValidation")[0]!.telegramMessageId).toBe(msg.messageId);
    // Étape rejouée : pas de second aperçu.
    await requestValidation(kit.deps, { missionId: m.id, teamKey: "dating", previewText: "x", reason: "y" });
    expect(kit.sent).toHaveLength(1);
  });

  it("✅ par l'admin : mission reprise ; double clic sans double effet", async () => {
    const { kit, m, v } = await setup();
    const data = `agv:${v.validationId}:ok`;
    const r1 = await handleAgentsCallback(kit.deps, { data, fromTelegramId: ADMIN_TG_ID });
    expect(r1).toMatchObject({ handled: true, removeButtons: true, toast: "Validé ✅" });
    const r2 = await handleAgentsCallback(kit.deps, { data, fromTelegramId: ADMIN_TG_ID });
    expect(r2.toast).toContain("déjà validé");
    expect(lifecycle.continueMission).toHaveBeenCalledTimes(1);
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { reason: "validation accordée" });
    expect(kit.tables("auditLog").filter((a) => a.action === "agents.validation.approved")).toHaveLength(1);
  });

  it("un autre que l'admin : ignoré en silence", async () => {
    const { kit, v } = await setup();
    const r = await handleAgentsCallback(kit.deps, { data: `agv:${v.validationId}:ok`, fromTelegramId: 999n });
    expect(r).toEqual({ handled: true });
    expect(kit.tables("agentValidation")[0]!.status).toBe("PENDING");
  });

  it("✏️ puis message texte : texte remplacé, retour au Contrôle qualité", async () => {
    const { kit, m, v } = await setup();
    const r = await handleAgentsCallback(kit.deps, { data: `agv:${v.validationId}:edit`, fromTelegramId: ADMIN_TG_ID });
    expect(r.reply).toContain("nouveau texte");
    expect(r.removeButtons).toBe(false);
    const t = await handleAdminText(kit.deps, { text: "Nouveau texte 🔥", messageId: 50 });
    expect(t.reply).toContain("repasse au contrôle qualité");
    expect(kit.tables("agentValidation")[0]).toMatchObject({ status: "EDITED", editedText: "Nouveau texte 🔥", awaitingEditAt: null });
    expect(kit.tables("agentMission")[0]!.payload).toMatchObject({ text: "Nouveau texte 🔥", approved: true });
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { fromAgent: "controle", reason: "texte corrigé par l'admin" });
    // Le message suivant n'est plus pris pour une correction.
    expect(await handleAdminText(kit.deps, { text: "fait", messageId: 51 })).toEqual({ handled: false });
  });

  it("« ok <n> » et « non <n> motif »", async () => {
    const { kit, v } = await setup();
    const r = await handleAdminText(kit.deps, { text: `non ${v.number} trop générique`, messageId: 3 });
    expect(r.reply).toContain("refusé");
    expect(lifecycle.cancelMission).toHaveBeenCalledWith(kit.deps, expect.any(String), { reason: "refusé par l'admin : trop générique" });
    expect(kit.tables("agentValidation")[0]).toMatchObject({ status: "REJECTED", rejectReason: "trop générique" });
    expect((await handleAdminText(kit.deps, { text: `ok ${v.number}`, messageId: 4 })).reply).toContain("déjà refusé");
  });

  it("depuis le site : correction avec texte", async () => {
    const { kit, v } = await setup();
    const r = await decideValidation(kit.deps, { validationId: v.validationId, decision: "edit", editedText: "Mieux", via: "SITE", byUserId: "u1" });
    expect(r.ok).toBe(true);
    expect(kit.tables("auditLog").find((a) => a.action === "agents.validation.edited")).toMatchObject({ userId: "u1" });
  });

  it("24 h sans réponse : rappel une fois ; 72 h : expirée, mission annulée", async () => {
    const { kit } = await setup();
    kit.advance(25 * 3600_000);
    expect(await sweepValidations(kit.deps)).toEqual({ reminded: 1, expired: 0 });
    expect(await sweepValidations(kit.deps)).toEqual({ reminded: 0, expired: 0 });
    kit.advance(48 * 3600_000);
    expect(await sweepValidations(kit.deps)).toEqual({ reminded: 0, expired: 1 });
    expect(lifecycle.cancelMission).toHaveBeenCalledTimes(1);
  });

  it("bascule vers Kevin : l'aperçu en attente est reposé avec ses boutons, nouveau numéro de message, correction remise à zéro", async () => {
    const { kit, v } = await setup();
    const oldId = kit.sent[0]!.messageId;
    await handleAgentsCallback(kit.deps, { data: `agv:${v.validationId}:edit`, fromTelegramId: ADMIN_TG_ID });
    // Une validation déjà tranchée n'est pas reposée.
    const m2 = await kit.mission({});
    const v2 = await requestValidation(kit.deps, { missionId: m2.id, teamKey: "casino", previewText: "x", reason: "y" });
    await decideValidation(kit.deps, { validationId: v2.validationId, decision: "approve", via: "SITE" });
    const before = kit.sent.length;
    expect(await resendPendingValidations(kit.deps)).toBe(1);
    const resent = kit.sent.slice(before);
    expect(resent).toHaveLength(1);
    expect(resent[0]!.html).toContain(VALIDATION_RESENT_PREFIX);
    expect(resent[0]!.html).toContain(`À valider n°${v.number}`);
    expect(resent[0]!.mediaAssetId).toBe("asset_1");
    expect(resent[0]!.buttons![0]!.map((b) => b.callbackData)).toEqual([`agv:${v.validationId}:ok`, `agv:${v.validationId}:edit`, `agv:${v.validationId}:no`]);
    const row = kit.tables("agentValidation").find((x) => x.id === v.validationId)!;
    expect(row.telegramMessageId).toBe(resent[0]!.messageId);
    expect(row.telegramMessageId).not.toBe(oldId);
    expect(row.awaitingEditAt).toBeNull();
    // Sans messager : l'ancien numéro (de l'autre conversation) est effacé.
    expect(await resendPendingValidations({ ...kit.deps, admin: undefined })).toBe(0);
    expect(kit.tables("agentValidation").find((x) => x.id === v.validationId)!.telegramMessageId).toBeNull();
  });
});
