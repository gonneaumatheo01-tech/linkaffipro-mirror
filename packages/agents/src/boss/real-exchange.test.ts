/**
 * Premier vrai échange du client avec Kevin (journal `BossTurn` de la production, nuit du 24 au 25 octobre), rejoué
 * de bout en bout sur fausse IA : la fausse IA rend les MÊMES outils que la vraie a rendus cette nuit-là. Corrections :
 * 1. réponse à une liste de Kevin par numéro ou par nom ; 2. noms de canaux en lettres stylisées ; 3. canal Test sans
 * univers ; 4. canal privé sans compte libre expliqué ; 5. plus jamais l'ancien « Je ne sais pas encore faire ça » ;
 * 6. lien sans canal cible → liste numérotée de nos canaux.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBossKit, type BossKit } from "./testing";
import { bossAiTurn, UNMET_HEADS } from "./execute";
import { bossFastPath } from "./fast";
import { isWhyFollowUp, pickOption } from "./choices";
import { matchNames, normName } from "./resolve";
import { universeFromText } from "../inspiration/kevin-refs";
import { kevinForwardedPost } from "../inspiration/kevin-forward";
import { resetVoiceRotation, voiceCheck } from "./voice";
import type { BossTeamInput } from "./contract";
import type { FakeBossTable } from "./llm";

vi.mock("../inspiration/kevin-ports", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  enqueueReferenceRead: vi.fn(async () => undefined),
}));

const ADMIN = 4242n;
const adminCtx = { speaker: { kind: "admin" as const, telegramUserId: ADMIN, firstName: "Mathéo" }, chat: { type: "private" as const, chatId: ADMIN } };
const LINK = "https://t.me/+dryj-6sk6t5lNGY0";
const CORNER = "🚩𝑪𝑶𝑹𝑵𝑬𝑹";

const tool = (name: string, input: Record<string, unknown>) => ({ name, input });
/** Ce que la vraie IA a choisi cette nuit-là, message par message. */
const REAL_AI: FakeBossTable = [
  [/réponse à ta question[\s\S]*: Test\)$/, tool("analyser_canal", { canal: LINK, canal_cible: "Test" })],
  ["Tu peux t'inspirer de ce canal : https://t.me/+dryj-6sk6t5lNGY0", tool("analyser_canal", { canal: LINK })],
  [
    `Inspire toi de ça ${CORNER} pour tir cadré`,
    tool("preciser", { question: `Pour quel canal de nos paris sportifs veux-tu t'inspirer de ${CORNER} pour les tirs cadrés ?`, choix1: "paris sportif 1", choix2: "Paris sportifs 2", choix3: "Test" }),
  ],
  [`Non inspire toi de ${LINK} pour ${CORNER}`, tool("analyser_canal", { canal: LINK, canal_cible: CORNER })],
  [
    `Inspire toi de ${LINK} pour tir cadré`,
    tool("preciser", { question: "Pour quel canal de paris sportifs veux-tu t'inspirer du lien pour les tirs cadrés ?", choix1: "paris sportif 1", choix2: "Paris sportifs 2", choix3: "Test" }),
  ],
  [`Inspire toi de ${LINK}`, tool("preciser", { question: "Pour quel canal veux-tu que je m'inspire de ce lien ?", choix1: CORNER, choix2: "paris sportif 1", choix3: "Paris sportifs 2", choix4: "Test" })],
  [`Je veux que tu t'inspire de ce canal ${LINK} pour le canal test`, tool("analyser_canal", { canal: LINK, canal_cible: "le canal test" })],
];

let kit: BossKit;
let ids: { corner: string; ps1: string; ps2: string; test: string };

