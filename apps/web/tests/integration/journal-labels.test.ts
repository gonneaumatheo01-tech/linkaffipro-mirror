/**
 * Phase 14, sur base réelle : libellés du Journal selon le détail de l'événement. La validation automatique des canaux
 * (« Canaux requis rejoints (vérifié automatiquement) ») et la raison d'un message privé refusé ou non envoyé (vrai
 * blocage, jamais démarré le bot, compte supprimé…) sont lues dans `payload`, pour la vue « Événements », son export et
 * les derniers événements des Statistiques. Un rappel non envoyé à une personne qui a bloqué le bot ne dit jamais
 * « n'a jamais démarré le bot ».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type Prisma } from "@linkaffipro/db";
import { createTestBot, resetDb } from "./helpers";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u-journal", role: "ADMIN", telegramUserId: null }),
}));

const { eventRowLabels } = await import("@/lib/journal/event-row-labels");
const { loadLastEvents } = await import("@/lib/dashboard/events");
const { GET: exportJournal } = await import("@/app/(admin)/settings/journal/export/route");

describe("Journal : libellés lus dans le détail de l'événement (base réelle)", () => {
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    const bot = await createTestBot(9141, "DATING");
    const member = await prisma.member.create({
      data: { telegramUserId: BigInt(9_141_000), firstName: "Camille" },
    });
    const base = { memberId: member.id, botId: bot.id };
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const rows: Array<[string, string, Prisma.InputJsonObject, number]> = [
      [
        "auto",
        "membership.gate_satisfied",
        { membershipId: "m1", auto: true, trigger: "chat_member" },
        6,
      ],
      ["button", "membership.gate_satisfied", { membershipId: "m2", auto: false }, 5],
      ["skippedBlocked", "dm.skipped_unreachable", { kind: "GATE_REMINDER", reason: "blocked" }, 4],
      ["skippedNever", "dm.skipped_unreachable", { kind: "ACCEPTED", reason: "never_started" }, 3],
      [
        "refused",
        "dm.unreachable",
        {
          kind: "GATE_REMINDER",
          telegramError: "403 Forbidden: bot can't initiate conversation with a user",
        },
        2,
      ],
      ["blocked", "member.blocked", {}, 1],
    ];
    for (const [key, type, payload, min] of rows)
      ids[key] = (
        await prisma.event.create({ data: { ...base, type, payload, occurredAt: at(min) } })
      ).id;
  });

  it("libellés de la liste : détail lu seulement pour les types qui en dépendent", async () => {
    const events = await prisma.event.findMany({
      orderBy: { occurredAt: "desc" },
      select: { id: true, type: true },
    });
    const labels = await eventRowLabels(events);
    expect(labels.get(ids.auto!)).toBe("Canaux requis rejoints (vérifié automatiquement)");
    expect(labels.get(ids.button!)).toBe("Canaux requis rejoints");
    expect(labels.get(ids.skippedBlocked!)).toBe(
      "Message privé non envoyé : la personne a bloqué le bot",
    );
    expect(labels.get(ids.skippedNever!)).toBe(
      "Message privé non envoyé : la personne n'a jamais démarré le bot",
    );
    expect(labels.get(ids.refused!)).toBe(
      "Message privé refusé : la personne n'a jamais démarré le bot (5 minutes passées)",
    );
    expect(labels.get(ids.blocked!)).toBe("A bloqué le bot");
    expect(await eventRowLabels([])).toEqual(new Map());
  });

  it("derniers événements des Statistiques : mêmes libellés", async () => {
    const last = await loadLastEvents(12);
    expect(last.map((e) => e.label)).toEqual([
      "A bloqué le bot",
      "Message privé refusé : la personne n'a jamais démarré le bot (5 minutes passées)",
      "Message privé non envoyé : la personne n'a jamais démarré le bot",
      "Message privé non envoyé : la personne a bloqué le bot",
      "Canaux requis rejoints",
      "Canaux requis rejoints (vérifié automatiquement)",
    ]);
    // Le détail n'est pas renvoyé à l'écran.
    expect(Object.keys(last[0]!)).not.toContain("payload");
  });

  it("export CSV de la vue « Événements » : mêmes libellés, code technique à côté", async () => {
    const res = await exportJournal(
      new Request("http://localhost/settings/journal/export?view=events"),
    );
    const csv = await res.text();
    expect(csv).toContain("Canaux requis rejoints (vérifié automatiquement)");
    expect(csv).toContain("Message privé non envoyé : la personne a bloqué le bot");
    expect(csv).toContain("dm.skipped_unreachable");
    expect(csv).not.toContain("Message privé non envoyé : le bot ne peut plus écrire");
  });
});
