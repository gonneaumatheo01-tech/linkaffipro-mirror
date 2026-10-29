import { describe, expect, it } from "vitest";
import { createBossKit } from "../boss/testing";
import { saveChannelPlanFor, setTeamPostsPerDay, updateChannelPlan } from "./channel-plan";
import { setBetCategoryActive } from "./bet-category";

const actor = { userId: "u1", via: "SITE" as const };

describe("plan d'un canal (une seule logique pour le site et Kevin)", () => {
  it("contrôles : univers, persona obligatoire en Rencontres, bornes du quota", async () => {
    const kit = await createBossKit();
    const base = { channelId: kit.ids.casino, enabled: true, postsPerDay: 3, windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: 90, mix: { video: 0, photo: 0, text: 1 }, personaId: null, campaignId: null, themes: [] };
    expect(await saveChannelPlanFor(kit.deps, "dating", base, actor)).toMatchObject({ ok: false });
    expect(await saveChannelPlanFor(kit.deps, "casino", { ...base, postsPerDay: 99 }, actor)).toMatchObject({ ok: false });
    expect(await saveChannelPlanFor(kit.deps, "casino", base, actor)).toEqual({ ok: true });
    expect(await updateChannelPlan(kit.deps, kit.ids.chEmma, { enabled: true, personaId: null }, actor)).toMatchObject({ ok: false });
    expect(kit.tables("auditLog").filter((a) => a.action === "agents.channel_plan_saved")).toHaveLength(1);
  });

  it("modification partielle : le reste du plan est gardé (Rencontres sans vidéo) ; quota d'une équipe", async () => {
    const kit = await createBossKit();
    const r = await updateChannelPlan(kit.deps, kit.ids.chLea, { mix: { video: 2, photo: 1, text: 1 } }, actor);
    expect(r.ok).toBe(true);
    expect(kit.tables("channelAgentPlan").find((p) => p.channelId === kit.ids.chLea)).toMatchObject({ postsPerDay: 3, personaId: kit.ids.lea, enabled: true, mix: { video: 0, photo: 1, text: 1 } });
    // Rencontres : part de vidéos ramenée à 0 (vidéos IA retirées le 29 octobre 2026) ; rien d'autre → refus clair.
    expect(await updateChannelPlan(kit.deps, kit.ids.chLea, { mix: { video: 3, photo: 0, text: 0 } }, actor)).toMatchObject({ ok: false, error: expect.stringContaining("ne fait plus de vidéos") });
    expect(await setTeamPostsPerDay(kit.deps, "dating", 4, actor)).toEqual({ ok: true, changed: 1 });
    expect(await setTeamPostsPerDay(kit.deps, "sports", 4, actor)).toMatchObject({ ok: false });
  });
});

describe("catégorie de paris", () => {
  it("activer puis désactiver, journalisé ; déjà active = rien", async () => {
    const kit = await createBossKit();
    expect(await setBetCategoryActive(kit.deps, kit.ids.corners, true, actor)).toMatchObject({ ok: true, changed: true });
    expect(await setBetCategoryActive(kit.deps, kit.ids.corners, true, actor)).toMatchObject({ changed: false });
    expect(await setBetCategoryActive(kit.deps, "inconnu", false, actor)).toMatchObject({ ok: false });
    expect(kit.tables("auditLog").filter((a) => a.action === "agents.bet_category_saved")).toHaveLength(1);
  });
});
