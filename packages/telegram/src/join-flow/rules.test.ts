import { describe, expect, it } from "vitest";
import {
  approveAtAfterGate,
  computeInitialState,
  dueReminderIndex,
  expirationOutcome,
  formatDelay,
  hasGate,
  IMPLICIT_RULE,
  isNoRule,
  NO_RULE,
  resolveRule,
  ruleDelayText,
  ruleFromRow,
} from "./rules";
import { pickText, renderHtmlText, renderText } from "./texts";

const row = (over: Partial<Parameters<typeof ruleFromRow>[0]> = {}) => ({
  id: "r1",
  name: "Défaut",
  mode: "DELAY" as const,
  delaySeconds: 600,
  gateChannelIds: ["c2", "c3"],
  gateMode: "REQUIRED" as const,
  reminderAfterMinutes: [60, 1440],
  maxReminders: 2,
  expireAfterHours: 48,
  expireAction: "DECLINE" as const,
  sendAcceptedMessage: true,
  isActive: true,
  ...over,
});

describe("résolution de règle", () => {
  it("sans lien ni défaut : validation manuelle, jamais d'acceptation automatique (décision « approbation jamais automatique par défaut »)", () => {
    const r = resolveRule(null, null);
    expect(r).toBe(NO_RULE);
    expect(r.mode).toBe("MANUAL");
    expect(isNoRule(r)).toBe(true);
    expect(computeInitialState(r, new Date(0))).toEqual({
      status: "REQUESTED",
      approveAt: null,
      expiresAt: null,
    });
  });
  it("une vraie règle n'est jamais prise pour l'absence de règle", () => {
    expect(isNoRule(ruleFromRow(row({ mode: "MANUAL" })))).toBe(false);
    expect(isNoRule(IMPLICIT_RULE)).toBe(false);
  });
  it("règle par défaut du canal", () => {
    expect(resolveRule(null, row()).id).toBe("r1");
  });
  it("règle du lien prioritaire", () => {
    expect(resolveRule(row({ id: "lien" }), row()).id).toBe("lien");
  });
  it("ignore une règle inactive", () => {
    expect(resolveRule(row({ id: "lien", isActive: false }), row({ id: "def" })).id).toBe("def");
    expect(resolveRule(null, row({ isActive: false }))).toBe(NO_RULE);
  });
  it("nettoie les listes JSON", () => {
    const r = ruleFromRow(
      row({
        gateChannelIds: ["a", 3, null] as unknown as string[],
        reminderAfterMinutes: ["5", -1, "x"] as unknown as number[],
      }),
    );
    expect(r.gateChannelIds).toEqual(["a"]);
    expect(r.reminderAfterMinutes).toEqual([5]);
  });
});

describe("état initial", () => {
  const t0 = new Date("2026-10-09T10:00:00Z");
  it("immédiat sans gate → SCHEDULED maintenant", () => {
    const s = computeInitialState(
      ruleFromRow(row({ mode: "IMMEDIATE", gateMode: "NONE", expireAfterHours: null })),
      t0,
    );
    expect(s).toEqual({ status: "SCHEDULED", approveAt: t0, expiresAt: null });
  });
  it("délai sans gate → SCHEDULED après le délai, sans expiration (l'acceptation est planifiée)", () => {
    const s = computeInitialState(ruleFromRow(row({ gateMode: "NONE" })), t0);
    expect(s.status).toBe("SCHEDULED");
    expect(s.approveAt?.getTime()).toBe(t0.getTime() + 600_000);
    expect(s.expiresAt).toBeNull();
  });
  it("délai plus long que l'expiration (2 jours, expiration 24 h → refuser) : planifiée, jamais d'expiration", () => {
    // Cas d'une personne venue du bouton « canal à rejoindre » qui tombe sur la règle par défaut (canaux non imposés) :
    // le bot lui annonce « accès dans 2 jours ».
    const r = {
      ...ruleFromRow(row({ delaySeconds: 2 * 86_400, expireAfterHours: 24 })),
      gateChannelIds: [],
      noGates: true,
    };
    const s = computeInitialState(r, t0);
    expect(s).toEqual({
      status: "SCHEDULED",
      approveAt: new Date(t0.getTime() + 2 * 86_400_000),
      expiresAt: null,
    });
  });
  it("à valider à la main ou canaux à rejoindre : l'expiration s'applique (la demande attend l'équipe ou la personne)", () => {
    expect(computeInitialState(ruleFromRow(row()), t0).expiresAt?.getTime()).toBe(
      t0.getTime() + 48 * 3600_000,
    );
    expect(
      computeInitialState(
        ruleFromRow(row({ mode: "MANUAL", gateMode: "NONE" })),
        t0,
      ).expiresAt?.getTime(),
    ).toBe(t0.getTime() + 48 * 3600_000);
  });
  it("gate requis → PENDING_GATE sans échéance", () => {
    expect(computeInitialState(ruleFromRow(row()), t0)).toMatchObject({
      status: "PENDING_GATE",
      approveAt: null,
    });
  });
  it("gate SOFT → SCHEDULED avec délai", () => {
    const s = computeInitialState(ruleFromRow(row({ gateMode: "SOFT" })), t0);
    expect(s.status).toBe("SCHEDULED");
    expect(s.approveAt?.getTime()).toBe(t0.getTime() + 600_000);
  });
  it("gate sans canaux = pas de gate", () => {
    const r = ruleFromRow(row({ gateChannelIds: [] }));
    expect(hasGate(r)).toBe(false);
    expect(computeInitialState(r, t0).status).toBe("SCHEDULED");
  });
  it("manuel → REQUESTED", () => {
    expect(computeInitialState(ruleFromRow(row({ mode: "MANUAL" })), t0).status).toBe("REQUESTED");
  });
  it("après le gate, approbation au délai", () => {
    expect(approveAtAfterGate(ruleFromRow(row()), t0).getTime()).toBe(t0.getTime() + 600_000);
    expect(approveAtAfterGate(ruleFromRow(row({ mode: "IMMEDIATE" })), t0).getTime()).toBe(
      t0.getTime(),
    );
  });
});

