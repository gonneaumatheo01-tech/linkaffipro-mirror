/**
 * Recherche globale (⌘K) sur base réelle : les messages de canal (templateName vide) sont trouvés,
 * les conteneurs d'envois groupés (`broadcast:<id>`) jamais.
 * Régression : un filtre `NOT templateName startsWith` seul écartait aussi les templateName NULL (NULL en SQL).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import type { SearchResponse } from "@/lib/search/query";
import { createBotAndChannel, resetDb } from "./helpers";

vi.mock("@/lib/ai/api-user", () => ({
  apiUser: vi.fn(async () => ({ id: "u-search", role: "ADMIN" })),
}));

import { GET } from "@/app/api/search/route";

async function search(q: string): Promise<SearchResponse> {
  const res = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));
  expect(res.status).toBe(200);
  return (await res.json()) as SearchResponse;
}

describe("recherche globale sur base réelle", () => {
  beforeAll(async () => {
    await resetDb();
    const { bot, channel } = await createBotAndChannel({ chatId: -1005550001n });
    const base = {
      channelId: channel.id,
      botId: bot.id,
      status: "SENT" as const,
      sentAt: new Date(),
    };
    await prisma.post.create({
      data: { ...base, code: "SRCH0001", text: "Grand tournoi zebrafoot ce soir" },
    });
    await prisma.post.create({
      data: {
        ...base,
        code: "SRCH0002",
        text: "Rappel zebrafoot",
        templateName: "Casino · Rappel · zebrafoot",
      },
    });
    await prisma.post.create({
      data: {
        ...base,
        code: "SRCH0003",
        text: "Envoi groupé zebrafoot",
        templateName: "broadcast:abc",
      },
    });
  });
  afterAll(async () => {
    await resetDb();
  });

  it("trouve les messages de canal sans nom de modèle et les modèles, jamais les conteneurs d'envois", async () => {
    const r = await search("zebrafoot");
    const posts = r.groups.find((g) => g.key === "posts");
    const titles = (posts?.hits ?? []).map((h) => h.title);
    expect(titles).toHaveLength(2);
    expect(titles.some((t) => t.includes("Grand tournoi"))).toBe(true);
    expect(titles).toContain("Casino · Rappel · zebrafoot");
    expect(titles.some((t) => t.includes("Envoi groupé"))).toBe(false);
  });
});
