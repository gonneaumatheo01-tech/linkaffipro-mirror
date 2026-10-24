/**
 * Outils des tests du Boss (phase 26) : base en mémoire avec des équipes, canaux, personas et catégories de paris,
 * fausse IA (aucun réseau). Jamais importé par le code de production.
 */
import { createTestKit } from "../human/test-kit";
import { createFakeBossLlm, type FakeBossTable } from "./llm";
import type { BossDeps, BossTeamInput } from "./contract";

export async function createBossKit(table: FakeBossTable = [], opts: { writer?: (user: string) => string } = {}) {
  const kit = createTestKit();
  const p = kit.prisma;
  const lea = await p.persona.create({ data: { name: "Léa", isActive: true, universe: "dating" } as never });
  const emma = await p.persona.create({ data: { name: "Emma", isActive: true, universe: "dating" } as never });
  const chLea = await p.channel.create({ data: { title: "Léa en privé", vertical: "DATING" } as never });
  const chEmma = await p.channel.create({ data: { title: "Emma Rencontres", vertical: "DATING" } as never });
  const casino = await p.channel.create({ data: { title: "Casino VIP", vertical: "CASINO" } as never });
  const casino2 = await p.channel.create({ data: { title: "Casino Bonus", vertical: "CASINO" } as never });
  const sports = await p.channel.create({ data: { title: "Paris Foot", vertical: "SPORTS" } as never });
  const test = await p.channel.create({ data: { title: "Canal Test", isTest: true } as never });
  await p.channelAgentPlan.create({ data: { channelId: chLea.id, teamKey: "dating", enabled: true, postsPerDay: 3, personaId: lea.id, mix: { video: 1, photo: 2, text: 1 } } as never });
  await p.channelAgentPlan.create({ data: { channelId: chEmma.id, teamKey: "dating", enabled: false, postsPerDay: 2, personaId: emma.id } as never });
  await p.channelAgentPlan.create({ data: { channelId: casino.id, teamKey: "casino", enabled: true, postsPerDay: 4 } as never });
  const tirs = await p.betCategory.create({ data: { key: "tirs-cadres", name: "Tirs cadrés", active: true, sortOrder: 0, picksPerDay: 2 } as never });
  const corners = await p.betCategory.create({ data: { key: "corners", name: "Corners", active: false, sortOrder: 1, picksPerDay: 2 } as never });
  const llm = createFakeBossLlm(table, opts);
  const deps: BossDeps = { ...kit.deps, llm };
  let msg = 1000;
  const input = (text: string, extra: Partial<BossTeamInput> = {}): BossTeamInput => ({ text, messageId: msg++, source: "text", ...extra });
  return { ...kit, deps, llm, input, ids: { lea: lea.id, emma: emma.id, chLea: chLea.id, chEmma: chEmma.id, casino: casino.id, casino2: casino2.id, sports: sports.id, test: test.id, tirs: tirs.id, corners: corners.id } };
}

export type BossKit = Awaited<ReturnType<typeof createBossKit>>;
