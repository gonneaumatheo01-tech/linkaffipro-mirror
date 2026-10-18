import { describe, expect, it } from "vitest";
import {
  DEMO_MEMBER_ID_BASE,
  DemoGuardError,
  P17_ASSISTANT_SETTING,
  P17_BOT,
  P17_CONVERSATIONS,
  P17_PERSONA,
  assertLocalDatabaseUrl,
  checkLocalDatabaseUrl,
  createRandom,
  isDemoTelegramUserId,
  p17SubId,
  parisDayKey,
  parisDayStart,
  pickP17Members,
  stableId,
} from "./demo-seed";

// Données de démonstration LOCALES : garde-fou sur la base visée, heures de Paris, tirage reproductible.

describe("garde-fou : base locale seulement", () => {
  it("accepte localhost, 127.0.0.1 et ::1 (conteneur lap-pg)", () => {
    expect(checkLocalDatabaseUrl("postgresql://postgres:lap@localhost:54329/linkaffipro")).toEqual({
      ok: true,
      host: "localhost",
      database: "linkaffipro",
    });
    expect(checkLocalDatabaseUrl("postgres://u:p@127.0.0.1/db").ok).toBe(true);
    expect(checkLocalDatabaseUrl("postgresql://u:p@[::1]:5432/db").ok).toBe(true);
    expect(() =>
      assertLocalDatabaseUrl("postgresql://postgres:lap@localhost:54329/linkaffipro"),
    ).not.toThrow();
  });

  it("refuse la production et tout hôte distant", () => {
    for (const url of [
      "postgresql://postgres:x@postgres.railway.internal:5432/railway",
      "postgresql://postgres:x@roundhouse.proxy.rlwy.net:41234/railway",
      "postgresql://u:p@localhost.example.com/db",
      "postgresql://u:p@10.0.0.5/db",
    ])
      expect(() => assertLocalDatabaseUrl(url)).toThrow(DemoGuardError);
  });

  it("refuse un paramètre host qui renverrait ailleurs, accepte un socket local", () => {
    expect(checkLocalDatabaseUrl("postgresql://u:p@localhost/db?host=db.example.com").ok).toBe(
      false,
    );
    expect(checkLocalDatabaseUrl("postgresql://u:p@localhost/db?host=/var/run/postgresql").ok).toBe(
      true,
    );
  });

  it("refuse une adresse absente, illisible ou d'un autre moteur, avec un message clair", () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/DATABASE_URL absente/);
    expect(() => assertLocalDatabaseUrl("pas une url")).toThrow(/illisible/);
    expect(() => assertLocalDatabaseUrl("mysql://u:p@localhost/db")).toThrow(/PostgreSQL/);
    expect(() => assertLocalDatabaseUrl("postgresql://u:p@db.example.com/x")).toThrow(
      /db\.example\.com/,
    );
  });
});

