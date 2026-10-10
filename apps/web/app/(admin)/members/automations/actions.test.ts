/**
 * Actions des relances automatiques : enregistrement du parcours à branches (validé côté serveur, refusé s'il est
 * invalide, forme liste conservée pour une simple chaîne), cartes prêtes à l'emploi (création désactivée, réglages
 * seuls modifiés ensuite), interrupteur et « Tester sur moi » avec retour aux cartes, mêmes droits qu'avant
 * (ADMIN et MANAGER, suppression ADMIN seulement).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linearToGraph, templateGraph } from "@linkaffipro/core";

const state = vi.hoisted(() => ({ role: "MANAGER" as "ADMIN" | "MANAGER" }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace", url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = vi.hoisted(() => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: state.role })),
  requireAdmin: vi.fn(async () => {
    if (state.role !== "ADMIN") throw new Error("Action réservée aux administrateurs");
    return { id: "u1", role: state.role };
  }),
}));
vi.mock("@/lib/session", () => session);
const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (..._args: unknown[]) => ({ id: "j1" })) }));
vi.mock("@linkaffipro/queue", () => queue);

const db = vi.hoisted(() => ({
  prisma: {
    automationRule: {
      findUnique: vi.fn(async (..._args: unknown[]) => null as unknown),
      findUniqueOrThrow: vi.fn(async (..._args: unknown[]) => ({}) as unknown),
      create: vi.fn(async (..._args: unknown[]) => ({ id: "new1" })),
      update: vi.fn(async (..._args: unknown[]) => ({})),
      delete: vi.fn(async (..._args: unknown[]) => ({})),
    },
    user: {
      findUnique: vi.fn(async (..._args: unknown[]) => ({ telegramUserId: 42n }) as unknown),
    },
    member: { findUnique: vi.fn(async (..._args: unknown[]) => ({ id: "m1" }) as unknown) },
    automationRun: {
      updateMany: vi.fn(async (..._args: unknown[]) => ({ count: 0 })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
  audit: vi.fn(async (..._args: unknown[]) => undefined),
  toJsonValue: (v: unknown) => JSON.parse(JSON.stringify(v)),
  Prisma: { DbNull: "DbNull" },
}));
vi.mock("@linkaffipro/db", () => db);

import {
  createRuleAction,
  deleteRuleAction,
  saveCardAction,
  saveRuleAction,
  testRuleOnMeAction,
  toggleRuleAction,
} from "./actions";

const message = { text: "Bonjour {prenom}" };

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

/** Adresse de redirection levée par l'action (null si elle n'a pas redirigé). */
async function redirected(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (!url) throw err;
    return url;
  }
}
const param = (url: string | null, key: string) =>
  new URLSearchParams((url ?? "").split("?")[1]?.split("#")[0] ?? "").get(key) ?? "";

const editorForm = (graph: unknown, extra: Record<string, string> = {}) =>
  form({
    name: "Relance des cliqueurs",
    trigger: "OFFER_CLICKED",
    conditions: JSON.stringify({ channelIds: ["c1"] }),
    oncePerMember: "on",
    graph: JSON.stringify(graph),
    ...extra,
  });

type CallArgs = { where?: { id: string }; data: Record<string, unknown> };
const created = () => db.prisma.automationRule.create.mock.calls[0]?.[0] as CallArgs | undefined;
const updated = () => db.prisma.automationRule.update.mock.calls[0]?.[0] as CallArgs | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "MANAGER";
  db.prisma.automationRule.findUnique.mockResolvedValue(null);
  db.prisma.automationRule.create.mockResolvedValue({ id: "new1" });
  db.prisma.automationRun.updateMany.mockResolvedValue({ count: 0 });
});

