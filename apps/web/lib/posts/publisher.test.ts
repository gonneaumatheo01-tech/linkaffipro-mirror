/**
 * Qui publie un message de canal avec des emojis animés (phase 12, D10) : le compte connecté sans boutons, le choix
 * imposé avec des boutons, les emojis normaux si l'équipe garde les boutons, rien pour un modèle ; prérequis du compte.
 */
import { describe, expect, it } from "vitest";
import type { MtprotoPublishStatus } from "@linkaffipro/core";
import {
  EMOJI_CHOICE_REQUIRED,
  accountProblemsFor,
  channelsToCheck,
  hasAccountProblem,
  needsAccountFor,
  parseEmojiButtonsChoice,
  parsePublishStatus,
  planPostVersion,
  postEmojiState,
  scheduleRefusal,
  statusAnswered,
  versionMode,
} from "./publisher";

const E = '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>';
const TEXT = `Bonus ${E} ce soir`;
const BTN = [[{ text: "Jouer", type: "URL", url: "https://x.test" }]];

function status(over: Partial<MtprotoPublishStatus> = {}): MtprotoPublishStatus {
  return {
    checkedAt: "2026-10-11T10:00:00.000Z",
    connected: true,
    premium: true,
    user: { id: "42", firstName: "Matt", username: "matt" },
    error: null,
    channels: { c1: { canPost: true, checkedAt: "2026-10-11T10:00:00.000Z" } },
    ...over,
  };
}

describe("planPostVersion : texte, boutons et auteur enregistrés", () => {
  it("sans emoji animé : le bot, texte et boutons tels quels", () => {
    expect(
      planPostVersion({ text: "Salut", buttons: BTN, choice: null, isTemplate: false }),
    ).toEqual({ ok: true, publisher: "BOT", text: "Salut", buttons: BTN });
  });

  it("emojis animés sans bouton : le compte connecté", () => {
    expect(planPostVersion({ text: TEXT, buttons: [], choice: null, isTemplate: false })).toEqual({
      ok: true,
      publisher: "ACCOUNT",
      text: TEXT,
      buttons: [],
    });
  });

  it("emojis animés et boutons sans choix : refus en français", () => {
    expect(planPostVersion({ text: TEXT, buttons: BTN, choice: null, isTemplate: false })).toEqual({
      ok: false,
      error: EMOJI_CHOICE_REQUIRED,
    });
    // Une ligne vide ne compte pas comme un bouton.
    expect(
      planPostVersion({ text: TEXT, buttons: [[]], choice: null, isTemplate: false }),
    ).toMatchObject({ ok: true, publisher: "ACCOUNT" });
  });

  it("choix « emojis » : le compte, boutons retirés", () => {
    expect(
      planPostVersion({ text: TEXT, buttons: BTN, choice: "emojis", isTemplate: false }),
    ).toEqual({ ok: true, publisher: "ACCOUNT", text: TEXT, buttons: [] });
  });

  it("choix « boutons » : le bot, chaque emoji animé remplacé par son emoji normal", () => {
    expect(
      planPostVersion({ text: TEXT, buttons: BTN, choice: "buttons", isTemplate: false }),
    ).toEqual({ ok: true, publisher: "BOT", text: "Bonus 👍 ce soir", buttons: BTN });
  });

  it("modèle : tout est gardé tel quel (le choix se fera en l'utilisant)", () => {
    expect(planPostVersion({ text: TEXT, buttons: BTN, choice: null, isTemplate: true })).toEqual({
      ok: true,
      publisher: "BOT",
      text: TEXT,
      buttons: BTN,
    });
  });
});

