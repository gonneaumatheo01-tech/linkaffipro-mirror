import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseEntry,
  entryFormFields,
  initialEntryState,
  type EntryFormState,
} from "@/lib/channels/entry-rule";

/**
 * Le formulaire « Qui peut entrer et quand » envoie les mêmes champs qu'avant à l'action serveur existante :
 * on rejoue ses champs (`entryFormFields`) dans `saveRuleAction` et on lit ce qui serait enregistré.
 */

type Row = Record<string, unknown> & { id: string };

/** Base simulée : règles d'adhésion (avec les filtres utilisés par les actions), canaux et liens. */
const db = vi.hoisted(() => {
  const state = {
    rules: [] as Array<Record<string, unknown> & { id: string }>,
    channels: [] as Array<{ id: string; title: string }>,
    links: [] as Array<{ id: string; channelId: string; name: string; kind: string }>,
    created: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    enqueue: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    seq: 0,
    /** Demandes en cours (« Tout accepter », phase 14). */
    memberships: [] as Array<
      { id: string; channelId: string; status: string } & Record<string, unknown>
    >,
  };
  return state;
});

/** « Leur appliquer la nouvelle règle » et demandes en attente de l'ancienne règle (phase 14) : simulés. */
const pendingRule = vi.hoisted(() => ({
  summary: vi.fn(
    async (): Promise<{
      ruleId: string;
      count: number;
      byStatus: { REQUESTED: number; PENDING_GATE: number; SCHEDULED: number };
      acceptNow: number;
    } | null> => null,
  ),
  apply: vi.fn(async (): Promise<Record<string, unknown>> => ({ status: "not_found" })),
}));
vi.mock("@/lib/channels/pending-rule", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pendingSummaryForRule: pendingRule.summary,
  applyRuleToPending: pendingRule.apply,
}));

function matches(r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "NOT") return !matches(r, v as Record<string, unknown>);
    if (v && typeof v === "object" && "not" in (v as object))
      return r[k] !== (v as { not: unknown }).not;
    return r[k] === v;
  });
}
function sorted(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || Number(a.seq) - Number(b.seq),
  );
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = vi.hoisted(() => ({ role: "MANAGER" as "ADMIN" | "MANAGER" }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: session.role, telegramUserId: null })),
}));
vi.mock("@/lib/approval/telegram", () => ({ approveNow: vi.fn(), declineNow: vi.fn() }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: db.enqueue }));
vi.mock("@linkaffipro/telegram", () => ({ recheckChannelRights: vi.fn() }));
/** Vérification des liens des canaux à rejoindre (appels Telegram) : simulée. */
const gate = vi.hoisted(() => ({
  verify: vi.fn(
    async (): Promise<{
      results: Array<{ channelId: string; title: string; status: string; tried: string[] }>;
      solutionBot: string | null;
    }> => ({ results: [], solutionBot: null }),
  ),
}));
vi.mock("@/lib/channels/rule-gate-links", () => ({ verifyChannelGateLinks: gate.verify }));
vi.mock("@linkaffipro/db", () => {
  const approvalRule = {
    findFirst: vi.fn(
      async ({ where }: { where?: Record<string, unknown> }) =>
        sorted(db.rules).find((r) => matches(r, where)) ?? null,
    ),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
      sorted(db.rules.filter((r) => matches(r, where))),
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.created.push(data);
      const row = {
        id: `r${++db.seq}`,
        seq: db.seq,
        isActive: true,
        sortOrder: 0,
        inviteLinkId: null,
        sourceChannelId: null,
        sourceKind: null,
        scope: "DEFAULT",
        ...data,
      };
      db.rules.push(row);
      return row;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        db.updated.push(data);
        const row = db.rules.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      db.rules = db.rules.filter((r) => r.id !== where.id);
    }),
  };
  const prisma = {
    approvalRule,
    channel: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.channels.find((c) => c.id === where.id) ?? null,
      ),
    },
    inviteLink: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; channelId: string } }) =>
          db.links.find((l) => l.id === where.id && l.channelId === where.channelId) ?? null,
      ),
    },
    membership: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            channelId: string;
            status: { in: string[] };
            requestedAt?: { lte: Date };
          };
        }) =>
          db.memberships
            .filter(
              (m) =>
                m.channelId === where.channelId &&
                where.status.in.includes(m.status) &&
                (!where.requestedAt ||
                  (m.requestedAt as Date).getTime() <= where.requestedAt.lte.getTime()),
            )
            .map((m) => ({ ...m })),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: { in: string[] };
            status: string | { in: string[] };
            approveAt?: null;
          };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          const statuses = typeof where.status === "string" ? [where.status] : where.status.in;
          for (const m of db.memberships)
            if (
              where.id.in.includes(m.id) &&
              statuses.includes(m.status) &&
              (where.approveAt !== null || (m.approveAt ?? null) === null)
            ) {
              Object.assign(m, data);
              count++;
            }
          return { count };
        },
      ),
    },
    /**
     * « Tout accepter » : `UPDATE "Membership" … RETURNING id` (valeurs dans l'ordre de la requête : heure de secours,
     * marque, demandes, statuts du filtre).
     */
    $queryRaw: vi.fn(
      async (
        _sql: TemplateStringsArray,
        fallbackAt: string,
        mark: string,
        ids: string[],
        statuses: string[],
      ) => {
        const out: Array<{ id: string }> = [];
        for (const m of db.memberships)
          if (ids.includes(m.id) && statuses.includes(m.status)) {
            Object.assign(m, {
              status: "SCHEDULED",
              approveAt: new Date(fallbackAt),
              expiresAt: null,
              source: { ...((m.source as object) ?? {}), approveAll: JSON.parse(mark) },
            });
            out.push({ id: m.id });
          }
        return out;
      },
    ),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma,
    audit: vi.fn(async (a: Record<string, unknown>) => {
      db.audits.push(a);
    }),
  };
});

