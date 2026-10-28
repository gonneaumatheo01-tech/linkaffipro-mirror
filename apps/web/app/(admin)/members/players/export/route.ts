import { prisma, audit, ourPlayers, type Prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { displayName } from "@/lib/members/query";
import { campaignPlayerWhere } from "@/lib/campaigns/attribution";
import { campaignScope } from "@/lib/dashboard/campaign-scope";
import { periodEnd, periodLabel, periodStart, resolvePeriod } from "@/lib/periods";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = {
  postback: "retour du casino (identifiant de suivi reçu)",
  time_match: "rapprochement horaire",
  linkaffi: "clic Link Affi",
  aggregate: "total du jour Link Affi (offre sans fiche joueur)",
};

/**
 * Export CSV des joueurs : identifiant, inscription, premier dépôt (FTD), dépôts, revenu net (NGR), membre rattaché,
 * source du rattachement. En-têtes avec les mots de l'interface (premier dépôt, revenu net, identifiant de suivi).
 * - Par défaut : « nos » joueurs seulement (clic à nous, ou offre Link Affi liée à une de nos campagnes).
 * - `campaignId` : joueurs de cette campagne (même règle que la fiche campagne).
 * - `range` / `from` / `to` : ajoute la colonne « Revenu net (NGR de la période, €) » (somme des variations datées).
 * - `scope=all` (ADMIN, depuis Réglages → Connecteurs) : export brut de TOUS les joueurs Link Affi, pour diagnostic.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const raw = sp.get("scope") === "all";
  if (raw && user.role !== "ADMIN")
    return new Response("Export réservé aux administrateurs.", { status: 403 });
  const campaignId = sp.get("campaignId") ?? "";
  const withPeriod = sp.has("range") || sp.has("from");
  const period = withPeriod ? resolvePeriod(Object.fromEntries(sp.entries())) : null;

  const and: Prisma.PlayerWhereInput[] = [];
  if (!raw) and.push(await ourPlayers());
  if (campaignId)
    and.push(campaignPlayerWhere(await campaignScope(campaignId)) as Prisma.PlayerWhereInput);
  const where: Prisma.PlayerWhereInput = and.length ? { AND: and } : {};

  const players = await prisma.player.findMany({
    where,
    orderBy: [{ registeredAt: "desc" }, { createdAt: "desc" }],
    take: 50_000,
    include: {
      affiliateCampaign: { select: { name: true, program: { select: { name: true } } } },
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          telegramUserId: true,
          anonymizedAt: true,
        },
      },
    },
  });
  const ngrInPeriod = new Map<string, number>();
  if (period) {
    const sums = await prisma.playerEvent.groupBy({
      by: ["playerId"],
      where: {
        type: "NGR",
        occurredAt: { gte: periodStart(period), lt: periodEnd(period) },
        player: where,
      },
      _sum: { amount: true },
    });
    for (const s of sums) ngrInPeriod.set(s.playerId, Number(s._sum.amount ?? 0));
  }
  if (raw)
    await audit({
      userId: user.id,
      action: "linkaffi.players_raw_export",
      metadata: { rows: players.length },
    });

  const headers = [
    "Identifiant joueur",
    "Programme",
    "Campagne Link Affi",
    "Inscription (Paris)",
    "Premier dépôt (FTD, Paris)",
    "Montant du premier dépôt (€)",
    "Nombre de dépôts",
    "Redépôts",
    "Dépôts (€)",
    "Revenu net total (NGR, €)",
  ];
  // « NGR de la période » reste dans l'en-tête (terme technique entre parenthèses, relu par les tests d'export).
  if (period) headers.push(`Revenu net (NGR de la période, €) — ${periodLabel(period)}`);
  headers.push(
    "Devise",
    "Statut",
    "Dernier événement (Paris)",
    "Identifiant de suivi (sub-ID)",
    "Source du rattachement",
    "Membre rattaché",
    "Pseudo",
    "Identifiant Telegram",
  );
  const csv = toCsv(
    headers,
    players.map((p) => [
      p.externalPlayerId,
      p.affiliateCampaign.program.name,
      p.affiliateCampaign.name,
      csvDate(p.registeredAt),
      csvDate(p.ftdAt),
      p.ftdAmount === null ? "" : csvNumber(Number(p.ftdAmount)),
      p.depositCount,
      p.redepositCount,
      csvNumber(Number(p.depositTotal)),
      csvNumber(Number(p.ngr)),
      ...(period ? [csvNumber(ngrInPeriod.get(p.id) ?? 0)] : []),
      p.currency,
      p.status ?? "",
      csvDate(p.lastEventAt),
      p.subId ?? "",
      p.subIdSource ? (SOURCE[p.subIdSource] ?? p.subIdSource) : "",
      p.member ? displayName(p.member) : "",
      p.member?.username && !p.member.anonymizedAt ? `@${p.member.username}` : "",
      p.member && !p.member.anonymizedAt ? p.member.telegramUserId.toString() : "",
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  const name = raw ? `joueurs-linkaffi-tous-${date}.csv` : `joueurs-${date}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
