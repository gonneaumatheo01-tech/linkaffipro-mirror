import { describe, expect, it } from "vitest";
import {
  assistantLabel,
  deliveryRank,
  mergeOffers,
  mergeThread,
  nextRemoved,
  THREAD_LOOKBACK_MS,
  threadCursor,
  threadSince,
  threadStateKey,
  threadWindowStart,
  toThreadMessage,
  vanishedFromThread,
  type ThreadMessage,
  type ThreadMessageRow,
  type ThreadState,
} from "./thread";

const AT = new Date("2026-10-18T10:00:00Z");
const LEA = { name: "Léa", gender: "F" };

const row = (over: Partial<ThreadMessageRow> = {}): ThreadMessageRow => ({
  id: "m1",
  direction: "IN",
  author: "MEMBER",
  text: "salut",
  media: null,
  meta: {},
  createdAt: AT,
  teamUser: null,
  outboundMessage: null,
  ...over,
});

const msg = (id: string, at: string, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  ...toThreadMessage(row({ id, createdAt: new Date(at) }), LEA),
  ...over,
});

describe("messages du fil", () => {
  it("la personne à gauche, l'assistante à droite avec le prénom de la persona", () => {
    const m = toThreadMessage(row(), LEA);
    expect(m).toMatchObject({
      side: "in",
      author: "MEMBER",
      authorLabel: "La personne",
      text: "salut",
    });
    expect(m.at).toBe(AT.toISOString());
    expect(m.delivery).toBeNull();
    const a = toThreadMessage(
      row({
        direction: "OUT",
        author: "ASSISTANT",
        outboundMessage: { status: "SENT", error: null },
      }),
      LEA,
    );
    expect(a).toMatchObject({ side: "out", authorLabel: "Léa (assistante)", delivery: "SENT" });
    expect(assistantLabel({ name: "Hugo", gender: "M" })).toBe("Hugo (assistant)");
    expect(assistantLabel(null)).toBe("Assistante");
  });

  it("l'équipe avec le prénom du membre de l'équipe, et l'échec d'envoi expliqué", () => {
    const t = toThreadMessage(
      row({
        direction: "OUT",
        author: "TEAM",
        teamUser: { name: "Marie" },
        outboundMessage: {
          status: "FAILED",
          error: "Le bot ne peut plus écrire à cette personne.",
        },
      }),
      LEA,
    );
    expect(t).toMatchObject({
      side: "out",
      authorLabel: "Équipe · Marie",
      delivery: "FAILED",
      deliveryError: "Le bot ne peut plus écrire à cette personne.",
    });
  });

  it("messages automatiques et appui sur Démarrer au centre", () => {
    const s = toThreadMessage(row({ direction: "OUT", author: "SYSTEM", text: "C'est noté" }), LEA);
    expect(s).toMatchObject({ side: "system", authorLabel: "Message automatique" });
    const start = toThreadMessage(
      row({ text: "/start", meta: { command: "start", source: "tk01" } }),
      LEA,
    );
    expect(start).toMatchObject({ side: "system", text: "", start: { source: "tk01" } });
  });

  it("média décrit, bouton de l'offre, relance ; aucun repère interne (refus de l'IA, modèle)", () => {
    const m = toThreadMessage(
      row({
        direction: "OUT",
        author: "ASSISTANT",
        text: "Regarde",
        media: { kind: "photo", mediaAssetId: "a1" },
        meta: { offerSubId: "AbCdEf123456", followUp: true, rejected: ["markdown"], model: "x" },
      }),
      LEA,
    );
    expect(m.text).toBe("[photo] Regarde");
    expect(m.offerSubId).toBe("AbCdEf123456");
    expect(m.followUp).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/markdown|rejected|model|mediaAssetId/);
  });
});

