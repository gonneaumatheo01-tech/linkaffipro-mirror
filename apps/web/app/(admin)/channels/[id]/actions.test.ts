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

const db = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  existing: null as null | { id: string },
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER", telegramUserId: null })),
}));
vi.mock("@/lib/approval/telegram", () => ({ approveNow: vi.fn(), declineNow: vi.fn() }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: db.enqueue }));
vi.mock("@linkaffipro/telegram", () => ({ recheckChannelRights: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    approvalRule: {
      findFirst: vi.fn(async () => db.existing),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return { id: "r1", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.updated.push(data);
        return { id: "r1", ...data };
      }),
    },
  },
  audit: vi.fn(async () => undefined),
}));

import { recomputeBestHoursAction, saveRuleAction } from "./actions";

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
  db.created = [];
  db.updated = [];
  db.existing = null;
});

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
      reminderAfterMinutes: [60, 1440],
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
    db.existing = { id: "r1" };
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
