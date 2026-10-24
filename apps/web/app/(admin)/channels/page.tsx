import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, RefreshCw } from "lucide-react";
import { ACTIVE_CHANNEL_BOT_WHERE, prisma } from "@linkaffipro/db";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { Flash } from "@/components/admin/flash";
import { HelpTip } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { UniverseDot } from "@/components/admin/universe-dot";
import { BotPills } from "@/components/channels/bot-pills";
import { ChannelSettingsForm } from "@/components/channels/channel-settings-form";
import { ChannelStatePills } from "@/components/channels/channel-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { isAccountSessionActive } from "@/lib/channels/account-import";
import {
  entrySentence,
  entryShortWithExceptions,
  exceptionsCountLabel,
} from "@/lib/channels/entry-rule";
import { loadChannelList, type ChannelListItem } from "@/lib/channels/queries";
import { TRACKED_MEMBERS_HELP } from "@/lib/channels/requests";
import { channelTabHref } from "@/lib/channels/tabs";
import { fmtDate, fmtNum } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";
import { recheckAllRightsAction, updateChannelAction } from "./actions";
import { AddChannelDialog } from "./add-channel-dialog";

export const metadata: Metadata = { title: "Canaux" };

/** Détail d'un canal dans le volet : l'essentiel, le lien vers la fiche, puis ses réglages. */
function ChannelDetail({
  c,
  titles,
  bots,
}: {
  c: ChannelListItem;
  titles: Record<string, string>;
  bots: Array<{ id: string; username: string }>;
}) {
  return (
    <div className="space-y-6">
      <Link
        href={`/channels/${c.id}`}
        className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between max-md:h-10")}
      >
        Ouvrir la fiche du canal
        <ArrowRight aria-hidden />
      </Link>
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="flex items-center gap-1 text-note text-muted-foreground">
            Membres suivis
            <HelpTip label="Aide : membres suivis">{TRACKED_MEMBERS_HELP}</HelpTip>
          </dt>
          <dd className="text-title tabular-nums">{fmtNum(c.members)}</dd>
        </div>
        <div>
          <dt className="text-note text-muted-foreground">Demandes en cours</dt>
          <dd className="text-title tabular-nums">
            {c.pending > 0 ? (
              <Link
                href={channelTabHref(c.id, "requests")}
                className="text-brand-ink underline-offset-4 hover:underline"
              >
                {fmtNum(c.pending)}
              </Link>
            ) : (
              "0"
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-note text-muted-foreground">Qui peut entrer et quand</dt>
          <dd className="mt-0.5">
            {entrySentence(c.rule, titles)}
            {c.exceptions > 0 ? (
              <span className="mt-0.5 block text-note text-muted-foreground">
                Sauf {exceptionsCountLabel(c.exceptions)} selon la provenance (fiche du canal).
              </span>
            ) : null}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-note text-muted-foreground">Bots administrateurs</dt>
          <dd className="mt-1">
            <BotPills admins={c.botAdmins} max={10} />
            {c.botAdmins.length === 0 ? (
              <p className="mt-1 text-note text-muted-foreground">
                Dans Telegram : canal → Administrateurs → Ajouter un administrateur → choisissez un
                de nos bots.
              </p>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="border-t border-border pt-6">
        <ChannelSettingsForm
          channel={c}
          bots={bots}
          action={updateChannelAction}
          returnTo="/channels"
        />
      </div>
      <p className="text-note text-muted-foreground">
        {statusLabel("chatType", c.type)} · identifiant Telegram {c.telegramChatId} · détecté le{" "}
        {fmtDate(c.createdAt)}
      </p>
    </div>
  );
}

export default async function ChannelsPage({ searchParams }: PageProps<"/channels">) {
  const sp = await searchParams;
  const [channels, bots, accountActive] = await Promise.all([
    loadChannelList(),
    // Bots proposés (bot principal, bot à qui transférer un message, exemple de l'aide) : jamais un assistant de
    // conversation (phase 17). Les bots administrateurs d'un canal restent tous affichés.
    prisma.bot.findMany({
      where: ACTIVE_CHANNEL_BOT_WHERE,
      orderBy: { name: "asc" },
      select: { id: true, username: true, name: true, vertical: true },
    }),
    isAccountSessionActive().catch(() => false),
  ]);
  const latestId = channels[0]?.id ?? null;
  const exampleBot = bots[0]?.username ?? "votre_bot";
  const titles = Object.fromEntries(channels.map((c) => [c.id, c.title]));
  const botOptions = bots.map((b) => ({ id: b.id, username: b.username }));

  const rows: DataTableRow[] = channels.map((c) => {
    const short = entryShortWithExceptions(c.rule, c.exceptions);
    return {
      id: c.id,
      detailTitle: c.title,
      detailDescription: c.username ? `@${c.username}` : statusLabel("chatType", c.type),
      cells: {
        channel: (
          <span className="flex min-w-0 items-center gap-2.5">
            <UniverseDot universe={c.vertical} />
            <span className="min-w-0">
              <span className="block truncate">{c.title}</span>
              <span className="block text-note font-normal text-muted-foreground">
                {c.username ? `@${c.username}` : statusLabel("chatType", c.type)}
              </span>
              <span className="mt-1 block md:hidden">
                <ChannelStatePills channel={c} />
              </span>
            </span>
          </span>
        ),
        members: fmtNum(c.members),
        bots: <BotPills admins={c.botAdmins} />,
        rule: (
          <span className={cn(!c.rule || c.rule.isActive === false ? "text-warning" : undefined)}>
            {short}
          </span>
        ),
        state: <ChannelStatePills channel={c} />,
      },
      sortValues: {
        channel: c.title.toLocaleLowerCase("fr"),
        members: c.members,
        bots: c.botAdmins.length,
        rule: short,
        state: (c.isActive ? 2 : 0) + (c.pending > 0 ? 1 : 0),
      },
      detail: <ChannelDetail c={c} titles={titles} bots={botOptions} />,
    };
  });

  return (
    <>
      <PageHeader
        title="Canaux"
        description="Vos canaux et groupes Telegram, et la façon dont le bot accueille les membres."
        help="Un canal apparaît tout seul dès qu'un de nos bots en devient administrateur. Cliquez sur une ligne pour le régler. Membres suivis : les personnes entrées depuis qu'un de nos bots gère le canal."
        primaryAction={
          <AddChannelDialog
            bots={bots.map((b) => ({ username: b.username, name: b.name }))}
            latestId={latestId}
            canImportFromAccount={accountActive}
          />
        }
        secondaryActions={
          <>
            {accountActive ? (
              <Link
                href="/channels/import"
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                <Download aria-hidden />
                Importer tous mes canaux
              </Link>
            ) : null}
            {channels.length > 0 ? (
              <form action={recheckAllRightsAction}>
                <Button
                  type="submit"
                  variant="outline"
                  className="max-md:h-10"
                  title="Relit les administrateurs de chaque canal avec chacun de nos bots et met la liste à jour"
                >
                  <RefreshCw aria-hidden />
                  Re-vérifier les droits des bots
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <DataTable
        label="Canaux"
        panelSize="lg"
        columns={[
          {
            key: "channel",
            header: "Canal",
            className: "whitespace-normal md:min-w-48 md:max-w-72",
          },
          { key: "members", header: "Membres suivis", align: "right" },
          { key: "bots", header: "Bots administrateurs", hideOnMobile: true },
          {
            key: "rule",
            header: "Qui peut entrer",
            hideOnMobile: true,
            className: "min-w-44 whitespace-normal",
          },
          { key: "state", header: "État", hideOnMobile: true, className: "whitespace-normal" },
        ]}
        rows={rows}
        empty={{
          title: "Aucun canal pour l'instant",
          description: `Dans Telegram, ouvrez le canal → Administrateurs → Ajouter un administrateur → choisissez @${exampleBot}. Le canal apparaît ici en quelques secondes. Le bot était déjà administrateur ? Cliquez « Ajouter un canal existant ».`,
          action: { href: "/settings/bots", label: "Voir les bots", variant: "outline" },
        }}
      />
    </>
  );
}