describe("fil en direct", () => {
  it("fusion sans doublon, ordre chronologique, l'envoi le plus avancé gagne", () => {
    const a = msg("a", "2026-10-18T10:00:00.000Z");
    const b = msg("b", "2026-10-18T10:00:05.000Z", { delivery: "QUEUED" });
    const bSent = { ...b, delivery: "SENT" as const };
    const c = msg("c", "2026-10-18T10:00:03.000Z");
    expect(mergeThread([a, bSent], [b, c]).map((m) => `${m.id}:${m.delivery ?? ""}`)).toEqual([
      "a:",
      "c:",
      "b:SENT",
    ]);
    expect(mergeThread([a, b], [bSent]).find((m) => m.id === "b")?.delivery).toBe("SENT");
    expect(deliveryRank("FAILED")).toBeGreaterThan(deliveryRank("QUEUED"));
  });

  it("liens de l'offre : ouvert le reste, ouvertures jamais en baisse", () => {
    expect(
      mergeOffers(
        {
          s1: { openedAt: null, opens: 0 },
          s2: { openedAt: "2026-10-18T10:00:00.000Z", opens: 2 },
        },
        {
          s1: { openedAt: "2026-10-18T11:00:00.000Z", opens: 1 },
          s2: { openedAt: null, opens: 1 },
        },
      ),
    ).toEqual({
      s1: { openedAt: "2026-10-18T11:00:00.000Z", opens: 1 },
      s2: { openedAt: "2026-10-18T10:00:00.000Z", opens: 2 },
    });
    expect(mergeOffers({ s1: { openedAt: null, opens: 0 } }, null)).toEqual({
      s1: { openedAt: null, opens: 0 },
    });
  });

  it("curseur : le message le plus récent ; relecture avec une minute de marge", () => {
    const list = [msg("a", "2026-10-18T10:00:00.000Z"), msg("b", "2026-10-18T10:02:00.000Z")];
    expect(threadCursor(list, "2026-10-18T09:00:00.000Z")).toBe("2026-10-18T10:02:00.000Z");
    expect(threadCursor([], "2026-10-18T09:00:00.000Z")).toBe("2026-10-18T09:00:00.000Z");
    expect(threadSince("2026-10-18T10:02:00.000Z")?.getTime()).toBe(
      Date.parse("2026-10-18T10:02:00.000Z") - THREAD_LOOKBACK_MS,
    );
    expect(threadSince("pas une date")).toBeNull();
    expect(threadSince(null)).toBeNull();
  });

  it("repère d'état : change avec qui répond, l'étape, un /stop, un blocage ou un /reset", () => {
    const base: ThreadState = {
      status: "BOT",
      stage: "CHAT",
      closedReason: null,
      stopped: false,
      minor: false,
      memberBlocked: false,
      takenOverById: null,
      resets: 0,
    };
    const key = threadStateKey(base);
    expect(threadStateKey({ ...base })).toBe(key);
    for (const change of [
      { status: "HUMAN" },
      { stage: "LINK_SENT" },
      { stopped: true },
      { memberBlocked: true },
      { takenOverById: "u2" },
      { resets: 1 },
    ])
      expect(threadStateKey({ ...base, ...change })).not.toBe(key);
  });

  it("fenêtre complète d'une relecture : depuis la marge, tout le fil, ou juste après le plus ancien à la limite", () => {
    const since = new Date("2026-10-18T10:01:00.000Z");
    const rows = [
      { createdAt: new Date("2026-10-18T10:03:00.000Z") },
      { createdAt: new Date("2026-10-18T10:02:00.000Z") },
    ];
    expect(threadWindowStart(since, rows)).toBe("2026-10-18T10:01:00.000Z");
    expect(threadWindowStart(null, rows)).toBe("1970-01-01T00:00:00.000Z");
    // Limite atteinte : les messages plus anciens que le dernier renvoyé (ou du même instant) peuvent manquer.
    expect(threadWindowStart(since, rows, 2)).toBe("2026-10-18T10:02:00.001Z");
    expect(threadWindowStart(since, [], 2)).toBe("2026-10-18T10:01:00.000Z");
  });

  it("message retiré par le worker (envoi raté) : enlevé du fil, même venu de la page ; jamais un message existant", () => {
    const old = msg("old", "2026-10-18T09:00:00.000Z");
    const kept = msg("kept", "2026-10-18T10:00:30.000Z");
    const ghost = msg("ghost", "2026-10-18T10:01:00.000Z", {
      side: "out",
      author: "ASSISTANT",
      delivery: "QUEUED",
    });
    const shown = [old, kept, ghost];
    // Relecture depuis 10:00 : « kept » est renvoyé, « ghost » n'existe plus ; « old » est hors de la fenêtre (gardé).
    const gone = vanishedFromThread(shown, {
      messages: [kept],
      windowStart: "2026-10-18T10:00:00.000Z",
    });
    expect([...gone]).toEqual(["ghost"]);
    const removed = nextRemoved(new Set(), gone, [kept]);
    expect([...removed]).toEqual(["ghost"]);
    expect(
      mergeThread(shown, [kept])
        .filter((m) => !removed.has(m.id))
        .map((m) => m.id),
    ).toEqual(["old", "kept"]);
    // Une relecture qui renvoie un message le remet (jamais un message existant caché).
    expect([...nextRemoved(removed, new Set(), [ghost])]).toEqual([]);
    // Tout est encore là : rien n'est retiré.
    expect(
      vanishedFromThread(shown, {
        messages: [kept, ghost],
        windowStart: "2026-10-18T10:00:00.000Z",
      }).size,
    ).toBe(0);
  });
});
