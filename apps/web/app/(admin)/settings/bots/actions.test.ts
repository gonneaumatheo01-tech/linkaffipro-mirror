import { beforeEach, describe, expect, it, vi } from "vitest";

// Réglages → Bots : mode du bot (bot normal / assistant de conversation) et persona liée (phase 17). Administrateur
// requis, instance du bot recréée, profil Telegram reposé (jamais bloquant), action journalisée.
const m = vi.hoisted(() => ({
  bot: {
    id: "bot1",
    username: "lea_bot",
    mode: "STANDARD" as "STANDARD" | "ASSISTANT",
    personaId: null as string | null,
    role: "CHANNEL" as "CHANNEL" | "ADMIN",
  },
  personas: new Map<string, { id: string; name: string; isActive: boolean }>([
    ["p1", { id: "p1", name: "Léa", isActive: true }],
    ["p2", { id: "p2", name: "Hugo", isActive: false }],
  ]),
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  requireAdmin: vi.fn(async () => ({ id: "admin1", role: "ADMIN" })),
  evictBot: vi.fn(),
  setAssistantProfile: vi.fn(),
  handover: {
    primaries: [] as Array<{ channelId: string; botId: string | null }>,
    posts: [] as Array<{ postId: string; botId: string }>,
    stuck: [] as Array<{ postId: string; channelId: string; channelTitle: string | null }>,
  },
  applied: { replaced: 0, emptied: 0, posts: 0 },
  /** Canaux que le bot administre encore (`ChannelBotAdmin` non retirés). */
  channelAdmins: 0,
  channelCountWhere: [] as unknown[],
  loadAssistantHandover: vi.fn(),
  applyAssistantHandover: vi.fn(),
  registerBoss: vi.fn(async () => ({ botId: "boss1", username: "kevin_bot", name: "Kevin", created: true, replaced: ["old_boss"], reasked: false })),
}));

class Redirect extends Error {
  digest: string;
  constructor(readonly url: string) {
    super("NEXT_REDIRECT");
    this.digest = `NEXT_REDIRECT;${url}`;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    bot: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === m.bot.id ? { ...m.bot } : null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.updates.push(data);
        Object.assign(m.bot, data);
        return m.bot;
      }),
    },
    persona: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => m.personas.get(where.id) ?? null,
      ),
    },
    channelBotAdmin: {
      count: vi.fn(async (args: unknown) => {
        m.channelCountWhere.push(args);
        return m.channelAdmins;
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
}));
vi.mock("@/lib/session", () => ({
  requireAdmin: m.requireAdmin,
  requireUser: vi.fn(async () => ({ id: "admin1", role: "ADMIN" })),
}));
vi.mock("@linkaffipro/telegram", () => ({
  evictBot: m.evictBot,
  setAssistantProfile: m.setAssistantProfile,
  registerBotFromToken: vi.fn(),
  setWebhookForBot: vi.fn(),
  registerBossFromToken: m.registerBoss,
  BossRegisterError: class extends Error {},
  bossRegisteredText: (u: string) => `Kevin est prêt : envoie /start à @${u} depuis ton compte, puis écris « commencer ».`,
}));

vi.mock("./assistant-handover", () => ({
  loadAssistantHandover: m.loadAssistantHandover,
  applyAssistantHandover: m.applyAssistantHandover,
}));

import { addBotAction, setBotModeAction } from "./actions";