import {
  applyRuleToPendingAction,
  approveAllRequestsAction,
  checkGateLinksAction,
  deleteExceptionAction,
  moveExceptionAction,
  recomputeBestHoursAction,
  reorderExceptionsAction,
  saveExceptionAction,
  saveRuleAction,
  toggleExceptionAction,
} from "./actions";

function formOf(state: EntryFormState, channelId = "ch1"): FormData {
  const f = new FormData();
  f.append("channelId", channelId);
  for (const [k, v] of entryFormFields(state)) f.append(k, v);
  // Champs propres à l'écran (boutons radio) : ignorés par l'action.
  f.append("r1-choice", state.choice);
  return f;
}

async function save(state: EntryFormState, channelId = "ch1") {
  try {
    await saveRuleAction(formOf(state, channelId));
  } catch (err) {
    return (err as { url?: string }).url ?? String(err);
  }
  return "";
}

beforeEach(() => {
  db.rules = [];
  db.channels = [
    { id: "ch1", title: "Zone Interdite" },
    { id: "tir", title: "Tir Cadré" },
    { id: "roulette", title: "Zone Roulette" },
  ];
  db.links = [
    { id: "l1", channelId: "ch1", name: "Post Tir Cadré", kind: "SHARE" },
    { id: "ad1", channelId: "ch1", name: "Pub TikTok 1", kind: "AD_ENTRY" },
  ];
  db.created = [];
  db.updated = [];
  db.audits = [];
  db.seq = 0;
  db.memberships = [];
  session.role = "MANAGER";
  gate.verify.mockClear();
  pendingRule.summary.mockReset();
  pendingRule.summary.mockResolvedValue(null);
  pendingRule.apply.mockReset();
});

/** Règle par défaut déjà enregistrée sur le canal. */
function seedDefault(over: Record<string, unknown> = {}) {
  db.rules.push({
    id: "def",
    seq: 0,
    channelId: "ch1",
    isDefault: true,
    scope: "DEFAULT",
    isActive: true,
    sortOrder: 0,
    inviteLinkId: null,
    sourceChannelId: null,
    sourceKind: null,
    ...over,
  });
}

describe("« Qui peut entrer et quand » → saveRuleAction", () => {
  it("« Tout de suite » : mode Immédiat, sans délai ni canaux", async () => {
    const url = await save(chooseEntry(initialEntryState(null), "now"));
    expect(url).toMatch(/^\/channels\/ch1\?tab=rules&ok=/);
    expect(db.created[0]).toMatchObject({
      channelId: "ch1",
      isDefault: true,
      mode: "IMMEDIATE",
      delaySeconds: 0,
      gateMode: "NONE",
      gateChannelIds: [],
      // Nouvelle règle (phase 14) : rappels 4 minutes puis 1 heure.
      reminderAfterMinutes: [4, 60],
      maxReminders: 2,
      expireAfterHours: null,
      expireAction: "KEEP",
      sendAcceptedMessage: true,
      isActive: true,
    });
  });

  it("« Après un délai » de 10 minutes (par défaut) ou d'une autre durée", async () => {
    await save(initialEntryState(null));
    expect(db.created[0]).toMatchObject({ mode: "DELAY", delaySeconds: 600, gateMode: "NONE" });
    db.rules = [];
    await save({
      ...initialEntryState(null),
      delayPreset: "custom",
      customAmount: 90,
      customUnit: "minutes",
    });
    expect(db.created[1]).toMatchObject({ mode: "DELAY", delaySeconds: 5400 });
  });

  it("« Après avoir rejoint ces canaux » : canaux obligatoires puis délai, le canal lui-même retiré", async () => {
    await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["a", "ch1", "b"],
      gateMode: "REQUIRED",
      delayPreset: "immediate",
    });
    expect(db.created[0]).toMatchObject({
      mode: "DELAY",
      delaySeconds: 0,
      gateMode: "REQUIRED",
      gateChannelIds: ["a", "b"],
    });
  });

  it("validation à la main et réglages avancés", async () => {
    seedDefault();
    await save({
      ...initialEntryState(null),
      manual: true,
      reminders: "30, 120",
      maxReminders: 1,
      expireAfterHours: 48,
      expireAction: "DECLINE",
      sendAcceptedMessage: false,
    });
    expect(db.updated[0]).toMatchObject({
      mode: "MANUAL",
      reminderAfterMinutes: [30, 120],
      maxReminders: 1,
      expireAfterHours: 48,
      expireAction: "DECLINE",
      sendAcceptedMessage: false,
    });
  });

  it("une règle relue puis renvoyée telle quelle ne change pas", async () => {
    const state = initialEntryState({
      mode: "DELAY",
      delaySeconds: 3600,
      gateMode: "SOFT",
      gateChannelIds: ["a"],
      reminderAfterMinutes: [60],
      maxReminders: 1,
      expireAfterHours: 24,
      expireAction: "APPROVE",
      sendAcceptedMessage: true,
    });
    await save(state);
    expect(db.created[0]).toMatchObject({
      mode: "DELAY",
      delaySeconds: 3600,
      gateMode: "SOFT",
      gateChannelIds: ["a"],
      reminderAfterMinutes: [60],
      maxReminders: 1,
      expireAfterHours: 24,
      expireAction: "APPROVE",
      sendAcceptedMessage: true,
    });
  });
});