describe("enregistrement depuis l'éditeur à branches", () => {
  it("crée une relance à branches désactivée (MANAGER compris) puis ouvre sa fiche", async () => {
    const graph = templateGraph("offer_no_signup", { message });
    const url = await redirected(saveRuleAction(editorForm(graph)));
    expect(url).toMatch(/^\/members\/automations\/new1\?/);
    expect(param(url, "ok")).toMatch(/désactivée/);
    const data = created()!.data;
    expect(data).toMatchObject({
      name: "Relance des cliqueurs",
      trigger: "OFFER_CLICKED",
      conditions: { channelIds: ["c1"] },
      actions: [],
      isActive: false,
      oncePerMember: true,
      createdById: "u1",
      templateKey: null,
    });
    expect((data.graph as { nodes: unknown[] }).nodes).toHaveLength(5);
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "automation.created", entityId: "new1", userId: "u1" }),
    );
  });

  it("refuse un parcours invalide sans rien écrire et renvoie la raison à l'éditeur", async () => {
    const graph = templateGraph("offer_no_signup", { message });
    graph.edges = graph.edges.filter((e) => e.id !== "e-no");
    graph.nodes = graph.nodes.map((n) =>
      n.type === "action" ? { ...n, action: { type: "send_message", text: "" } } : n,
    ) as typeof graph.nodes;
    const r = await saveRuleAction(editorForm(graph));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^Relance à corriger : /) });
    expect(db.prisma.automationRule.create).not.toHaveBeenCalled();
    expect(db.prisma.automationRule.update).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("refuse aussi un JSON illisible, un nom vide ou un déclencheur inconnu", async () => {
    const graph = templateGraph("offer_no_signup", { message });
    expect((await saveRuleAction(editorForm(graph, { graph: "{" }))).error).toMatch(/illisible/);
    expect((await saveRuleAction(editorForm(graph, { name: "" }))).error).toMatch(/nom/);
    expect((await saveRuleAction(editorForm(graph, { trigger: "X" }))).error).toMatch(
      /ce qui lance/,
    );
    expect(db.prisma.automationRule.create).not.toHaveBeenCalled();
  });

  it("une relance à liste restée une simple chaîne reste une liste (attentes en cours préservées)", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r1",
      graph: null,
      templateKey: null,
    });
    const chain = linearToGraph([
      { type: "wait", hours: 24 },
      { type: "send_message", ...message },
    ]);
    const url = await redirected(saveRuleAction(editorForm(chain, { ruleId: "r1" })));
    expect(url).toMatch(/^\/members\/automations\/r1\?/);
    expect(updated()!.where).toEqual({ id: "r1" });
    expect(updated()!.data.graph).toBe("DbNull");
    expect((updated()!.data.actions as Array<{ type: string }>).map((a) => a.type)).toEqual([
      "wait",
      "send_message",
    ]);
    expect(db.prisma.automationRule.create).not.toHaveBeenCalled();
  });

  it("une relance à liste qui perd son attente dans l'éditeur : membres en attente décalés", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r1",
      graph: null,
      templateKey: null,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Salut" },
      ],
    });
    db.prisma.automationRun.updateMany.mockResolvedValue({ count: 1 });
    const chain = linearToGraph([{ type: "send_message", ...message }]);
    const url = await redirected(saveRuleAction(editorForm(chain, { ruleId: "r1" })));
    expect(db.prisma.automationRun.updateMany).toHaveBeenCalledWith({
      where: { ruleId: "r1", status: "PENDING", step: 1 },
      data: { step: 0 },
    });
    expect(param(url, "ok")).toMatch(/1 membre en attente recevra le message/);
  });

  it("garde la carte d'origine si la forme est conservée, la retire sinon", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r2",
      graph: {},
      templateKey: "offer_no_signup",
    });
    const card = templateGraph("offer_no_signup", { message: { text: "Autre texte" }, hours: 12 });
    await redirected(saveRuleAction(editorForm(card, { ruleId: "r2", conditions: "{}" })));
    expect(updated()!.data.templateKey).toBe("offer_no_signup");

    vi.clearAllMocks();
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r2",
      graph: {},
      templateKey: "offer_no_signup",
    });
    card.nodes.push({
      id: "tag",
      type: "action",
      position: { x: 0, y: 0 },
      action: { type: "tag", tag: "relancé" },
    });
    card.edges.push({ id: "e-tag", source: "message", sourceHandle: "next", target: "tag" });
    await redirected(saveRuleAction(editorForm(card, { ruleId: "r2", conditions: "{}" })));
    expect(updated()!.data.templateKey).toBeNull();
  });

  it("relance introuvable : message clair, rien d'écrit", async () => {
    const r = await saveRuleAction(
      editorForm(templateGraph("welcome", { message }), { ruleId: "gone" }),
    );
    expect(r.error).toMatch(/introuvable/);
    expect(db.prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it("exige un utilisateur connecté", async () => {
    session.requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT /login"));
    await expect(saveRuleAction(editorForm(templateGraph("welcome", { message })))).rejects.toThrow(
      /login/,
    );
    expect(db.prisma.automationRule.findUnique).not.toHaveBeenCalled();
  });

  it("l'action de formulaire accepte aussi le parcours, et revient sur la création en cas d'erreur", async () => {
    const ok = await redirected(
      createRuleAction(editorForm(templateGraph("welcome", { message }))),
    );
    expect(ok).toMatch(/^\/members\/automations\/new1\?/);
    const ko = await redirected(createRuleAction(editorForm({ version: 1, nodes: [], edges: [] })));
    expect(ko).toMatch(/^\/members\/automations\/new\?/);
    expect(param(ko, "error")).toMatch(/Relance à corriger/);
  });
});

describe("cartes prêtes à l'emploi", () => {
  it("première sauvegarde : relance désactivée, carte d'origine, parcours à branches pour une carte à condition", async () => {
    const url = await redirected(
      saveCardAction(
        form({
          templateKey: "signup_no_deposit",
          delay: "72",
          text: "Il reste une étape",
          channelIds: ["c1"],
        }),
      ),
    );
    expect(url).toMatch(/^\/members\/automations\?ok=.+#carte-signup_no_deposit$/);
    const data = created()!.data;
    expect(data).toMatchObject({
      name: "Relance des inscrits sans dépôt",
      trigger: "REGISTERED",
      conditions: { channelIds: ["c1"] },
      templateKey: "signup_no_deposit",
      isActive: false,
      oncePerMember: true,
      actions: [],
    });
    const graph = data.graph as { nodes: Array<{ id: string; hours?: number }> };
    expect(graph.nodes.find((n) => n.id === "wait")?.hours).toBe(72);
  });

  it("carte sans condition : liste d'actions", async () => {
    await redirected(
      saveCardAction(form({ templateKey: "welcome", delay: "now", text: "Bienvenue" })),
    );
    expect(created()!.data).toMatchObject({
      trigger: "JOINED",
      graph: "DbNull",
      actions: [{ type: "send_message", text: "Bienvenue" }],
    });
  });

  it("modification : seuls les réglages changent (nom, interrupteur et « une fois » conservés)", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r9",
      graph: null,
      isActive: true,
    });
    const url = await redirected(
      saveCardAction(form({ templateKey: "vip", ruleId: "r9", level: "REGULIER", text: "Bravo" })),
    );
    expect(param(url, "ok")).toMatch(/prochains membres/);
    const call = updated()!;
    expect(call.where).toEqual({ id: "r9" });
    expect(call.data).not.toHaveProperty("name");
    expect(call.data).not.toHaveProperty("isActive");
    expect(call.data).not.toHaveProperty("oncePerMember");
    expect(call.data).toMatchObject({
      conditions: { spendLevels: ["REGULIER"] },
      templateKey: "vip",
    });
  });

  it("« Bienvenue » de « 1 jour » à « tout de suite » : les membres en attente reçoivent quand même le message", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r5",
      graph: null,
      isActive: true,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Bienvenue" },
      ],
    });
    db.prisma.automationRun.updateMany.mockResolvedValue({ count: 3 });
    const url = await redirected(
      saveCardAction(form({ templateKey: "welcome", ruleId: "r5", delay: "now", text: "Salut" })),
    );
    expect(updated()!.data).toMatchObject({
      graph: "DbNull",
      actions: [{ type: "send_message", text: "Salut" }],
    });
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.prisma.automationRun.updateMany).toHaveBeenCalledWith({
      where: { ruleId: "r5", status: "PENDING", step: 1 },
      data: { step: 0 },
    });
    expect(param(url, "ok")).toMatch(/3 membres en attente recevront le message à l'heure prévue/);
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ pendingMoved: 3 }) }),
    );
  });

  it("délai gardé ou ajouté : aucune exécution décalée", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      id: "r6",
      graph: null,
      isActive: false,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Bienvenue" },
      ],
    });
    const url = await redirected(
      saveCardAction(form({ templateKey: "welcome", ruleId: "r6", delay: "3", text: "Salut" })),
    );
    expect(param(url, "ok")).toBe("Relance enregistrée.");
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.prisma.automationRun.updateMany).not.toHaveBeenCalled();
    expect(updated()!.where).toEqual({ id: "r6" });
  });

  it("erreur de saisie renvoyée au volet, rien d'écrit", async () => {
    expect(await saveCardAction(form({ templateKey: "welcome", text: "" }))).toEqual({
      ok: false,
      error: "Écrivez le message que le bot va envoyer.",
    });
    expect((await saveCardAction(form({ templateKey: "nope", text: "x" }))).error).toMatch(
      /inconnue/,
    );
    expect(db.prisma.automationRule.create).not.toHaveBeenCalled();
  });
});

