import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { approveMembershipAction, declineMembershipAction, saveRuleAction } from "./actions";
import { SequencesTab } from "./sequences/sequences-tab";
import { BestHoursTab } from "./best-hours-tab";

export const metadata: Metadata = { title: "Canal" };

const TABS = [
  { key: "rules", label: "Règles d'adhésion" },
  { key: "requests", label: "Demandes" },
  { key: "members", label: "Membres" },
  { key: "sequences", label: "Messages du bot" },
  { key: "besthours", label: "Meilleurs horaires" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TAB_HELP: Record<TabKey, string> = {
  rules:
    "Réglez ici comment le bot accepte les personnes qui demandent à rejoindre ce canal : tout de suite, après un délai, ou à la main.",
  requests:
    "Les demandes d'adhésion en attente. Vous pouvez accepter ou refuser à la main ; les demandes programmées sont acceptées toutes seules à l'heure prévue.",
  members:
    "Les membres acceptés dans ce canal, avec leur origine (la pub ou le lien qui les a amenés).",
  sequences:
    "Les messages privés que le bot envoie aux membres (accueil, rappel, accepté…). Modifiez le texte, ajoutez une langue, envoyez-vous un test.",
  besthours:
    "Les jours et heures où vos messages marchent le mieux dans ce canal (clics, réactions), par catégorie. Le créneau recommandé est proposé dans le formulaire de message.",
};

const PRESETS: Array<{ key: string; label: string; seconds: number | null }> = [
  { key: "immediate", label: "immédiat", seconds: 0 },
  { key: "1m", label: "1 minute", seconds: 60 },
  { key: "10m", label: "10 minutes", seconds: 600 },
  { key: "1h", label: "1 heure", seconds: 3600 },
  { key: "1d", label: "1 jour", seconds: 86400 },
  { key: "2d", label: "2 jours", seconds: 172800 },
  { key: "custom", label: "personnalisé (en secondes)", seconds: null },
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
  const s = (source ?? {}) as {
    inviteLink?: { name?: string; adPlatform?: string | null } | null;
    joinedDirectly?: boolean;
  };
  if (s.inviteLink?.name)
    return `${s.inviteLink.name}${s.inviteLink.adPlatform ? ` (${statusLabel("adPlatform", s.inviteLink.adPlatform)})` : ""}`;
  if (s.joinedDirectly) return "entrée directe";
  return "lien inconnu";
}

function memberName(m: { firstName: string | null; lastName: string | null }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || "—";
}

export default async function ChannelPage({ params, searchParams }: PageProps<"/channels/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (
    typeof sp.tab === "string" && TABS.some((t) => t.key === sp.tab) ? sp.tab : "rules"
  ) as TabKey;
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      primaryBot: { select: { username: true } },
      botAdmins: { where: { revokedAt: null }, include: { bot: { select: { username: true } } } },
    },
  });
  if (!channel) notFound();
  const now = new Date();
  const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";

  return (
    <>
      <PageHeader
        title={channel.title}
        description={`${statusLabel("chatType", channel.type)}${channel.vertical ? ` · ${VERTICAL_LABELS[channel.vertical]}` : ""} · langue ${channel.language}${channel.isTest ? " · canal de test" : ""} · bot principal ${channel.primaryBot ? `@${channel.primaryBot.username}` : "aucun"} · bots administrateurs : ${channel.botAdmins.length ? channel.botAdmins.map((a) => `@${a.bot.username}`).join(", ") : "aucun"}`}
        help={TAB_HELP[tab]}
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/channels" />}
        >
          ← Tous les canaux
        </Button>
      </PageHeader>
      <nav aria-label="Onglets du canal" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/channels/${channel.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              tab === t.key
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Flash ok={sp.ok} error={sp.error} />
      {channel.botAdmins.length === 0 ? (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="pt-6 text-sm">
            Aucun de nos bots n&apos;est administrateur de ce canal : les demandes d&apos;adhésion
            ne peuvent pas être traitées. Dans Telegram, ajoutez un bot comme administrateur avec le
            droit « Ajouter des membres ».
          </CardContent>
        </Card>
      ) : null}

      {tab === "rules" ? <RulesTab channelId={channel.id} selectCls={selectCls} /> : null}
      {tab === "requests" ? <RequestsTab channelId={channel.id} now={now} /> : null}
      {tab === "members" ? <MembersTab channelId={channel.id} /> : null}
      {tab === "besthours" ? (
        <BestHoursTab
          channelId={channel.id}
          categoryParam={typeof sp.cat === "string" ? sp.cat : undefined}
        />
      ) : null}
      {tab === "sequences" ? (
        <SequencesTab
          channelId={channel.id}
          channelTitle={channel.title}
          open={typeof sp.open === "string" ? sp.open : undefined}
          telegramLinked={Boolean(me.telegramUserId)}
        />
      ) : null}
    </>
  );
}

