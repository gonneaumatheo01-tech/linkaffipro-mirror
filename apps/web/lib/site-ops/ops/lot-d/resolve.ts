/**
 * Phase 34, lot D — désignation par nom OU par identifiant (« l'équipe casino », « la persona Léa », « la catégorie
 * corners », « le canal Zone Interdite », « Sportaza », « l'ordre 3 »). Chemin de Kevin seulement : le site envoie
 * toujours des identifiants. Rapprochement des noms par `matchNames` / `teamOf` de Kevin (`boss/resolve.ts`), chargés
 * à la demande. Plusieurs correspondances : jamais de devinette, la liste revient à Kevin (qui propose des boutons).
 */
import { prisma } from "@linkaffipro/db";
import type { TeamKey } from "@linkaffipro/agents";
import { fail, str, type Fail } from "./kit";

type Named = { id: string; name: string; extra?: string[] };
export type Ref = { ok: true; id: string; name: string } | { ok: false; result: Fail };

async function agents() {
  return import("@linkaffipro/agents");
}

/** Une ligne parmi `rows` : identifiant exact, sinon rapprochement par nom. */
export async function pickNamed(what: { plural: string; one: string }, raw: string, rows: readonly Named[]): Promise<Ref> {
  const t = raw.trim();
  if (!t) return { ok: false, result: fail(`Il manque ${what.one}.`, "invalid") };
  const exact = rows.find((r) => r.id === t);
  if (exact) return { ok: true, id: exact.id, name: exact.name };
  const { matchNames } = await agents();
  const found = matchNames(t, rows);
  if (found.length === 1) return { ok: true, id: found[0]!.id, name: found[0]!.name };
  if (found.length > 1)
    return {
      ok: false,
      result: fail(
        `Il y a plusieurs ${what.plural} qui correspondent à « ${t} » : ${found
          .slice(0, 10)
          .map((f) => `« ${f.name} »`)
          .join(", ")}. Lequel ?`,
      ),
    };
  return { ok: false, result: fail(`Je ne trouve pas ${what.one} « ${t} ».`, "not_found") };
}

/** Équipe (« casino », « paris sportifs », « rencontres », « algo ») ; `allowAll` : « tout ». */
export async function resolveTeam(
  raw: unknown,
  opts: { allowAll?: boolean } = {},
): Promise<{ ok: true; team: TeamKey | "all" } | { ok: false; result: Fail }> {
  const s = str(raw).trim();
  const { isTeamKey, teamOf } = await agents();
  if (isTeamKey(s)) return { ok: true, team: s };
  const t = s ? teamOf(s, opts) : null;
  if (t) return { ok: true, team: t };
  return { ok: false, result: fail(s ? `Je ne connais pas l'équipe « ${s} ».` : "Quelle équipe ?", "invalid", "team") };
}

export async function resolveChannel(raw: unknown): Promise<Ref> {
  const rows = await prisma.channel.findMany({ select: { id: true, title: true, username: true } });
  const s = str(raw).trim().replace(/^(https?:\/\/)?(t\.me|telegram\.me)\/(s\/)?/i, "@");
  const byUser = s.startsWith("@") ? rows.filter((r) => r.username?.toLowerCase() === s.slice(1).toLowerCase()) : [];
  if (byUser.length === 1) return { ok: true, id: byUser[0]!.id, name: byUser[0]!.title };
  return pickNamed(
    { plural: "canaux", one: "le canal" },
    s.replace(/^@/, ""),
    rows.map((r) => ({ id: r.id, name: r.title, extra: r.username ? [r.username] : [] })),
  );
}

export async function resolvePersona(raw: unknown): Promise<Ref> {
  const rows = await prisma.persona.findMany({ select: { id: true, name: true } });
  return pickNamed({ plural: "personas", one: "la persona" }, str(raw), rows);
}

export async function resolveCampaign(raw: unknown): Promise<Ref> {
  const rows = await prisma.campaign.findMany({ select: { id: true, name: true } });
  return pickNamed({ plural: "campagnes", one: "la campagne" }, str(raw), rows);
}

export async function resolveBetCategory(raw: unknown): Promise<Ref> {
  const rows = await prisma.betCategory.findMany({ select: { id: true, name: true, key: true } });
  return pickNamed(
    { plural: "catégories de paris", one: "la catégorie de paris" },
    str(raw),
    rows.map((r) => ({ id: r.id, name: r.name, extra: [r.key, r.key.replace(/[-_]/g, " ")] })),
  );
}

/** Ordre par numéro (« l'ordre 3 », « 3 ») ou par identifiant. */
export async function resolveOrder(raw: unknown): Promise<Ref> {
  const s = str(raw).trim();
  const n = /^(?:n°|no|ordre|#)?\s*(\d{1,6})$/i.exec(s);
  const row = n
    ? await prisma.teamOrder.findFirst({ where: { number: Number(n[1]) }, select: { id: true, number: true } })
    : s
      ? await prisma.teamOrder.findUnique({ where: { id: s }, select: { id: true, number: true } })
      : null;
  if (!row) return { ok: false, result: fail(s ? `Je ne trouve pas l'ordre « ${s} ».` : "Quel ordre ?", "not_found") };
  return { ok: true, id: row.id, name: `Ordre n° ${row.number}` };
}

/** Demande au client : identifiant, sinon la demande en cours (« la question », « la demande »). */
export async function resolveHumanRequest(raw: unknown, statuses: string[] = ["PENDING"]): Promise<Ref> {
  const s = str(raw).trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(s) && !/^(courante|actuelle|derniere|dernière|current)$/i.test(s))
    return { ok: true, id: s, name: s };
  const row = await prisma.humanRequest.findFirst({
    where: { status: { in: statuses as never } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!row)
    return { ok: false, result: fail(statuses.includes("PENDING") ? "Aucune demande en attente." : "Aucune demande passée ou expirée à relancer.", "not_found") };
  return { ok: true, id: row.id, name: row.id };
}
