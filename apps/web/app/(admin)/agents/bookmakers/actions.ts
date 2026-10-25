"use server";

import { revalidatePath } from "next/cache";
import { openVisibleBrowser, relearnSite, setSiteUrl, testSite } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { BOOKMAKERS_PATH, canManageBookmakers, safeSiteKey } from "@/lib/agents/bookmakers";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Bookmakers (phase 35), réservées aux administrateurs : « Tester », « Ré-apprendre »,
 * « Ouvrir le navigateur sur le Mac » et « Changer l'adresse ». Elles ne font que déposer des LECTURES pour le
 * service d'arrière-plan (ou le Mac) : jamais de mise. Chaque geste est noté dans le journal des actions (`AuditLog`,
 * par les fonctions des agents, « via SITE ») ; Kevin donne le résultat sur Telegram.
 */

type Site = { key: string; label: string; baseUrl: string | null };

const db = () =>
  prisma as unknown as {
    bookmakerSite: { findUnique(a: unknown): Promise<Site | null> };
    setting: { findMany(a: unknown): Promise<Array<{ key: string }>> };
  };

const NO_CREDENTIALS =
  "Il manque les identifiants des comptes bookmakers : écrivez « identifiants bookmakers » à Kevin, il vous les demande en privé.";
const NO_URL = "Il manque l'adresse du site : renseignez-la d'abord (Changer l'adresse).";
const NO_MAC =
  "Le Mac ne lit pas en ce moment : allumez-le et ouvrez la session, puis recommencez.";

async function guard(formData: FormData, what: string): Promise<{ site: Site; userId: string }> {
  const user = await requireUser();
  if (!canManageBookmakers(user.role))
    backTo(BOOKMAKERS_PATH, { error: `${what} est réservé aux administrateurs.` });
  const key = safeSiteKey(formData.get("siteKey"));
  const site = key
    ? await db().bookmakerSite.findUnique({
        where: { key },
        select: { key: true, label: true, baseUrl: true },
      })
    : null;
  if (!site) backTo(BOOKMAKERS_PATH, { error: "Bookmaker inconnu : rechargez la page." });
  return { site, userId: user.id };
}

async function hasCredentials(key: string): Promise<boolean> {
  const rows = await db().setting.findMany({
    where: {
      key: {
        in: [
          `agents.secret.providers.bookmakers.${key}.login`,
          "agents.secret.providers.bookmakers.default.credentials",
        ],
      },
    },
    select: { key: true },
  });
  return rows.length > 0;
}

function done(ok: string): never {
  revalidatePath(BOOKMAKERS_PATH);
  backTo(BOOKMAKERS_PATH, { ok });
}

export async function testSiteAction(formData: FormData): Promise<void> {
  const { site, userId } = await guard(formData, "Tester un bookmaker");
  if (!site.baseUrl) backTo(BOOKMAKERS_PATH, { error: NO_URL });
  if (!(await hasCredentials(site.key))) backTo(BOOKMAKERS_PATH, { error: NO_CREDENTIALS });
  try {
    const r = await testSite(buildAgentsDeps(), site.key, { userId, via: "SITE" });
    if (!r.ok)
      backTo(BOOKMAKERS_PATH, { error: `Test impossible pour ${site.label} pour l'instant.` });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOOKMAKERS_PATH, { error: `Test impossible pour l'instant : ${errorText(err)}.` });
  }
  done(
    `Test de ${site.label} lancé (connexion et une lecture des matchs, aucune mise) : Kevin vous donne le résultat sur Telegram dans quelques minutes.`,
  );
}

export async function relearnSiteAction(formData: FormData): Promise<void> {
  const { site, userId } = await guard(formData, "Ré-apprendre un bookmaker");
  if (!site.baseUrl) backTo(BOOKMAKERS_PATH, { error: NO_URL });
  if (!(await hasCredentials(site.key))) backTo(BOOKMAKERS_PATH, { error: NO_CREDENTIALS });
  try {
    const r = await relearnSite(buildAgentsDeps(), site.key, { userId, via: "SITE" });
    if (!r.ok)
      backTo(BOOKMAKERS_PATH, {
        error: `Apprentissage impossible pour ${site.label} pour l'instant.`,
      });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOOKMAKERS_PATH, {
      error: `Apprentissage impossible pour l'instant : ${errorText(err)}.`,
    });
  }
  done(
    `Apprentissage de ${site.label} demandé : quelques minutes. Kevin vous prévient sur Telegram quand c'est prêt.`,
  );
}

export async function openBrowserAction(formData: FormData): Promise<void> {
  const { site, userId } = await guard(formData, "Ouvrir le navigateur sur le Mac");
  if (!site.baseUrl) backTo(BOOKMAKERS_PATH, { error: NO_URL });
  try {
    const r = await openVisibleBrowser(buildAgentsDeps(), site.key, { userId, via: "SITE" });
    if (!r.ok) backTo(BOOKMAKERS_PATH, { error: NO_MAC });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOOKMAKERS_PATH, {
      error: `Navigateur impossible à ouvrir pour l'instant : ${errorText(err)}.`,
    });
  }
  done(
    `Le navigateur s'ouvre sur le Mac, sur ${site.label} : passez le contrôle ou tapez le code, puis laissez la fenêtre. La lecture reprend toute seule.`,
  );
}

export async function setSiteUrlAction(formData: FormData): Promise<void> {
  const { site, userId } = await guard(formData, "Changer l'adresse d'un bookmaker");
  const url = String(formData.get("url") ?? "").trim();
  if (!url) backTo(BOOKMAKERS_PATH, { error: "Indiquez l'adresse du site." });
  let message = "";
  try {
    const r = await setSiteUrl(buildAgentsDeps(), site.key, url, { userId, via: "SITE" });
    if (!r.ok) backTo(BOOKMAKERS_PATH, { error: r.message });
    message =
      r.site?.baseUrl === site.baseUrl
        ? `${site.label} a déjà cette adresse.`
        : `Nouvelle adresse de ${site.label} enregistrée : cliquez sur « Ré-apprendre » pour qu'il la lise.`;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOOKMAKERS_PATH, { error: `Adresse impossible à enregistrer : ${errorText(err)}.` });
  }
  done(message);
}
