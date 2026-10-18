import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, RefreshCw, Settings2, TriangleAlert } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { Flash } from "@/components/admin/flash";
import { HelpTip } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { SidePanel } from "@/components/admin/side-panel";
import { UniverseDot } from "@/components/admin/universe-dot";
import { ChannelSettingsForm } from "@/components/channels/channel-settings-form";
import { ChannelStatePills } from "@/components/channels/channel-state";
import { ChannelTabs } from "@/components/channels/channel-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { actingBotNotice } from "@/lib/channels/acting-bot-notice";
import { entryRuleFromRow } from "@/lib/channels/entry-rule";
import { loadChannelCounts } from "@/lib/channels/queries";
import { TRACKED_MEMBERS_HELP, trackedMembersLabel } from "@/lib/channels/requests";
import { bestSlotsHref, parseChannelTab } from "@/lib/channels/tabs";
import { requireUser } from "@/lib/session";
import { statusLabel } from "@/lib/status-badges";
import { updateChannelAction } from "../actions";
import { recheckRightsAction } from "./actions";
import { SequencesTab } from "./sequences/sequences-tab";
import { MembersTab } from "./tabs/members";
import { RequestsTab } from "./tabs/requests";
import { RulesTab } from "./tabs/rules";

export const metadata: Metadata = { title: "Canal" };

/**
 * Fiche d'un canal en langage courant : en-tête (univers, membres, bot principal, état, « Réglages du canal » dans
 * un volet), puis les onglets « Qui peut entrer et quand », « Ce que dit le bot », « Demandes » (avec le nombre en
 * cours) et « Membres ». Les meilleurs créneaux de publication sont dans le calendrier des messages.
 */
