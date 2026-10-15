/** Alerte « des personnes bloquent le bot après l'accueil » (phase 14, décision E10) : règles pures. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {}, toJsonValue: (v: unknown) => v }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { alertKindLabel } from "@linkaffipro/core";
import {
  BOT_BLOCKED_RATE_DEDUP_MS,
  detectBotBlockedRate,
  formatAlert,
  shouldCreateForChannel,
  type BotBlockedRateSnapshot,
} from "./alert-rules";
import { blockedRateByChannel, provenanceGroupOf, type BlockedRateRequest } from "./blocked-rate";

const req = (fromText: string, blocked: boolean, over: Partial<BlockedRateRequest> = {}) => ({
  channelId: "cZone",
  channelTitle: "Zone Interdite 🔞",
  botId: "b1",
  botUsername: "womendatingoobot",
  groupKey: fromText,
  fromText,
  blocked,
  ...over,
});

describe("blocage du bot après l'accueil", () => {
  it("plus de 25 % sur au moins 10 demandes : une alerte avec la provenance la plus touchée", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => req("de Pub 1", true)),
      ...Array.from({ length: 6 }, () => req("de Pub 1", false)),
      req("de « Tir Cadré »", true),
      req("de « Tir Cadré »", false),
    ];
    const [snap] = blockedRateByChannel(rows);
    expect(snap).toMatchObject({ channelId: "cZone", requests: 12, blocked: 5 });
    const [alert, ...rest] = detectBotBlockedRate([snap!]);
    expect(rest).toEqual([]);
    expect(alert!.message).toBe(
      "40 % des personnes venues de Pub 1 ont bloqué @womendatingoobot après l'accueil de « Zone Interdite 🔞 » (4 sur 10 en 24 h) : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ».",
    );
    expect(alert!.payload).toMatchObject({
      channelId: "cZone",
      requests: 12,
      blocked: 5,
      rate: 42,
    });
    expect(alert!.kind).toBe("bot_blocked_rate");
    expect(formatAlert(alert!)).toContain("Personnes qui bloquent le bot après l'accueil");
    expect(alertKindLabel("bot_blocked_rate")).toBe(
      "Personnes qui bloquent le bot après l'accueil",
    );
  });

  it("cite la provenance au-dessus du seuil la plus touchée, jamais une provenance sous le seuil", () => {
    const snap: BotBlockedRateSnapshot = {
      channelId: "cZone",
      channelTitle: "Zone Interdite 🔞",
      botUsername: "womendatingoobot",
      requests: 40,
      blocked: 11,
      groups: [
        { fromText: "de Pub 1", requests: 10, blocked: 5 },
        { fromText: "de Pub 2", requests: 30, blocked: 6 },
      ],
    };
    const [alert] = detectBotBlockedRate([snap]);
    expect(alert!.message).toBe(
      "50 % des personnes venues de Pub 1 ont bloqué @womendatingoobot après l'accueil de « Zone Interdite 🔞 » (5 sur 10 en 24 h) : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ».",
    );
    expect(alert!.payload).toMatchObject({
      rate: 28,
      worst: { fromText: "de Pub 1", requests: 10, blocked: 5, rate: 50 },
    });
  });

  it("aucune provenance au-dessus du seuil (ou trop petite) : le total du canal", () => {
    const snap: BotBlockedRateSnapshot = {
      channelId: "cZone",
      channelTitle: "Zone Interdite 🔞",
      botUsername: "womendatingoobot",
      requests: 40,
      blocked: 11,
      groups: [
        // 100 % sur 2 demandes : trop peu pour être citée.
        { fromText: "de « Tir Cadré »", requests: 2, blocked: 2 },
        { fromText: "de Pub 1", requests: 18, blocked: 4 },
        { fromText: "de Pub 2", requests: 20, blocked: 5 },
      ],
    };
    const [alert] = detectBotBlockedRate([snap]);
    expect(alert!.message).toBe(
      "28 % des personnes ont bloqué @womendatingoobot après l'accueil de « Zone Interdite 🔞 » (11 sur 40 en 24 h) : Telegram peut limiter un bot signalé. Adoucir le message ou passer les canaux en « Proposés ».",
    );
    expect(alert!.payload).toMatchObject({ worst: null });
  });

  it("moins de 10 demandes, ou 25 % tout juste : pas d'alerte", () => {
    const few: BotBlockedRateSnapshot = {
      channelId: "c",
      channelTitle: "C",
      botUsername: "b",
      requests: 9,
      blocked: 9,
      groups: [],
    };
    expect(detectBotBlockedRate([few])).toEqual([]);
    expect(detectBotBlockedRate([{ ...few, requests: 20, blocked: 5 }])).toEqual([]);
    expect(detectBotBlockedRate([{ ...few, requests: 20, blocked: 6 }])).toHaveLength(1);
  });

  it("au plus une alerte par canal toutes les 6 heures", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const recent = [
      { createdAt: new Date(now.getTime() - 5 * 3600_000), payload: { channelId: "cZone" } },
    ];
    expect(shouldCreateForChannel("cZone", recent, now)).toBe(false);
    expect(shouldCreateForChannel("cAutre", recent, now)).toBe(true);
    expect(
      shouldCreateForChannel("cZone", recent, new Date(now.getTime() + BOT_BLOCKED_RATE_DEDUP_MS)),
    ).toBe(true);
  });

  it("provenance : nom du lien (pub), canal d'origine, sinon « d'un autre lien »", () => {
    const titles = new Map([["cTir", "Tir Cadré"]]);
    expect(
      provenanceGroupOf(
        {
          provenance: {
            type: "AD",
            inviteLinkId: "l1",
            sourceChannelId: null,
            adPlatform: "TIKTOK",
          },
          inviteLink: { id: "l1", name: "Pub 1" },
        },
        titles,
      ),
    ).toEqual({ groupKey: "link:l1", fromText: "de Pub 1" });
    expect(
      provenanceGroupOf(
        {
          provenance: {
            type: "GATE",
            inviteLinkId: "g1",
            sourceChannelId: "cTir",
            adPlatform: null,
          },
        },
        titles,
      ),
    ).toEqual({ groupKey: "gate:cTir", fromText: "de « Tir Cadré »" });
    expect(provenanceGroupOf({}, titles)).toEqual({
      groupKey: "unknown",
      fromText: "d'un autre lien",
    });
  });
});