describe("règle par défaut : délai après les canaux à rejoindre (phase 11)", () => {
  it("« puis accepter : 1 jour » enregistre le mode Délai et 86 400 secondes (jamais remis à zéro)", async () => {
    await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["tir", "roulette"],
      gateDelayPreset: "1d",
    });
    expect(db.created[0]).toMatchObject({
      scope: "DEFAULT",
      isDefault: true,
      mode: "DELAY",
      delaySeconds: 86400,
      gateMode: "REQUIRED",
      gateChannelIds: ["tir", "roulette"],
    });
  });

  it("accepte la clé « 5m » (5 minutes), pour « après un délai » comme pour « puis accepter »", async () => {
    await save({ ...initialEntryState(null), delayPreset: "5m" });
    expect(db.created[0]).toMatchObject({ mode: "DELAY", delaySeconds: 300, gateMode: "NONE" });
    db.rules = [];
    await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["tir"],
      gateDelayPreset: "5m",
    });
    expect(db.created[1]).toMatchObject({ delaySeconds: 300, gateMode: "REQUIRED" });
  });

  it("une règle « 10 minutes après avoir rejoint » relue puis renvoyée garde ses 10 minutes", async () => {
    seedDefault();
    await save(
      initialEntryState({
        mode: "DELAY",
        delaySeconds: 600,
        gateMode: "REQUIRED",
        gateChannelIds: ["tir"],
        reminderAfterMinutes: [60],
        maxReminders: 1,
        expireAfterHours: null,
        expireAction: "KEEP",
        sendAcceptedMessage: true,
      }),
    );
    expect(db.updated[0]).toMatchObject({ mode: "DELAY", delaySeconds: 600, gateMode: "REQUIRED" });
  });

  it("message à l'arrivée : coupé seulement si l'écran l'envoie « off » (absent = envoyé)", async () => {
    await save({ ...initialEntryState(null), sendWelcome: false });
    expect(db.created[0]).toMatchObject({ sendWelcome: false });
    db.rules = [];
    const f = formOf(initialEntryState(null));
    f.delete("sendWelcome");
    try {
      await saveRuleAction(f);
    } catch {
      // redirection attendue
    }
    expect(db.created[1]).toMatchObject({ sendWelcome: true });
  });
});

describe("canaux à rejoindre : exigence alignée et liens vérifiés à l'enregistrement", () => {
  it("des canaux envoyés sans exigence sont enregistrés comme obligatoires (jamais « aucune exigence » avec des canaux)", async () => {
    const f = new FormData();
    f.append("channelId", "ch1");
    for (const [k, v] of entryFormFields(initialEntryState(null)))
      if (k !== "gateMode") f.append(k, v);
    f.append("gateMode", "NONE");
    f.append("gateChannelIds", "a");
    f.append("gateChannelIds", "a");
    try {
      await saveRuleAction(f);
    } catch {
      // redirection attendue
    }
    expect(db.created[0]).toMatchObject({ gateMode: "REQUIRED", gateChannelIds: ["a"] });
  });

  it("vérifie les liens tout de suite et nomme le canal en cause avec la solution", async () => {
    gate.verify.mockResolvedValueOnce({
      results: [
        { channelId: "a", title: "LA ZONE ROULETTE", status: "ok", tried: [] },
        { channelId: "b", title: "TIR CADRÉ", status: "no_link", tried: ["@womendatingoobot"] },
      ],
      solutionBot: "womendatingoobot",
    });
    const url = await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["a", "b"],
      gateMode: "REQUIRED",
    });
    expect(gate.verify).toHaveBeenCalledWith("ch1", { userId: "u1" });
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("ok")).toMatch(/^Règle d'adhésion enregistrée/);
    expect(q.get("error")).toBe(
      "Le bot ne peut pas créer le lien de « TIR CADRÉ » : ajoutez @womendatingoobot comme administrateur de « TIR CADRÉ » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    );
  });

  it("tout est prêt : confirmation sans erreur", async () => {
    gate.verify.mockResolvedValueOnce({
      results: [{ channelId: "a", title: "A", status: "ok", tried: [] }],
      solutionBot: "x",
    });
    const url = await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["a"],
    });
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("ok")).toContain("Liens des canaux à rejoindre vérifiés : tout est prêt.");
    expect(q.get("error")).toBeNull();
  });

  it("une panne de la vérification n'empêche pas l'enregistrement", async () => {
    gate.verify.mockRejectedValueOnce(new Error("réseau"));
    const url = await save({ ...chooseEntry(initialEntryState(null), "gate"), gateIds: ["a"] });
    expect(db.created).toHaveLength(1);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("ok")).toMatch(/^Règle d'adhésion enregistrée/);
    expect(q.get("error")).toMatch(/Vérification des liens impossible pour le moment/);
  });

  it("« Vérifier les liens » : revient sur l'onglet avec le résultat", async () => {
    gate.verify.mockResolvedValueOnce({
      results: [{ channelId: "a", title: "A", status: "ok", tried: [] }],
      solutionBot: "x",
    });
    const f = new FormData();
    f.append("channelId", "ch1");
    let url = "";
    try {
      await checkGateLinksAction(f);
    } catch (err) {
      url = (err as { url: string }).url;
    }
    expect(url.startsWith("/channels/ch1?tab=rules&ok=")).toBe(true);
    expect(gate.verify).toHaveBeenCalledWith("ch1", { userId: "u1" });
  });
});

