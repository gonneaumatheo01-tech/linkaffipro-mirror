/**
 * Phase 33, chantier C — Kevin montre ce que font les équipes et présente chaque agent : phrases du client sur la
 * fausse IA (`createFakeBossLlm`), réponses de 8 lignes au plus, voix contrôlée, lecture seule, droits des membres.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeOddsProvider } from "../providers/fake-odds";
import { bossAiTurn } from "./execute";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import { VIEW_ACTIONS, VIEW_ACTION_KEYS } from "./catalog-view";
import { createBossKit } from "./testing";
import { voiceCheck } from "./voice";
import type { FakeBossTable } from "./llm";

vi.mock("../missions/lifecycle", async (orig) => ({ ...(await orig<Record<string, unknown>>()), continueMission: vi.fn(async () => undefined) }));

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

const PHRASES: Array<[string, ReturnType<typeof call>, RegExp]> = [
  ["qu'est-ce que l'agent des paris sportifs va poster aujourd'hui sur Paris Foot ?", call("voir_paris_du_canal", { canal: "Paris Foot" }), /Paris Foot aujourd'hui : 2 paris \(Tirs cadrés\)/],
  ["montre-moi les matchs qu'il regarde", call("apercu_matchs", { canal: "Paris Foot" }), /Cotes d'essai : rien de payé\.|Rien ne passe les critères/],
  ["qu'est-ce qui part demain sur tous les canaux casino ?", call("voir_programme", { equipe: "casino", jour: "demain" }), /Rien de programmé demain[\s\S]*Casino VIP demain : 4 posts/],
  ["qu'est-ce que Léa poste ce soir ?", call("voir_programme", { persona: "Léa", moment: "soir" }), /Rien de programmé aujourd'hui \(soir\)[\s\S]*Léa en privé aujourd.hui : 3 posts/],
  ["l'agent Rédaction, il a écrit quoi ce matin ?", call("fiche_agent", { agent: "Rédaction", moment: "matin" }), /Rédaction \(Rencontres, Casino, Paris sportifs/],
  ["l'agent Horaires conseille quoi ?", call("fiche_agent", { agent: "l'agent Horaires" }), /Horaires \(Algorithme, sous le Chef Algorithme\)/],
  ["pourquoi rien n'est sorti ce matin ?", call("pourquoi_rien", { moment: "matin" }), /: /],
  ["qu'est-ce qui attend ma validation ?", call("qu_attend_ma_validation", {}), /1 post attend ta validation/],
  ["quels matchs sont sur Sportaza ce soir ?", call("voir_matchs_bookmaker", { bookmaker: "Sportaza", moment: "soir" }), /Sportaza/],
  ["les matchs de demain chez 5Gringos en foot", call("voir_matchs_bookmaker", { bookmaker: "5Gringos", jour: "demain", sport: "foot" }), /5Gringos n'est pas chez mon fournisseur de cotes/],
];

describe("catalogue « voir »", () => {
  it("les 9 entrées sont dans le catalogue, immédiates, lisibles par les membres présentés", () => {
    expect(VIEW_ACTION_KEYS).toEqual(["voir_plan", "voir_programme", "voir_paris_du_canal", "apercu_matchs", "voir_matchs_bookmaker", "voir_fait", "pourquoi_rien", "fiche_agent", "qu_attend_ma_validation"]);
    for (const a of VIEW_ACTIONS) {
      expect(BOSS_CATALOG).toContain(a);
      expect(a.cls).toBe("immediate");
      expect(bossActionAllowed(a, { kind: "member", telegramUserId: 7n, memberId: "m", role: "MEMBER", firstName: "Zoé" })).toBe(true);
    }
  });

  it("répond aux phrases du client (fausse IA), 8 lignes au plus, voix contrôlée, sans rien publier", async () => {
    const table: FakeBossTable = PHRASES.map(([p, c]) => [p, c] as const);
    const kit = await createBossKit(table);
    await kit.prisma.betCategory.update({ where: { id: kit.ids.tirs }, data: { channelIds: [kit.ids.sports] } as never });
    const m = await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "WAITING_VALIDATION" } as never });
    await kit.prisma.agentValidation.create({ data: { missionId: m.id, teamKey: "casino", previewText: "x", reason: "nouveau thème" } as never });
    const deps = { ...kit.deps, providers: { odds: createFakeOddsProvider({ now: kit.deps.now }) } };
    for (const [phrase, , expected] of PHRASES) {
      const r = await bossAiTurn(deps, kit.input(phrase));
      const reply = r.reply ?? "";
      expect(reply, phrase).toMatch(expected);
      expect(reply.split("\n").filter((l) => l.trim()).length, phrase).toBeLessThanOrEqual(8);
      expect(voiceCheck(reply).problems, `${phrase}\n${reply}`).toEqual([]);
    }
    expect(kit.tables("bettingPick")).toHaveLength(0);
    expect(kit.tables("post")).toHaveLength(0);
    expect(kit.tables("agentMission")).toHaveLength(1);
  });

  it("validation en attente : boutons existants ; agent ambigu : question numérotée ; long : « Tu veux le détail ? »", async () => {
    const kit = await createBossKit([
      ["qu'est-ce qui attend ma validation ?", call("qu_attend_ma_validation", {})],
      ["l'agent des photos il fait quoi", call("fiche_agent", { agent: "l'agent des photos" })],
      ["le plan de la semaine", call("voir_plan", { jours: 7 })],
    ]);
    const m = await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "WAITING_VALIDATION" } as never });
    await kit.prisma.agentValidation.create({ data: { missionId: m.id, teamKey: "casino", previewText: "x", reason: "nouveau thème" } as never });
    const v = await bossAiTurn(kit.deps, kit.input("qu'est-ce qui attend ma validation ?"));
    expect(v.buttons?.[0]?.map((b) => b.callbackData.split(":")[2])).toEqual(["ok", "edit", "no"]);
    const amb = await bossAiTurn(kit.deps, kit.input("l'agent des photos il fait quoi"));
    expect(amb.reply).toMatch(/1\. Médiathèque\n2\. Média IA\nRéponds par le numéro\./);
    const week = await bossAiTurn(kit.deps, kit.input("le plan de la semaine"));
    const ls = (week.reply ?? "").split("\n");
    expect(ls).toHaveLength(8);
    expect(["Tu veux le détail ?", "Je t'envoie le reste ?", "Tu veux la suite ?"]).toContain(ls[7]);
  });
});
