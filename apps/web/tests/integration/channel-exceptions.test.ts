import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  getOrCreateBot,
  prismaTelegramDeps,
  resolveRuleForProvenance,
} from "@linkaffipro/telegram";
import { createTestBot, installFakeTelegram, resetDb } from "./helpers";

/**
 * Phase 11, « Qui peut entrer et quand » → exceptions selon la provenance, sur base réelle : chargement de l'onglet
 * (canaux qui envoient leurs membres ici, liens de partage), création (exemple du client : venue de « Tir Cadré » →
 * 1 jour), refus d'un doublon, place dans le groupe, ordre, activation, suppression réservée à l'administrateur,
 * journal de l'équipe, nombre d'exceptions de la liste des canaux, liens des canaux à rejoindre d'une exception créés
 * à l'enregistrement. Telegram est simulé (aucun appel réseau).
 */

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER";
    telegramUserId: bigint | null;
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  },
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

const actions = await import("@/app/(admin)/channels/[id]/actions");
const { loadChannelList, loadRulesTab } = await import("@/lib/channels/queries");
const { initialEntryState, chooseEntry, entryFormFields } =
  await import("@/lib/channels/entry-rule");
const { groupByLevel } = await import("@/lib/channels/exceptions");
const { simulate, simulationChoices } = await import("@/lib/channels/rule-simulator");

type State = ReturnType<typeof initialEntryState>;

function form(channelId: string, provenance: string, state: State, ruleId?: string): FormData {
  const f = new FormData();
  f.append("channelId", channelId);
  f.append("provenance", provenance);
  if (ruleId) f.append("ruleId", ruleId);
  for (const [k, v] of entryFormFields(state)) f.append(k, v);
  return f;
}

/** « Enregistrer l'exception » : message du volet en cas de refus, sinon les paramètres de retour sur l'onglet. */
async function saveException(f: FormData): Promise<{ error?: string; q?: URLSearchParams }> {
  try {
    const r = await actions.saveExceptionAction(null, f);
    return { error: r?.error };
  } catch (err) {
    const url = (err as { url?: string }).url ?? "";
    return { q: new URLSearchParams(url.split("?")[1] ?? "") };
  }
}

async function redirected(fn: () => Promise<unknown>): Promise<URLSearchParams> {
  try {
    await fn();
  } catch (err) {
    return new URLSearchParams(((err as { url?: string }).url ?? "").split("?")[1] ?? "");
  }
  throw new Error("redirection attendue");
}