describe("état du formulaire", () => {
  it("modes d'une version", () => {
    expect(versionMode({ text: "x", buttons: BTN, choice: null })).toBe("bot");
    expect(versionMode({ text: TEXT, buttons: [], choice: null })).toBe("account");
    expect(versionMode({ text: TEXT, buttons: BTN, choice: null })).toBe("choice");
    expect(versionMode({ text: TEXT, buttons: BTN, choice: "emojis" })).toBe("account");
    expect(versionMode({ text: TEXT, buttons: BTN, choice: "buttons" })).toBe("fallback");
  });

  it("versions A et B : choix demandé si l'une a emojis et boutons", () => {
    const s = postEmojiState({
      textA: "Sans emoji",
      buttonsA: BTN,
      textB: TEXT,
      buttonsB: BTN,
      abActive: true,
      choice: null,
      isTemplate: false,
    });
    expect(s).toMatchObject({
      hasEmoji: true,
      choiceOffered: true,
      choiceMissing: true,
      modeA: "bot",
      modeB: "choice",
      account: false,
    });
    // La version B ne compte pas si le test A/B n'est pas actif.
    expect(
      postEmojiState({
        textA: "x",
        buttonsA: [],
        textB: TEXT,
        buttonsB: BTN,
        abActive: false,
        choice: null,
        isTemplate: false,
      }),
    ).toMatchObject({ hasEmoji: false, choiceOffered: false, modeB: null });
  });

  it("modèle : aucun choix ni compte, mais le rappel des emojis animés", () => {
    expect(
      postEmojiState({
        textA: TEXT,
        buttonsA: BTN,
        abActive: false,
        choice: null,
        isTemplate: true,
      }),
    ).toMatchObject({ hasEmoji: true, choiceOffered: false, account: false });
  });

  it("choix lu dans le formulaire", () => {
    expect(parseEmojiButtonsChoice("emojis")).toBe("emojis");
    expect(parseEmojiButtonsChoice("buttons")).toBe("buttons");
    expect(parseEmojiButtonsChoice("autre")).toBeNull();
    expect(parseEmojiButtonsChoice(null)).toBeNull();
  });
});