describe("recalcul des meilleurs créneaux", () => {
  it("revient vers le calendrier des messages du canal avec la confirmation", async () => {
    const f = new FormData();
    f.append("channelId", "ch 1");
    let url = "";
    try {
      await recomputeBestHoursAction(f);
    } catch (err) {
      url = (err as { url: string }).url;
    }
    expect(db.enqueue).toHaveBeenCalledWith("stats", { type: "best-hours" }, expect.anything());
    expect(url.startsWith("/messages?channelId=ch+1&ok=")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("ok")).toMatch(/meilleurs créneaux/);
  });

  it("garde la semaine et les filtres du calendrier", async () => {
    const f = new FormData();
    f.append("channelId", "ch1");
    f.append("week", "2026-10-19");
    f.append("category", "cat1");
    f.append("campaignId", "https://evil.example");
    let url = "";
    try {
      await recomputeBestHoursAction(f);
    } catch (err) {
      url = (err as { url: string }).url;
    }
    const q = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/messages?channelId=ch1&week=2026-10-19&category=cat1&ok=")).toBe(true);
    expect(q.get("campaignId")).toBeNull();
  });
});

/** Formulaire du volet d'une exception (mêmes champs que la règle par défaut, plus la provenance). */
function exceptionForm(
  provenance: string,
  state: EntryFormState = initialEntryState(null),
  ruleId?: string,
): FormData {
  const f = formOf(state);
  f.append("provenance", provenance);
  if (ruleId) f.append("ruleId", ruleId);
  return f;
}

async function saveException(f: FormData): Promise<{ url?: string; error?: string }> {
  try {
    const r = await saveExceptionAction(null, f);
    return { error: r?.error };
  } catch (err) {
    return { url: (err as { url?: string }).url };
  }
}

function exception(id: string, over: Record<string, unknown>) {
  db.rules.push({
    id,
    seq: ++db.seq,
    channelId: "ch1",
    isDefault: false,
    isActive: true,
    sortOrder: 10,
    inviteLinkId: null,
    sourceChannelId: null,
    sourceKind: null,
    gateChannelIds: [],
    ...over,
  });
}

