import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { displayName } from "@/lib/members/query";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { postback: "postback (identifiant de suivi reçu)", time_match: "rapprochement horaire", linkaffi: "clic Link Affi" };

/** Export CSV des joueurs : identifiant, inscription, FTD, dépôts, NGR, membre rattaché, source du rattachement. */
export async function GET() {
  await requireUser();
  const players = await prisma.player.findMany({
    orderBy: [{ registeredAt: "desc" }, { createdAt: "desc" }],
    take: 50_000,
    include: {
      affiliateCampaign: { select: { name: true, program: { select: { name: true } } } },
      member: { select: { id: true, firstName: true, lastName: true, username: true, telegramUserId: true, anonymizedAt: true } },
    },
  });
  const csv = toCsv(
    ["Identifiant joueur", "Programme", "Campagne", "Inscription (Paris)", "FTD (Paris)", "Montant FTD (€)", "Nombre de dépôts", "Redépôts", "Dépôts (€)", "NGR (€)", "Devise", "Statut", "Dernier événement (Paris)", "Identifiant de suivi (sub-ID)", "Source du rattachement", "Membre rattaché", "Pseudo", "Identifiant Telegram"],
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
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="joueurs-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
