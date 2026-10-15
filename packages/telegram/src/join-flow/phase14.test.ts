/** Règles pures de la phase 14 : joignabilité, rappels à l'heure, textes d'accueil, bouton à rappel. */
import { describe, expect, it } from "vitest";
import { hasStartedBot, inJoinWindow, reachability } from "./reachability";
import { DEFAULT_GATE_REMINDER_MINUTES, earlyReminders, IMPLICIT_RULE } from "./rules";
import { mentionsRequiredStep, plainBotText } from "./texts";
import { buildGateButtons, gateCallbackData, parseGateCallbackData } from "./service";

const NOW = new Date("2026-10-15T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("joignabilité (le bot peut-il encore écrire ?)", () => {
  it("a démarré le bot et ne l'a pas bloqué : joignable à tout moment", () => {
    const state = { canDm: true, startedAt: ago(86_400_000), blockedAt: null };
    expect(hasStartedBot(state)).toBe(true);
    expect(reachability(state, null, NOW)).toEqual({ reachable: true, via: "started" });
  });

  it("demande de moins de 5 minutes avec user_chat_id : joignable, même sans « Démarrer »", () => {
    expect(reachability(null, { userChatId: 42n, requestedAt: ago(4 * 60_000) }, NOW)).toEqual({
      reachable: true,
      via: "join_window",
    });
    expect(inJoinWindow({ userChatId: null, requestedAt: ago(60_000) }, NOW)).toBe(false);
  });

  it("fenêtre passée, jamais démarré : injoignable (un message de la fenêtre ne compte pas)", () => {
    // État créé par l'envoi de l'accueil dans la fenêtre : canDm faux, pas de startedAt.
    const afterWelcome = { canDm: false, startedAt: null, blockedAt: null };
    expect(
      reachability(afterWelcome, { userChatId: 42n, requestedAt: ago(5 * 60_000) }, NOW),
    ).toEqual({ reachable: false, reason: "never_started" });
    // Ancienne donnée (avant la phase 14) : canDm vrai sans « Démarrer » ne suffit plus.
    expect(hasStartedBot({ canDm: true, startedAt: null, blockedAt: null })).toBe(false);
  });

  it("bloqué (Telegram l'a dit) : jamais joignable, même dans la fenêtre", () => {
    const blocked = { canDm: false, startedAt: ago(60_000), blockedAt: ago(30_000) };
    expect(reachability(blocked, { userChatId: 42n, requestedAt: ago(60_000) }, NOW)).toEqual({
      reachable: false,
      reason: "blocked",
    });
  });

  it("démarré mais Telegram a refusé ensuite (injoignable sans blocage)", () => {
    const refused = { canDm: false, startedAt: ago(86_400_000), blockedAt: null };
    expect(reachability(refused, null, NOW)).toEqual({ reachable: false, reason: "unreachable" });
  });
});

describe("rappels à l'heure (moins de 5 minutes après la demande)", () => {
  const rule = {
    ...IMPLICIT_RULE,
    gateMode: "REQUIRED" as const,
    gateChannelIds: ["a"],
    reminderAfterMinutes: [...DEFAULT_GATE_REMINDER_MINUTES],
    maxReminders: 2,
  };
  it("règle par défaut des nouvelles règles : 4 minutes (à l'heure) puis 1 heure (passage du worker)", () => {
    expect(DEFAULT_GATE_REMINDER_MINUTES).toEqual([4, 60]);
    expect(earlyReminders(rule, NOW)).toEqual([
      { index: 0, at: new Date(NOW.getTime() + 4 * 60_000) },
    ]);
  });
  it("aucun avec des canaux proposés, sans canaux, ou au-delà du nombre de rappels", () => {
    expect(earlyReminders({ ...rule, gateMode: "SOFT" }, NOW)).toEqual([]);
    expect(earlyReminders({ ...rule, gateChannelIds: [] }, NOW)).toEqual([]);
    expect(earlyReminders({ ...rule, maxReminders: 0 }, NOW)).toEqual([]);
    expect(earlyReminders({ ...rule, reminderAfterMinutes: [5, 60] }, NOW)).toEqual([]);
  });
});

describe("textes", () => {
  it("accueil qui parle d'une étape obligatoire (avertissement des canaux « Proposés »)", () => {
    expect(
      mentionsRequiredStep(
        "Rejoins les deux canaux ci-dessous, puis clique sur « J’ai rejoint » pour être accepté",
      ),
    ).toBe(true);
    expect(mentionsRequiredStep("Dernière étape : rejoins nos canaux")).toBe(true);
    expect(mentionsRequiredStep("Ces canaux sont <b>obligatoires</b>")).toBe(true);
    expect(mentionsRequiredStep("Then tap ✅ I joined")).toBe(true);
    expect(mentionsRequiredStep("Ta demande est reçue, découvre aussi nos canaux.")).toBe(false);
    expect(mentionsRequiredStep(null)).toBe(false);
  });
  it("réponse courte d'un bouton : texte brut, 200 caractères au plus", () => {
    expect(plainBotText("C'est bon <b>Jean &amp; Léa</b>")).toBe("C'est bon Jean & Léa");
    expect(plainBotText("x".repeat(300))).toHaveLength(200);
  });
});

describe("bouton à rappel « ✅ J'ai rejoint »", () => {
  it("g:<code> aller-retour, rien d'autre", () => {
    expect(gateCallbackData("AbC12345")).toBe("g:AbC12345");
    expect(parseGateCallbackData("g:AbC12345")).toBe("AbC12345");
    expect(parseGateCallbackData("g:")).toBeNull();
    expect(parseGateCallbackData("o:AbC12345")).toBeNull();
    expect(parseGateCallbackData(undefined)).toBeNull();
  });
  it("canaux obligatoires : boutons des canaux puis « ✅ J'ai rejoint » ; proposés : pas de « J'ai rejoint »", () => {
    const gates = [{ channelId: "a", title: "Tir", url: "https://t.me/+a" }];
    expect(buildGateButtons(gates, { code: "AbC12345" }, "fr")).toEqual([
      [{ text: "Rejoindre Tir", url: "https://t.me/+a" }],
      [{ text: "✅ J'ai rejoint", callbackData: "g:AbC12345" }],
    ]);
    expect(buildGateButtons(gates, null, "en")).toEqual([
      [{ text: "Join Tir", url: "https://t.me/+a" }],
    ]);
  });
});
