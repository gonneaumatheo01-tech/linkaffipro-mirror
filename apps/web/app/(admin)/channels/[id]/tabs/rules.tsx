import { EntryRuleForm } from "@/components/channels/entry-rule-form";
import { ExceptionList } from "@/components/channels/exception-list";
import { GateLinksStatus } from "@/components/channels/gate-links-status";
import { RuleSimulator } from "@/components/channels/rule-simulator";
import { ShareLinksSection } from "@/components/channels/share-links-section";
import { initialEntryState, isRuleInForce } from "@/lib/channels/entry-rule";
import { gateSenderExceptions } from "@/lib/channels/exceptions";
import { loadGateLinkView } from "@/lib/channels/gate-links-server";
import { loadGateChannelChoices, loadRulesTab } from "@/lib/channels/queries";
import { loadExceptionGateViews } from "@/lib/channels/rule-gate-links";
import { simulationChoices, type SimRule } from "@/lib/channels/rule-simulator";
import { channelTabHref } from "@/lib/channels/tabs";
import { requireUser } from "@/lib/session";
import {
  checkGateLinksAction,
  deleteExceptionAction,
  moveExceptionAction,
  reorderExceptionsAction,
  saveExceptionAction,
  saveRuleAction,
  toggleExceptionAction,
} from "../actions";

/**
 * Onglet « Qui peut entrer et quand » (phase 11) :
 * 1. « Par défaut » : la règle par défaut du canal, en trois choix et en langage courant (« puis accepter » après les
 *    canaux à rejoindre). Canal sans règle : encadré « Aucune règle » et bouton « Choisir une règle ».
 * 2. « Exceptions selon la provenance » : une règle à part pour les personnes venues d'un de nos canaux, d'une pub ou
 *    d'un lien de partage ; ordre, activation, suppression (administrateurs).
 * 3. Le simulateur « Et si quelqu'un demande à entrer ? », avec les règles enregistrées (même logique que le bot).
 * 4. « Liens de partage » : les liens nommés à poster où l'on veut (chiffres, règle appliquée, création,
 *    désactivation), sous le simulateur ; leurs exceptions se règlent plus haut (section serveur autonome).
 * Les canaux que les règles demandent encore mais qui sont inactifs ou supprimés restent visibles (et décochables).
 * Avec des canaux à rejoindre : état des liens de chaque canal (prêt, ou le canal en cause et la solution) et
 * « Vérifier les liens ».
 */
export async function RulesTab({ channelId }: { channelId: string }) {
  const [me, data] = await Promise.all([requireUser(), loadRulesTab(channelId)]);
  const { defaultRow, defaultRule: rule, exceptions } = data;
  const initial = initialEntryState(rule);
  const [channels, gateView, exceptionViews] = await Promise.all([
    loadGateChannelChoices(channelId, initial.gateIds),
    loadGateLinkView(channelId, rule),
    loadExceptionGateViews(channelId, exceptions),
  ]);

  const names = {
    titles: Object.fromEntries(data.channels.map((c) => [c.id, c.title])),
    linkNames: Object.fromEntries(data.links.map((l) => [l.id, l.name])),
  };
  const channelTitle = names.titles[channelId] ?? "ce canal";
  const activeChannels = data.channels
    .filter((c) => c.isActive && c.id !== channelId)
    .map((c) => ({
      id: c.id,
      title: c.title,
      vertical: c.vertical,
      isMediaLibrary: c.isMediaLibrary,
    }));
  const gateViews = Object.fromEntries(
    Object.entries(exceptionViews).map(([id, view]) => [
      id,
      <GateLinksStatus key={id} view={view} checkAction={checkGateLinksAction} />,
    ]),
  );
  const gateWarnings = Object.fromEntries(
    Object.entries(exceptionViews)
      .filter(([, view]) => !view.summary.ok)
      .map(([id, view]) => [id, view.summary.text]),
  );

  const simRules: SimRule[] = [
    ...(defaultRow && rule
      ? [
          {
            id: defaultRow.id,
            scope: "DEFAULT" as const,
            isDefault: true,
            isActive: defaultRow.isActive,
            inviteLinkId: null,
            sourceChannelId: null,
            sourceKind: null,
            sortOrder: defaultRow.sortOrder,
            label: null,
            rule,
          },
        ]
      : []),
    ...exceptions,
  ];
  const exceptionLinkIds = new Set(
    exceptions.flatMap((e) =>
      e.scope === "INVITE_LINK" && e.inviteLinkId ? [e.inviteLinkId] : [],
    ),
  );
  const simGroups = simulationChoices({
    channelId,
    channels: data.channels,
    senders: data.senders,
    shareLinks: data.links.filter((l) => l.kind === "SHARE" && l.isActive),
    // Liens qui ont leur propre règle (ex. lien d'entrée d'une pub réglé dans Campagnes → Tous les liens).
    preciseLinks: data.links.filter((l) => exceptionLinkIds.has(l.id)),
  });
  const activeExceptions = exceptions.filter((e) => e.isActive).length;
  // Personnes envoyées ici par le bouton d'un autre canal : l'exception qui les vise, comme le bot (rappelée dans
  // la note de la règle par défaut, sous les canaux à rejoindre).
  const gateSkip = gateSenderExceptions(exceptions, data.senders, names);

  return (
    <div className="max-w-3xl space-y-10">
      <section aria-labelledby="rules-default-title" className="space-y-4">
        <div>
          <h2 id="rules-default-title" className="text-title text-foreground">
            Par défaut
          </h2>
          <p className="mt-0.5 text-note text-muted-foreground">
            Pour toute personne qui ne correspond à aucune exception plus bas.
          </p>
        </div>
        <EntryRuleForm
          key={defaultRow ? `${defaultRow.id}-${defaultRow.updatedAt.getTime()}` : "none"}
          channelId={channelId}
          hasRule={isRuleInForce(rule)}
          initial={initial}
          channels={channels}
          action={saveRuleAction}
          requestsHref={channelTabHref(channelId, "requests")}
          exceptionsCount={activeExceptions}
          gateSkip={gateSkip}
          gateStatus={
            gateView ? <GateLinksStatus view={gateView} checkAction={checkGateLinksAction} /> : null
          }
        />
      </section>

      <ExceptionList
        channelId={channelId}
        items={exceptions}
        names={names}
        canDelete={me.role === "ADMIN"}
        menuInput={{
          channels: data.channels.map((c) => ({ id: c.id, title: c.title, isActive: c.isActive })),
          links: data.links.map((l) => ({
            id: l.id,
            name: l.name,
            kind: l.kind,
            isActive: l.isActive,
          })),
          senders: data.senders,
        }}
        baseState={initial}
        activeChannels={activeChannels}
        knownChannels={data.channels.map((c) => ({
          id: c.id,
          title: c.title,
          vertical: c.vertical,
          isMediaLibrary: c.isMediaLibrary,
          isActive: c.isActive,
        }))}
        gateViews={gateViews}
        gateWarnings={gateWarnings}
        saveAction={saveExceptionAction}
        toggleAction={toggleExceptionAction}
        moveAction={moveExceptionAction}
        reorderAction={reorderExceptionsAction}
        deleteAction={deleteExceptionAction}
      />

      <RuleSimulator
        rules={simRules}
        groups={simGroups}
        ctx={{ ...names, channelId, channelTitle }}
      />

      <ShareLinksSection channelId={channelId} />
    </div>
  );
}
