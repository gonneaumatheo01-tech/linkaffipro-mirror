import { describe, expect, it } from "vitest";
import { buildTodo, groupGateLinksMissing, type TodoInput } from "./todo";

const empty: TodoInput = {
  isAdmin: true,
  pendingRequests: [],
  failedPosts: 0,
  adReconnect: [],
  telegramSessionError: false,
  channelsWithoutRule: [],
  abTests: [],
  telegramLinked: true,
  telegramInChecklist: false,
  aiKeyMissing: false,
};

describe("bloc « À faire » de l'accueil", () => {
  it("rien à faire : liste vide", () => {
    expect(buildTodo(empty)).toEqual([]);
  });

  it("demandes à valider : une ligne par canal (les plus nombreuses d'abord), puis les autres canaux", () => {
    const lines = buildTodo({
      ...empty,
      pendingRequests: [
        { channelId: "c1", channelTitle: "Casino VIP", count: 1 },
        { channelId: "c2", channelTitle: "Rencontres Lyon", count: 4 },
        { channelId: "c3", channelTitle: "Foot", count: 2 },
        { channelId: "c4", channelTitle: "Tennis", count: 1 },
        { channelId: "c5", channelTitle: "Basket", count: 2 },
        { channelId: "c6", channelTitle: "Vide", count: 0 },
      ],
    });
    expect(lines.map((l) => [l.text, l.href])).toEqual([
      ["4 demandes d'adhésion à valider dans « Rencontres Lyon »", "/channels/c2?tab=requests"],
      ["2 demandes d'adhésion à valider dans « Basket »", "/channels/c5?tab=requests"],
      ["2 demandes d'adhésion à valider dans « Foot »", "/channels/c3?tab=requests"],
      ["2 autres demandes à valider dans 2 autres canaux", "/channels"],
    ]);
    expect(
      buildTodo({
        ...empty,
        pendingRequests: [{ channelId: "c1", channelTitle: "A", count: 1 }],
      })[0]!.text,
    ).toBe("1 demande d'adhésion à valider dans « A »");
  });

  it("demandes qui attendent des liens de canaux : en tête, avec le bouton « Renvoyer l'accueil avec les liens »", () => {
    const lines = buildTodo({
      ...empty,
      pendingRequests: [{ channelId: "c1", channelTitle: "A", count: 2 }],
      gateLinksMissing: [
        { channelId: "z1", channelTitle: "Autre", count: 1, missingTitles: ["Canal B"] },
        {
          channelId: "z",
          channelTitle: "Zone Interdite 🔞",
          count: 2,
          missingTitles: ["LA ZONE ROULETTE 🎰", "🎯 TIR CADRÉ ⚡"],
        },
      ],
    });
    expect(lines[0]).toEqual({
      key: "gate-links:z",
      text: "2 demandes dans « Zone Interdite 🔞 » attendent des liens de canaux : « LA ZONE ROULETTE 🎰 », « 🎯 TIR CADRÉ ⚡ »",
      href: "/channels/z?tab=rules",
      icon: "links",
      tone: "danger",
      action: {
        kind: "resend-gate-welcome",
        channelId: "z",
        label: "Renvoyer l'accueil avec les liens",
      },
    });
    expect(lines[1]!.text).toBe(
      "1 demande dans « Autre » attend des liens de canaux : « Canal B »",
    );
    expect(lines[2]!.key).toBe("requests:c1");
    // Sans demande concernée : aucune ligne.
    expect(buildTodo({ ...empty, gateLinksMissing: [] })).toEqual([]);
  });

  it("canal obligatoire que le bot ne peut pas vérifier : même ligne, en mots clairs", () => {
    const lines = buildTodo({
      ...empty,
      gateLinksMissing: [
        {
          channelId: "p",
          channelTitle: "Paris public",
          count: 1,
          missingTitles: [],
          uncheckedTitles: ["Canal public"],
        },
        {
          channelId: "z",
          channelTitle: "Zone",
          count: 2,
          missingTitles: ["Roulette"],
          uncheckedTitles: ["Canal public"],
        },
        {
          channelId: "q",
          channelTitle: "Quiz",
          count: 3,
          missingTitles: [],
          uncheckedTitles: ["C"],
        },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      "3 demandes dans « Quiz » sont bloquées : le bot ne peut pas vérifier « C »",
      "2 demandes dans « Zone » attendent des liens de canaux : « Roulette » ; le bot ne peut pas vérifier « Canal public »",
      "1 demande dans « Paris public » est bloquée : le bot ne peut pas vérifier « Canal public »",
    ]);
    expect(lines[2]).toMatchObject({
      key: "gate-links:p",
      tone: "danger",
      action: { kind: "resend-gate-welcome", channelId: "p" },
    });
  });

  it("regroupement par canal : canaux sans lien et canaux impossibles à vérifier séparés", () => {
    expect(
      groupGateLinksMissing([
        {
          channelId: "z",
          channelTitle: "Zone",
          missing: [{ title: "Roulette" }, { title: "Public", reason: "cannot_verify" }],
        },
        { channelId: "z", channelTitle: "Zone", missing: [{ title: "Tir", reason: "no_link" }] },
        {
          channelId: "p",
          channelTitle: "Paris",
          missing: [{ title: "Public", reason: "cannot_verify" }],
        },
      ]),
    ).toEqual([
      {
        channelId: "z",
        channelTitle: "Zone",
        count: 2,
        missingTitles: ["Roulette", "Tir"],
        uncheckedTitles: ["Public"],
      },
      {
        channelId: "p",
        channelTitle: "Paris",
        count: 1,
        missingTitles: [],
        uncheckedTitles: ["Public"],
      },
    ]);
  });

  it("ordre : demandes, échecs, connexions, canaux sans règle, tests A/B, Telegram, clé IA", () => {
    const lines = buildTodo({
      ...empty,
      pendingRequests: [{ channelId: "c1", channelTitle: "A", count: 2 }],
      failedPosts: 3,
      adReconnect: [{ platform: "META", name: "Compte FR" }],
      telegramSessionError: true,
      channelsWithoutRule: [{ id: "c9", title: "Nouveau canal" }],
      abTests: [
        { groupId: "g1", channelTitle: "Casino VIP", winner: "B" },
        { groupId: "g2", channelTitle: "Foot", winner: null },
        { groupId: "g3", channelTitle: "Trop", winner: "A" },
      ],
      telegramLinked: false,
      aiKeyMissing: true,
    });
    expect(lines.map((l) => l.key)).toEqual([
      "requests:c1",
      "failed-posts",
      "reconnect:META:Compte FR",
      "reconnect:telegram",
      "rules",
      "ab:g1",
      "ab:g2",
      "telegram",
      "ai",
    ]);
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(byKey["failed-posts"]).toMatchObject({
      text: "3 messages n'ont pas pu partir",
      href: "/messages?view=list&status=FAILED",
      tone: "danger",
    });
    expect(byKey["reconnect:META:Compte FR"]).toMatchObject({
      text: "Reconnectez le compte pub Meta « Compte FR »",
      href: "/settings/connectors/meta",
    });
    expect(byKey["reconnect:telegram"]!.href).toBe("/settings/connectors/telegram");
    expect(byKey.rules).toMatchObject({
      text: "Le canal « Nouveau canal » n'a pas de règle d'adhésion : chaque demande attend votre validation",
      href: "/channels/c9?tab=rules",
    });
    expect(byKey["ab:g1"]).toMatchObject({
      text: "Test A/B à conclure dans « Casino VIP » : la version B l'emporte",
      href: "/messages/ab/g1",
    });
    expect(byKey["ab:g2"]!.text).toBe(
      "Test A/B à conclure dans « Foot » : égalité entre les deux versions",
    );
    expect(byKey.telegram!.href).toBe("/account");
    expect(byKey.ai!.href).toBe("/settings/ai");
  });

  it("plusieurs canaux sans règle : une seule ligne vers Canaux ; un seul message en échec", () => {
    const lines = buildTodo({
      ...empty,
      failedPosts: 1,
      channelsWithoutRule: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    });
    expect(lines.map((l) => [l.text, l.href])).toEqual([
      ["1 message n'a pas pu partir", "/messages?view=list&status=FAILED"],
      [
        "2 canaux n'ont pas de règle d'adhésion : leurs demandes attendent votre validation",
        "/channels",
      ],
    ]);
  });

  it("manager : pas de clé IA, connexions « à reconnecter par un administrateur »", () => {
    const lines = buildTodo({
      ...empty,
      isAdmin: false,
      adReconnect: [{ platform: "TIKTOK", name: "TT" }],
      telegramSessionError: true,
      aiKeyMissing: true,
    });
    expect(lines.map((l) => l.text)).toEqual([
      "Le compte pub TikTok « TT » est à reconnecter par un administrateur",
      "Le compte Telegram qui relève les vues est à reconnecter par un administrateur",
    ]);
    expect(lines[0]!.href).toBe("/settings/connectors/tiktok");
  });

  it("Telegram non relié : pas de doublon avec la liste « À faire pour démarrer »", () => {
    expect(buildTodo({ ...empty, telegramLinked: false, telegramInChecklist: true })).toEqual([]);
  });
});
