import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma, type MembershipStatus } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/session";
import { approveMembershipAction, declineMembershipAction, saveRuleAction } from "./actions";

export const metadata: Metadata = { title: "Canal" };

const TABS = [
  { key: "rules", label: "Règles d'adhésion" },
  { key: "requests", label: "Demandes" },
  { key: "members", label: "Membres" },
] as const;

const STATUS_LABELS: Record<MembershipStatus, string> = {
  REQUESTED: "à valider",
  PENDING_GATE: "canaux à rejoindre",
  SCHEDULED: "planifiée",
  APPROVED: "acceptée",
  DECLINED: "refusée",
  LEFT: "parti",
  KICKED: "exclu",
  EXPIRED: "expirée",
  FAILED: "échec",
};

const PRESETS: Array<{ key: string; label: string; seconds: number | null }> = [
  { key: "immediate", label: "immédiat", seconds: 0 },
  { key: "1m", label: "1 minute", seconds: 60 },
  { key: "10m", label: "10 minutes", seconds: 600 },
  { key: "1h", label: "1 heure", seconds: 3600 },
  { key: "1d", label: "1 jour", seconds: 86400 },
  { key: "2d", label: "2 jours", seconds: 172800 },
  { key: "custom", label: "personnalisé (secondes)", seconds: null },
];

function presetFor(seconds: number): string {
  return PRESETS.find((p) => p.seconds === seconds)?.key ?? "custom";
}