async function setupProd(table: FakeBossTable = REAL_AI) {
  kit = await createBossKit(table);
  // Les canaux de la production : 🚩𝑪𝑶𝑹𝑵𝑬𝑹, paris sportif 1, Paris sportifs 2 (paris sportifs) et Test (sans univers).
  await kit.prisma.channel.updateMany({ where: {}, data: { isActive: false } } as never);
  const mk = async (title: string) => (await kit.prisma.channel.create({ data: { title, vertical: "SPORTS", isActive: true } } as never)) as { id: string };
  const corner = await mk(CORNER);
  const ps1 = await mk("paris sportif 1");
  const ps2 = await mk("Paris sportifs 2");
  await kit.prisma.channel.update({ where: { id: kit.ids.test }, data: { title: "Test", isActive: true, vertical: null } } as never);
  ids = { corner: corner.id, ps1: ps1.id, ps2: ps2.id, test: kit.ids.test };
  // Un seul compte réel, qui porte la persona Léa et un bot fantôme : jamais utilisé pour lire un canal.
  await kit.prisma.telegramUserAccount.create({
    data: { label: "Lea", phone: "+33612345678", sessionEncrypted: "x", status: "ACTIVE", isActive: true, personaId: kit.ids.lea, botId: "bot-fantome" },
  } as never);
}

async function say(text: string, extra: Partial<BossTeamInput> = {}): Promise<string> {
  const input = kit.input(text, { ...adminCtx, ...extra });
  const fast = await bossFastPath(kit.deps, input);
  if (fast.handled) return fast.reply ?? "";
  return (await bossAiTurn(kit.deps, input)).reply ?? "";
}