function ids(channelId: string, ruleId: string, extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.append("channelId", channelId);
  f.append("ruleId", ruleId);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

describe("exceptions selon la provenance (base réelle)", () => {
  const c = { zone: "", tir: "", roulette: "", lyon: "" };
  let managerId = "";
  let adminId = "";
  let shareId = "";

  beforeAll(async () => {
    await resetDb();
    const bot = await createTestBot(711, "DATING");
    installFakeTelegram(getOrCreateBot(bot, prismaTelegramDeps).api);
    const mk = async (n: number, title: string) => {
      const ch = await prisma.channel.create({
        data: {
          telegramChatId: BigInt(-1_001_700_000_000 - n),
          title,
          primaryBotId: bot.id,
          isTest: true,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: ch.id,
          botId: bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      return ch.id;
    };
    c.zone = await mk(1, "Zone Interdite 🔞");
    c.tir = await mk(2, "Tir Cadré");
    c.roulette = await mk(3, "Zone Roulette");
    c.lyon = await mk(4, "Rencontres Lyon");
    const rule = (channelId: string, gate: string[]) =>
      prisma.approvalRule.create({
        data: {
          channelId,
          name: "Règle par défaut",
          isDefault: true,
          mode: "DELAY",
          delaySeconds: 300,
          gateMode: gate.length ? "REQUIRED" : "NONE",
          gateChannelIds: gate,
          reminderAfterMinutes: [],
          maxReminders: 0,
        },
      });
    // Zone Interdite : 5 minutes par défaut. Tir Cadré exige Zone Interdite (il y envoie ses membres).
    await rule(c.zone, []);
    await rule(c.tir, [c.zone]);
    await rule(c.lyon, [c.roulette]);
    shareId = (
      await prisma.inviteLink.create({
        data: {
          channelId: c.zone,
          botId: bot.id,
          telegramInviteLink: "https://t.me/+partage-zone",
          name: "Post Tir Cadré",
          kind: "SHARE",
          sourceChannelId: c.tir,
        },
      })
    ).id;
    const stamp = Date.now();
    const manager = await prisma.user.create({
      data: {
        email: `exc-m-${stamp}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    });
    const admin = await prisma.user.create({
      data: { email: `exc-a-${stamp}@test.local`, passwordHash: "x", name: "Admin", role: "ADMIN" },
    });
    managerId = manager.id;
    adminId = admin.id;
    session.user = { ...manager, role: "MANAGER", telegramUserId: null };
  });

  it("onglet : canaux qui envoient leurs membres ici, liens de partage, aucune exception", async () => {
    const tab = await loadRulesTab(c.zone);
    expect(tab.senders).toEqual([c.tir]);
    expect(tab.exceptions).toEqual([]);
    expect(tab.defaultRule).toMatchObject({ mode: "DELAY", delaySeconds: 300, sendWelcome: true });
    expect(tab.links.map((l) => [l.id, l.kind, l.sourceChannelId])).toEqual([
      [shareId, "SHARE", c.tir],
    ]);
    expect(tab.channels.map((x) => x.title)).toContain("Tir Cadré");
  });

  it("exemple du client : un responsable crée « venue de Tir Cadré → après 1 jour »", async () => {
    const r = await saveException(
      form(c.zone, `channel:${c.tir}`, { ...initialEntryState(null), delayPreset: "1d" }),
    );
    expect(r.error).toBeUndefined();
    expect(r.q?.get("ok")).toMatch(/^Exception enregistrée pour les personnes venues de/);
    const row = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, scope: "SOURCE_CHANNEL" },
    });
    expect(row).toMatchObject({
      isDefault: false,
      sourceChannelId: c.tir,
      mode: "DELAY",
      delaySeconds: 86400,
      gateMode: "NONE",
      sendWelcome: true,
      isActive: true,
      sortOrder: 10,
    });
    expect(row.label).toBe("Venu de « Tir Cadré »");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: managerId, action: "approval_rule.exception_created" },
    });
    expect(audit).toMatchObject({ entityType: "ApprovalRule", entityId: row.id });
    expect(audit.metadata).toMatchObject({ channelId: c.zone, scope: "SOURCE_CHANNEL" });
  });

  it("pas deux exceptions pour la même provenance", async () => {
    const r = await saveException(form(c.zone, `channel:${c.tir}`, initialEntryState(null)));
    expect(r.error).toMatch(/^Une exception existe déjà pour les personnes venues de/);
    expect(
      await prisma.approvalRule.count({ where: { channelId: c.zone, scope: "SOURCE_CHANNEL" } }),
    ).toBe(1);
  });

  it("une « pub TikTok » ajoutée après « n'importe quelle pub » passe avant elle ; lien de partage précis", async () => {
    await saveException(form(c.zone, "kind:AD_ANY", initialEntryState(null)));
    await saveException(
      form(c.zone, "kind:AD_TIKTOK", chooseEntry(initialEntryState(null), "now")),
    );
    await saveException(form(c.zone, `link:${shareId}`, initialEntryState(null)));
    const tab = await loadRulesTab(c.zone);
    expect(
      groupByLevel(tab.exceptions).map((g) => [
        g.scope,
        g.items.map((i) => i.sourceKind ?? i.inviteLinkId ?? i.sourceChannelId),
      ]),
    ).toEqual([
      ["INVITE_LINK", [shareId]],
      ["SOURCE_CHANNEL", [c.tir]],
      ["SOURCE_KIND", ["AD_TIKTOK", "AD_ANY"]],
    ]);
    const order = Object.fromEntries(
      tab.exceptions
        .filter((e) => e.scope === "SOURCE_KIND")
        .map((k) => [k.sourceKind, k.sortOrder]),
    );
    expect(order).toEqual({ AD_TIKTOK: 10, AD_ANY: 20 });
  });

  it("monter / descendre dans le groupe, glisser-déposer ; noté au journal", async () => {
    const any = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, sourceKind: "AD_ANY" },
    });
    const tiktok = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, sourceKind: "AD_TIKTOK" },
    });
    expect(await actions.moveExceptionAction(ids(c.zone, any.id, { direction: "up" }))).toEqual({
      ok: "Exception montée d'un cran.",
    });
    const after = await prisma.approvalRule.findMany({
      where: { id: { in: [any.id, tiktok.id] } },
      select: { id: true, sortOrder: true },
    });
    expect(Object.fromEntries(after.map((r) => [r.id, r.sortOrder]))).toEqual({
      [any.id]: 10,
      [tiktok.id]: 20,
    });
    expect(
      await prisma.auditLog.count({
        where: { userId: managerId, action: "approval_rule.exceptions_reordered" },
      }),
    ).toBe(1);
    const f = new FormData();
    f.append("channelId", c.zone);
    f.append("scope", "SOURCE_KIND");
    f.append("ruleIds", tiktok.id);
    f.append("ruleIds", any.id);
    expect(await actions.reorderExceptionsAction(f)).toEqual({
      ok: "Ordre des exceptions enregistré.",
    });
    expect(
      (await prisma.approvalRule.findUniqueOrThrow({ where: { id: tiktok.id } })).sortOrder,
    ).toBe(10);
  });

  it("désactiver puis réactiver ; la liste des canaux compte les exceptions actives", async () => {
    const any = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, sourceKind: "AD_ANY" },
    });
    expect((await actions.toggleExceptionAction(ids(c.zone, any.id, { active: "0" }))).ok).toMatch(
      /^Exception désactivée/,
    );
    let list = await loadChannelList();
    expect(list.find((x) => x.id === c.zone)?.exceptions).toBe(3);
    expect(list.find((x) => x.id === c.tir)?.exceptions).toBe(0);
    await actions.toggleExceptionAction(ids(c.zone, any.id, { active: "1" }));
    list = await loadChannelList();
    expect(list.find((x) => x.id === c.zone)?.exceptions).toBe(4);
  });

  it("supprimer : refusé au responsable, accepté pour l'administrateur ; le groupe est renuméroté", async () => {
    const tiktok = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, sourceKind: "AD_TIKTOK" },
    });
    const refused = await redirected(() => actions.deleteExceptionAction(ids(c.zone, tiktok.id)));
    expect(refused.get("error")).toMatch(/^Seul un administrateur peut supprimer une exception/);
    expect(await prisma.approvalRule.count({ where: { id: tiktok.id } })).toBe(1);

    session.user = { id: adminId, email: "a", name: "Admin", role: "ADMIN", telegramUserId: null };
    const ok = await redirected(() => actions.deleteExceptionAction(ids(c.zone, tiktok.id)));
    expect(ok.get("ok")).toMatch(/^Exception supprimée/);
    expect(await prisma.approvalRule.count({ where: { id: tiktok.id } })).toBe(0);
    const rest = await prisma.approvalRule.findMany({
      where: { channelId: c.zone, scope: "SOURCE_KIND" },
    });
    expect(rest.map((r) => [r.sourceKind, r.sortOrder])).toEqual([["AD_ANY", 10]]);
    expect(
      await prisma.auditLog.count({
        where: { userId: adminId, action: "approval_rule.exception_deleted", entityId: tiktok.id },
      }),
    ).toBe(1);
    session.user = {
      id: managerId,
      email: "m",
      name: "Resp",
      role: "MANAGER",
      telegramUserId: null,
    };
  });

  it("exception avec canaux à rejoindre : leurs liens sont créés à l'enregistrement (même contrôle que la règle par défaut)", async () => {
    const r = await saveException(
      form(c.lyon, "kind:AD_META", {
        ...chooseEntry(initialEntryState(null), "gate"),
        gateIds: [c.zone],
        gateDelayPreset: "1h",
      }),
    );
    expect(r.q?.get("ok")).toMatch(/Liens des canaux à rejoindre vérifiés : tout est prêt\.$/);
    expect(
      await prisma.inviteLink.count({
        where: { kind: "GATE", sourceChannelId: c.lyon, channelId: c.zone },
      }),
    ).toBe(1);
    const row = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.lyon, sourceKind: "AD_META" },
    });
    expect(row).toMatchObject({
      gateMode: "REQUIRED",
      gateChannelIds: [c.zone],
      delaySeconds: 3600,
    });
  });

  it("règle par défaut : « puis accepter : 1 jour » enregistré, portée par défaut, message à l'arrivée gardé", async () => {
    const q = await redirected(() => {
      const f = new FormData();
      f.append("channelId", c.tir);
      for (const [k, v] of entryFormFields({
        ...chooseEntry(initialEntryState(null), "gate"),
        gateIds: [c.zone],
        gateDelayPreset: "1d",
      }))
        f.append(k, v);
      return actions.saveRuleAction(f);
    });
    expect(q.get("ok")).toMatch(/^Règle d'adhésion enregistrée/);
    const def = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.tir, isDefault: true },
    });
    expect(def).toMatchObject({
      scope: "DEFAULT",
      mode: "DELAY",
      delaySeconds: 86400,
      gateMode: "REQUIRED",
      sendWelcome: true,
    });
  });

  it("simulateur : un lien d'entrée de pub qui a sa propre règle est proposé, avec la règle que le bot appliquera", async () => {
    // Relecture du 11 octobre : Campagnes → Tous les liens crée une exception « lien précis » sur un lien d'entrée de
    // pub (lib/links/create.ts) ; le simulateur ne le proposait pas et affichait la règle par défaut.
    const bot = await prisma.bot.findFirstOrThrow();
    const ad = await prisma.inviteLink.create({
      data: {
        channelId: c.lyon,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+pub-tiktok-lyon",
        name: "Pub TikTok Lyon",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
      },
    });
    await prisma.approvalRule.create({
      data: {
        channelId: c.lyon,
        name: "Règle par défaut — Pub TikTok Lyon",
        isDefault: false,
        scope: "INVITE_LINK",
        inviteLinkId: ad.id,
        label: "Venu du lien « Pub TikTok Lyon »",
        mode: "IMMEDIATE",
        delaySeconds: 0,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
        sendWelcome: false,
      },
    });
    const tab = await loadRulesTab(c.lyon);
    expect(tab.links.find((l) => l.id === ad.id)).toMatchObject({
      kind: "AD_ENTRY",
      adPlatform: "TIKTOK",
      sourceChannelId: null,
    });
    // Même montage que l'onglet (tabs/rules.tsx).
    const linkIds = new Set(
      tab.exceptions.flatMap((e) => (e.inviteLinkId ? [e.inviteLinkId] : [])),
    );
    const groups = simulationChoices({
      channelId: c.lyon,
      channels: tab.channels,
      senders: tab.senders,
      shareLinks: tab.links.filter((l) => l.kind === "SHARE" && l.isActive),
      preciseLinks: tab.links.filter((l) => linkIds.has(l.id)),
    });
    const choice = groups.flatMap((g) => g.choices).find((x) => x.key === `link:${ad.id}`);
    expect(choice?.label).toBe("du lien « Pub TikTok Lyon »");
    const rules = [
      {
        ...tab.defaultRow!,
        scope: "DEFAULT" as const,
        isDefault: true,
        label: null,
        rule: tab.defaultRule!,
      },
      ...tab.exceptions,
    ];
    const names = {
      titles: Object.fromEntries(tab.channels.map((x) => [x.id, x.title])),
      linkNames: Object.fromEntries(tab.links.map((l) => [l.id, l.name])),
    };
    const r = simulate(rules, choice!.provenance, {
      ...names,
      channelId: c.lyon,
      channelTitle: "Rencontres Lyon",
    });
    expect(r.ruleText).toBe("L'exception pour les personnes venues du lien « Pub TikTok Lyon ».");
    expect([r.gateIds, r.whenText, r.messageText]).toEqual([
      [],
      "Elle est acceptée tout de suite.",
      "Le bot ne lui écrit pas.",
    ]);
    // Le bot, sur les mêmes règles en base : la même règle, sans canal à rejoindre.
    const botRule = resolveRuleForProvenance(
      await prisma.approvalRule.findMany({ where: { channelId: c.lyon, isActive: true } }),
      choice!.provenance,
      c.lyon,
    );
    const row = await prisma.approvalRule.findFirstOrThrow({ where: { inviteLinkId: ad.id } });
    expect([botRule.id, botRule.gateChannelIds]).toEqual([row.id, []]);
  });
});