describe("heures de Paris", () => {
  it("jour civil de Paris (UTC+2 l'été, UTC+1 l'hiver)", () => {
    expect(parisDayKey(new Date("2026-10-10T21:59:00Z"))).toBe("2026-10-10");
    expect(parisDayKey(new Date("2026-10-10T22:01:00Z"))).toBe("2026-10-11");
    expect(parisDayKey(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("minuit à Paris, y compris les jours de changement d'heure", () => {
    expect(parisDayStart(new Date("2026-10-10T10:00:00Z")).toISOString()).toBe(
      "2026-10-09T22:00:00.000Z",
    );
    expect(parisDayStart(new Date("2026-12-01T10:00:00Z")).toISOString()).toBe(
      "2026-11-30T23:00:00.000Z",
    );
    // 29 mars 2026 : passage à l'heure d'été à 2 h ; minuit était encore à UTC+1.
    expect(parisDayStart(new Date("2026-03-29T10:00:00Z")).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    // 25 octobre 2026 : retour à l'heure d'hiver à 3 h ; minuit était encore à UTC+2.
    expect(parisDayStart(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
  });
});

describe("tirage reproductible et repères de démonstration", () => {
  it("même graine, même suite ; valeurs dans [0, 1)", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    const r = createRandom(7);
    for (let i = 0; i < 50; i++) {
      const n = r.int(3, 5);
      expect(n >= 3 && n <= 5 && Number.isInteger(n)).toBe(true);
    }
  });
  it("identifiants Telegram de démonstration hors de la plage des vrais comptes", () => {
    expect(isDemoTelegramUserId(DEMO_MEMBER_ID_BASE + 12n)).toBe(true);
    expect(isDemoTelegramUserId(123456789n)).toBe(false);
  });
  it("identifiants stables des objets principaux : mêmes adresses de fiches d'une passe à l'autre", () => {
    expect(stableId("campaign:0")).toBe(stableId("campaign:0"));
    expect(stableId("campaign:0")).not.toBe(stableId("campaign:1"));
    expect(stableId("member:12")).toMatch(/^c[0-9a-z]{24}$/);
  });
});

describe("phase 17 : assistant de conversation de démonstration", () => {
  const assistantLines = P17_CONVERSATIONS.flatMap((c) =>
    c.lines.flatMap((l) => (l.kind === "lea" || l.kind === "team" ? [l.text] : [])),
  );

  it("réglage sans clé, en essai par l'équipe ; bot assistant à part des trois bots d'univers", () => {
    expect(P17_ASSISTANT_SETTING.apiKeyEncrypted).toBeNull();
    expect(P17_ASSISTANT_SETTING.activation).toBe("team");
    expect(P17_BOT.username.endsWith("_bot")).toBe(true);
    expect(P17_BOT.tgId).toBe(9_900_000_004n);
  });

  it("persona : la description du bot dit « assistante » et « IA », la fiche de l'offre n'invente aucun chiffre", () => {
    for (const t of [P17_PERSONA.botDescription, P17_PERSONA.botShortDescription]) {
      expect(t).toMatch(/assistante/);
      expect(t).toMatch(/\bIA\b/);
    }
    expect(P17_PERSONA.botDescription.length).toBeLessThanOrEqual(512);
    expect(P17_PERSONA.botShortDescription.length).toBeLessThanOrEqual(120);
    expect(P17_PERSONA.offerPitch.trim().length).toBeGreaterThan(0);
    expect(P17_PERSONA.offerPitch).not.toMatch(/\d{2,}|%/);
    // Aucune promesse de proximité (« profils près de chez toi ») : interdit par le client.
    expect(P17_PERSONA.offerPitch).not.toMatch(/chez (toi|soi|vous)/i);
  });

  it("la première réponse de chaque conversation présente Léa comme l'assistante du canal", () => {
    for (const c of P17_CONVERSATIONS) {
      const first = c.lines.find((l) => l.kind === "lea");
      expect(first && first.kind === "lea" ? first.text : "").toMatch(/Léa, l'assistante du canal/);
    }
  });

  it("messages courts, sans lien, sans markdown ni chiffre inventé ; l'aveu d'être une IA quand on le demande", () => {
    for (const t of assistantLines) {
      expect(t.length).toBeLessThanOrEqual(300);
      expect(t).not.toMatch(/https?:|www\.|t\.me|@\w|\*\*|__|`/);
      expect(t).not.toMatch(/\d{2,}|%/);
      expect(t).not.toMatch(/chez (toi|soi|vous)/i);
    }
    const asked = P17_CONVERSATIONS.find((c) =>
      c.lines.some((l) => l.kind === "in" && /vraie personne/.test(l.text)),
    );
    expect(asked).toBeDefined();
    const i = asked!.lines.findIndex((l) => l.kind === "in" && /vraie personne/.test(l.text));
    const answer = asked!.lines[i + 1];
    expect(answer && answer.kind === "lea" ? answer.text : "").toMatch(/\bIA\b/);
  });

  it("parcours cohérents : étapes enchaînées depuis l'accueil, étapes variées, un lien par envoi", () => {
    const stages = new Set(P17_CONVERSATIONS.map((c) => c.stage));
    for (const s of ["WELCOME", "PROPOSAL", "LINK_SENT", "CONVERTED", "CLOSED"])
      expect(stages.has(s as never)).toBe(true);
    expect(P17_CONVERSATIONS.some((c) => c.status === "HUMAN")).toBe(true);
    expect(P17_CONVERSATIONS.length).toBeGreaterThanOrEqual(4);
    expect(P17_CONVERSATIONS.length).toBeLessThanOrEqual(6);
    for (const c of P17_CONVERSATIONS) {
      let stage = "WELCOME";
      for (const e of c.events.filter((x) => x.type === "stage_changed")) {
        expect(e.from).toBe(stage);
        stage = e.to!;
      }
      expect(stage).toBe(c.stage);
      // Jamais de lien au premier message de l'assistante ; un événement offer_sent par lien envoyé.
      const offers = c.lines.filter((l) => l.kind === "lea" && l.offer);
      expect(c.events.filter((e) => e.type === "offer_sent")).toHaveLength(offers.length);
      const firstLea = c.lines.find((l) => l.kind === "lea");
      expect(firstLea && firstLea.kind === "lea" && firstLea.offer).toBeFalsy();
      // Lignes dans l'ordre chronologique (minutes avant maintenant, décroissantes).
      for (let k = 1; k < c.lines.length; k++)
        expect(c.lines[k]!.ago).toBeLessThan(c.lines[k - 1]!.ago);
    }
    expect(p17SubId("x")).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(p17SubId("x")).toBe(p17SubId("x"));
    expect(p17SubId("x")).not.toBe(p17SubId("y"));
  });

  it("choix des personnes : francophones d'un canal Rencontres d'abord, ordre stable, repli si besoin", () => {
    const m = (n: number, firstName: string, languageCode: string, dating: boolean) => ({
      id: `m${n}`,
      tgId: BigInt(n),
      firstName,
      languageCode,
      dating,
    });
    const list = [
      m(5, "Hugo", "fr", true),
      m(1, "Emma", "fr", true),
      m(3, "Lucas", "en", true),
      m(2, "Paul", "fr", false),
      m(4, "Théo", "fr", true),
    ];
    expect(pickP17Members(list, 3).map((x) => x.id)).toEqual(["m4", "m5", "m2"]);
    expect(pickP17Members(list, 5).map((x) => x.id)).toEqual(["m4", "m5", "m2", "m1", "m3"]);
  });
});
