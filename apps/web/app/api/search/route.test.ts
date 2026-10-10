/**
 * Recherche globale ⌘K : même contrôle que les pages (compte actif, session à jour). Un jeton encore valide d'un
 * compte désactivé, ou d'une session révoquée (mot de passe changé), reçoit 401.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({
  current: null as null | { id: string; role: "ADMIN" | "MANAGER" },
}));
vi.mock("@/lib/ai/api-user", () => ({ apiUser: async () => user.current }));
// Session JWT toujours présente : seul le contrôle en base doit décider.
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1", sessionVersion: 0 } }) }));
const db = vi.hoisted(() => ({
  member: { findMany: vi.fn(async () => []) },
  post: { findMany: vi.fn(async () => []) },
  channel: { findMany: vi.fn(async () => []) },
  campaign: {
    findMany: vi.fn(async () => [
      { id: "k1", name: "TT casino", status: "ACTIVE", adPlatform: "TIKTOK" },
    ]),
  },
  automationRule: { findMany: vi.fn(async () => []) },
}));
vi.mock("@linkaffipro/db", () => ({ prisma: db }));
vi.mock("@/lib/members/query", () => ({ displayName: () => "x" }));

import { GET } from "./route";

beforeEach(() => {
  user.current = null;
});

describe("GET /api/search", () => {
  it("compte désactivé ou session révoquée : 401 malgré le jeton", async () => {
    const res = await GET(new Request("https://app.test/api/search?q=casino"));
    expect(res.status).toBe(401);
    expect(db.campaign.findMany).not.toHaveBeenCalled();
  });

  it("utilisateur actif : résultats, groupe « Campagnes » avec la plateforme lisible", async () => {
    user.current = { id: "u1", role: "MANAGER" };
    const res = await GET(new Request("https://app.test/api/search?q=casino"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: Array<{ key: string; label: string; hits: Array<{ subtitle?: string }> }>;
    };
    const campaigns = body.groups.find((g) => g.key === "campaigns");
    expect(campaigns?.label).toBe("Campagnes");
    expect(campaigns?.hits[0]?.subtitle).toBe("TikTok · active");
  });

  it("chaque résultat mène à sa page à sa nouvelle adresse (relances sous Membres)", async () => {
    user.current = { id: "u1", role: "ADMIN" };
    db.automationRule.findMany.mockImplementationOnce(
      async () =>
        [{ id: "r1", name: "Relance casino", isActive: true, trigger: "MEMBER_JOINED" }] as never,
    );
    const res = await GET(new Request("https://app.test/api/search?q=casino"));
    const body = (await res.json()) as {
      groups: Array<{ key: string; hits: Array<{ href: string }> }>;
    };
    const hrefs = body.groups.flatMap((g) => g.hits.map((h) => h.href));
    expect(hrefs).toEqual(["/campaigns/k1", "/members/automations/r1"]);
  });
});
