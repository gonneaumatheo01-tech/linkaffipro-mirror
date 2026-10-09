import Link from "next/link";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { addDays, parisDayKey, parisHour, toParisLocalInput } from "@/lib/posts/time";
import type { PostStatus } from "@linkaffipro/db";

export type CalendarPost = {
  id: string;
  scheduledAt: Date | null;
  status: PostStatus;
  text: string;
  channel: { title: string };
  category: { name: string; color: string } | null;
};

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6 h → 23 h

/** Calendrier de la semaine (heures de 6 h à 23 h, Europe/Paris) ; défilement horizontal sur téléphone. */
export function WeekCalendar({ weekStart, posts }: { weekStart: Date; posts: CalendarPost[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = parisDayKey(new Date());
  const byCell = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const h = Math.min(23, Math.max(6, parisHour(p.scheduledAt)));
    const key = `${parisDayKey(p.scheduledAt)}:${h}`;
    byCell.set(key, [...(byCell.get(key) ?? []), p]);
  }
  const fmtDay = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  });
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-xs">
        <caption className="sr-only">
          Messages programmés de la semaine, par jour et par heure
        </caption>
        <thead>
          <tr className="bg-muted/50">
            <th scope="col" className="w-12 border-r p-1 text-muted-foreground">
              <abbr title="Heure (Paris)">h</abbr>
            </th>
            {days.map((d) => (
              <th
                key={d.toISOString()}
                scope="col"
                className={`border-r p-1 font-medium ${parisDayKey(d) === todayKey ? "bg-primary/10" : ""}`}
              >
                {fmtDay.format(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h} className="border-t">
              <th
                scope="row"
                className="border-r p-1 text-center align-top font-normal text-muted-foreground"
              >
                {h} h
              </th>
              {days.map((d) => {
                const cell = byCell.get(`${parisDayKey(d)}:${h}`) ?? [];
                return (
                  <td
                    key={d.toISOString()}
                    className={`h-10 border-r p-0.5 align-top ${parisDayKey(d) === todayKey ? "bg-primary/5" : ""}`}
                  >
                    {cell.map((p) => (
                      <Link
                        key={p.id}
                        href={`/messages/${p.id}`}
                        className="mb-0.5 block truncate rounded px-1 py-0.5 hover:bg-accent"
                        style={{ borderLeft: `3px solid ${p.category?.color ?? "#94a3b8"}` }}
                        title={`${p.channel.title} — ${statusLabel("post", p.status)}${p.category ? ` — ${p.category.name}` : ""}`}
                      >
                        <span className="text-muted-foreground">
                          {toParisLocalInput(p.scheduledAt!).slice(11)}
                        </span>{" "}
                        {p.channel.title}
                        <StatusBadge
                          kind="post"
                          value={p.status}
                          className="ml-1 h-4 px-1 py-0 text-[9px]"
                        />
                      </Link>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
