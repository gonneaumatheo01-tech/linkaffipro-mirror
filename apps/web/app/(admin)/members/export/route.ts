import { SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { listMembers, parseMemberFilters, type MemberRow } from "@/lib/members/query";
import { statusLabel } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";

export const dynamic = "force-dynamic";

/** Univers d'origine : celui de la campagne, sinon celui du canal ; vide sans demande d'adhésion. */
function universeOf(r: MemberRow): string {
  const v = r.origin?.campaignVertical ?? r.origin?.channelVertical ?? null;
  return v ? universeLabel(v) : "";
}

/** Export CSV des membres avec les mêmes filtres que la liste (sans pagination), dates en heure de Paris. */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseMemberFilters(sp);
  const { rows } = await listMembers(f, { all: true });
  const csv = toCsv(
    ["Identifiant Telegram", "Nom", "Pseudo", "Langue", "Canaux", "Pub d'origine", "Campagne d'origine", "Univers", "Statut (dernière demande)", "Arrivé le (Paris)", "Dernière activité (Paris)", "Clics", "Joueur", "Premier dépôt (FTD, Paris)", "Nombre de dépôts", "Dépôts (EUR)", "Niveau"],
    rows.map((r) => [
      r.telegramUserId,
      r.displayName,
      r.username ? `@${r.username}` : "",
      r.languageCode ?? "",
      r.channels.join(", "),
      r.source ?? "",
      r.origin?.campaignName ?? "",
      universeOf(r),
      r.status ? statusLabel("membership", r.status) : "",
      csvDate(r.firstSeenAt),
      csvDate(r.lastEventAt),
      r.clicks,
      r.isPlayer ? "oui" : "non",
      csvDate(r.ftdAt),
      r.depositCount,
      csvNumber(r.depositTotal),
      SPEND_LEVEL_LABELS[r.level],
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="membres-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
