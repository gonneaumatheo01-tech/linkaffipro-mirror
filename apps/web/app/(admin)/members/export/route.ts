import { SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/members/csv";
import { listMembers, parseMemberFilters } from "@/lib/members/query";

export const dynamic = "force-dynamic";

/** Export CSV des membres avec les mêmes filtres que la liste (sans pagination). */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseMemberFilters(sp);
  const { rows } = await listMembers(f, { all: true });
  const csv = toCsv(
    ["Identifiant Telegram", "Nom", "Pseudo", "Langue", "Canaux", "Source", "Arrivé le", "Dernier événement", "Clics", "Joueur", "FTD", "Nombre de dépôts", "Dépôts (EUR)", "Niveau"],
    rows.map((r) => [
      r.telegramUserId,
      r.displayName,
      r.username ? `@${r.username}` : "",
      r.languageCode ?? "",
      r.channels.join(", "),
      r.source ?? "",
      r.firstSeenAt,
      r.lastEventAt,
      r.clicks,
      r.isPlayer ? "oui" : "non",
      r.ftdAt,
      r.depositCount,
      r.depositTotal.toFixed(2),
      SPEND_LEVEL_LABELS[r.level],
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="membres-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