describe("prérequis du compte Telegram connecté", () => {
  const ch = [{ id: "c1", title: "Casino VIP" }];

  it("tout va bien : aucun problème", () => {
    const p = accountProblemsFor(status(), ch);
    expect(p).toEqual({ global: null, channels: [] });
    expect(hasAccountProblem(p)).toBe(false);
    expect(scheduleRefusal(p)).toBeNull();
  });

  it("aucun relevé ou compte non connecté : problème général, avec le chemin des réglages", () => {
    const none = accountProblemsFor(null, ch);
    expect(none.global).toMatch(/Aucun compte Telegram connecté/);
    expect(scheduleRefusal(none)).toMatch(/^Enregistré en brouillon, pas programmé/);
    expect(scheduleRefusal(none)).toContain("Réglages → Connexions → Telegram");
    expect(accountProblemsFor(status({ connected: false }), ch).global).toMatch(/Aucun compte/);
  });

  it("session expirée, pas Premium : problème général", () => {
    expect(accountProblemsFor(status({ error: "Session expirée." }), ch).global).toBe(
      "Session expirée.",
    );
    expect(accountProblemsFor(status({ premium: false }), ch).global).toMatch(/Premium/);
    expect(scheduleRefusal(accountProblemsFor(status({ premium: false }), ch), 3)).toMatch(
      /^3 brouillons enregistrés, pas programmés/,
    );
  });

  it("canal pas vérifié ou sans droit de publier : problème du canal", () => {
    const unchecked = accountProblemsFor(status({ channels: {} }), ch);
    expect(unchecked.channels[0]).toMatchObject({ channelId: "c1", title: "Casino VIP" });
    expect(unchecked.channels[0]!.problem).toMatch(/pas encore vérifiés/);
    const denied = accountProblemsFor(
      status({ channels: { c1: { canPost: false, checkedAt: "x", error: null } } }),
      ch,
    );
    expect(denied.channels[0]!.problem).toMatch(/n'est pas administrateur/);
    expect(scheduleRefusal(denied)).toMatch(/ne peut pas encore publier dans «\sCasino VIP\s»/);
    expect(scheduleRefusal(denied)).toContain("(Réglages → Connexions → Telegram).");
  });

  it("canaux à vérifier : ceux jamais relevés, et aucun si le compte est inutilisable", () => {
    expect(channelsToCheck(status(), ["c1", "c2"])).toEqual(["c2"]);
    expect(channelsToCheck(null, ["c1"])).toEqual(["c1"]);
    expect(channelsToCheck(status({ connected: false }), ["c2"])).toEqual([]);
  });

  it("réponse de la vérification : un relevé plus récent que la demande", () => {
    expect(statusAnswered(status(), "2026-10-11T09:59:59.000Z")).toBe(true);
    expect(statusAnswered(status(), "2026-10-11T10:05:00.000Z")).toBe(false);
    expect(statusAnswered(null, "2026-10-11T09:00:00.000Z")).toBe(false);
  });

  it("lecture du relevé enregistré : valeurs mal formées écartées", () => {
    expect(parsePublishStatus(null)).toBeNull();
    expect(parsePublishStatus({ connected: true })).toBeNull();
    const s = parsePublishStatus({
      checkedAt: "2026-10-11T10:00:00.000Z",
      connected: true,
      premium: "oui",
      user: { id: "1", firstName: "A" },
      error: "",
      channels: { c1: { canPost: true, checkedAt: "t" }, c2: { canPost: "x" }, c3: null },
    });
    expect(s).toEqual({
      checkedAt: "2026-10-11T10:00:00.000Z",
      connected: true,
      premium: null,
      user: { id: "1", firstName: "A", username: null },
      error: null,
      channels: { c1: { canPost: true, checkedAt: "t", error: null } },
    });
  });
});

describe("groupe ou supergroupe : le bot publie lui-même les emojis animés", () => {
  it("planPostVersion : groupe → le bot, emojis animés ET boutons gardés, sans choix", () => {
    expect(
      planPostVersion({
        text: TEXT,
        buttons: BTN,
        choice: null,
        isTemplate: false,
        chatType: "GROUP",
      }),
    ).toEqual({ ok: true, publisher: "BOT", text: TEXT, buttons: BTN });
    // Le choix « boutons » ne concerne que les canaux : dans un groupe, les emojis animés restent.
    expect(
      planPostVersion({
        text: TEXT,
        buttons: BTN,
        choice: "buttons",
        isTemplate: false,
        chatType: "GROUP",
      }),
    ).toEqual({ ok: true, publisher: "BOT", text: TEXT, buttons: BTN });
    // Canal (ou type inconnu) : comme avant.
    expect(
      planPostVersion({
        text: TEXT,
        buttons: [],
        choice: null,
        isTemplate: false,
        chatType: "CHANNEL",
      }),
    ).toMatchObject({ ok: true, publisher: "ACCOUNT" });
    expect(
      planPostVersion({ text: TEXT, buttons: [], choice: null, isTemplate: false, chatType: null }),
    ).toMatchObject({ ok: true, publisher: "ACCOUNT" });
  });

  it("le compte connecté n'est nécessaire que dans un canal", () => {
    expect(needsAccountFor("CHANNEL")).toBe(true);
    expect(needsAccountFor(undefined)).toBe(true);
    expect(needsAccountFor("GROUP")).toBe(false);
  });

  it("formulaire, groupes seulement : ni bandeau, ni choix, boutons gardés, contenu protégé possible", () => {
    const s = postEmojiState({
      textA: TEXT,
      buttonsA: BTN,
      abActive: false,
      choice: null,
      isTemplate: false,
      targetsA: { channel: false, group: true },
    });
    expect(s).toMatchObject({
      hasEmoji: true,
      choiceOffered: false,
      choiceMissing: false,
      account: false,
      modeA: "group",
      groupEmoji: true,
      buttonsOffA: false,
      protect: "ok",
    });
  });

  it("formulaire, canal et groupe cochés : compte dans le canal, bot dans le groupe (boutons gardés pour le groupe)", () => {
    const s = postEmojiState({
      textA: TEXT,
      buttonsA: BTN,
      abActive: false,
      choice: "emojis",
      isTemplate: false,
      targetsA: { channel: true, group: true },
    });
    expect(s).toMatchObject({
      account: true,
      modeA: "account",
      groupEmoji: true,
      buttonsOffA: false,
      protect: "partial",
    });
    // Sans choix : le choix reste demandé pour le canal.
    expect(
      postEmojiState({
        textA: TEXT,
        buttonsA: BTN,
        abActive: false,
        choice: null,
        isTemplate: false,
        targetsA: { channel: true, group: true },
      }),
    ).toMatchObject({ choiceOffered: true, choiceMissing: true });
  });

  it("formulaire, canal seulement : boutons retirés partout, contenu protégé impossible", () => {
    const s = postEmojiState({
      textA: TEXT,
      buttonsA: [],
      abActive: false,
      choice: null,
      isTemplate: false,
    });
    expect(s).toMatchObject({
      account: true,
      groupEmoji: false,
      buttonsOffA: true,
      protect: "none",
    });
    // Version B dans un groupe : une partie des messages reste protégeable.
    expect(
      postEmojiState({
        textA: TEXT,
        buttonsA: [],
        textB: TEXT,
        buttonsB: [],
        abActive: true,
        choice: null,
        isTemplate: false,
        targetsB: { channel: false, group: true },
      }),
    ).toMatchObject({ modeA: "account", modeB: "group", protect: "partial", buttonsOffB: false });
    // Sans emoji animé : rien ne change.
    expect(
      postEmojiState({
        textA: "x",
        buttonsA: BTN,
        abActive: false,
        choice: null,
        isTemplate: false,
      }),
    ).toMatchObject({ protect: "ok", buttonsOffA: false, groupEmoji: false });
  });
});
