/**
 * Phase 34, lot D — cœurs de l'onglet Demandes (`/agents/validations`) : répondre à une demande au client, la passer
 * (« Plus tard »), relancer une demande passée ou expirée. Mêmes règles que par Telegram : le rôle est transmis au
 * moteur, qui refuse à un MANAGER les demandes réservées (clé, passage en vrai, niveau 2…) et journalise.
 * Publier / Corriger / Refuser un post (`decideValidationAction`) : `decideValidation`, déjà la fonction des commandes
 * « valider », « corriger », « refuser » de Kevin (correspondance de catalogue).
 */
import { answerHumanRequestFromSite, relaunchHumanRequest, skipHumanRequest } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { engineActor, errorText, fail, formOf, ok, preview, str, type CoreRun, type Fail } from "./kit";

const UNKNOWN = "Demande inconnue : rechargez la page.";

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const done = (r: { ok: boolean; message: string }) => (r.ok ? ok(r.message) : fail(r.message, "conflict"));

/** Une clé ne passe jamais par une réponse de groupe ni par l'IA : elle se donne à Kevin en privé, seule. */
async function secretRequest(id: string): Promise<boolean> {
  const { prisma } = await import("@linkaffipro/db");
  const row = await prisma.humanRequest.findUnique({ where: { id }, select: { kind: true } });
  return row?.kind === "SECRET";
}

export const runAnswerHumanRequest: CoreRun = async (fd, actor, opts = {}) => {
  const id = field(fd, "requestId");
  const answer = field(fd, "answer");
  if (!id) return fail(UNKNOWN, "invalid", "requestId");
  if (!answer) return fail("Écrivez ou choisissez une réponse.", "invalid", "answer");
  if (actor.via === "TELEGRAM" && (await secretRequest(id)))
    return fail("Cette demande attend une clé : envoie-la-moi en privé, seule dans le message.", "forbidden");
  if (opts.dryRun) return preview(`Réponse à la demande : « ${answer.slice(0, 120)} ».`);
  try {
    // Le rôle est passé au moteur : un MANAGER ne répond jamais à une demande réservée (clé, passage en vrai…).
    return done(await answerHumanRequestFromSite(buildAgentsDeps(), id, answer, engineActor(actor), actor.role));
  } catch (err) {
    return fail(`Réponse impossible : ${errorText(err)}.`, "unavailable");
  }
};

export const runSkipHumanRequest: CoreRun = async (fd, actor, opts = {}) => {
  const id = field(fd, "requestId");
  if (!id) return fail(UNKNOWN, "invalid", "requestId");
  if (opts.dryRun) return preview("La demande passe : la suivante arrive.");
  try {
    return done(await skipHumanRequest(buildAgentsDeps(), id, engineActor(actor), actor.role));
  } catch (err) {
    return fail(`Impossible de passer la demande : ${errorText(err)}.`, "unavailable");
  }
};

export const runRelaunchHumanRequest: CoreRun = async (fd, actor, opts = {}) => {
  const id = field(fd, "requestId");
  if (!id) return fail(UNKNOWN, "invalid", "requestId");
  if (opts.dryRun) return preview("La demande est reposée.");
  try {
    return done(await relaunchHumanRequest(buildAgentsDeps(), id, engineActor(actor)));
  } catch (err) {
    return fail(`Relance impossible : ${errorText(err)}.`, "unavailable");
  }
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/** Demande par identifiant, sinon la demande en cours ; `reponse` = la réponse (jamais une clé, voir plus haut). */
export async function kevinRequestForm(input: In, mode: "answer" | "skip" | "relaunch"): Promise<Prepared> {
  const { resolveHumanRequest } = await import("./resolve");
  const withAnswer = mode === "answer";
  const r = await resolveHumanRequest(input.demande ?? input.requestId, mode === "relaunch" ? ["SKIPPED", "EXPIRED"] : ["PENDING"]);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ requestId: r.id, ...(withAnswer ? { answer: str(input.reponse ?? input.answer) } : {}) }) };
}