function remaining(approveAt: Date | null, now: Date): string {
  if (!approveAt) return "—";
  const s = Math.round((approveAt.getTime() - now.getTime()) / 1000);
  if (s <= 0) return "imminent";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

function sourceLabel(source: unknown): string {
  const s = (source ?? {}) as { inviteLink?: { name?: string; adPlatform?: string | null } | null; joinedDirectly?: boolean };
  if (s.inviteLink?.name) return `${s.inviteLink.name}${s.inviteLink.adPlatform ? ` (${s.inviteLink.adPlatform})` : ""}`;
  if (s.joinedDirectly) return "entrée directe";
  return "lien inconnu";
}

export default async function ChannelPage({ params, searchParams }: PageProps<"/channels/[id]">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" && TABS.some((t) => t.key === sp.tab) ? sp.tab : "rules") as (typeof TABS)[number]["key"];
  const channel = await prisma.channel.findUnique({ where: { id }, include: { primaryBot: { select: { username: true } }, botAdmins: { where: { revokedAt: null }, include: { bot: { select: { username: true } } } } } });
  if (!channel) notFound();
  const now = new Date();
  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <>
      <PageHeader title={channel.title} description={`${channel.type === "CHANNEL" ? "Canal" : "Groupe"}${channel.vertical ? ` · ${VERTICAL_LABELS[channel.vertical]}` : ""} · langue ${channel.language}${channel.isTest ? " · TEST" : ""} · bot principal ${channel.primaryBot ? `@${channel.primaryBot.username}` : "aucun"} · bots administrateurs : ${channel.botAdmins.length ? channel.botAdmins.map((a) => `@${a.bot.username}`).join(", ") : "aucun"}`}>
        <Button variant="outline" size="sm" render={<Link href="/channels" />}>← Tous les canaux</Button>
      </PageHeader>
      <nav className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <Link key={t.key} href={`/channels/${channel.id}?tab=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Flash ok={sp.ok} error={sp.error} />
      {channel.botAdmins.length === 0 ? (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="pt-6 text-sm">Aucun de nos bots n&apos;est administrateur de ce canal : les demandes d&apos;adhésion ne peuvent pas être traitées. Ajoutez un bot comme administrateur avec le droit « Ajouter des membres ».</CardContent>
        </Card>
      ) : null}

      {tab === "rules" ? <RulesTab channelId={channel.id} selectCls={selectCls} /> : null}
      {tab === "requests" ? <RequestsTab channelId={channel.id} now={now} /> : null}
      {tab === "members" ? <MembersTab channelId={channel.id} /> : null}
    </>
  );
}

async function RulesTab({ channelId, selectCls }: { channelId: string; selectCls: string }) {
  const [rule, otherChannels] = await Promise.all([
    prisma.approvalRule.findFirst({ where: { channelId, isDefault: true } }),
    prisma.channel.findMany({ where: { id: { not: channelId }, isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true, isMediaLibrary: true } }),
  ]);
  const gateIds = new Set(Array.isArray(rule?.gateChannelIds) ? (rule!.gateChannelIds as string[]) : []);
  const reminders = Array.isArray(rule?.reminderAfterMinutes) ? (rule!.reminderAfterMinutes as number[]).join(", ") : "60, 1440";
  const preset = presetFor(rule?.delaySeconds ?? 0);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Règle par défaut du canal</CardTitle>
        <CardDescription>{rule ? "Appliquée à toute demande d'adhésion sans règle spécifique au lien." : "Aucune règle enregistrée : approbation immédiate, sans canaux à rejoindre."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveRuleAction} className="space-y-5">
          <input type="hidden" name="channelId" value={channelId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <select id="mode" name="mode" defaultValue={rule?.mode ?? "DELAY"} className={selectCls}>
                <option value="IMMEDIATE">Immédiat</option>
                <option value="DELAY">Après un délai</option>
                <option value="MANUAL">Validation manuelle</option>
              </select>
              <p className="text-xs text-muted-foreground">Manuel : la demande attend un clic « Accepter » dans l&apos;onglet Demandes.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delayPreset">Délai avant acceptation</Label>
              <select id="delayPreset" name="delayPreset" defaultValue={preset} className={selectCls}>
                {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <Input name="delayCustomSeconds" type="number" min={0} placeholder="Délai personnalisé en secondes" defaultValue={preset === "custom" ? rule?.delaySeconds : undefined} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Canaux à rejoindre d&apos;abord</Label>
            {otherChannels.length === 0 ? <p className="text-sm text-muted-foreground">Aucun autre canal connu.</p> : (
              <div className="grid gap-1 sm:grid-cols-2">
                {otherChannels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="gateChannelIds" value={c.id} defaultChecked={gateIds.has(c.id)} /> {c.title}{c.isMediaLibrary ? " (médiathèque)" : ""}
                  </label>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="gateMode">Exigence</Label>
                <select id="gateMode" name="gateMode" defaultValue={rule?.gateMode ?? "REQUIRED"} className={selectCls}>
                  <option value="REQUIRED">Obligatoire (accepté seulement après « J&apos;ai rejoint »)</option>
                  <option value="SOFT">Proposé (accepté après le délai dans tous les cas)</option>
                  <option value="NONE">Aucun</option>
                </select>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reminderAfterMinutes">Rappels (minutes après la demande)</Label>
              <Input id="reminderAfterMinutes" name="reminderAfterMinutes" defaultValue={reminders} placeholder="60, 1440" />
              <p className="text-xs text-muted-foreground">Envoyés seulement si le membre a accepté les messages du bot.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxReminders">Nombre maximal de rappels</Label>
              <Input id="maxReminders" name="maxReminders" type="number" min={0} max={10} defaultValue={rule?.maxReminders ?? 2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expireAfterHours">Expiration (heures, 0 = jamais)</Label>
              <Input id="expireAfterHours" name="expireAfterHours" type="number" min={0} defaultValue={rule?.expireAfterHours ?? 0} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expireAction">À l&apos;expiration</Label>
              <select id="expireAction" name="expireAction" defaultValue={rule?.expireAction ?? "KEEP"} className={selectCls}>
                <option value="KEEP">Laisser en attente</option>
                <option value="APPROVE">Accepter quand même</option>
                <option value="DECLINE">Refuser</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="sendAcceptedMessage" defaultChecked={rule?.sendAcceptedMessage ?? true} /> Envoyer un message « accepté » au membre
          </label>
          <Button type="submit">Enregistrer la règle</Button>
        </form>
      </CardContent>
    </Card>
  );
}

async function RequestsTab({ channelId, now }: { channelId: string; now: Date }) {
  const requests = await prisma.membership.findMany({
    where: { channelId, status: { in: ["REQUESTED", "PENDING_GATE", "SCHEDULED", "FAILED"] } },
    orderBy: { requestedAt: "desc" },
    take: 200,
    include: { member: { select: { firstName: true, lastName: true, username: true, telegramUserId: true } } },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Demandes en cours ({requests.length})</CardTitle>
        <CardDescription>Rechargez la page pour actualiser. Les demandes planifiées sont acceptées automatiquement à l&apos;échéance.</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande en attente.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Demandé le</TableHead>
                <TableHead>Acceptation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{[r.member.firstName, r.member.lastName].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.member.username ? `@${r.member.username}` : r.member.telegramUserId.toString()}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "FAILED" ? "destructive" : r.status === "SCHEDULED" ? "default" : "secondary"}>{STATUS_LABELS[r.status]}</Badge>
                    {r.lastError ? <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={r.lastError}>{r.lastError}</div> : null}
                  </TableCell>
                  <TableCell className="text-sm">{sourceLabel(r.source)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.requestedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.status === "SCHEDULED" ? `dans ${remaining(r.approveAt, now)}` : r.status === "PENDING_GATE" ? "après « J'ai rejoint »" : r.status === "REQUESTED" ? "manuelle" : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <form action={approveMembershipAction}>
                        <input type="hidden" name="membershipId" value={r.id} />
                        <input type="hidden" name="channelId" value={channelId} />
                        <Button type="submit" size="sm">Accepter maintenant</Button>
                      </form>
                      <form action={declineMembershipAction}>
                        <input type="hidden" name="membershipId" value={r.id} />
                        <input type="hidden" name="channelId" value={channelId} />
                        <Button type="submit" size="sm" variant="outline">Refuser</Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function MembersTab({ channelId }: { channelId: string }) {
  const members = await prisma.membership.findMany({
    where: { channelId, status: { in: ["APPROVED", "LEFT", "KICKED"] } },
    orderBy: [{ approvedAt: "desc" }, { requestedAt: "desc" }],
    take: 500,
    include: { member: { select: { id: true, firstName: true, lastName: true, username: true } } },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Membres ({members.filter((m) => m.status === "APPROVED").length} présents)</CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? <p className="text-sm text-muted-foreground">Aucun membre accepté pour l&apos;instant.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Accepté le</TableHead>
                <TableHead>Entré le</TableHead>
                <TableHead>Parti le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/members/${m.member.id}`} className="font-medium hover:underline">{[m.member.firstName, m.member.lastName].filter(Boolean).join(" ") || "—"}</Link>
                    <div className="text-xs text-muted-foreground">{m.member.username ? `@${m.member.username}` : ""}</div>
                  </TableCell>
                  <TableCell><Badge variant={m.status === "APPROVED" ? "default" : "secondary"}>{STATUS_LABELS[m.status]}</Badge></TableCell>
                  <TableCell className="text-sm">{sourceLabel(m.source)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(m.approvedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(m.joinedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(m.leftAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
