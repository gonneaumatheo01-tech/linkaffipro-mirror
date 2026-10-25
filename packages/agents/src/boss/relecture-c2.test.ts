/**
 * Phase 33 — relecture adverse, correcteur 2 (côté Kevin) : un test par défaut corrigé. Base en mémoire, fausse IA,
 * aucun réseau.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "@linkaffipro/ai";
import { createBossKit } from "./testing";
import { bossAiTurn, lastBossText, nearestActions, oopsReply, runBossAction, suggestable, unmetReply } from "./execute";
import { bossFastPath, FAST_VARIANTS } from "./fast";
import { BOSS_CATALOG, bossAction } from "./catalog";
import { BOSS_READ_KEYS } from "./team/rights";
import { BOSS_MEMBER_PLAN_DAILY_LIMIT, claimMemberPlanTurn } from "./team/members";
import { bossLlmFromClient, estimatedFailedPlanCents, loadBossLlm } from "./llm";
import {
  BOSS_DEFERRED_SETTING,
  deferBossPending,
  deferredOrderIds,
  noticeStaleMemberOrder,
  readBossPending,
  sendNextDeferredBossPending,
} from "./confirm";
import { emojiCount, kevinText, pick, resetVoiceRotation, rewriteForVoice, varyAgainst, voiceCheck, voiceFidelityProblems } from "./voice";
import { hasKeyLikeToken, isSecretAdminText } from "../admin/commands";
import { ordersMemoryLines, orderInConversation } from "../orders/current";
import { decideValidation } from "../validation/requests";
import { formatQuestion } from "../human/requests";
import type { BossSpeaker } from "./contract";

beforeEach(() => resetVoiceRotation());

const ADMIN = 4242n;
const GROUP = -100777n;
const lea = (role: "MEMBER" | "MANAGER" = "MEMBER"): BossSpeaker => ({ kind: "member", telegramUserId: 777n, memberId: "m777", role, firstName: "Léa" });
const plain = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "");
const rep = (r: object): string => (r as { reply?: string }).reply ?? "";
const ORDER_TOOL = (m: string) => ({ name: "ordre_equipe", input: { demande: m } });

// ------------------------------------------------------------------------------------------------ 1. GRAVE

describe("1. une proposition faite quand Kevin ne peut pas est TOUJOURS une lecture", () => {
  it("aucune entrée qui change, défait ou dépense n'est proposable", () => {
    for (const a of BOSS_CATALOG) if (suggestable(a)) expect(BOSS_READ_KEYS.has(a.key), a.key).toBe(true);
    for (const k of ["annuler_reglage", "annuler_inspiration", "arreter_ordre", "modifier_ordre", "plus_tard", "test_bookmaker", "pause", "simulation"]) {
      const a = bossAction(k, { includeHidden: true });
      if (a) expect(suggestable(a), k).toBe(false);
    }
  });

  it("demandes impossibles proches d'une annulation : la confirmation créée est une lecture", async () => {
    for (const text of ["annule le réglage d'hier en douce", "arrête l'ordre et rembourse-moi", "teste le bookmaker sur la lune", "plus tard la semaine prochaine fais un gâteau"]) {
      const kit = await createBossKit();
      await unmetReply(kit.deps, text);
      const p = await readBossPending(kit.deps);
      expect(p, text).not.toBeNull();
      expect(BOSS_READ_KEYS.has(p!.actionKey), `${text} → ${p!.actionKey}`).toBe(true);
    }
    for (const a of nearestActions("annule le réglage, arrête l'ordre").filter(suggestable)) expect(BOSS_READ_KEYS.has(a.key)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ 2. GRAVE

describe("2. confirmation déjà ouverte : la proposition se prend par numéro, jamais par OUI", () => {
  it("« vrai casino » en attente, demande impossible, « oui » → le passage en vrai ne part pas ; Kevin redemande", async () => {
    const kit = await createBossKit([["commande une pizza", { name: "pas_prevu", input: {} }]]);
    const live = await runBossAction(kit.deps, bossAction("simulation")!, { equipe: "casino", mode: "vrai" }, { actor: { userId: null, via: "TELEGRAM" } });
    expect(live.status).toBe("confirm");
    const before = await readBossPending(kit.deps);
    const r = await bossAiTurn(kit.deps, kit.input("commande une pizza"));
    expect(r.buttons).toBeUndefined();
    expect(plain(r.reply)).toMatch(/réponds 1/);
    expect(voiceCheck(r.reply ?? "").problems).toEqual([]);
    // La confirmation du passage en vrai est toujours là, inchangée.
    expect((await readBossPending(kit.deps))?.id).toBe(before!.id);

    const yes = await bossFastPath(kit.deps, kit.input("oui"));
    expect(yes.handled).toBe(true);
    expect(plain(rep(yes))).toMatch(/Casino en vrai/);
    expect(plain(rep(yes))).toMatch(/OUI/);
    expect((await kit.prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } }))?.simulation ?? true).toBe(true);

    // « 1 » : la proposition (une lecture), sans toucher à la confirmation.
    const one = await bossFastPath(kit.deps, kit.input("1"));
    expect(one.handled).toBe(true);
    expect((await kit.prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } }))?.simulation ?? true).toBe(true);

    // OUI redemandé clairement, puis redit : là seulement le passage en vrai part.
    const again = await bossFastPath(kit.deps, kit.input("oui"));
    expect(again.handled).toBe(true);
    expect((await kit.prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } }))?.simulation).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ 3. MOYEN (coût)

describe("3. coût : droits et limite du jour avant le planificateur", () => {
  it("un simple membre ne déclenche jamais le planificateur : sa demande part chez l'admin en une ligne", async () => {
    const kit = await createBossKit([[/./, (m: string) => ORDER_TOOL(m)]], { planner: () => null });
    const r = await bossAiTurn(kit.deps, kit.input("programme 2 posts roulette par jour sur le canal Test", { speaker: lea(), chat: { type: "private", chatId: 777n } }));
    expect(kit.llm.calls.plan).toHaveLength(0);
    expect(plain(r.reply)).toMatch(/qui décide|transmis/);
    expect(kit.sent.at(-1)?.html).toMatch(/Léa (demande|voudrait) : « programme 2 posts roulette/);
    expect(kit.sent.at(-1)!.html.split("\n")).toHaveLength(1);
  });

  it("dans le groupe : une ligne avec la mention de l'admin, sans plan", async () => {
    const kit = await createBossKit([[/./, (m: string) => ORDER_TOOL(m)]], { planner: () => null });
    const r = await bossAiTurn(kit.deps, kit.input("mets 3 paris corners sur le canal Test", { speaker: lea(), chat: { type: "group", chatId: GROUP } }));
    expect(kit.llm.calls.plan).toHaveLength(0);
    expect(plain(r.reply)).toMatch(/Léa (demande|voudrait) : « mets 3 paris corners/);
  });

  it("un responsable : vrai canal → transmis sans plan ; canal Test → 5 plans par jour au plus", async () => {
    const kit = await createBossKit([[/./, (m: string) => ORDER_TOOL(m)]], { planner: () => null });
    const manager = lea("MANAGER");
    const chat = { type: "private" as const, chatId: 777n };
    await bossAiTurn(kit.deps, kit.input("programme 2 paris par jour sur Paris Foot", { speaker: manager, chat }));
    await bossAiTurn(kit.deps, kit.input("programme 2 paris en vrai", { speaker: manager, chat }));
    expect(kit.llm.calls.plan).toHaveLength(0);
    for (let i = 0; i < BOSS_MEMBER_PLAN_DAILY_LIMIT + 2; i++) await bossAiTurn(kit.deps, kit.input(`programme ${i + 1} paris sur le canal Test`, { speaker: manager, chat }));
    expect(kit.llm.calls.plan).toHaveLength(BOSS_MEMBER_PLAN_DAILY_LIMIT);
    // L'admin n'est limité que par le plafond.
    await bossAiTurn(kit.deps, kit.input("programme 9 paris sur le canal Test"));
    expect(kit.llm.calls.plan).toHaveLength(BOSS_MEMBER_PLAN_DAILY_LIMIT + 1);
  });

  it("limite du jour : 5 puis non, de nouveau le lendemain", async () => {
    const kit = await createBossKit();
    for (let i = 0; i < 5; i++) expect(await claimMemberPlanTurn(kit.deps, 777n)).toBe(true);
    expect(await claimMemberPlanTurn(kit.deps, 777n)).toBe(false);
    kit.advance(24 * 3600_000);
    expect(await claimMemberPlanTurn(kit.deps, 777n)).toBe(true);
  });

  it("planificateur : client dédié (120 s, sans relance) ; un appel en échec est compté à l'estimation", async () => {
    const kit = await createBossKit();
    const failing: AiClient = { createMessage: vi.fn(async () => Promise.reject(new Error("délai dépassé"))) };
    const short: AiClient = { createMessage: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, cacheWriteTokens: 0 }, stopReason: null })) };
    const llm = bossLlmFromClient(kit.prisma as never, short, { planClient: failing, now: () => new Date("2026-10-23T08:00:00Z") });
    const req = { system: "x".repeat(4000), user: "y".repeat(4000) };
    await expect(llm.plan!(req)).rejects.toThrow("délai dépassé");
    expect(failing.createMessage).toHaveBeenCalledTimes(1);
    expect(short.createMessage).not.toHaveBeenCalled();
    const usage = kit.tables("agentUsage")[0] as { cents: number; calls: number };
    expect(usage.calls).toBe(1);
    expect(usage.cents).toBe(estimatedFailedPlanCents(req));
    expect(usage.cents).toBeGreaterThan(0);
  });

  it("loadBossLlm : le planificateur a sa propre fabrique (délai long, aucune relance)", async () => {
    const kit = await createBossKit();
    await kit.prisma.setting.create({ data: { key: "ai.config", value: {} } as never });
    const src = readFileSync(fileURLToPath(new URL("./llm.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/timeoutMs: BOSS_PLAN_TIMEOUT_MS, maxRetries: 0/);
    expect(src).toMatch(/BOSS_PLAN_TIMEOUT_MS = 120_000/);
    expect(await loadBossLlm(kit.prisma as never, { factory: () => ({}) as AiClient, planFactory: () => ({}) as AiClient })).toBeDefined();
  });
});

// ------------------------------------------------------------------------------------------------ 4. MOYEN (erreurs)

describe("4. jamais d'erreur brute envoyée à l'admin", () => {
  it("interprète en panne, chemin rapide en panne, action confirmée en panne : message simple", async () => {
    const kit = await createBossKit();
    const llm = { interpret: vi.fn(async () => Promise.reject(new Error("ECONNRESET 10.0.0.1:443 détail interne"))), write: vi.fn() };
    const r = await bossAiTurn({ ...kit.deps, llm: llm as never }, kit.input("bonjour toi"));
    expect(r.reply).not.toMatch(/ECONNRESET|détail interne|IA ne répond/);
    expect(r.reply).toMatch(/de mon côté/);
    const broken = { ...kit.deps, prisma: new Proxy(kit.prisma, { get: () => { throw new Error("relation \"BossTurn\" does not exist"); } }) };
    const f = await bossFastPath(broken as never, kit.input("salut"));
    expect(rep(f)).not.toMatch(/relation|BossTurn/);
    expect(oopsReply("secret interne")).not.toContain("secret interne");
  });
});

// ------------------------------------------------------------------------------------------------ 5. MOYEN (voix)

describe("5. voix des textes envoyés par Kevin", () => {
  it("« t'es un bot ? » d'un membre : réponse franche sans IA", async () => {
    const kit = await createBossKit();
    const r = await bossFastPath(kit.deps, kit.input("t'es un bot ?", { speaker: lea(), chat: { type: "group", chatId: GROUP } }));
    expect(r.handled).toBe(true);
    expect(FAST_VARIANTS.areYouABot).toContain(rep(r));
    const thanks = await bossFastPath(kit.deps, kit.input("merci", { speaker: lea(), chat: { type: "group", chatId: GROUP } }));
    expect(thanks.handled).toBe(true);
  });

  it("validations : messages rendus sans « mission » ni « Grand Chef », voix contrôlée", async () => {
    const kit = await createBossKit();
    const m = await kit.prisma.agentMission.create({ data: { teamKey: "casino", status: "WAITING_VALIDATION" } as never });
    const v = await kit.prisma.agentValidation.create({ data: { missionId: m.id, teamKey: "casino", previewText: "x", reason: "nouveau canal" } as never });
    const rejected = await decideValidation(kit.deps, { validationId: v.id, decision: "reject", via: "TELEGRAM" });
    const again = await decideValidation(kit.deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" });
    for (const t of [rejected.message, again.message]) {
      expect(t).not.toMatch(/mission|Grand Chef/i);
      expect(voiceCheck(t).problems, t).toEqual([]);
    }
  });

  it("question et rappel au client : un emoji au plus, pas de titre", () => {
    const q = { id: "q", key: "k", kind: "TEXT", question: "Ton prénom ?", options: null } as never;
    for (const t of [formatQuestion(q), formatQuestion(q, { reminder: true })]) expect(voiceCheck(t).problems, t).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ 6. MOYEN (fidélité)

describe("6. une réécriture garde exactement les chiffres, les noms et le mode", () => {
  const orig = "Le canal Roulette Pro a fait 1,94 de cote moyenne, -12 % de clics, pour de faux.";
  it("refus : chiffre disparu, « 1.94 », arrondi, signe inversé, nom perdu, mode changé", () => {
    const codes = (c: string) => voiceFidelityProblems(orig, c).map((p) => p.code);
    expect(voiceFidelityProblems(orig, "Roulette Pro : cote moyenne 1,94, clics -12 %, pour de faux.")).toEqual([]);
    expect(codes("Roulette Pro : cote moyenne 1,94, pour de faux.")).toContain("chiffres");
    expect(codes("Roulette Pro : cote moyenne 1.94, clics -12 %, pour de faux.")).toContain("format");
    expect(codes("Roulette Pro : cote moyenne 1,9, clics -12 %, pour de faux.")).toContain("chiffres");
    expect(codes("Roulette Pro : cote moyenne 1,94, clics +12 %, pour de faux.")).toContain("chiffres");
    expect(codes("Le canal a une cote moyenne de 1,94, clics -12 %, pour de faux.")).toContain("nom");
    expect(codes("Roulette Pro : cote moyenne 1,94, clics -12 %, en vrai.")).toContain("mode");
    expect(voiceFidelityProblems("Je mets @lea sur le casino.", "Je mets le casino.").map((p) => p.code)).toContain("nom");
  });

  it("rewriteForVoice et kevinText retombent sur le secours", async () => {
    const draft = "Voici : 1,94 de cote sur Roulette Pro, pour de faux.";
    const llm = { write: async () => ({ text: "Cote de 1.94 sur Roulette Pro, pour de faux.", costCents: 1 }) };
    expect((await rewriteForVoice(llm, draft, voiceCheck(draft).problems)).text).toBeNull();
    const lost = { write: async () => ({ text: "Cote de 1,94, pour de faux.", costCents: 1 }) };
    expect(await kevinText({ llm: lost, draft, fallback: "Secours." })).toMatchObject({ source: "fallback" });
    const ok = { write: async () => ({ text: "Cote de 1,94 sur Roulette Pro, pour de faux.", costCents: 1 }) };
    expect(await kevinText({ llm: ok, draft, fallback: "Secours." })).toMatchObject({ source: "rewrite" });
  });
});

// ------------------------------------------------------------------------------------------------ 7. BAS (contrôle)

describe("7. voiceCheck : trous bouchés, répétition branchée", () => {
  const codes = (t: string, o?: Parameters<typeof voiceCheck>[1]) => voiceCheck(t, o).problems.map((p) => p.code);
  it("formules, puces, statuts anglais, emojis composés et drapeaux", () => {
    expect(codes("Voilà, c'est fait.")).toContain("formule");
    expect(codes("C'est fait, n'hesite pas.")).toContain("formule");
    expect(codes("C'est lancé. Avec plaisir !")).toContain("formule");
    expect(codes("Avec plaisir 👍", { allowThanks: true })).toEqual([]);
    expect(codes(["Les posts :", "— a", "— b", "➤ c", "➤ d", "— e"].join("\n"))).toContain("puces");
    for (const w of ["PROPOSED", "WON", "LOST", "APPLIED"]) expect(codes(`Le pari est ${w}.`), w).toContain("jargon");
    expect(emojiCount("👨‍👩‍👧")).toBe(1);
    expect(emojiCount("🇫🇷")).toBe(1);
    expect(codes("Bravo 🇫🇷🇫🇷")).toContain("emojis");
    expect(codes("La famille 👨‍👩‍👧 est là.")).toEqual([]);
  });

  it("« merci » → « Avec plaisir » reste permis (table du chemin rapide)", () => {
    for (const t of FAST_VARIANTS.thanks) expect(voiceCheck(t, FAST_VARIANTS.thanks.rules).problems, t).toEqual([]);
  });

  it("pick et varyAgainst évitent le dernier message de Kevin, même d'un autre processus", async () => {
    const v = ["Rien à confirmer.", "Je n'ai rien en attente de ton OUI."];
    const first = pick(v, "c2.test", 1n);
    resetVoiceRotation();
    expect(pick(v, "c2.test", 1n, first)).not.toBe(first);
    const chosen = pick(v, "c2.other", 2n);
    expect(varyAgainst(chosen, chosen)).toBe(v.find((x) => x !== chosen));
    expect(varyAgainst("Tu as dépensé 12 €.", "Tu as dépensé 12 €.")).toBe("Tu as dépensé 12 €.");

    const kit = await createBossKit();
    const a = await bossFastPath(kit.deps, kit.input("oui"));
    kit.advance(1000);
    resetVoiceRotation(); // l'autre processus (site / worker) n'a pas la rotation en mémoire
    const b = await bossFastPath(kit.deps, kit.input("oui"));
    expect(rep(b)).not.toBe(rep(a));
    expect(await lastBossText(kit.deps, null)).toBe(rep(b));
  });
});

// ------------------------------------------------------------------------------------------------ 8. BAS

describe("8. mémoire par conversation, lectures des membres, secrets dans une adresse", () => {
  it("le groupe ne voit pas les ordres donnés en privé", async () => {
    const kit = await createBossKit();
    await kit.prisma.teamOrder.create({ data: { requestText: "a", recap: "Ordre privé de l'admin", kind: "PROGRAM", teamKey: "sports", status: "RUNNING", chatId: ADMIN.toString() } as never });
    await kit.prisma.teamOrder.create({ data: { requestText: "b", recap: "Ordre du groupe", kind: "PROGRAM", teamKey: "casino", status: "RUNNING", chatId: GROUP.toString() } as never });
    const inGroup = (await ordersMemoryLines(kit.deps, GROUP)).join("\n");
    expect(inGroup).toContain("Ordre du groupe");
    expect(inGroup).not.toContain("Ordre privé");
    const priv = (await ordersMemoryLines(kit.deps, ADMIN)).join("\n");
    expect(priv).toContain("Ordre privé");
    expect(priv).not.toContain("Ordre du groupe");
    expect(orderInConversation(null, null)).toBe(true);
    expect(orderInConversation("-1", null)).toBe(false);
  });

  it("lectures des vues : permises à un membre sans charger catalog-view", () => {
    for (const k of ["voir_plan", "voir_programme", "voir_fait", "pourquoi_rien", "fiche_agent", "qu_attend_ma_validation"]) expect(BOSS_READ_KEYS.has(k), k).toBe(true);
    const src = readFileSync(fileURLToPath(new URL("./team/rights.ts", import.meta.url)), "utf8");
    expect(src).toContain('"pourquoi_rien"');
  });

  it("clé dans une adresse web sans le mot « clé »", () => {
    for (const t of ["https://api.exemple.com/v1/odds?key=AbC123xyz789", "regarde https://x.io/a?apikey=ZZtop12345", "https://h.com/cb?code=1&token=eyJhbGciOiJIUzI1"]) {
      expect(hasKeyLikeToken(t), t).toBe(true);
      expect(isSecretAdminText(t), t).toBe(true);
    }
    expect(hasKeyLikeToken("https://example.com/abcdefghij1234567890")).toBe(false);
    expect(hasKeyLikeToken("https://t.me/s/moncanal?before=1234")).toBe(false);
  });

  it("ordre d'un membre mis de côté : repéré (jamais annulé avant que l'admin le voie), puis rattaché à son OUI", async () => {
    const kit = await createBossKit();
    const order = await kit.prisma.teamOrder.create({ data: { requestText: "a", recap: "r", kind: "PROGRAM", teamKey: "sports", status: "WAITING_CONFIRM" } as never });
    await deferBossPending(kit.deps, {
      actionKey: "confirmer_ordre",
      params: { ordre: order.id, op: "launch" },
      summary: "Je lance 2 paris ?",
      text: "Léa demande : je lance 2 paris. OUI ?",
      chatId: null,
      requestedBy: { telegramUserId: "777", firstName: "Léa" },
    });
    expect((await deferredOrderIds(kit.deps)).has(order.id)).toBe(true);
    expect(await sendNextDeferredBossPending(kit.deps)).toBe(true);
    const pending = await readBossPending(kit.deps);
    expect((kit.tables("teamOrder")[0] as { pendingId: string }).pendingId).toBe(pending!.id);
    expect(kit.tables("setting").find((s) => s.key === BOSS_DEFERRED_SETTING)?.value).toEqual([]);
  });

  it("ordre d'un membre annulé faute de OUI : le membre et l'admin sont prévenus, une ligne chacun", async () => {
    const kit = await createBossKit();
    const sendTo = vi.fn(async () => ({ messageId: 1 }));
    (kit.deps.admin as unknown as Record<string, unknown>).sendTo = sendTo;
    await noticeStaleMemberOrder(kit.deps, { number: 12, chatId: GROUP.toString() }, { telegramUserId: "777", firstName: "Léa" });
    expect(sendTo).toHaveBeenCalledWith(GROUP, expect.stringMatching(/ordre n°12/));
    expect(kit.sent.at(-1)!.html).toMatch(/Léa \(ordre n°12\)/);
    for (const t of [kit.sent.at(-1)!.html, (sendTo.mock.calls[0] as unknown as [bigint, string])[1]]) {
      expect(t.split("\n")).toHaveLength(1);
      expect(voiceCheck(t).problems).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------------------------------------ 9. BAS

describe("9. question à une équipe : par le chemin du Grand Chef, jamais une capacité appelée par Kevin", () => {
  it("catalog-orders ne lance plus aucune capacité lui-même", () => {
    const src = readFileSync(fileURLToPath(new URL("./catalog-orders.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/cap\.run\(|cap\.plan\(|cap\.report\(/);
    expect(src).toContain("askTeam(");
  });
});