async function redirected(p: Promise<unknown>): Promise<URLSearchParams> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) {
      expect(err.url.startsWith("/settings/bots?")).toBe(true);
      return new URLSearchParams(err.url.split("?")[1]);
    }
    throw err;
  }
  throw new Error("aucune redirection");
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  Object.assign(m.bot, { mode: "STANDARD", personaId: null, role: "CHANNEL" });
  m.updates.length = 0;
  m.audits.length = 0;
  m.evictBot.mockClear();
  m.requireAdmin.mockClear();
  m.handover = { primaries: [], posts: [], stuck: [] };
  m.applied = { replaced: 0, emptied: 0, posts: 0 };
  m.channelAdmins = 0;
  m.channelCountWhere.length = 0;
  m.loadAssistantHandover.mockReset();
  m.loadAssistantHandover.mockImplementation(async () => m.handover);
  m.applyAssistantHandover.mockReset();
  m.applyAssistantHandover.mockImplementation(async () => m.applied);
  m.setAssistantProfile.mockReset();
  m.setAssistantProfile.mockResolvedValue({
    mode: "ASSISTANT",
    applied: true,
    languages: ["fr"],
    warnings: [],
  });
});

describe("mode du bot", () => {
  it("assistant de conversation + persona : enregistré, instance recréée, profil posé, journalisé", async () => {
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(m.requireAdmin).toHaveBeenCalledTimes(1);
    expect(m.updates).toEqual([{ mode: "ASSISTANT", personaId: "p1" }]);
    expect(m.evictBot).toHaveBeenCalledWith("bot1");
    expect(m.setAssistantProfile).toHaveBeenCalledWith("bot1");
    expect(m.audits).toEqual([
      expect.objectContaining({
        action: "assistant.bot_mode_changed",
        entityType: "Bot",
        entityId: "bot1",
        // Phase 34 : même cœur que Kevin, journal avec la provenance (`via`).
        metadata: { from: "STANDARD", to: "ASSISTANT", fromPersonaId: null, personaId: "p1", via: "WEB" },
      }),
    ]);
    expect(sp.get("ok")).toBe(
      "@lea_bot est maintenant un assistant de conversation (persona Léa).",
    );
    expect(sp.get("error")).toBeNull();
  });

  it("bot normal : la persona liée est retirée", async () => {
    Object.assign(m.bot, { mode: "ASSISTANT", personaId: "p1" });
    m.setAssistantProfile.mockResolvedValue({ mode: "STANDARD", cleared: true, languages: ["fr"] });
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "STANDARD", personaId: "p1" })),
    );
    expect(m.updates).toEqual([{ mode: "STANDARD", personaId: null }]);
    expect(sp.get("ok")).toBe("@lea_bot est maintenant un bot normal.");
  });

  it("sans persona, ou persona désactivée : enregistré avec un avertissement clair", async () => {
    let sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "" })),
    );
    expect(m.updates.at(-1)).toEqual({ mode: "ASSISTANT", personaId: null });
    expect(sp.get("ok")).toContain(
      "Liez une persona : sans elle, l'assistant ne répond à personne.",
    );
    sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p2" })),
    );
    expect(sp.get("ok")).toContain("La persona est désactivée");
  });

  it("textes de la persona refusés pour la description : signalés", async () => {
    m.setAssistantProfile.mockResolvedValue({
      mode: "ASSISTANT",
      applied: true,
      languages: ["fr"],
      warnings: [
        "Description de la persona refusée : elle doit dire que c'est l'assistante ou l'assistant du canal. Texte par défaut utilisé.",
      ],
    });
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(sp.get("ok")).toContain("Description de la persona refusée");
  });

  it("Telegram injoignable pour le profil : mode gardé, raison en clair, jamais le texte technique", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.setAssistantProfile.mockRejectedValue(
      new Error("Network request for 'setMyDescription' failed!"),
    );
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(m.updates).toHaveLength(1);
    expect(sp.get("error")).toBe(
      "@lea_bot est maintenant un assistant de conversation (persona Léa). Mais la description du bot n'a pas pu être posée dans Telegram : Telegram ne répond pas pour l'instant. Réessayez dans un instant.",
    );
    expect(sp.get("error")).not.toMatch(/Network|setMyDescription|failed/);
    // Le texte brut part dans le journal du serveur.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[1])).toContain("setMyDescription");
    logged.mockRestore();
  });

  it("limite de Telegram (429) pour le profil : « attendre quelques secondes »", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.setAssistantProfile.mockRejectedValue(
      new Error("Call to 'setMyDescription' failed! (429: Too Many Requests: retry after 31)"),
    );
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(sp.get("error")).toContain(
      "n'a pas pu être posée dans Telegram : Telegram demande d'attendre quelques secondes. Réessayez dans un instant.",
    );
    expect(sp.get("error")).not.toMatch(/Call to|Too Many|retry/);
    logged.mockRestore();
  });

  it("jeton refusé par Telegram pour le profil : coller le nouveau jeton, jamais « réessayez »", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.setAssistantProfile.mockRejectedValue(
      new Error("Call to 'setMyDescription' failed! (401: Unauthorized)"),
    );
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(m.updates).toHaveLength(1);
    expect(sp.get("error")).toBe(
      "@lea_bot est maintenant un assistant de conversation (persona Léa). Mais la description du bot n'a pas pu être posée dans Telegram : Telegram refuse le jeton de ce bot (supprimé ou régénéré dans @BotFather). Collez le nouveau jeton avec « Ajouter un bot » (Réglages → Bots), puis réenregistrez.",
    );
    expect(sp.get("error")).not.toMatch(/Réessayez|Unauthorized|401/);
    logged.mockRestore();
  });

  it("description refusée par notre garde-fou : la corriger dans la persona, jamais « réessayez »", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.setAssistantProfile.mockRejectedValue(
      new Error(
        "Description du bot refusée : elle doit dire que c'est l'assistante ou l'assistant du canal, sans laisser croire à une vraie personne.",
      ),
    );
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(sp.get("error")).toContain(
      "n'a pas pu être posée dans Telegram : Description du bot refusée : elle doit dire que c'est l'assistante ou l'assistant du canal, sans laisser croire à une vraie personne. Corrigez la description dans le bloc « Profil du bot » de la persona, puis réenregistrez.",
    );
    expect(sp.get("error")).not.toMatch(/Réessayez/);
    logged.mockRestore();
  });

  it("garde-fou : un bot normal qui gère des canaux ne devient jamais l'assistante (rien n'est modifié)", async () => {
    m.channelAdmins = 2;
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(sp.get("error")).toBe(
      "Ce bot gère 2 canaux : il ne peut pas devenir l'assistante. Créez un bot dédié dans @BotFather (voir le guide) et ajoutez-le ici.",
    );
    expect(m.channelCountWhere).toEqual([{ where: { botId: "bot1", revokedAt: null } }]);
    expect(m.updates).toEqual([]);
    expect(m.audits).toEqual([]);
    expect(m.evictBot).not.toHaveBeenCalled();
    expect(m.loadAssistantHandover).not.toHaveBeenCalled();
    expect(m.setAssistantProfile).not.toHaveBeenCalled();
    m.channelAdmins = 1;
    const one = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(one.get("error")).toMatch(/^Ce bot gère 1 canal : /);
  });

  it("garde-fou : retour en bot normal, ou persona changée d'un bot déjà assistant, toujours possibles", async () => {
    m.channelAdmins = 3;
    Object.assign(m.bot, { mode: "ASSISTANT", personaId: "p1" });
    let sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p2" })),
    );
    expect(sp.get("error")).toBeNull();
    expect(m.updates).toEqual([{ mode: "ASSISTANT", personaId: "p2" }]);
    m.setAssistantProfile.mockResolvedValue({ mode: "STANDARD", cleared: true, languages: ["fr"] });
    sp = await redirected(setBotModeAction(form({ botId: "bot1", mode: "STANDARD" })));
    expect(sp.get("ok")).toBe("@lea_bot est maintenant un bot normal.");
    expect(m.channelCountWhere).toEqual([]);
  });

  it("refusé : mode inconnu, bot ou persona introuvable (rien n'est modifié)", async () => {
    let sp = await redirected(setBotModeAction(form({ botId: "bot1", mode: "ROBOT" })));
    expect(sp.get("error")).toBe("Choisissez un mode valide pour le bot.");
    sp = await redirected(setBotModeAction(form({ botId: "autre", mode: "STANDARD" })));
    expect(sp.get("error")).toBe("Bot introuvable.");
    sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "inconnue" })),
    );
    expect(sp.get("error")).toBe("Persona introuvable : choisissez-en une autre.");
    expect(m.updates).toEqual([]);
    expect(m.audits).toEqual([]);
  });

  it("passage en assistant : bot principal et messages à venir repris par un bot normal", async () => {
    m.handover = {
      primaries: [{ channelId: "c1", botId: "b2" }],
      posts: [{ postId: "p1", botId: "b2" }],
      stuck: [],
    };
    m.applied = { replaced: 1, emptied: 1, posts: 2 };
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(m.applyAssistantHandover).toHaveBeenCalledWith("bot1", m.handover);
    expect(sp.get("ok")).toContain(
      "Un autre de nos bots le remplace comme bot principal (1 canal).",
    );
    expect(sp.get("ok")).toContain("1 canal n'a plus de bot principal");
    expect(sp.get("ok")).toContain(
      "2 messages de canal pas encore publiés passent à un autre de nos bots.",
    );
    expect(m.audits[0]).toMatchObject({
      metadata: { primaryReplaced: 1, primaryEmptied: 1, postsMoved: 2 },
    });
  });

  it("refusé tant qu'un message à venir n'a aucun autre bot pour le publier (rien n'est modifié)", async () => {
    m.handover = {
      primaries: [],
      posts: [],
      stuck: [
        { postId: "p1", channelId: "c1", channelTitle: "Rencontres VIP" },
        { postId: "p2", channelId: "c1", channelTitle: "Rencontres VIP" },
      ],
    };
    const sp = await redirected(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    );
    expect(sp.get("error")).toBe(
      "@lea_bot doit encore publier 2 messages dans « Rencontres VIP », où aucun autre de nos bots n'est administrateur. Ajoutez un autre bot comme administrateur de ce canal, ou supprimez ces messages, puis réessayez.",
    );
    expect(m.updates).toEqual([]);
    expect(m.applyAssistantHandover).not.toHaveBeenCalled();
    expect(m.evictBot).not.toHaveBeenCalled();
  });

  it("retour en bot normal : rien à reprendre", async () => {
    Object.assign(m.bot, { mode: "ASSISTANT", personaId: "p1" });
    m.setAssistantProfile.mockResolvedValue({ mode: "STANDARD", cleared: true, languages: ["fr"] });
    await redirected(setBotModeAction(form({ botId: "bot1", mode: "STANDARD" })));
    expect(m.loadAssistantHandover).not.toHaveBeenCalled();
    expect(m.applyAssistantHandover).not.toHaveBeenCalled();
  });

  it("réservé aux administrateurs", async () => {
    m.requireAdmin.mockRejectedValueOnce(new Error("Action réservée aux administrateurs"));
    await expect(
      setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })),
    ).rejects.toThrow("Action réservée aux administrateurs");
    expect(m.updates).toEqual([]);
  });
});

describe("Réglages → Bots : le Boss (phase 26)", () => {
  it("« Ajouter un bot » avec le rôle Boss : même enregistrement que par Telegram, message « /start »", async () => {
    const q = await redirected(addBotAction(form({ token: "123:ABC", role: "ADMIN" })));
    expect(m.registerBoss).toHaveBeenCalledWith("123:ABC", { userId: "admin1", via: "SITE" });
    expect(q.get("ok")).toContain("envoie /start à @kevin_bot");
    expect(q.get("ok")).toContain("@old_boss");
  });

  it("le Boss ne peut jamais devenir assistant de conversation (refus du serveur)", async () => {
    m.bot.role = "ADMIN";
    const q = await redirected(setBotModeAction(form({ botId: "bot1", mode: "ASSISTANT", personaId: "p1" })));
    expect(q.get("error")).toContain("Boss");
    expect(m.updates).toEqual([]);
  });
});
