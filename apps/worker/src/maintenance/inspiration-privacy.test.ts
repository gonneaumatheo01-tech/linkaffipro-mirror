/** Phase 27 : reprise unique des anciens événements de posts transférés (aucune base réelle). */
import { describe, expect, it } from "vitest";
import { EVENTS_REDACTED_SETTING, redactForwardedEventsOnce } from "./inspiration-privacy";

type Ev = { id: string; type: string; occurredAt: Date; payload: Record<string, unknown> };

function fakeDb(events: Ev[], refCreatedAt: Date | null) {
  const settings = new Map<string, unknown>();
  const db = {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => settings.set(where.key, create.value),
    },
    referenceChannel: { findFirst: async () => (refCreatedAt ? { createdAt: refCreatedAt } : null) },
    event: {
      findMany: async ({ where, take }: { where: { type: { in: string[] }; occurredAt: { gte: Date }; id?: { gt: string } }; take: number }) =>
        events
          .filter((e) => where.type.in.includes(e.type) && e.occurredAt >= where.occurredAt.gte && (!where.id || e.id > where.id.gt))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take),
      update: async ({ where, data }: { where: { id: string }; data: { payload: Record<string, unknown> } }) => {
        events.find((e) => e.id === where.id)!.payload = data.payload;
      },
    },
  };
  return { db: db as never, settings };
}

const now = new Date("2026-10-24T12:00:00Z");
const admin = { id: 4242, is_bot: false, first_name: "A" };
const msg = (extra: Record<string, unknown>) => ({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 4242, type: "private" }, from: admin, ...extra } });

describe("reprise unique : anciens événements de posts transférés masqués", () => {
  it("depuis le plus ancien canal de référence : transferts masqués, messages ordinaires intacts, trop anciens laissés ; une seule fois", async () => {
    const events: Ev[] = [
      { id: "a", type: "telegram.message", occurredAt: new Date("2026-10-20T10:00:00Z"), payload: msg({ text: "Places limitées au VIP", forward_origin: { type: "channel", date: 1, chat: { id: -1, type: "channel" }, message_id: 3, author_signature: "Julie" } }) },
      { id: "b", type: "telegram.message", occurredAt: new Date("2026-10-23T10:00:00Z"), payload: msg({ text: "fait" }) },
      { id: "c", type: "telegram.edited_message", occurredAt: new Date("2026-10-23T11:00:00Z"), payload: { update_id: 2, edited_message: { message_id: 2, date: 1, chat: { id: -9, type: "supergroup" }, text: "texte", forward_from_chat: { id: -1, type: "channel" } } } },
      { id: "d", type: "telegram.message", occurredAt: new Date("2026-10-01T10:00:00Z"), payload: msg({ text: "trop ancien", forward_origin: { type: "hidden_user", date: 1 } }) },
    ];
    const { db, settings } = fakeDb(events, new Date("2026-10-19T00:00:00Z"));
    expect(await redactForwardedEventsOnce(db, now)).toEqual({ done: true, redacted: 2 });
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/VIP|Julie/);
    expect(events[1]!.payload).toEqual(msg({ text: "fait" }));
    expect(JSON.stringify(events[2]!.payload)).not.toContain("texte");
    expect(JSON.stringify(events[3]!.payload)).toContain("trop ancien");
    expect(settings.has(EVENTS_REDACTED_SETTING)).toBe(true);
    expect(await redactForwardedEventsOnce(db, now)).toEqual({ done: false, redacted: 0 });
  });
  it("sans canal de référence : les 3 derniers jours", async () => {
    const events: Ev[] = [
      { id: "a", type: "telegram.message", occurredAt: new Date("2026-10-22T10:00:00Z"), payload: msg({ text: "x", forward_origin: { type: "hidden_user", date: 1 } }) },
      { id: "b", type: "telegram.message", occurredAt: new Date("2026-10-20T10:00:00Z"), payload: msg({ text: "y", forward_origin: { type: "hidden_user", date: 1 } }) },
    ];
    expect(await redactForwardedEventsOnce(fakeDb(events, null).db, now)).toEqual({ done: true, redacted: 1 });
  });
});
