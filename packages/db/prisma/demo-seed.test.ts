import { describe, expect, it } from "vitest";
import {
  DEMO_MEMBER_ID_BASE,
  DemoGuardError,
  assertLocalDatabaseUrl,
  checkLocalDatabaseUrl,
  createRandom,
  isDemoTelegramUserId,
  parisDayKey,
  parisDayStart,
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
