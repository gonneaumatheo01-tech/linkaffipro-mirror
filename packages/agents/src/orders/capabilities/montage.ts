/**
 * Capacités de l'équipe Montage (phase 28) : « fais-moi 10 clips de 15 secondes », « découpe ma vidéo en shorts
 * verticaux avec sous-titres » arrivent aussi par le planificateur des ordres (phase 33). Les shorts ne partent nulle
 * part tout seuls : chaque short passe par un aperçu et un ✅ du client ; lancer un montage ne touche aucun canal.
 * - `decouper_video` : monte la dernière vidéo reçue par Kevin (30 min, pas encore utilisée) ;
 * - `etat_montage` : où en est le montage (lecture seule).
 */
import { adminTelegramId, readSetting, writeSetting } from "../../admin/journal";
import type { AgentsDeps } from "../../types";
import { latestFreeVideo } from "../../montage/kevin-state";
import { montageStatus, latestJob } from "../../montage/kevin-view";
import { launchMontage } from "../../montage/reception";
import type { KevinMontageDeps } from "../../montage/kevin-port";
import type { OrderRow } from "../contract";
import { defineCapability, done, failed, ok, readOnly, refuse } from "./kit";

const T = "montage" as const;
const AGENTS = ["chef-montage", "montage-reception", "montage-decoupe", "montage-monteur", "montage-habillage", "montage-controle"];
const ORDER_JOB_PREFIX = "montage.order.";

type DecoupeP = {
  duree?: number;
  nombre?: number;
  format?: "vertical" | "horizontal" | "carre";
  camera?: "haut_droite" | "haut_gauche" | "bas_droite" | "bas_gauche" | "sans";
  sous_titres?: boolean;
  texte?: string;
  theme?: string;
  consignes?: string;
};

async function adminChat(deps: AgentsDeps): Promise<string | null> {
  return (await adminTelegramId(deps))?.toString() ?? null;
}

/** Paramètres → phrase de consignes (lue ensuite par `parseMontageInstructions`, comme une phrase du client). Pur. */
export function consignesOf(p: DecoupeP): string {
  const parts: string[] = [];
  if (p.consignes) parts.push(p.consignes);
  if (p.nombre) parts.push(`${p.nombre} shorts`);
  if (p.duree) parts.push(`de ${p.duree} secondes`);
  if (p.format) parts.push(p.format === "carre" ? "en carré" : p.format);
  const cam: Record<string, string> = { haut_droite: "cam en haut à droite", haut_gauche: "cam en haut à gauche", bas_droite: "cam en bas à droite", bas_gauche: "cam en bas à gauche", sans: "sans la cam" };
  if (p.camera) parts.push(cam[p.camera]!);
  if (p.sous_titres === true) parts.push("avec sous-titres");
  if (p.sous_titres === false) parts.push("sans sous-titres");
  if (p.texte) parts.push(`texte « ${p.texte.replace(/[«»"]/g, "")} »`);
  if (p.theme) parts.push(`thème ${p.theme}`);
  return parts.join(", ");
}

const decouperVideo = defineCapability<DecoupeP>({
  teamKey: T,
  key: "decouper_video",
  description: "Découper la vidéo longue que le client vient d'envoyer en shorts (durée, nombre, format, cam, sous-titres, texte) ; chaque short passe par un aperçu à valider",
  agents: AGENTS,
  spec: {
    duree: { kind: "int", description: "Durée d'un short en secondes (5 à 90)", min: 5, max: 90, optional: true },
    nombre: { kind: "int", description: "Nombre de shorts voulus (1 à 20)", min: 1, max: 20, optional: true },
    format: { kind: "enum", description: "vertical (TikTok, Reels), horizontal ou carre", values: ["vertical", "horizontal", "carre"], optional: true },
    camera: { kind: "enum", description: "Place de la cam incrustée", values: ["haut_droite", "haut_gauche", "bas_droite", "bas_gauche", "sans"], optional: true },
    sous_titres: { kind: "bool", description: "Sous-titres (oui par défaut)", optional: true },
    texte: { kind: "string", description: "Texte à incruster, tel que demandé", optional: true, maxLength: 100 },
    theme: { kind: "string", description: "Thème (roulette, blackjack, slots…)", optional: true, maxLength: 40 },
    consignes: { kind: "string", description: "Autres consignes telles que dites", optional: true, maxLength: 300 },
  },
  limits: { modes: ["simulation", "real"], channels: "any" },
  async check(deps) {
    const chat = await adminChat(deps);
    const video = chat ? await latestFreeVideo(deps, chat) : null;
    if (!video) return refuse("Il me faut d'abord la vidéo : envoie-la-moi ici, avec ou sans consignes.", []);
    return ok();
  },
  async plan(_deps, p) {
    const what = consignesOf(p) || "shorts de 15 secondes, vertical, sous-titres";
    return [{ stepKey: "decouper_video", capability: "decouper_video", teamKey: T, summary: `découper ta dernière vidéo (${what}), chaque short passera par ton ✅`, touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order: OrderRow, step) {
    const key = `${ORDER_JOB_PREFIX}${order.id}`;
    const already = (await readSetting(deps, key)) as { jobId?: string } | undefined;
    if (already?.jobId) return done("Montage déjà lancé pour cet ordre.");
    const chat = order.chatId ?? (await adminChat(deps));
    const video = chat ? await latestFreeVideo(deps, chat) : null;
    if (!chat || !video) return failed("Il me faut d'abord la vidéo : envoie-la-moi ici.");
    const r = await launchMontage(deps as KevinMontageDeps, { chatId: chat, video, text: consignesOf(step.params as DecoupeP), instructionsMsgId: null });
    if (!r.jobId) return failed(r.reply.replace(/<[^>]+>/g, ""), true);
    await writeSetting(deps, key, { jobId: r.jobId });
    return done(r.reply.replace(/<[^>]+>/g, ""));
  },
  async report(deps, order) {
    const key = `${ORDER_JOB_PREFIX}${order.id}`;
    const saved = (await readSetting(deps, key)) as { jobId?: string } | undefined;
    const job = saved?.jobId ? ((await deps.prisma.montageJob.findUnique({ where: { id: saved.jobId } })) as { status: string; shortCount: number } | null) : null;
    return { montage: job ? { etat: job.status, shorts: job.shortCount } : null };
  },
});

const etatMontage = defineCapability<{ sujet?: string }>({
  teamKey: T,
  key: "etat_montage",
  description: "Dire où en est le montage vidéo (analyse, plan, fabrication, aperçus, shorts validés)",
  agents: AGENTS,
  spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "etat_montage", capability: "etat_montage", teamKey: T, summary: "dire où en est le montage", touches: readOnly(), params: { sujet: p.sujet ?? null } }];
  },
  async run(deps) {
    return done((await montageStatus(deps, await adminChat(deps))).text);
  },
  async report(deps) {
    const job = await latestJob(deps, await adminChat(deps));
    return { montage: job ? { etat: job.status } : null };
  },
});

export const MONTAGE_CAPABILITIES = [decouperVideo, etatMontage];