describe("exceptions selon la provenance → saveExceptionAction", () => {
  it("exemple du client : venue de Tir Cadré → après 1 jour ; libellé, portée, journal de l'équipe", async () => {
    seedDefault();
    const r = await saveException(
      exceptionForm("channel:tir", { ...initialEntryState(null), delayPreset: "1d" }),
    );
    expect(r.url).toMatch(/^\/channels\/ch1\?tab=rules&ok=/);
    expect(new URLSearchParams(r.url!.split("?")[1]).get("ok")).toBe(
      "Exception enregistrée pour les personnes venues de « Tir Cadré » : elle s'applique aux prochaines demandes.",
    );
    expect(db.created[0]).toMatchObject({
      channelId: "ch1",
      isDefault: false,
      scope: "SOURCE_CHANNEL",
      sourceChannelId: "tir",
      sourceKind: null,
      inviteLinkId: null,
      label: "Venu de « Tir Cadré »",
      name: "Venu de « Tir Cadré »",
      mode: "DELAY",
      delaySeconds: 86400,
      gateMode: "NONE",
      sendWelcome: true,
    });
    const created = db.rules.find((x) => x.scope === "SOURCE_CHANNEL")!;
    expect(created.sortOrder).toBe(10);
    expect(db.audits.at(-1)).toMatchObject({
      action: "approval_rule.exception_created",
      entityType: "ApprovalRule",
      entityId: created.id,
      metadata: { channelId: "ch1", scope: "SOURCE_CHANNEL", label: "Venu de « Tir Cadré »" },
    });
  });

  it("un responsable peut créer et modifier ; la modification garde la place et note « modifiée »", async () => {
    exception("e1", { scope: "SOURCE_KIND", sourceKind: "AD_META", sortOrder: 20 });
    const r = await saveException(
      exceptionForm("kind:AD_META", { ...initialEntryState(null), delayPreset: "1h" }, "e1"),
    );
    expect(r.url).toMatch(/ok=/);
    expect(db.rules.find((x) => x.id === "e1")).toMatchObject({
      delaySeconds: 3600,
      sortOrder: 20,
      label: "Venu d'une pub Meta",
    });
    expect(db.audits.at(-1)?.action).toBe("approval_rule.exception_updated");
  });

  it("pas deux exceptions pour la même provenance : message clair, rien d'enregistré", async () => {
    exception("e1", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir" });
    const r = await saveException(exceptionForm("channel:tir"));
    expect(r.error).toBe(
      "Une exception existe déjà pour les personnes venues de « Tir Cadré » : modifiez-la plutôt.",
    );
    expect(db.created).toHaveLength(0);
  });

  it("provenance illisible, canal inconnu ou le canal lui-même, lien d'un autre type : refus en français", async () => {
    expect((await saveException(exceptionForm("kind:NOPE"))).error).toBe(
      "Choisissez d'où vient la personne.",
    );
    expect((await saveException(exceptionForm("channel:inconnu"))).error).toBe(
      "Ce canal n'existe plus : choisissez une autre provenance.",
    );
    expect((await saveException(exceptionForm("channel:ch1"))).error).toMatch(
      /^Choisissez un autre canal que celui-ci/,
    );
    expect((await saveException(exceptionForm("link:ad1"))).error).toBe(
      "Choisissez un lien de partage ou une campagne d'affilié de ce canal.",
    );
    expect(db.created).toHaveLength(0);
  });

  it("une nouvelle « pub TikTok » se place avant « n'importe quelle pub » (10, 20)", async () => {
    exception("any", { scope: "SOURCE_KIND", sourceKind: "AD_ANY", sortOrder: 10 });
    await saveException(exceptionForm("kind:AD_TIKTOK"));
    const tiktok = db.rules.find((x) => x.sourceKind === "AD_TIKTOK")!;
    expect(tiktok.sortOrder).toBe(10);
    expect(db.rules.find((x) => x.id === "any")!.sortOrder).toBe(20);
  });

  it("venue de Tir Cadré : Tir Cadré retiré de ses canaux à rejoindre ; liens vérifiés tout de suite", async () => {
    await saveException(
      exceptionForm("channel:tir", {
        ...chooseEntry(initialEntryState(null), "gate"),
        gateIds: ["tir", "roulette"],
        gateDelayPreset: "1d",
      }),
    );
    expect(db.created[0]).toMatchObject({
      gateChannelIds: ["roulette"],
      gateMode: "REQUIRED",
      delaySeconds: 86400,
    });
    expect(gate.verify).toHaveBeenCalledWith("ch1", { userId: "u1" });
  });

  it("lien de partage précis : portée « lien précis »", async () => {
    await saveException(exceptionForm("link:l1"));
    expect(db.created[0]).toMatchObject({
      scope: "INVITE_LINK",
      inviteLinkId: "l1",
      label: "Venu du lien « Post Tir Cadré »",
    });
  });
});

describe("exceptions : activer, supprimer, ordre", () => {
  const ids = (channelId = "ch1", ruleId = "e1") => {
    const f = new FormData();
    f.append("channelId", channelId);
    f.append("ruleId", ruleId);
    return f;
  };

  it("désactiver puis réactiver ; noté au journal comme une modification", async () => {
    exception("e1", { scope: "SOURCE_KIND", sourceKind: "GATE", label: "Venu du bouton" });
    const off = ids();
    off.append("active", "0");
    expect(await toggleExceptionAction(off)).toEqual({
      ok: "Exception désactivée : ces personnes suivent la règle par défaut (ou une autre exception).",
    });
    expect(db.rules[0]!.isActive).toBe(false);
    expect(db.audits.at(-1)).toMatchObject({
      action: "approval_rule.exception_updated",
      metadata: { change: "deactivated", isActive: false },
    });
    const on = ids();
    on.append("active", "1");
    expect((await toggleExceptionAction(on)).ok).toMatch(/^Exception activée/);
    expect(db.rules[0]!.isActive).toBe(true);
  });

  it("la règle par défaut ne passe jamais par les actions d'exception", async () => {
    seedDefault();
    const f = ids("ch1", "def");
    f.append("active", "0");
    expect(await toggleExceptionAction(f)).toEqual({
      error: "Cette exception n'existe plus : rechargez la page.",
    });
    expect(db.rules[0]!.isActive).toBe(true);
  });

  it("supprimer : réservé à l'administrateur (un responsable peut désactiver)", async () => {
    exception("e1", { scope: "SOURCE_KIND", sourceKind: "GATE" });
    exception("e2", { scope: "SOURCE_KIND", sourceKind: "SHARE", sortOrder: 20 });
    let url = "";
    try {
      await deleteExceptionAction(ids());
    } catch (err) {
      url = (err as { url: string }).url;
    }
    expect(new URLSearchParams(url.split("?")[1]).get("error")).toMatch(
      /^Seul un administrateur peut supprimer une exception/,
    );
    expect(db.rules).toHaveLength(2);

    session.role = "ADMIN";
    try {
      await deleteExceptionAction(ids());
    } catch (err) {
      url = (err as { url: string }).url;
    }
    expect(new URLSearchParams(url.split("?")[1]).get("ok")).toMatch(/^Exception supprimée/);
    expect(db.rules.map((r) => [r.id, r.sortOrder])).toEqual([["e2", 10]]);
    expect(db.audits.at(-1)).toMatchObject({
      action: "approval_rule.exception_deleted",
      entityId: "e1",
    });
  });

  it("monter / descendre dans son groupe seulement ; noté au journal", async () => {
    exception("a", { scope: "SOURCE_KIND", sourceKind: "AD_ANY", sortOrder: 10 });
    exception("b", { scope: "SOURCE_KIND", sourceKind: "SHARE", sortOrder: 20 });
    exception("t", { scope: "SOURCE_CHANNEL", sourceChannelId: "tir", sortOrder: 10 });
    const up = ids("ch1", "b");
    up.append("direction", "up");
    expect(await moveExceptionAction(up)).toEqual({ ok: "Exception montée d'un cran." });
    expect(Object.fromEntries(db.rules.map((r) => [r.id, r.sortOrder]))).toEqual({
      a: 20,
      b: 10,
      t: 10,
    });
    expect(db.audits.at(-1)).toMatchObject({
      action: "approval_rule.exceptions_reordered",
      metadata: { scope: "SOURCE_KIND", order: ["b", "a"], movedId: "b", direction: "up" },
    });
    const again = ids("ch1", "t");
    again.append("direction", "up");
    expect((await moveExceptionAction(again)).error).toBe(
      "Cette exception est déjà la première de son groupe.",
    );
  });

  it("glisser-déposer : l'ordre complet du groupe est exigé", async () => {
    exception("a", { scope: "SOURCE_KIND", sourceKind: "AD_ANY", sortOrder: 10 });
    exception("b", { scope: "SOURCE_KIND", sourceKind: "SHARE", sortOrder: 20 });
    const f = new FormData();
    f.append("channelId", "ch1");
    f.append("scope", "SOURCE_KIND");
    f.append("ruleIds", "b");
    expect((await reorderExceptionsAction(f)).error).toMatch(/ont changé entre-temps/);
    f.append("ruleIds", "a");
    expect(await reorderExceptionsAction(f)).toEqual({ ok: "Ordre des exceptions enregistré." });
    expect(Object.fromEntries(db.rules.map((r) => [r.id, r.sortOrder]))).toEqual({ a: 20, b: 10 });
  });
});

/** Paramètres de l'adresse de retour d'une action (redirection simulée). */
async function redirectParams(fn: () => Promise<unknown>): Promise<URLSearchParams> {
  try {
    await fn();
  } catch (err) {
    const url = (err as { url?: string }).url ?? "";
    return new URLSearchParams(url.split("?")[1] ?? "");
  }
  throw new Error("redirection attendue");
}

function fdOf(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("Demandes → « Tout accepter » (phase 14)", () => {
  /** Moment de l'affichage de la liste (une minute avant le clic). */
  const T0 = new Date(Date.now() - 60_000);
  const ago = (min: number) => new Date(T0.getTime() - min * 60_000);
  /** Liste affichée à T0 avec 4 demandes en cours (« Toutes ») : champs envoyés par le formulaire. */
  const shown = (filter: string, expected: number) => ({
    channelId: "ch1",
    filter,
    asOf: T0.toISOString(),
    expected: String(expected),
  });
  const approveCalls = () =>
    db.enqueue.mock.calls.filter(
      (c) => c[0] === "telegram-send" && (c[1] as { type?: string }).type === "approve",
    );

  beforeEach(() => {
    db.enqueue.mockReset();
    db.enqueue.mockResolvedValue(undefined);
    db.channels = [
      { id: "ch1", title: "Zone Interdite", isActive: true, botAdmins: [{ botId: "b1" }] } as never,
    ];
    db.memberships = [
      { id: "g1", channelId: "ch1", status: "PENDING_GATE", requestedAt: ago(120) },
      { id: "g2", channelId: "ch1", status: "PENDING_GATE", requestedAt: ago(60) },
      {
        id: "s1",
        channelId: "ch1",
        status: "SCHEDULED",
        approveAt: new Date("2030-01-01"),
        requestedAt: ago(30),
      },
      {
        id: "r1",
        channelId: "ch1",
        status: "REQUESTED",
        expiresAt: new Date("2030-01-01"),
        requestedAt: ago(10),
      },
      { id: "a1", channelId: "ch1", status: "APPROVED", requestedAt: ago(200) },
      { id: "o1", channelId: "autre", status: "PENDING_GATE", requestedAt: ago(5) },
    ];
  });

  it("toute la liste : une tâche d'acceptation par demande (file telegram-send), journal avec le nombre", async () => {
    session.role = "MANAGER"; // un responsable peut tout accepter (ce n'est pas une suppression)
    const before = Date.now();
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("all", 4))));
    expect(q.get("tab")).toBe("requests");
    expect(q.get("status")).toBeNull();
    expect(q.get("ok")).toBe(
      "4 demandes seront acceptées dans les prochaines minutes, au rythme permis par Telegram.",
    );
    // Une tâche `approve` par demande, avec l'utilisateur (journal) et un identifiant propre à cet affichage.
    expect(approveCalls().map((c) => c.slice(1))).toEqual(
      ["g1", "g2", "s1", "r1"].map((id) => [
        { type: "approve", membershipId: id, byUserId: "u1" },
        { jobId: `approve:${id}:${T0.getTime()}` },
      ]),
    );
    const byId = Object.fromEntries(db.memberships.map((m) => [m.id, m]));
    for (const id of ["g1", "g2", "s1", "r1"]) {
      // En file d'acceptation, avec une heure de secours dans 10 minutes : si la tâche n'aboutit pas, le passage des
      // 20 secondes l'accepte (jamais « Acceptation en cours » pour toujours). Sans expiration.
      expect(byId[id]!.status, id).toBe("SCHEDULED");
      const at = (byId[id]!.approveAt as Date).getTime();
      expect(at, id).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
      expect(at, id).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
      expect(byId[id]!.expiresAt, id).toBeNull();
      expect((byId[id]!.source as { approveAll?: unknown }).approveAll, id).toMatchObject({
        byUserId: "u1",
        fallbackAt: new Date(at).toISOString(),
      });
    }
    // Ni les demandes déjà acceptées, ni celles d'un autre canal.
    expect(byId.a1!.status).toBe("APPROVED");
    expect(byId.o1!.status).toBe("PENDING_GATE");
    expect(db.audits.at(-1)).toMatchObject({
      action: "membership.approve_all",
      entityType: "Channel",
      entityId: "ch1",
      metadata: {
        channelId: "ch1",
        filter: "all",
        count: 4,
        queued: 4,
        byStatus: { PENDING_GATE: 2, SCHEDULED: 1, REQUESTED: 1 },
      },
    });
  });

  it("liste filtrée « Attend les canaux » : seulement ces demandes, le filtre reste dans l'adresse", async () => {
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    expect(q.get("status")).toBe("gate");
    expect(q.get("ok")).toMatch(/^2 demandes seront acceptées/);
    expect(approveCalls().map((c) => (c[1] as { membershipId: string }).membershipId)).toEqual([
      "g1",
      "g2",
    ]);
    // La demande déjà programmée garde son heure ; celle à valider à la main n'est pas touchée.
    expect(db.memberships.find((m) => m.id === "s1")!.approveAt).toEqual(new Date("2030-01-01"));
    expect(db.memberships.find((m) => m.id === "r1")!.status).toBe("REQUESTED");
    expect(db.audits.at(-1)).toMatchObject({ metadata: { filter: "gate", count: 2 } });
  });

  it("nouveau clic après une tâche qui n'a pas abouti : une nouvelle tâche, jamais ignorée par la file", async () => {
    await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    const first = approveCalls().map((c) => (c[2] as { jobId: string }).jobId);
    expect(first).toEqual([`approve:g1:${T0.getTime()}`, `approve:g2:${T0.getTime()}`]);
    // Double envoi du même formulaire : mêmes identifiants (la file n'en garde qu'une).
    db.memberships.find((m) => m.id === "g1")!.status = "PENDING_GATE";
    db.memberships.find((m) => m.id === "g2")!.status = "PENDING_GATE";
    await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    expect(
      approveCalls()
        .slice(2)
        .map((c) => (c[2] as { jobId: string }).jobId),
    ).toEqual(first);
    // Les tâches n'ont pas abouti ; la liste est réaffichée, l'équipe clique de nouveau sur « Toutes » : une nouvelle
    // tâche par demande (autre identifiant), la demande toujours programmée avec une nouvelle heure de secours.
    db.enqueue.mockClear();
    const T1 = new Date(Date.now() - 1000);
    const q = await redirectParams(() =>
      approveAllRequestsAction(
        fdOf({ channelId: "ch1", filter: "all", asOf: T1.toISOString(), expected: "4" }),
      ),
    );
    expect(q.get("ok")).toMatch(/^4 demandes seront acceptées/);
    const again = approveCalls().map((c) => (c[2] as { jobId: string }).jobId);
    expect(again).toContain(`approve:g1:${T1.getTime()}`);
    expect(again).not.toContain(first[0]);
    expect(db.memberships.find((m) => m.id === "g1")!.status).toBe("SCHEDULED");
  });

  it("une demande arrivée après l'affichage n'est pas acceptée", async () => {
    db.memberships.push({
      id: "new",
      channelId: "ch1",
      status: "PENDING_GATE",
      requestedAt: new Date(T0.getTime() + 30_000),
    });
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    expect(q.get("ok")).toMatch(/^2 demandes seront acceptées/);
    expect(db.memberships.find((m) => m.id === "new")!.status).toBe("PENDING_GATE");
    expect(approveCalls()).toHaveLength(2);
  });

  it("plus de demandes que la fenêtre n'en annonçait : rien n'est accepté, message clair", async () => {
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("all", 3))));
    expect(q.get("error")).toBe(
      "La liste a changé depuis l'affichage : vérifiez les demandes, puis cliquez à nouveau « Tout accepter ».",
    );
    expect(q.get("ok")).toBeNull();
    expect(approveCalls()).toEqual([]);
    expect(db.memberships.find((m) => m.id === "g1")!.status).toBe("PENDING_GATE");
    expect(db.audits).toEqual([]);
  });

  it("file indisponible pour une demande : le passage des 20 secondes l'accepte (heure d'acceptation maintenant)", async () => {
    db.enqueue.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as { membershipId?: string }).membershipId === "g2")
        throw new Error("Redis indisponible");
      return undefined;
    });
    const before = Date.now();
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    expect(q.get("ok")).toMatch(/^2 demandes seront acceptées/);
    const g1 = db.memberships.find((m) => m.id === "g1")!;
    const g2 = db.memberships.find((m) => m.id === "g2")!;
    // Tâche enfilée : heure de secours dans 10 minutes ; file indisponible : acceptée au prochain passage.
    expect((g1.approveAt as Date).getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    expect(g2.status).toBe("SCHEDULED");
    expect((g2.approveAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((g2.approveAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(db.audits.at(-1)).toMatchObject({ metadata: { count: 2, queued: 1 } });
  });

  it("canal désactivé, ou sans bot administrateur : rien n'est accepté", async () => {
    db.channels = [
      {
        id: "ch1",
        title: "Zone Interdite",
        isActive: false,
        botAdmins: [{ botId: "b1" }],
      } as never,
    ];
    let q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    expect(q.get("error")).toMatch(/^Ce canal est désactivé/);
    expect(q.get("status")).toBe("gate");
    db.channels = [{ id: "ch1", title: "Zone Interdite", isActive: true, botAdmins: [] } as never];
    q = await redirectParams(() => approveAllRequestsAction(fdOf({ channelId: "ch1" })));
    expect(q.get("error")).toMatch(/^Aucun de nos bots n'est administrateur/);
    expect(db.memberships.filter((m) => m.status === "SCHEDULED").map((m) => m.id)).toEqual(["s1"]);
    expect(approveCalls()).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("phase 17 : seul un bot normal et actif compte comme bot qui accepte (jamais un assistant)", async () => {
    const { prisma } = await import("@linkaffipro/db");
    const findUnique = vi.mocked(prisma.channel.findUnique);
    findUnique.mockClear();
    await redirectParams(() => approveAllRequestsAction(fdOf(shown("gate", 2))));
    const args = findUnique.mock.calls[0]![0] as {
      select: { botAdmins: { where: unknown } };
    };
    expect(args.select.botAdmins.where).toEqual({
      revokedAt: null,
      bot: { isActive: true, mode: "STANDARD", role: "CHANNEL" },
    });
  });

  it("liste vide entre-temps : rien à accepter", async () => {
    db.memberships = [];
    const q = await redirectParams(() => approveAllRequestsAction(fdOf(shown("manual", 1))));
    expect(q.get("ok")).toBe("Aucune demande à accepter : la liste a changé entre-temps.");
    expect(approveCalls()).toEqual([]);
  });
});

describe("« Leur appliquer la nouvelle règle » (phase 14)", () => {
  it("recalcule les demandes de la règle, note au journal le nombre et les états, sans message envoyé", async () => {
    pendingRule.apply.mockResolvedValue({
      status: "ok",
      count: 37,
      byStatus: { SCHEDULED: 30, PENDING_GATE: 5, REQUESTED: 2 },
      acceptNow: 25,
      gateSatisfied: 3,
      skipped: 0,
    });
    const q = await redirectParams(() =>
      applyRuleToPendingAction(fdOf({ channelId: "ch1", ruleId: "def" })),
    );
    expect(pendingRule.apply).toHaveBeenCalledWith({
      channelId: "ch1",
      ruleId: "def",
      userId: "u1",
    });
    expect(q.get("tab")).toBe("rules");
    expect(q.get("ok")).toBe(
      "Nouvelle règle appliquée à 37 demandes en attente : 30 acceptations programmées (25 tout de suite), 5 attendent encore les canaux obligatoires et 2 à valider à la main. Aucun message n'a été envoyé.",
    );
    expect(db.audits.at(-1)).toMatchObject({
      action: "approval_rule.applied_to_pending",
      entityType: "ApprovalRule",
      entityId: "def",
      metadata: {
        channelId: "ch1",
        ruleId: "def",
        count: 37,
        byStatus: { SCHEDULED: 30, PENDING_GATE: 5, REQUESTED: 2 },
      },
    });
  });

  it("règle introuvable ou exception désactivée : message d'erreur, rien au journal", async () => {
    pendingRule.apply.mockResolvedValueOnce({ status: "not_found" });
    let q = await redirectParams(() =>
      applyRuleToPendingAction(fdOf({ channelId: "ch1", ruleId: "x" })),
    );
    expect(q.get("error")).toBe("Cette règle n'existe plus : rechargez la page.");
    pendingRule.apply.mockResolvedValueOnce({ status: "inactive" });
    q = await redirectParams(() =>
      applyRuleToPendingAction(fdOf({ channelId: "ch1", ruleId: "e1" })),
    );
    expect(q.get("error")).toMatch(/^Cette exception est désactivée/);
    q = await redirectParams(() => applyRuleToPendingAction(fdOf({ channelId: "ch1" })));
    expect(q.get("error")).toBe("Règle introuvable : rechargez la page.");
    expect(db.audits).toEqual([]);
  });

  it("enregistrer la règle signale les demandes qui suivent encore l'ancienne règle", async () => {
    seedDefault({
      mode: "DELAY",
      delaySeconds: 300,
      gateMode: "REQUIRED",
      gateChannelIds: ["tir"],
    });
    pendingRule.summary.mockResolvedValue({
      ruleId: "def",
      count: 37,
      byStatus: { REQUESTED: 0, PENDING_GATE: 0, SCHEDULED: 37 },
      acceptNow: 37,
    });
    const url = await save({
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["tir"],
      gateMode: "SOFT",
      gateDelayPreset: "5m",
    });
    const ok = new URLSearchParams(url.split("?")[1]).get("ok") ?? "";
    expect(ok).toContain(
      "37 demandes déjà en attente suivent encore l'ancienne règle : « Leur appliquer la nouvelle règle » est sous le bouton « Enregistrer la règle ».",
    );
    expect(pendingRule.summary).toHaveBeenCalledWith("ch1", "def");
    // Une panne de lecture n'empêche pas l'enregistrement.
    pendingRule.summary.mockRejectedValue(new Error("base indisponible"));
    const again = await save({ ...chooseEntry(initialEntryState(null), "now") });
    expect(new URLSearchParams(again.split("?")[1]).get("ok")).toBe(
      "Règle d'adhésion enregistrée : elle s'applique aux prochaines demandes.",
    );
  });
});
