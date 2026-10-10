import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { VERTICALS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { AdvancedSection } from "@/components/admin/form-section";
import { SidePanel } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { BotConnection, botCheckLabel } from "@/components/settings/bot-connection";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { ActiveBadge } from "@/lib/status-badges";
import { botCheck, botsTile } from "@/lib/status/health";
import { liveWebhook } from "@/lib/status/queries";
import { universeLabel } from "@/lib/universe";
import { addBotAction, resyncWebhookAction, toggleBotAction } from "./actions";

export const metadata: Metadata = { title: "Bots" };

/**
 * Réglages → Bots : un bot par univers. Tableau de 5 colonnes (bot, univers, état, connexion Telegram, dernier signal),
 * détail au clic (canaux administrés, membres, messages en attente, actions « Reposer la connexion » et
 * « Activer / Désactiver ») ; le détail technique de la connexion (adresse du webhook) est dans « Avancé ».
 * « Ajouter un bot » (ADMIN) ouvre un volet. Contenu et actions inchangés.
 * État de chaque bot : règle `botCheck` (lib/status/health.ts), la même que la carte Bots de Réglages et la tuile
 * « Bots » d'État du système ; la pastille de l'en-tête reprend cette tuile (« 2 à vérifier »).
 */
export default async function BotsPage({ searchParams }: PageProps<"/settings/bots">) {
  const user = await requireUser();
  const sp = await searchParams;
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { channelAdmins: { where: { revokedAt: null } }, memberStates: true } },
    },
  });
  const webhooks = await Promise.all(
    bots.map((b) => (b.isActive ? liveWebhook(b.id) : Promise.resolve(null))),
  );
  const health = bots.map((b, i) => ({
    isActive: b.isActive,
    lastError: b.lastError,
    webhook: webhooks[i] ?? null,
  }));
  const tile = botsTile(health);
  const summary = { ...tile.state, detail: tile.detail };
  const isAdmin = user.role === "ADMIN";
  // Clé renouvelée à chaque rendu : après une action (la page est rechargée par la redirection), le volet ouvert se
  // ferme au lieu de garder l'état d'avant (Next garde l'état client quand seule l'adresse change). Sinon, un second
  // clic sur « Activer » dans un volet resté « Inactif » désactiverait le bot sans confirmation.
  const viewKey = String(new Date().getTime());

  const addBotPanel = isAdmin ? (
    <SidePanel
      key={`add-${viewKey}`}
      title="Ajouter un bot"
      description="Collez le jeton donné par @BotFather. Le bot est vérifié, son jeton est chiffré, puis sa connexion Telegram est posée toute seule."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter un bot
        </Button>
      }
    >
      <form action={addBotAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="token">Jeton du bot</Label>
          <Input id="token" name="token" placeholder="123456789:AAE…" required autoComplete="off" />
          <p className="text-note text-muted-foreground">
            Dans Telegram, ouvrez @BotFather, envoyez /newbot, puis copiez le jeton qu&apos;il vous
            donne.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vertical">Univers</Label>
          <NativeSelect id="vertical" name="vertical" required wrapperClassName="w-full">
            {VERTICALS.map((v) => (
              <option key={v} value={v}>
                {universeLabel(v)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" className="max-md:h-10">
          Ajouter le bot
        </Button>
      </form>
    </SidePanel>
  ) : null;

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Bots"
        description="Vos bots Telegram, un par univers (casino, paris sportifs, rencontres). Ce sont eux qui accueillent les membres et publient les messages."
        help={
          isAdmin
            ? "Première chose à faire : ajouter un bot avec son jeton, puis l'ajouter comme administrateur de vos canaux dans Telegram."
            : "Si une connexion Telegram est « À vérifier », ouvrez le bot et cliquez sur « Reposer la connexion »."
        }
        meta={
          bots.length > 0 ? (
            <StatusPill tone={summary.tone} title={summary.detail}>
              {summary.label}
            </StatusPill>
          ) : null
        }
        primaryAction={addBotPanel}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <DataTable
        key={`bots-${viewKey}`}
        label="Bots"
        columns={[
          { key: "bot", header: "Bot", className: "min-w-40 whitespace-normal" },
          { key: "universe", header: "Univers", hideOnMobile: true },
          { key: "state", header: "État", hideOnMobile: true },
          { key: "connection", header: "Connexion Telegram" },
          { key: "signal", header: "Dernier signal", hideOnMobile: true },
        ]}
        rows={bots.map((b, i) => {
          const w = webhooks[i] ?? null;
          const check = botCheck(health[i]!);
          const connectionCell = <BotConnection check={check} />;
          return {
            id: b.id,
            cells: {
              bot: (
                <span className="flex flex-col items-start">
                  <span>{b.name}</span>
                  <span className="text-note font-normal text-muted-foreground">@{b.username}</span>
                </span>
              ),
              universe: <UniverseDot universe={b.vertical} withLabel />,
              state: <ActiveBadge active={b.isActive} />,
              connection: connectionCell,
              signal: fmtDate(b.lastWebhookAt),
            },
            sortValues: {
              bot: b.name,
              universe: universeLabel(b.vertical),
              state: b.isActive ? 1 : 0,
              connection: botCheckLabel(check),
            },
            detailTitle: b.name,
            detailDescription: `@${b.username} · ${universeLabel(b.vertical)}`,
            detail: (
              <div className="space-y-6">
                <DetailList>
                  <DetailRow label="État">
                    <ActiveBadge active={b.isActive} />
                  </DetailRow>
                  <DetailRow label="Connexion Telegram">{connectionCell}</DetailRow>
                  {w?.fetchError ? (
                    <DetailRow label="Réponse de Telegram">
                      <span className="text-danger">{w.fetchError}</span>
                    </DetailRow>
                  ) : null}
                  {w?.pending ? (
                    <DetailRow label="En attente">
                      {fmtNum(w.pending)} message(s) de Telegram en attente
                    </DetailRow>
                  ) : null}
                  {w?.lastError ? (
                    <DetailRow label="Erreur de connexion">
                      <span className="text-danger">
                        {w.lastError} ({fmtDate(w.lastErrorAt)})
                      </span>
                    </DetailRow>
                  ) : null}
                  {b.lastError ? (
                    <DetailRow label="Dernière erreur du bot">
                      <span className="text-danger">{b.lastError}</span>
                    </DetailRow>
                  ) : null}
                  <DetailRow label="Univers">
                    <UniverseDot universe={b.vertical} withLabel />
                  </DetailRow>
                  <DetailRow label="Canaux administrés">{fmtNum(b._count.channelAdmins)}</DetailRow>
                  <DetailRow label="Membres">{fmtNum(b._count.memberStates)}</DetailRow>
                  <DetailRow label="Dernier signal">{fmtDate(b.lastWebhookAt)}</DetailRow>
                </DetailList>

                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <form action={resyncWebhookAction}>
                    <input type="hidden" name="botId" value={b.id} />
                    <Button
                      type="submit"
                      variant={check === "check" ? "default" : "outline"}
                      className="max-md:h-10"
                      disabled={!b.isActive}
                    >
                      Reposer la connexion
                    </Button>
                  </form>
                  {isAdmin ? (
                    <form action={toggleBotAction}>
                      <input type="hidden" name="botId" value={b.id} />
                      {b.isActive ? (
                        <ConfirmSubmit
                          variant="destructive"
                          className="max-md:h-10"
                          confirmTitle={`Désactiver @${b.username} ?`}
                          confirmLabel="Désactiver"
                          message="Le bot ne répondra plus aux membres, n'acceptera plus les demandes d'adhésion et ne publiera plus de messages tant qu'il est inactif. Vous pourrez le réactiver ici."
                        >
                          Désactiver
                        </ConfirmSubmit>
                      ) : (
                        <Button type="submit" variant="outline" className="max-md:h-10">
                          Activer
                        </Button>
                      )}
                    </form>
                  ) : null}
                </div>

                {w && !w.fetchError ? (
                  <AdvancedSection
                    title="Avancé : adresse de connexion"
                    description="L'adresse à laquelle Telegram envoie au bot tout ce qui se passe."
                  >
                    <DetailList>
                      <DetailRow label="Adresse (webhook)" mono>
                        {w.url || "aucune adresse"}
                      </DetailRow>
                    </DetailList>
                  </AdvancedSection>
                ) : null}
              </div>
            ),
          };
        })}
        empty={{
          title: "Aucun bot enregistré",
          description: isAdmin
            ? "Créez un bot avec @BotFather dans Telegram, puis cliquez sur « Ajouter un bot » et collez son jeton."
            : "Un administrateur doit ajouter un bot (jeton @BotFather).",
        }}
      />
    </>
  );
}