describe("interrupteur, test et suppression", () => {
  it("interrupteur depuis une carte : retour aux cartes, à la bonne carte", async () => {
    db.prisma.automationRule.findUniqueOrThrow.mockResolvedValue({
      id: "r1",
      isActive: false,
      templateKey: "welcome",
    });
    const url = await redirected(toggleRuleAction(form({ ruleId: "r1", back: "list" })));
    expect(url).toMatch(/^\/members\/automations\?ok=.+#carte-welcome$/);
    expect(param(url, "ok")).toMatch(/partira automatiquement/);
    expect(db.prisma.automationRule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { isActive: true },
    });
    const fromRule = await redirected(toggleRuleAction(form({ ruleId: "r1" })));
    expect(fromRule).toMatch(/^\/members\/automations\/r1\?/);
  });

  it("« Tester sur moi » depuis une carte : test lancé, retour aux cartes", async () => {
    const url = await redirected(testRuleOnMeAction(form({ ruleId: "r1", back: "list" })));
    expect(url).toMatch(/^\/members\/automations\?ok=/);
    expect(queue.enqueue).toHaveBeenCalledWith(
      "automations",
      { type: "test", ruleId: "r1", memberId: "m1" },
      expect.anything(),
    );
    expect(param(url, "ok")).toMatch(/dans quelques secondes/);
  });

  it("« Tester sur moi » d'une relance à liste avec attente : prévient que le délai est respecté", async () => {
    db.prisma.automationRule.findUnique.mockResolvedValue({
      graph: null,
      actions: [
        { type: "wait", hours: 24 },
        { type: "send_message", text: "Salut" },
      ],
    });
    const url = await redirected(testRuleOnMeAction(form({ ruleId: "r1" })));
    expect(url).toMatch(/^\/members\/automations\/r1\?/);
    expect(param(url, "ok")).toMatch(/attend le délai prévu/);
  });

  it("suppression réservée aux ADMIN", async () => {
    await expect(deleteRuleAction(form({ ruleId: "r1" }))).rejects.toThrow(/administrateurs/);
    expect(db.prisma.automationRule.delete).not.toHaveBeenCalled();
    state.role = "ADMIN";
    expect(await redirected(deleteRuleAction(form({ ruleId: "r1" })))).toMatch(
      /^\/members\/automations\?/,
    );
  });
});
