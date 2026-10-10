import { describe, expect, it } from "vitest";
import {
  buildChecklist,
  checklistProgress,
  checklistSummary,
  checklistVisible,
  type ChecklistInput,
} from "./checklist";
import {
  EMPTY_ONBOARDING,
  onboardingKey,
  parseOnboarding,
  resetOnboarding,
  shouldStartTour,
  withChecklistDismissed,
  withTourDone,
} from "./state";

const now = new Date("2026-10-10T08:00:00Z");

describe("état de la visite guidée (Setting onboarding.<userId>)", () => {
  it("clé par utilisateur", () => {
    expect(onboardingKey("u1")).toBe("onboarding.u1");
  });

  it("lecture tolérante", () => {
    expect(parseOnboarding(undefined)).toEqual(EMPTY_ONBOARDING);
    expect(parseOnboarding(null)).toEqual(EMPTY_ONBOARDING);
    expect(parseOnboarding([])).toEqual(EMPTY_ONBOARDING);
    expect(parseOnboarding({ tourDoneAt: "pas une date", checklistDismissedAt: 12 })).toEqual(
      EMPTY_ONBOARDING,
    );
    expect(parseOnboarding({ tourDoneAt: "2026-10-09T10:00:00.000Z", extra: true })).toEqual({
      tourDoneAt: "2026-10-09T10:00:00.000Z",
      checklistDismissedAt: null,
    });
  });

  it("première connexion : la visite démarre ; terminée ou passée : plus jamais seule", () => {
    expect(shouldStartTour(EMPTY_ONBOARDING)).toBe(true);
    const done = withTourDone(EMPTY_ONBOARDING, now);
    expect(done.tourDoneAt).toBe(now.toISOString());
    expect(shouldStartTour(done)).toBe(false);
    // La première date est conservée.
    expect(withTourDone(done, new Date("2027-01-01T00:00:00Z")).tourDoneAt).toBe(now.toISOString());
  });

  it("masquer la liste, puis « Revoir la visite » remet tout à zéro", () => {
    const s = withChecklistDismissed(withTourDone(EMPTY_ONBOARDING, now), now);
    expect(s).toEqual({ tourDoneAt: now.toISOString(), checklistDismissedAt: now.toISOString() });
    expect(resetOnboarding()).toEqual(EMPTY_ONBOARDING);
    expect(shouldStartTour(resetOnboarding())).toBe(true);
  });
});

describe("liste « À faire pour démarrer »", () => {
  const base: ChecklistInput = {
    isAdmin: true,
    telegramLinked: false,
    hasCampaign: false,
    hasScheduledPost: false,
    teamInvited: false,
  };

  it("quatre lignes pour un administrateur, trois pour un manager, chacune avec son lien", () => {
    expect(buildChecklist(base).map((i) => [i.key, i.href])).toEqual([
      ["telegram", "/account"],
      ["campaign", "/campaigns/new"],
      ["message", "/messages/new"],
      ["team", "/settings/team"],
    ]);
    expect(buildChecklist({ ...base, isAdmin: false }).map((i) => i.key)).toEqual([
      "telegram",
      "campaign",
      "message",
    ]);
  });

  it("cochée d'après la base", () => {
    const items = buildChecklist({ ...base, telegramLinked: true, hasScheduledPost: true });
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(["telegram", "message"]);
    expect(checklistProgress(items)).toEqual({ done: 2, total: 4, complete: false });
  });

  it("ligne repliée du téléphone : avancement et prochaine étape (la première pas encore faite)", () => {
    const items = buildChecklist({ ...base, telegramLinked: true, hasScheduledPost: true });
    const summary = checklistSummary(items);
    expect(summary.title).toBe("Pour démarrer : 2 sur 4");
    expect(summary.next?.key).toBe("campaign");
    expect(checklistSummary(buildChecklist(base)).next?.label).toBe("Relier votre Telegram");
    const complete = buildChecklist({
      ...base,
      telegramLinked: true,
      hasCampaign: true,
      hasScheduledPost: true,
      teamInvited: true,
    });
    expect(checklistSummary(complete)).toEqual({ title: "Pour démarrer : 4 sur 4", next: null });
  });

  it("visible jusqu'à ce qu'elle soit finie ou masquée", () => {
    const partial = buildChecklist(base);
    const complete = buildChecklist({
      ...base,
      telegramLinked: true,
      hasCampaign: true,
      hasScheduledPost: true,
      teamInvited: true,
    });
    expect(checklistVisible(partial, EMPTY_ONBOARDING)).toBe(true);
    expect(checklistVisible(complete, EMPTY_ONBOARDING)).toBe(false);
    expect(checklistVisible(partial, withChecklistDismissed(EMPTY_ONBOARDING, now))).toBe(false);
    // Un manager a fini sans l'équipe (ligne réservée aux administrateurs).
    const manager = buildChecklist({
      ...base,
      isAdmin: false,
      telegramLinked: true,
      hasCampaign: true,
      hasScheduledPost: true,
    });
    expect(checklistProgress(manager).complete).toBe(true);
  });
});
