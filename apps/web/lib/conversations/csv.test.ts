import { describe, expect, it } from "vitest";
import { INBOX_CSV_HEADERS, inboxCsv, STATS_CSV_HEADERS, statsCsv } from "./csv";
import type { InboxExportRow } from "./inbox";
import { aggregateConversationStats } from "./stats";

const row = (over: Partial<InboxExportRow> = {}): InboxExportRow => ({
  id: "c1",
  createdAt: new Date("2026-10-18T08:00:00Z"),
  stage: "LINK_SENT",
  status: "HUMAN",
  source: "tk01",
  personaId: "p1",
  personaName: "Léa",
  personaGender: "F",
  closedReason: null,
  stoppedAt: null,
  isMinor: false,
  needsHumanAt: null,
  needsHumanReason: null,
  universe: "dating",
  member: { id: "m1", firstName: "Jean", lastName: null, username: "jean_m", anonymizedAt: null },
  last: {
    direction: "IN",
    author: "MEMBER",
    text: "Mon numéro secret 0612345678",
    media: null,
    meta: {},
    at: new Date("2026-10-18T09:30:00Z"),
  },
  unread: true,
  activityAt: new Date("2026-10-18T09:30:00Z"),
  botUsername: "lea_bot",
  language: "fr",
  memberMessages: 5,
  linksSent: 2,
  linksOpened: 1,
  registeredAt: new Date("2026-10-18T10:00:00Z"),
  ftdAt: null,
  costEur: 0.0123,
  ...over,
});

describe("export CSV de la boîte de réception", () => {
  it("une ligne par conversation, sans aucun texte de la conversation", () => {
    const csv = inboxCsv([row()]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(INBOX_CSV_HEADERS.join(";"));
    expect(lines).toHaveLength(2);
    const cells = lines[1]!.split(";");
    expect(cells.slice(0, 8)).toEqual([
      "Jean",
      "jean_m",
      "lea_bot",
      "Léa",
      "tk01",
      "Lien envoyé",
      "L'équipe a la main",
      "",
    ]);
    expect(cells.at(-4)).toBe("La personne");
    expect(cells.at(-3)).toBe("oui");
    expect(cells.at(-2)).toBe("Rencontres");
    expect(cells.at(-1)).toBe("");
    expect(csv).toContain("0,0123");
    expect(csv).toContain("18/10/2026 12:00");
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("0612345678");
  });

  it("conversation fermée : la raison ; persona supprimée, sans source, personne sans nom", () => {
    const csv = inboxCsv([
      row({
        status: "CLOSED",
        stage: "CLOSED",
        closedReason: "STOP",
        personaName: null,
        source: null,
        member: { id: "m2", firstName: null, lastName: null, username: null, anonymizedAt: null },
        last: null,
        unread: false,
      }),
    ]);
    const cells = csv.trim().split("\r\n")[1]!.split(";");
    expect(cells[0]).toBe("Personne sans nom");
    expect(cells[1]).toBe("");
    expect(cells[3]).toBe("Sans persona");
    expect(cells[4]).toBe("Sans source");
    expect(cells[7]).toContain("/stop");
    expect(cells.at(-3)).toBe("non");
  });

  it("conversation à traiter : le motif en clair ; univers de la persona", () => {
    const cells = inboxCsv([
      row({
        needsHumanAt: new Date("2026-10-18T09:31:00Z"),
        needsHumanReason: "argent",
        universe: "casino",
      }),
    ])
      .trim()
      .split("\r\n")[1]!
      .split(";");
    expect(cells.at(-2)).toBe("Casino");
    expect(cells.at(-1)).toBe("Demande d'argent");
  });

  it("« Qui répond » et « Dernier message de » accordés à la persona, comme sur la fiche", () => {
    const last = {
      direction: "OUT" as const,
      author: "ASSISTANT" as const,
      text: "Coucou",
      media: null,
      meta: {},
      at: new Date("2026-10-18T09:30:00Z"),
    };
    const cellsOf = (csv: string) => csv.trim().split("\r\n")[1]!.split(";");
    const lea = cellsOf(inboxCsv([row({ status: "BOT", last, unread: false })]));
    expect(lea[6]).toBe("L'assistante répond");
    expect(lea.at(-4)).toBe("L'assistante");
    const hugo = cellsOf(
      inboxCsv([
        row({ status: "BOT", personaName: "Hugo", personaGender: "M", last, unread: false }),
      ]),
    );
    expect(hugo[6]).toBe("L'assistant répond");
    expect(hugo.at(-4)).toBe("L'assistant");
  });
});

describe("export CSV des chiffres", () => {
  it("le total, puis les personas, puis les sources", () => {
    const stats = aggregateConversationStats({
      conversations: [
        {
          personaId: "p1",
          source: "tk01",
          stage: "CHAT",
          replied: true,
          reached: ["CHAT"],
          converted: false,
        },
        {
          personaId: "p1",
          source: null,
          stage: "WELCOME",
          replied: false,
          reached: [],
          converted: false,
        },
      ],
      linksSent: [{ personaId: "p1", source: "tk01" }],
      linksOpened: [],
      players: [{ personaId: "p1", source: "tk01", registered: true, ftd: false }],
      costs: [{ personaId: "p1", source: "tk01", costEur: 0.5 }],
      personaNames: { p1: "Léa" },
    });
    const lines = statsCsv(stats, "7 derniers jours").replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(STATS_CSV_HEADERS.join(";"));
    expect(lines.map((l) => l.split(";").slice(0, 3).join(";"))).toEqual([
      lines[0]!.split(";").slice(0, 3).join(";"),
      "Total (7 derniers jours);Toutes les conversations;2",
      "Persona;Léa;2",
      "Source;tk01;1",
      "Source;Sans source;1",
    ]);
    expect(lines[1]).toContain(";50,0;");
    expect(lines[1]!.endsWith(";0,5000;0,50;0")).toBe(true);
  });

  it("univers connus : une ligne par univers après le total ; « encore à traiter » en dernière colonne", () => {
    const stats = aggregateConversationStats({
      conversations: [
        {
          personaId: "p1",
          source: "tk01",
          stage: "CHAT",
          replied: true,
          reached: ["CHAT"],
          converted: false,
          needsHuman: true,
        },
        {
          personaId: "p2",
          source: null,
          stage: "WELCOME",
          replied: false,
          reached: [],
          converted: false,
        },
      ],
      linksSent: [],
      linksOpened: [],
      players: [],
      costs: [],
      personaNames: { p1: "Léa", p2: "Max" },
      personaUniverses: { p1: "dating", p2: "casino" },
    });
    const lines = statsCsv(stats, "Hier")
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    const heads = lines.map((l) => l.split(";").slice(0, 2).join(";"));
    expect(heads.slice(1, 4)).toEqual([
      "Total (Hier);Toutes les conversations",
      "Univers;Rencontres",
      "Univers;Casino",
    ]);
    expect(lines[0]!.endsWith(";Encore à traiter")).toBe(true);
    expect(lines[1]!.endsWith(";1")).toBe(true);
    expect(lines[2]!.endsWith(";1")).toBe(true);
    expect(lines[3]!.endsWith(";0")).toBe(true);
  });
});