describe("rappels et expiration", () => {
  const r = ruleFromRow(row());
  const requestedAt = new Date("2026-10-09T10:00:00Z");
  it("premier rappel après 60 minutes", () => {
    expect(
      dueReminderIndex(r, { requestedAt, remindersSent: 0 }, new Date("2026-10-09T10:59:00Z")),
    ).toBeNull();
    expect(
      dueReminderIndex(r, { requestedAt, remindersSent: 0 }, new Date("2026-10-09T11:00:00Z")),
    ).toBe(0);
  });
  it("second rappel après 24 h, puis plus rien", () => {
    expect(
      dueReminderIndex(r, { requestedAt, remindersSent: 1 }, new Date("2026-10-10T09:00:00Z")),
    ).toBeNull();
    expect(
      dueReminderIndex(r, { requestedAt, remindersSent: 1 }, new Date("2026-10-10T10:00:00Z")),
    ).toBe(1);
    expect(
      dueReminderIndex(r, { requestedAt, remindersSent: 2 }, new Date("2026-10-20T10:00:00Z")),
    ).toBeNull();
  });
  it("respecte maxReminders", () => {
    expect(
      dueReminderIndex(
        ruleFromRow(row({ maxReminders: 1 })),
        { requestedAt, remindersSent: 1 },
        new Date("2026-10-20T10:00:00Z"),
      ),
    ).toBeNull();
  });
  it("expiration : DECLINE, APPROVE, KEEP", () => {
    expect(expirationOutcome(ruleFromRow(row({ expireAction: "DECLINE" })))).toEqual({
      status: "DECLINED",
      approveNow: false,
      declineNow: true,
    });
    expect(expirationOutcome(ruleFromRow(row({ expireAction: "APPROVE" })))).toEqual({
      status: "SCHEDULED",
      approveNow: true,
      declineNow: false,
    });
    expect(expirationOutcome(ruleFromRow(row({ expireAction: "KEEP" })))).toEqual({
      status: "EXPIRED",
      approveNow: false,
      declineNow: false,
    });
  });
});

describe("textes", () => {
  it("formate les délais", () => {
    expect(formatDelay(0)).toBe("immédiatement");
    expect(formatDelay(60)).toBe("dans 1 minute");
    expect(formatDelay(600)).toBe("dans 10 minutes");
    expect(formatDelay(3600)).toBe("dans 1 heure");
    expect(formatDelay(172800)).toBe("dans 2 jours");
    expect(formatDelay(3600, "en")).toBe("in 1 hour");
  });
  it("remplace les placeholders", () => {
    expect(
      renderText("Salut {prenom}, canal {canal} {delai} {bot}", {
        prenom: "Jean",
        canal: "VIP",
        delai: "dans 1 minute",
        bot: "@b",
      }),
    ).toBe("Salut Jean, canal VIP dans 1 minute @b");
    expect(renderText("{inconnu} {prenom}", {})).toBe("{inconnu} ");
  });
  it("textes HTML Telegram : valeurs échappées (un prénom « Tom <3 » ne fait plus refuser le message)", () => {
    expect(
      renderHtmlText("Salut {prenom} ! <b>{canal}</b> : rejoins {liste_canaux} ({bot}) {delai}", {
        prenom: "Tom <3",
        canal: "Paris & Foot <VIP>",
        liste_canaux: "Roulette & Co, <Tir>",
        bot: "@b",
        delai: "dans 1 minute",
      }),
    ).toBe(
      "Salut Tom &lt;3 ! <b>Paris &amp; Foot &lt;VIP&gt;</b> : rejoins Roulette &amp; Co, &lt;Tir&gt; (@b) dans 1 minute",
    );
    expect(renderHtmlText("{inconnu} {prenom}", {})).toBe("{inconnu} ");
  });
  it("choisit la langue du membre, sinon du canal, sinon fr", () => {
    const texts = { fr: "FR", en: "EN" };
    expect(pickText(texts, "en-US", "fr")).toBe("EN");
    expect(pickText(texts, "de", "en")).toBe("EN");
    expect(pickText(texts, "de", "es")).toBe("FR");
    expect(pickText({ es: "ES" }, "de", "fr")).toBe("ES");
    expect(pickText(null, "fr", "fr")).toBeNull();
  });
});

describe("texte du délai d'une règle ({delai})", () => {
  it("validation à la main : « par l'équipe », jamais l'heure d'un délai enregistré", () => {
    expect(ruleDelayText({ mode: "MANUAL", delaySeconds: 86_400 })).toBe("par l'équipe");
    expect(ruleDelayText({ mode: "MANUAL", delaySeconds: 0 }, "en")).toBe("by the team");
    expect(ruleDelayText({ mode: "MANUAL", delaySeconds: 600 }, "de")).toBe("vom Team");
  });
  it("tout de suite : « immédiatement » ; délai : « dans 1 jour »", () => {
    expect(ruleDelayText({ mode: "IMMEDIATE", delaySeconds: 600 })).toBe("immédiatement");
    expect(ruleDelayText({ mode: "DELAY", delaySeconds: 86_400 })).toBe("dans 1 jour");
    expect(ruleDelayText({ mode: "DELAY", delaySeconds: 300 }, "it")).toBe(formatDelay(300, "it"));
  });
});
