import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { askHuman } from "../human/requests";
import { handleAdminText } from "../admin/handle";
import { relaunchOpenRequestsOnce, REQUESTS_RELAUNCHED_KEY } from "./relaunch-requests";

describe("relance unique des demandes ouvertes (phase 25)", () => {
  it("renvoie une fois la question en cours, les autres restent dans l'ordre ; « demandes » les liste", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "TEXT", key: "a", question: "Question A ?" });
    await askHuman(kit.deps, { kind: "TEXT", key: "b", question: "Question B ?" });
    await askHuman(kit.deps, { kind: "TEXT", key: "c", question: "Question C ?" });
    expect(kit.sent).toHaveLength(1);
    const first = kit.sent[0]!;

    const r = await relaunchOpenRequestsOnce(kit.deps);
    expect(r).toEqual({ relaunched: true, open: 3 });
    expect(kit.sent).toHaveLength(2);
    expect(kit.sent[1]!.html).toContain("🔁 3 questions encore ouvertes");
    expect(kit.sent[1]!.html).toContain("Question A ?");
    expect(kit.sent[1]!.replyToMessageId).toBe(first.messageId);
    const a = kit.tables("humanRequest").find((x) => x.key === "a")!;
    expect(a).toMatchObject({ status: "PENDING", telegramMessageId: kit.sent[1]!.messageId });
    expect(a.remindedAt).toBeInstanceOf(Date);

    // Une seule fois.
    expect(await relaunchOpenRequestsOnce(kit.deps)).toEqual({ relaunched: false, open: 0 });
    expect(kit.sent).toHaveLength(2);
    expect(kit.tables("setting").some((s) => s.key === REQUESTS_RELAUNCHED_KEY)).toBe(true);

    const list = (await handleAdminText(kit.deps, { text: "demandes", messageId: 1 })).reply!;
    expect(list.split("\n")).toEqual(["Demandes ouvertes (3) :", "1. [en cours] Question A ?", "2. Question B ?", "3. Question C ?"]);

    // Réponse au message de relance : la suivante part (ordre gardé).
    const ok = await handleAdminText(kit.deps, { text: "ma réponse", messageId: 2, replyToMessageId: kit.sent[1]!.messageId });
    await ok.followUp?.();
    expect(kit.sent.at(-1)!.html).toContain("Question B ?");
  });

  it("sans messager : rien n'est marqué (le cycle suivant réessaie) ; sans demande : marqué sans message", async () => {
    const kit = createTestKit();
    expect(await relaunchOpenRequestsOnce({ ...kit.deps, admin: undefined })).toEqual({ relaunched: false, open: 0 });
    expect(kit.tables("setting").some((s) => s.key === REQUESTS_RELAUNCHED_KEY)).toBe(false);
    expect(await relaunchOpenRequestsOnce(kit.deps)).toEqual({ relaunched: false, open: 0 });
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("setting").some((s) => s.key === REQUESTS_RELAUNCHED_KEY)).toBe(true);
  });
});