async function RulesTab({ channelId, selectCls }: { channelId: string; selectCls: string }) {
  const [rule, otherChannels] = await Promise.all([
    prisma.approvalRule.findFirst({ where: { channelId, isDefault: true } }),
    prisma.channel.findMany({
      where: { id: { not: channelId }, isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, isMediaLibrary: true },
    }),
  ]);
  const gateIds = new Set(
    Array.isArray(rule?.gateChannelIds) ? (rule!.gateChannelIds as string[]) : [],
  );
  const reminders = Array.isArray(rule?.reminderAfterMinutes)
    ? (rule!.reminderAfterMinutes as number[]).join(", ")
    : "60, 1440";
  const preset = presetFor(rule?.delaySeconds ?? 0);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Règle par défaut du canal</CardTitle>
        <CardDescription>
          {rule
            ? "Appliquée à toute demande d'adhésion sans règle propre au lien d'entrée."
            : "Aucune règle enregistrée : pour l'instant, les demandes sont acceptées immédiatement, sans canaux à rejoindre."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveRuleAction} className="space-y-5">
          <input type="hidden" name="channelId" value={channelId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mode">
                Mode d&apos;acceptation{" "}
                <HelpTip label="Aide : mode d'acceptation">
                  Immédiat : accepté tout de suite. Après un délai : accepté automatiquement à la
                  fin du délai (le temps de lire le message d&apos;accueil). Validation manuelle :
                  vous acceptez à la main dans l&apos;onglet Demandes.
                </HelpTip>
              </Label>
              <select
                id="mode"
                name="mode"
                defaultValue={rule?.mode ?? "DELAY"}
                className={selectCls}
              >
                <option value="IMMEDIATE">Immédiat</option>
                <option value="DELAY">Après un délai</option>
                <option value="MANUAL">Validation manuelle</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delayPreset">Délai avant acceptation</Label>
              <select
                id="delayPreset"
                name="delayPreset"
                defaultValue={preset}
                className={selectCls}
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Input
                name="delayCustomSeconds"
                aria-label="Délai personnalisé en secondes"
                type="number"
                min={0}
                placeholder="Délai personnalisé en secondes"
                defaultValue={preset === "custom" ? rule?.delaySeconds : undefined}
                className="max-md:h-10"
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              Canaux à rejoindre d&apos;abord{" "}
              <HelpTip label="Aide : canaux à rejoindre">
                Le bot demande au membre de rejoindre ces autres canaux avant de l&apos;accepter ici
                (bouton « J&apos;ai rejoint »). Pratique pour faire grossir plusieurs canaux à la
                fois.
              </HelpTip>
            </p>
            {otherChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun autre canal connu.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {otherChannels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="gateChannelIds"
                      value={c.id}
                      defaultChecked={gateIds.has(c.id)}
                    />{" "}
                    {c.title}
                    {c.isMediaLibrary ? " (médiathèque)" : ""}
                  </label>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="gateMode">Exigence</Label>
                <select
                  id="gateMode"
                  name="gateMode"
                  defaultValue={rule?.gateMode ?? "REQUIRED"}
                  className={selectCls}
                >
                  <option value="REQUIRED">
                    Obligatoire (accepté seulement après « J&apos;ai rejoint »)
                  </option>
                  <option value="SOFT">Proposé (accepté après le délai dans tous les cas)</option>
                  <option value="NONE">Aucune</option>
                </select>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reminderAfterMinutes">Rappels (minutes après la demande)</Label>
              <Input
                id="reminderAfterMinutes"
                name="reminderAfterMinutes"
                defaultValue={reminders}
                placeholder="60, 1440"
                className="max-md:h-10"
              />
              <p className="text-xs text-muted-foreground">
                Exemple : « 60, 1440 » = un rappel après 1 heure, un autre après 1 jour. Envoyés
                seulement si le membre a accepté les messages du bot.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxReminders">Nombre maximal de rappels</Label>
              <Input
                id="maxReminders"
                name="maxReminders"
                type="number"
                min={0}
                max={10}
                defaultValue={rule?.maxReminders ?? 2}
                className="max-md:h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expireAfterHours">
                Expiration de la demande (heures, 0 = jamais)
              </Label>
              <Input
                id="expireAfterHours"
                name="expireAfterHours"
                type="number"
                min={0}
                defaultValue={rule?.expireAfterHours ?? 0}
                className="max-md:h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expireAction">À l&apos;expiration</Label>
              <select
                id="expireAction"
                name="expireAction"
                defaultValue={rule?.expireAction ?? "KEEP"}
                className={selectCls}
              >
                <option value="KEEP">Laisser en attente</option>
                <option value="APPROVE">Accepter quand même</option>
                <option value="DECLINE">Refuser</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="sendAcceptedMessage"
              defaultChecked={rule?.sendAcceptedMessage ?? true}
            />{" "}
            Envoyer un message « accepté » au membre
          </label>
          <Button type="submit" className="max-md:h-10">
            Enregistrer la règle
          </Button>
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
    include: {
      member: { select: { firstName: true, lastName: true, username: true, telegramUserId: true } },
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Demandes en cours ({requests.length})</CardTitle>
        <CardDescription>
          Rechargez la page pour actualiser. Les demandes « Acceptation programmée » sont acceptées
          automatiquement à l&apos;heure prévue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <EmptyState
            title="Aucune demande en attente"
            description="Les personnes qui demandent à rejoindre ce canal apparaîtront ici. Partagez un lien d'entrée pour en recevoir."
            action={{ href: "/links", label: "Voir les liens", variant: "outline" }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden md:table-cell">Origine</TableHead>
                <TableHead className="hidden md:table-cell">Demandé le</TableHead>
                <TableHead className="hidden md:table-cell">Acceptation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{memberName(r.member)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.member.username
                        ? `@${r.member.username}`
                        : r.member.telegramUserId.toString()}
                    </div>
                    <div className="text-xs text-muted-foreground md:hidden">
                      {fmtDate(r.requestedAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="membership" value={r.status} />
                    {r.lastError ? (
                      <div
                        className="mt-1 max-w-xs truncate text-xs text-destructive"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {sourceLabel(r.source)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {fmtDate(r.requestedAt)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">
                    {r.status === "SCHEDULED"
                      ? `dans ${remaining(r.approveAt, now)}`
                      : r.status === "PENDING_GATE"
                        ? "après « J'ai rejoint »"
                        : r.status === "REQUESTED"
                          ? "à la main"
                          : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                      <form action={approveMembershipAction}>
                        <input type="hidden" name="membershipId" value={r.id} />
                        <input type="hidden" name="channelId" value={channelId} />
                        <Button type="submit" size="sm" className="max-md:h-10">
                          Accepter maintenant
                        </Button>
                      </form>
                      <form action={declineMembershipAction}>
                        <input type="hidden" name="membershipId" value={r.id} />
                        <input type="hidden" name="channelId" value={channelId} />
                        <ConfirmSubmit
                          size="sm"
                          variant="outline"
                          className="max-md:h-10"
                          message={`Refuser la demande de ${memberName(r.member)} ? La personne ne pourra pas entrer dans le canal et devra refaire une demande.`}
                        >
                          Refuser
                        </ConfirmSubmit>
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
        <CardTitle className="text-base">
          Membres ({members.filter((m) => m.status === "APPROVED").length} présents)
        </CardTitle>
        <CardDescription>
          Les 500 derniers membres. La liste complète, avec recherche et export, est dans la page
          Membres.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <EmptyState
            title="Aucun membre accepté pour l'instant"
            description="Dès qu'une demande est acceptée, le membre apparaît ici avec son origine."
            action={{
              href: `/channels/${channelId}?tab=requests`,
              label: "Voir les demandes",
              variant: "outline",
            }}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden md:table-cell">Origine</TableHead>
                <TableHead className="hidden md:table-cell">Accepté le</TableHead>
                <TableHead className="hidden lg:table-cell">Entré le</TableHead>
                <TableHead className="hidden lg:table-cell">Parti le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/members/${m.member.id}`} className="font-medium hover:underline">
                      {memberName(m.member)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {m.member.username ? `@${m.member.username}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="membership" value={m.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {sourceLabel(m.source)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {fmtDate(m.approvedAt)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {fmtDate(m.joinedAt)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {fmtDate(m.leftAt)}
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