const OLD_UNMET = /Je ne sais pas encore faire|Je sais par exemple|Écris aide pour tout voir/;
function expectNeverUnmet(reply: string) {
  expect(reply).not.toMatch(OLD_UNMET);
  for (const head of UNMET_HEADS) expect(reply).not.toContain(head);
  expect(reply).not.toMatch(/fiche d'abord|Redis-moi la phrase avec|Tu veux dire quoi par/);
}

beforeEach(async () => {
  resetVoiceRotation();
  await setupProd();
});

describe("correspondance d'une réponse avec une option (pur)", () => {
  const labels = [CORNER, "paris sportif 1", "Paris sportifs 2", "Test"];
  it("numéro, « le 3 », nom, fautes, accents, lettres stylisées", () => {
    expect(pickOption("3", labels)).toBe(2);
    expect(pickOption("le 3", labels)).toBe(2);
    expect(pickOption("3.", labels)).toBe(2);
    expect(pickOption("n°4", labels)).toBe(3);
    expect(pickOption("Test", labels)).toBe(3);
    expect(pickOption("le canal test", labels)).toBe(3);
    expect(pickOption("paris sportif 1", labels)).toBe(1);
    expect(pickOption("Paris sportifs 2", labels)).toBe(2);
    expect(pickOption("paris sportf 1", labels)).toBe(1);
    expect(pickOption("corner", labels)).toBe(0);
    expect(pickOption("Corners", labels)).toBe(0);
    expect(pickOption(CORNER, labels)).toBe(0);
    expect(pickOption("le premier", labels)).toBe(0);
  });
  it("jamais un choix : numéro hors liste, nom ambigu, phrase longue", () => {
    expect(pickOption("7", labels)).toBeNull();
    expect(pickOption("paris sportif", labels)).toBeNull();
    expect(pickOption(`Je veux que tu t'inspire de ce canal ${LINK} pour le canal test`, labels)).toBeNull();
  });
  it("canal en lettres stylisées retrouvé par « corner », « Corner », « 🚩𝑪𝑶𝑹𝑵𝑬𝑹 »", () => {
    expect(normName(CORNER)).toBe("corner");
    const items = [{ id: "c", name: CORNER }, { id: "t", name: "Test" }];
    for (const raw of ["corner", "Corner", CORNER, "corners"]) expect(matchNames(raw, items).map((i) => i.id), raw).toEqual(["c"]);
  });
  it("univers dit dans la demande ; questions qui suivent un blocage", () => {
    expect(universeFromText(`Inspire toi de ${LINK} pour tir cadré`)).toBe("sports");
    expect(universeFromText("pour la roulette")).toBe("casino");
    expect(universeFromText("côté rencontres")).toBe("dating");
    expect(universeFromText(`Inspire toi de ${LINK}`)).toBeNull();
    for (const t of ["Comment ça aucune compte réel ?", "pourquoi ?", "c'est quoi un compte réel ?", "je comprends pas"]) expect(isWhyFollowUp(t), t).toBe(true);
    expect(isWhyFollowUp("Inspire toi de ça pour tir cadré")).toBe(false);
  });
});

describe("la conversation réelle, de bout en bout", () => {
  it("chaque réponse de Kevin avance ; à la fin, la référence attend les posts transférés pour Test", async () => {
    const replies: string[] = [];
    const turn = async (text: string) => {
      const r = await say(text);
      replies.push(r);
      expectNeverUnmet(r);
      expect(voiceCheck(r, { allowList: true }).problems.filter((p) => p.code !== "repetition"), r).toEqual([]);
      kit.advance(30_000);
      return r;
    };

    // 6. Lien sans canal cible : la liste numérotée de nos canaux, tout de suite.
    const r1 = await turn("Tu peux t'inspirer de ce canal : https://t.me/+dryj-6sk6t5lNGY0");
    expect(r1).toMatch(/lequel de nos canaux/);
    for (const name of [CORNER, "paris sportif 1", "Paris sportifs 2", "Test"]) expect(r1).toContain(name);
    expect(r1).toMatch(/\n1\. /);

    // 1 + 2. Réponse par le nom stylisé : le canal est reconnu ; 4. pas de compte libre → pourquoi et quoi faire.
    const r2 = await turn(CORNER);
    expect(r2).toContain("Ton seul compte Telegram relié (Lea, numéro finissant par 78, celui de Léa)");
    expect(r2).toMatch(/je ne m'en sers jamais pour lire un autre canal|je ne l'utilise jamais pour lire un autre canal/i);
    expect(r2).toMatch(/1\. tu me transfères 20 à 30 de ses posts ici, je les range pour 🚩𝑪𝑶𝑹𝑵𝑬𝑹/);
    expect(r2).toContain("Réglages → Comptes Telegram");
    expect(r2).not.toContain("612345678");

    // 4. « Comment ça aucun compte réel ? » : la même explication, jamais « pas prévu ».
    const r3 = await turn("Comment ça aucune compte réel ?");
    expect(r3).toContain("Ton seul compte Telegram relié");

    const r4 = await turn(`Inspire toi de ça ${CORNER} pour tir cadré`);
    expect(r4).toMatch(/1\. paris sportif 1\n2\. Paris sportifs 2\n3\. Test/);

    const r5 = await turn(`Non inspire toi de ${LINK} pour ${CORNER}`);
    expect(r5).toMatch(/compte Telegram relié/);

    const r6 = await turn(`Inspire toi de ${LINK} pour tir cadré`);
    expect(r6).toMatch(/3\. Test/);

    // 1. « 3 » rejoue la demande d'origine complétée par « Test » ; 3. univers « tir cadré » → paris sportifs.
    const r7 = await turn("3");
    expect(r7).toMatch(/je les range pour Test/);
    expect(kit.llm.calls.interpret.at(-1)!.user).toMatch(/Inspire toi de https:\/\/t\.me\/\+dryj-6sk6t5lNGY0 pour tir cadré\n\(réponse à ta question .* : Test\)/);

    const r8 = await turn(`Inspire toi de ${LINK}`);
    expect(r8).toMatch(/4\. Test/);

    // 1. « Test » (le nom d'une option) : rejoué, plus jamais « Tu veux dire quoi par Test ? ».
    const r9 = await turn("Test");
    expect(r9).toMatch(/je les range pour Test/);

    // 3. Dernier message : canal Test, univers repris de la référence (paris sportifs), jamais « règle-le dans sa fiche ».
    const r10 = await turn(`Je veux que tu t'inspire de ce canal ${LINK} pour le canal test`);
    expect(r10).toMatch(/je les range pour Test/);

    // Une seule référence pour ce lien, cibles 🚩𝑪𝑶𝑹𝑵𝑬𝑹 et Test, univers paris sportifs, en attente de posts.
    const refs = kit.tables("referenceChannel");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ universe: "sports", status: "UNAVAILABLE" });
    expect(refs[0]!.targetChannelIds).toEqual(expect.arrayContaining([ids.corner, ids.test]));
    // Aucune entrée tentée sans compte libre ; aucun tour « pas prévu ».
    expect(kit.tables("bossTurn").filter((t) => t.status === "unmet")).toEqual([]);
    expect(kit.tables("bossTurn").filter((t) => t.role === "BOSS").every((t) => !OLD_UNMET.test(String(t.text)))).toBe(true);

    // Les posts transférés ensuite vont tout seuls dans cette référence.
    const out = await kevinForwardedPost(kit.deps, {
      message: { message_id: 9001, date: 1_792_000_000, text: "Corner ce soir : plus de 9,5", forward_origin: { type: "channel", date: 1_791_000_000, chat: { id: -100555, type: "channel", title: "Club Corner" }, message_id: 77 } } as never,
      chat: adminCtx.chat,
      speaker: adminCtx.speaker,
    });
    expect(out.handled).toBe(true);
    expect(kit.tables("referenceChannel")).toHaveLength(1);
    expect(kit.tables("referencePost")).toHaveLength(1);
    expect(kit.tables("referencePost")[0]!.referenceChannelId).toBe(refs[0]!.id);
  });

  it("« 1 » / « 2 » après l'explication : la marche à suivre, jamais « pas prévu »", async () => {
    await say(`Non inspire toi de ${LINK} pour ${CORNER}`);
    const one = await say("1");
    expect(one).toMatch(/transfère-moi 20 à 30 de ses posts ici/);
    expectNeverUnmet(one);
    const two = await say("2");
    expect(two).toMatch(/Réglages → Comptes Telegram/);
    expectNeverUnmet(two);
  });

  it("aucun compte relié : Kevin le dit", async () => {
    await kit.prisma.telegramUserAccount.deleteMany({ where: {} } as never);
    const r = await say(`Non inspire toi de ${LINK} pour ${CORNER}`);
    expect(r).toMatch(/aucun compte Telegram (n'est )?relié|Aucun compte Telegram n'est relié/i);
  });

  it("canal Test sans univers dans la demande ni la référence : UNE question numérotée, réponse par numéro ou par nom", async () => {
    const r = await say(`Je veux que tu t'inspire de ce canal ${LINK} pour le canal test`);
    expect(r).toMatch(/quel univers \?\n1\. Paris sportifs\n2\. Casino\n3\. Rencontres/);
    expectNeverUnmet(r);
    const after = await say("Paris sportifs");
    expect(after).toMatch(/je les range pour Test/);
    expect(kit.tables("referenceChannel")[0]).toMatchObject({ universe: "sports" });
  });

  it("avec un compte libre : le OUI fait entrer le compte, l'inspiration vers Test est lancée", async () => {
    const joins: string[] = [];
    (kit.deps as Record<string, unknown>).inspirationReader = {
      available: true,
      memberAccounts: async () => [],
      history: async () => ({ posts: [], title: null, chatId: null }),
      joinWithInvite: async (_a: string, link: string) => {
        joins.push(link);
        return { ok: true, chatId: -100999n, title: "Club Corner" };
      },
    };
    (kit.deps as Record<string, unknown>).inspirationSleep = async () => undefined;
    await kit.prisma.telegramUserAccount.create({ data: { label: "Max", phone: "+33698765412", sessionEncrypted: "x", status: "ACTIVE", isActive: true, personaId: null, botId: null } } as never);
    await say(`Inspire toi de ${LINK} pour tir cadré`);
    const ask = await say("3");
    expect(ask).toMatch(/compte Max par ce lien \?/);
    expect(ask).toContain("C'est pour Test.");
    expect(ask).not.toContain("id:");
    const done = await say("OUI");
    expect(done).toMatch(/compte Max est entré/);
    expect(joins).toEqual([LINK]);
    const ref = kit.tables("referenceChannel").find((x) => x.title === "Club Corner")!;
    expect(ref).toMatchObject({ universe: "sports", targetChannelIds: [ids.test] });
  });
});
