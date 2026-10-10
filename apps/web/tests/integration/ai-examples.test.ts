/**
 * Assistant IA, « Ce qui marche chez vous » (phase 8), sur base réelle : les messages de canal envoyés
 * (templateName vide) servent d'exemples ; les conteneurs d'envois groupés (`broadcast:<id>`) et les modèles non.
 * Régression : un filtre `NOT templateName startsWith` écartait aussi les templateName NULL (NULL en SQL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadBestExamples } from "@/lib/ai/examples";
import { createBotAndChannel, resetDb } from "./helpers";

let seq = 0;
async function sentPost(
  data: {
    channelId: string;
    botId: string;
    text: string;
    templateName?: string | null;
    isTemplate?: boolean;
    categoryId?: string | null;
  },
  stats: { clicks: number; views?: number; uniqueClickers?: number },
) {
  seq += 1;
  return prisma.post.create({
    data: {
      code: `AIEX${seq.toString().padStart(4, "0")}`,
      channelId: data.channelId,
      botId: data.botId,
      status: "SENT",
      sentAt: new Date(Date.now() - seq * 60_000),
      text: data.text,
      templateName: data.templateName ?? null,
      isTemplate: data.isTemplate ?? false,
      categoryId: data.categoryId ?? null,
      stats: {
        create: {
          clicks: stats.clicks,
          views: stats.views ?? 0,
          uniqueClickers: stats.uniqueClickers ?? stats.clicks,
        },
      },
    },
  });
}

describe("« Ce qui marche chez vous » sur base réelle", () => {
  let categoryId = "";

  beforeAll(async () => {
    await resetDb();
    await prisma.messageCategory.deleteMany({ where: { slug: "aiex-bonus" } });
    // Canal non typé : l'univers vient du bot (CASINO), comme pour la plupart des canaux importés.
    const { bot, channel } = await createBotAndChannel({
      chatId: BigInt(-1001234500777),
      title: "Canal exemples IA",
    });
    const cat = await prisma.messageCategory.create({
      data: { name: "Bonus IA test", slug: "aiex-bonus", color: "#16a34a" },
    });
    categoryId = cat.id;
    const base = { channelId: channel.id, botId: bot.id };
    // Message de canal normal : templateName NULL, 5 clics → doit servir d'exemple.
    await sentPost({ ...base, text: "Message de canal normal", categoryId }, { clicks: 5 });
    // Message de canal avec un templateName libre (créé depuis un modèle) : compte aussi.
    await sentPost(
      { ...base, text: "Message issu d'un modèle", templateName: "Accueil du soir" },
      { clicks: 4, views: 200, uniqueClickers: 4 },
    );
    // Conteneur d'un envoi groupé : jamais un exemple, même avec beaucoup de clics.
    await sentPost(
      { ...base, text: "Conteneur d'envoi groupé", templateName: "broadcast:abc123" },
      { clicks: 50 },
    );
    // Modèle de la bibliothèque : jamais un exemple.
    await sentPost(
      { ...base, text: "Modèle de bibliothèque", templateName: "Modèle", isTemplate: true },
      { clicks: 40 },
    );
    // Sous le seuil : écarté.
    await sentPost({ ...base, text: "Un seul clic" }, { clicks: 1 });
  });

  afterAll(async () => {
    await resetDb();
    await prisma.messageCategory.deleteMany({ where: { slug: "aiex-bonus" } });
  });

  it("renvoie les messages de canal envoyés (templateName vide compris), jamais les envois groupés ni les modèles", async () => {
    const out = await loadBestExamples({ vertical: "CASINO" });
    const texts = out.map((e) => e.text);
    expect(texts).toContain("Message de canal normal");
    expect(texts).toContain("Message issu d'un modèle");
    expect(texts).not.toContain("Conteneur d'envoi groupé");
    expect(texts).not.toContain("Modèle de bibliothèque");
    expect(texts).not.toContain("Un seul clic");
  });

  it("catégorie d'abord, puis repli sur l'univers ; autre univers : rien", async () => {
    const out = await loadBestExamples({ vertical: "CASINO", categoryId });
    expect(out[0]?.text).toBe("Message de canal normal");
    expect(out).toHaveLength(2);
    expect(await loadBestExamples({ vertical: "DATING", categoryId })).toEqual([]);
  });
});
