/**
 * Phase 31, chantier A (Sourceur) : source F, ajout manuel (« Kevin, ajoute t.me/xxx », lien transféré à Kevin, bouton
 * du site). Candidat `MANUAL`, priorité 10, enrichi en priorité ; le plafond journalier ne s'applique pas (demande du
 * client). Un lien d'invitation privé est enregistré `UNREADABLE` (jamais ouvert) ; un canal sur liste noire est refusé.
 */
import type { ProspectionDeps } from "../contract";
import { MANUAL_PRIORITY, MANUAL_QUEUE_PRIORITY, upsertCandidates } from "./dedupe";
import { normalizeProspectUrl } from "./normalize";

export type ManualProspectResult = { ok: true; prospectId: string; created: boolean; unreadable: boolean } | { ok: false; reason: string };

/** `input` : texte du client (« @nom », « t.me/nom »…) ou `{ url }`. */
export async function addManualProspect(deps: ProspectionDeps, input: string | { url: string }, by: "client" | "system"): Promise<ManualProspectResult> {
  const raw = typeof input === "string" ? input : String(input?.url ?? "");
  const n = normalizeProspectUrl(raw);
  if (!n) return { ok: false, reason: `Je ne reconnais pas un canal Telegram public dans « ${raw.slice(0, 80)} ».` };
  if (n.folder) return { ok: false, reason: "C'est un dossier de canaux (addlist), pas un canal : envoie-moi plutôt un des canaux." };

  const existing = await deps.prisma.prospect.findFirst({
    where: n.username ? { OR: [{ channelUrl: n.channelUrl }, { username: n.username }] } : { channelUrl: n.channelUrl },
  });
  if (existing) {
    if (existing.status === "BLACKLISTED") return { ok: false, reason: "Ce canal est sur la liste noire : je ne le reprends pas." };
    if (existing.priority < MANUAL_PRIORITY) await deps.prisma.prospect.update({ where: { id: existing.id }, data: { priority: MANUAL_PRIORITY } });
    // Pas encore lu (ou lecture ratée) : on relance l'enrichissement en priorité.
    if ((existing.status === "DISCOVERED" || existing.status === "ENRICH_FAILED") && deps.prospection?.enqueue)
      await deps.prospection.enqueue({ type: "prospection.enrich", prospectId: existing.id }, { jobId: `prospection.enrich:${existing.id}`, priority: MANUAL_QUEUE_PRIORITY });
    return { ok: true, prospectId: existing.id, created: false, unreadable: existing.status === "UNREADABLE" };
  }

  const r = await upsertCandidates(
    deps,
    [{ url: n.channelUrl, sourceType: "MANUAL", sourceDetail: raw.slice(0, 500) }],
    { sourceType: "MANUAL", sourceDetail: raw.slice(0, 500), languages: [], vertical: null },
    { ignoreCap: true, by },
  );
  const row = await deps.prisma.prospect.findFirst({ where: { channelUrl: n.channelUrl } });
  if (!row) return { ok: false, reason: r.errors[0] ?? "Enregistrement impossible, réessaie plus tard." };
  return { ok: true, prospectId: row.id, created: r.newCount > 0, unreadable: n.invite };
}