export default async function ChannelPage({ params, searchParams }: PageProps<"/channels/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = parseChannelTab(sp.tab);
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      primaryBot: { select: { username: true, vertical: true, isActive: true, mode: true } },
      botAdmins: {
        where: { revokedAt: null },
        orderBy: { detectedAt: "asc" },
        include: { bot: { select: { username: true, isActive: true, mode: true } } },
      },
    },
  });
  if (!channel) notFound();
  const [counts, bots] = await Promise.all([
    loadChannelCounts(channel.id),
    // « Bot principal » : jamais un bot assistant de conversation (phase 17).
    prisma.bot.findMany({
      where: { isActive: true, mode: "STANDARD" },
      orderBy: { name: "asc" },
      select: { id: true, username: true },
    }),
  ]);
  const now = new Date();
  // Tous les bots administrateurs sont listés dans les réglages ; le bot qui agit pour le canal (accueil, demandes,
  // « Ce que dit le bot ») n'est jamais un assistant de conversation (phase 17). L'en-tête montre le bot principal et
  // les bots normaux comme avant (même désactivés), jamais un assistant.
  const admins = channel.botAdmins.map((a) => a.bot.username);
  const standardAdmins = channel.botAdmins.filter((a) => a.bot.mode === "STANDARD");
  const actingAdmins = standardAdmins.filter((a) => a.bot.isActive).map((a) => a.bot.username);
  const shownPrimary = channel.primaryBot?.mode === "STANDARD" ? channel.primaryBot : null;
  const botName =
    (shownPrimary?.isActive ? shownPrimary.username : null) ?? actingAdmins[0] ?? null;
  const notice = actingBotNotice(channel.botAdmins.map((a) => a.bot));
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const parts: React.ReactNode[] = [
    statusLabel("chatType", channel.type),
    channel.username ? `@${channel.username}` : null,
    <span key="members" className="inline-flex items-center gap-1">
      {trackedMembersLabel(counts.members)}
      <HelpTip label="Aide : membres suivis">{TRACKED_MEMBERS_HELP}</HelpTip>
    </span>,
    shownPrimary
      ? `bot principal @${shownPrimary.username}`
      : standardAdmins.length > 0
        ? `bot @${standardAdmins[0]!.bot.username}`
        : null,
  ].filter(Boolean);
  const description = parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? " · " : null}
      {part}
    </Fragment>
  ));

  const settingsPanel = (
    <SidePanel
      size="lg"
      title="Réglages du canal"
      description={channel.title}
      trigger={
        <Button variant="outline" className="max-md:h-10">
          <Settings2 aria-hidden />
          Réglages du canal
        </Button>
      }
    >
      <div className="space-y-6">
        <ChannelSettingsForm
          channel={channel}
          bots={bots}
          action={updateChannelAction}
          returnTo={`/channels/${channel.id}?tab=${tab}`}
        />
        <div className="space-y-1 border-t border-border pt-6">
          <p className="text-body font-medium text-foreground">Bots administrateurs</p>
          <p className="text-body text-muted-foreground">
            {admins.length > 0 ? admins.map((u) => `@${u}`).join(", ") : "Aucun"}
          </p>
          <p className="text-note text-muted-foreground">
            Identifiant Telegram {channel.telegramChatId.toString()}
          </p>
        </div>
      </div>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        title={channel.title}
        backHref="/channels"
        backLabel="Tous les canaux"
        meta={
          <>
            <UniverseDot universe={channel.vertical} variant="pill" />
            <ChannelStatePills channel={channel} />
          </>
        }
        description={description}
        help={
          <Link
            href={bestSlotsHref(channel.id)}
            className="inline-flex min-h-8 items-center gap-1.5 font-medium text-brand-ink underline-offset-4 hover:underline max-md:min-h-10"
          >
            <CalendarClock aria-hidden className="size-4" />
            Voir les meilleurs créneaux dans le calendrier
          </Link>
        }
        secondaryActions={
          <>
            <form action={recheckRightsAction}>
              <input type="hidden" name="channelId" value={channel.id} />
              <input type="hidden" name="tab" value={tab} />
              <Button
                type="submit"
                variant="outline"
                className="max-md:h-10"
                title="Relit les administrateurs du canal avec chacun de nos bots et met la liste à jour"
              >
                <RefreshCw aria-hidden />
                Re-vérifier les droits des bots
              </Button>
            </form>
            {settingsPanel}
          </>
        }
      />
      {notice ? (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert aria-hidden />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.sentences.join(" ")}</AlertDescription>
        </Alert>
      ) : null}
      {admins.length === 0 ? (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert aria-hidden />
          <AlertTitle>Aucun de nos bots n&apos;est administrateur de ce canal</AlertTitle>
          <AlertDescription>
            Les demandes ne peuvent pas être traitées. Dans Telegram, ajoutez un de nos bots comme
            administrateur avec le droit « Ajouter des membres », puis cliquez « Re-vérifier les
            droits des bots ».
          </AlertDescription>
        </Alert>
      ) : null}
      <ChannelTabs channelId={channel.id} current={tab} pending={counts.pending} />
      <Flash ok={sp.ok} error={sp.error} />

      {tab === "rules" ? <RulesTab channelId={channel.id} /> : null}
      {tab === "requests" ? <RequestsTab channelId={channel.id} now={now} /> : null}
      {tab === "members" ? <MembersTab channelId={channel.id} sp={sp} /> : null}
      {tab === "sequences" ? (
        <SequencesTabLoader
          channel={channel}
          botName={botName}
          open={one(sp.open)}
          lang={one(sp.lang)}
          telegramLinked={Boolean(me.telegramUserId)}
        />
      ) : null}
    </>
  );
}

/** Lit la règle d'entrée (boutons des canaux à rejoindre, délai dans l'aperçu) puis affiche « Ce que dit le bot ». */
async function SequencesTabLoader({
  channel,
  botName,
  open,
  lang,
  telegramLinked,
}: {
  channel: {
    id: string;
    title: string;
    vertical: "CASINO" | "SPORTS" | "DATING" | null;
    primaryBot: { vertical: "CASINO" | "SPORTS" | "DATING" } | null;
  };
  botName: string | null;
  open: string | undefined;
  lang: string | undefined;
  telegramLinked: boolean;
}) {
  const row = await prisma.approvalRule.findFirst({
    where: { channelId: channel.id, isDefault: true },
  });
  const rule = row ? entryRuleFromRow(row) : null;
  const gateChannels = rule?.gateChannelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: rule.gateChannelIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleOf = new Map(gateChannels.map((c) => [c.id, c.title]));
  const gateTitles = (rule?.gateChannelIds ?? [])
    .map((gid) => titleOf.get(gid))
    .filter((t): t is string => Boolean(t));
  return (
    <SequencesTab
      channelId={channel.id}
      channelTitle={channel.title}
      channelVertical={channel.vertical ?? channel.primaryBot?.vertical ?? null}
      open={open}
      lang={lang}
      telegramLinked={telegramLinked}
      rule={rule}
      gateTitles={gateTitles}
      botUsername={botName}
    />
  );
}
