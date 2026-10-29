/**
 * Envois programmés de Kevin (29 octobre 2026, « envoie chaque matin tous les canaux Paris sportifs que tu as trouvés à
 * @Raul_FNZ ») : phrase → contenu (lecture seulement) + destinataire → OUI → envoi le lendemain à l'heure dite, une
 * fois par jour ; personne présentée en privé, sinon dans le groupe ; échec signalé à l'admin ; liste et arrêt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBossKit } from "./testing";
import { bossAiTurn, offerFragment } from "./execute";
import { bossFastPath } from "./fast";
import { BOSS_GROUP_SETTING } from "./contract";
import { tickBossRoutines } from "./catalog-routines";
import { dueRoutineDay, listRoutines, routineReadKeys, routineWhenText, type Routine } from "./routines";
import { resetVoiceRotation } from "./voice";
import type { FakeBossTable } from "./llm";

const LEA_TG = 4242n;
const GROUP = -100777n;

const TABLE: FakeBossTable = [
  ["envoie chaque matin la liste des personas a @lea", { name: "programmer_envoi", input: { quoi: "la liste des personas", a_qui: "@lea", quand: "tous_les_jours", heure: 9 } }],
  ["envoie chaque matin la liste des personas a @Raul_FNZ", { name: "programmer_envoi", input: { quoi: "la liste des personas", a_qui: "@Raul_FNZ", quand: "tous_les_jours", heure: 9 } }],
  ["envoie-moi maintenant la liste des personas", { name: "programmer_envoi", input: { quoi: "la liste des personas", a_qui: "moi", quand: "maintenant" } }],
  ["envoie chaque lundi un truc impossible a moi", { name: "programmer_envoi", input: { quoi: "un truc impossible", a_qui: "moi", quand: "lundi" } }],
  ["la liste des personas", { name: "personas", input: {} }],
  ["un truc impossible", { name: "pause", input: { equipe: "casino" } }],
];

async function kit(opts: { group?: boolean; lea?: boolean; dmFails?: boolean } = {}) {
  const k = await createBossKit(TABLE);
  const out: { chatId: bigint; html: string }[] = [];
  (k.deps.admin as unknown as Record<string, unknown>).sendTo = vi.fn(async (chatId: bigint, html: string) => {
    if (opts.dmFails && chatId === LEA_TG) return null;
    out.push({ chatId, html });
    return { messageId: 1 };
  });
  await k.prisma.bot.create({ data: { username: "kevin_boss_bot", role: "ADMIN", isActive: true, name: "Kevin" } as never });
  if (opts.group) await k.prisma.setting.create({ data: { key: BOSS_GROUP_SETTING, value: GROUP.toString() } });
  if (opts.lea !== false)
    await k.prisma.teamMember.create({ data: { telegramUserId: LEA_TG, username: "lea", firstName: "Léa", role: "MEMBER", responsibilities: { teams: ["dating"] }, startedPrivateAt: new Date() } as never });
  return { ...k, out };
}

const text = (r: { reply?: string }) => r.reply ?? "";

beforeEach(() => resetVoiceRotation());

describe("envois programmés : règles (pures)", () => {
  const base: Pick<Routine, "days" | "hour" | "minute" | "lastDay" | "createdAt"> = { days: "tous_les_jours", hour: 9, minute: 0, lastDay: null, createdAt: "2026-10-23T08:00:00Z" };
  it("créé à 10 h pour 9 h : demain seulement ; une fois par jour ; rattrapage le jour même", () => {
    expect(dueRoutineDay(base, new Date("2026-10-23T08:10:00Z"))).toBeNull();
    expect(dueRoutineDay(base, new Date("2026-10-24T06:59:00Z"))).toBeNull();
    expect(dueRoutineDay(base, new Date("2026-10-24T07:00:00Z"))).toBe("2026-10-24");
    expect(dueRoutineDay({ ...base, lastDay: "2026-10-24" }, new Date("2026-10-24T12:00:00Z"))).toBeNull();
    expect(dueRoutineDay(base, new Date("2026-10-24T15:00:00Z"))).toBe("2026-10-24");
  });
  it("semaine sans samedi ni dimanche ; un jour précis seulement ce jour-là", () => {
    expect(dueRoutineDay({ ...base, days: "semaine" }, new Date("2026-10-24T10:00:00Z"))).toBeNull(); // samedi
    expect(dueRoutineDay({ ...base, days: "semaine" }, new Date("2026-10-26T10:00:00Z"))).toBe("2026-10-26"); // lundi
    expect(dueRoutineDay({ ...base, days: "lundi" }, new Date("2026-10-27T10:00:00Z"))).toBeNull();
    expect(routineWhenText({ days: "semaine", hour: 18, minute: 30 })).toBe("du lundi au vendredi à 18 h 30");
    expect(routineWhenText({ days: "lundi", hour: 8, minute: 0 })).toBe("chaque lundi à 8 h");
  });
  it("lectures seulement : jamais une action qui change quelque chose", () => {
    const keys = routineReadKeys();
    for (const k of ["personas", "prospects_filtre", "paris_du_jour", "depenses_du_mois"]) expect(keys.has(k), k).toBe(true);
    for (const k of ["pause", "reprise", "prospect_statut", "programmer_envoi", "arreter_envoi", "aide", "repondre_demande"]) expect(keys.has(k), k).toBe(false);
  });
  it("proposition quand Kevin ne peut pas : jamais « je peux les … »", () => {
    expect(offerFragment("Les prochains canaux Telegram d'affiliés à contacter, avec leurs boutons (« montre »)")).toBe("te montrer les prochains canaux Telegram d'affiliés à contacter, avec leurs boutons");
    expect(offerFragment("Dire où en sont les agents")).toBe("te dire où en sont les agents");
  });
});

describe("envois programmés : de la phrase à l'envoi", () => {
  it("« chaque matin … à @lea » : récapitulatif, OUI, rien aujourd'hui, envoi en privé demain à 9 h, une seule fois", async () => {
    const k = await kit();
    const ask = await bossAiTurn(k.deps, k.input("envoie chaque matin la liste des personas a @lea"));
    expect(text(ask)).toContain("Chaque jour à 9 h, j'envoie à Léa (@lea) : la liste des personas.");
    const yes = await bossFastPath(k.deps, k.input("OUI"));
    expect(JSON.stringify(yes)).toMatch(/C'est (programmé|noté)/);
    const items = await listRoutines(k.deps);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ days: "tous_les_jours", hour: 9, content: { kind: "action", actionKey: "personas" }, target: { kind: "member", username: "lea" } });

    expect(await tickBossRoutines(k.deps)).toMatchObject({ due: 0 });
    k.advance(23 * 3600_000); // lendemain 9 h à Paris
    expect(await tickBossRoutines(k.deps)).toMatchObject({ due: 1, sent: 1 });
    expect(k.out).toHaveLength(1);
    expect(k.out[0]!.chatId).toBe(LEA_TG);
    expect(k.out[0]!.html).toMatch(/la liste des personas/);
    expect(k.out[0]!.html).toMatch(/Emma/);
    k.advance(10 * 60_000);
    expect(await tickBossRoutines(k.deps)).toMatchObject({ due: 0 });
    expect(k.out).toHaveLength(1);
  });

  it("@nom inconnu : dans le groupe en le mentionnant ; sans groupe, Kevin explique comment le présenter", async () => {
    const none = await kit({ lea: false });
    const refused = await bossAiTurn(none.deps, none.input("envoie chaque matin la liste des personas a @Raul_FNZ"));
    expect(text(refused)).toMatch(/Je ne connais pas encore @Raul_FNZ|@Raul_FNZ, je ne le connais pas/);
    expect(await listRoutines(none.deps)).toHaveLength(0);

    const k = await kit({ group: true, lea: false });
    const ask = await bossAiTurn(k.deps, k.input("envoie chaque matin la liste des personas a @Raul_FNZ"));
    expect(text(ask)).toContain("@Raul_FNZ (dans le groupe de l'équipe)");
    await bossFastPath(k.deps, k.input("OUI"));
    k.advance(23 * 3600_000);
    await tickBossRoutines(k.deps);
    expect(k.out[0]!.chatId).toBe(GROUP);
    expect(k.out[0]!.html.startsWith("@Raul_FNZ ")).toBe(true);
  });

  it("personne qui n'a pas fait /start : dans le groupe ; sans groupe, l'admin est prévenu une seule fois", async () => {
    const g = await kit({ group: true, dmFails: true });
    await bossAiTurn(g.deps, g.input("envoie chaque matin la liste des personas a @lea"));
    await bossFastPath(g.deps, g.input("OUI"));
    g.advance(23 * 3600_000);
    await tickBossRoutines(g.deps);
    expect(g.out[0]).toMatchObject({ chatId: GROUP });
    expect(g.out[0]!.html.startsWith("@lea ")).toBe(true);

    const k = await kit({ dmFails: true });
    await bossAiTurn(k.deps, k.input("envoie chaque matin la liste des personas a @lea"));
    await bossFastPath(k.deps, k.input("OUI"));
    const before = k.sent.length;
    k.advance(23 * 3600_000);
    expect(await tickBossRoutines(k.deps)).toMatchObject({ failed: 1 });
    k.advance(24 * 3600_000);
    await tickBossRoutines(k.deps);
    const warnings = k.sent.slice(before).filter((m) => /pas pu envoyer|Envoi raté/.test(m.html));
    expect(warnings).toHaveLength(1);
  });

  it("« maintenant » pour l'admin : la réponse est le contenu, rien n'est programmé", async () => {
    const k = await kit();
    await bossAiTurn(k.deps, k.input("envoie-moi maintenant la liste des personas"));
    const yes = await bossFastPath(k.deps, k.input("OUI"));
    expect(JSON.stringify(yes)).toMatch(/Emma/);
    expect(await listRoutines(k.deps)).toHaveLength(0);
  });

  it("contenu qui serait une action (pas une lecture) : refusé avant toute question", async () => {
    const k = await kit();
    const r = await bossAiTurn(k.deps, k.input("envoie chaque lundi un truc impossible a moi"));
    expect(text(r)).toMatch(/quoi envoyer/);
    expect(r.pendingId).toBeUndefined();
  });

  it("liste numérotée et arrêt", async () => {
    const k = await kit();
    await bossAiTurn(k.deps, k.input("envoie chaque matin la liste des personas a @lea"));
    await bossFastPath(k.deps, k.input("OUI"));
    const { bossAction } = await import("./catalog");
    const list = await bossAction("envois_programmes")!.execute(k.deps, {}, { userId: null, via: "TELEGRAM" });
    expect(text(list)).toContain("1. chaque jour à 9 h → Léa (@lea) : la liste des personas");
    const stop = await bossAction("arreter_envoi")!.execute(k.deps, { numero: 1 }, { userId: null, via: "TELEGRAM" });
    expect(text(stop)).toMatch(/la liste des personas/);
    expect(await listRoutines(k.deps)).toHaveLength(0);
  });
});
