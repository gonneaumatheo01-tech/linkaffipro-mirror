/**
 * Phase 10, sur base réelle :
 * - modèles fournis : leur bouton « Offre (campagne) » n'a pas de campagne (elle se choisit en utilisant le modèle).
 *   « Modifier » puis « Enregistrer le modèle » est accepté sans choisir de campagne : bouton gardé tel quel, aucun
 *   lien traqué ; un message ordinaire avec le même bouton reste refusé ;
 * - « Écrire à un groupe » → « Envoyer un test à moi » : {prenom} et {bot} remplacés comme pour un destinataire.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { segmentFormFields } from "@/lib/broadcasts/group";
import { createBotAndChannel, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "modeles@template-offer.test.local",
    name: "Équipe modèles",
    role: "ADMIN",
    telegramUserId: null as bigint | null,
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const { createPostAction, updatePostAction } = await import("@/app/(admin)/messages/actions");
const { createAndTestAction } = await import("@/app/(admin)/members/broadcasts/actions");

const OFFER_TO_CHOOSE = [[{ text: "🎁 J'en profite", type: "OFFER" }]];
const ids: Record<string, string> = {};

async function cleanExtras() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.broadcast.deleteMany({ where: { createdBy: { email: session.user.email } } });
  await prisma.post.deleteMany({
    where: {
      OR: [
        { createdBy: { email: session.user.email } },
        { updatedBy: { email: session.user.email } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({ where: { user: { email: session.user.email } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
}

/** Lance une action serveur et renvoie l'adresse de redirection. */
async function redirectOf(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("aucune redirection");
}

function param(url: string, key: string): string {
  return new URLSearchParams(url.split("?")[1] ?? "").get(key) ?? "";
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

beforeAll(async () => {
  await resetDb();
  await cleanExtras();
  const u = await prisma.user.create({
    data: { email: session.user.email, name: session.user.name, passwordHash: "x", role: "ADMIN" },
  });
  session.user.id = u.id;
  const { bot, channel } = await createBotAndChannel();
  ids.bot = bot.id;
  ids.channel = channel.id;
  // Modèle fourni, tel que `pnpm seed:templates` (phase 10) l'insère : bouton Offre sans campagne.
  ids.template = (
    await prisma.post.create({
      data: {
        code: "modele:casino:bonus:2",
        channelId: channel.id,
        botId: bot.id,
        status: "DRAFT",
        isTemplate: true,
        templateName: "Casino · Bonus · Tours gratuits",
        vertical: "CASINO",
        text: "Des <b>tours gratuits</b> sont disponibles cette semaine.",
        buttons: OFFER_TO_CHOOSE,
      },
    })
  ).id;
  ids.draft = (
    await prisma.post.create({
      data: {
        code: "TPLOFFR1",
        channelId: channel.id,
        botId: bot.id,
        status: "DRAFT",
        text: "Brouillon d'origine",
        buttons: [],
      },
    })
  ).id;
});

afterAll(cleanExtras);

describe("modèle fourni avec un bouton Offre sans campagne", () => {
  it("« Modifier » → « Enregistrer le modèle » sans campagne : texte enregistré, bouton gardé, aucun lien", async () => {
    const url = await redirectOf(
      updatePostAction(
        form({
          postId: ids.template!,
          channelIds: ids.channel!,
          text: "Des <b>tours gratuits</b> sont disponibles ce week-end.",
          intent: "template",
          templateName: "Casino · Bonus · Tours gratuits",
          buttons: JSON.stringify(OFFER_TO_CHOOSE),
        }),
      ),
    );
    expect(param(url, "error")).toBe("");
    expect(url.split("?")[0]).toBe(`/messages/${ids.template}`);
    const p = await prisma.post.findUniqueOrThrow({ where: { id: ids.template! } });
    expect(p.text).toBe("Des <b>tours gratuits</b> sont disponibles ce week-end.");
    expect(p.buttons).toEqual(OFFER_TO_CHOOSE);
    expect(p).toMatchObject({ isTemplate: true, status: "DRAFT", updatedById: session.user.id });
    expect(await prisma.trackingLink.count({ where: { postId: ids.template! } })).toBe(0);
  });

  it("« Enregistrer comme modèle » avec un bouton Offre sans campagne : modèle créé, sans lien", async () => {
    const url = await redirectOf(
      createPostAction(
        form({
          channelIds: ids.channel!,
          text: "Notre bonus du vendredi.",
          intent: "template",
          templateName: "Bonus du vendredi",
          buttons: JSON.stringify(OFFER_TO_CHOOSE),
        }),
      ),
    );
    expect(param(url, "ok")).toBe("Modèle enregistré.");
    const p = await prisma.post.findFirstOrThrow({ where: { templateName: "Bonus du vendredi" } });
    expect(p).toMatchObject({ isTemplate: true, buttons: OFFER_TO_CHOOSE });
    expect(await prisma.trackingLink.count({ where: { postId: p.id } })).toBe(0);
  });

  it("message ordinaire avec le même bouton : toujours refusé, rien n'est modifié", async () => {
    const url = await redirectOf(
      updatePostAction(
        form({
          postId: ids.draft!,
          channelIds: ids.channel!,
          text: "Brouillon modifié",
          intent: "draft",
          buttons: JSON.stringify(OFFER_TO_CHOOSE),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    const p = await prisma.post.findUniqueOrThrow({ where: { id: ids.draft! } });
    expect(p.text).toBe("Brouillon d'origine");
    expect(p.buttons).toEqual([]);
  });
});

describe("« Envoyer un test à moi » d'un message à un groupe", () => {
  it("{prenom} et {bot} remplacés comme pour un destinataire (valeurs échappées)", async () => {
    const me = await prisma.member.create({
      data: { telegramUserId: 9_120_001n, firstName: "Tom <3", languageCode: "fr" },
    });
    await prisma.memberBotState.create({
      data: { memberId: me.id, botId: ids.bot!, canDm: true },
    });
    session.user.telegramUserId = 9_120_001n;
    try {
      const fd = form({
        name: "Test prénom",
        botId: ids.bot!,
        text: "Bonjour {prenom}, ici {bot}. {offre} reste tel quel.",
        mediaAssetId: "",
        buttons: "[]",
        scheduledAt: "",
        intent: "draft",
      });
      for (const [k, v] of segmentFormFields({ channelIds: [ids.channel!] })) fd.append(k, v);
      const url = await redirectOf(createAndTestAction(fd));
      expect(param(url, "ok")).toContain("Message de test envoyé");
      const sent = await prisma.outboundMessage.findMany({
        where: { memberId: me.id, kind: "TEST" },
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toBe("Bonjour Tom &lt;3, ici Bot test. {offre} reste tel quel.");
      // Le brouillon garde le texte avec ses repères (personnalisé à l'envoi pour chacun).
      const b = await prisma.broadcast.findFirstOrThrow({ where: { name: "Test prénom" } });
      expect(b.text).toBe("Bonjour {prenom}, ici {bot}. {offre} reste tel quel.");
    } finally {
      session.user.telegramUserId = null;
    }
  });
});
