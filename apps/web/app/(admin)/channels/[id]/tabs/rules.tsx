import { prisma } from "@linkaffipro/db";
import { ApplyRulePending, ChannelRulesProvider } from "@/components/channels/apply-rule-pending";
import { EntryRuleForm } from "@/components/channels/entry-rule-form";
import { ExceptionList } from "@/components/channels/exception-list";
import { GateLinksStatus } from "@/components/channels/gate-links-status";
import { RuleSimulator } from "@/components/channels/rule-simulator";
import { ShareLinksSection } from "@/components/channels/share-links-section";
import { initialEntryState, isRuleInForce } from "@/lib/channels/entry-rule";
import { textsMentionRequiredStep } from "@/lib/channels/bot-messages";
import { affiliateNameMaps, conditionText, gateSenderExceptions } from "@/lib/channels/exceptions";
import {
  pendingRuleSummaries,
  pendingRuleView,
  type PendingRuleView,
  type PendingSummary,
} from "@/lib/channels/pending-rule";
import { loadGateLinkView } from "@/lib/channels/gate-links-server";
import { loadGateChannelChoices, loadRulesTab } from "@/lib/channels/queries";
import { loadChannelLandingPages } from "@/lib/landing/queries";
import { loadExceptionGateViews } from "@/lib/channels/rule-gate-links";
import { simulationChoices, type SimRule } from "@/lib/channels/rule-simulator";
import { channelTabHref } from "@/lib/channels/tabs";
import { requireUser } from "@/lib/session";
import {
  applyRuleToPendingAction,
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
 * Phase 14 : sous « Enregistrer la règle » (et au-dessus des exceptions pour une exception), les demandes en cours qui
 * suivent encore l'ancienne version de la règle, avec « Leur appliquer la nouvelle règle » ; avertissement en direct
 * quand les canaux sont « Proposés » mais que l'accueil du canal dit qu'il faut les rejoindre.
 */
export async function RulesTab({ channelId }: { channelId: string }) {
  const [me, data, summaries, welcome] = await Promise.all([
    requireUser(),
    loadRulesTab(channelId),
    // Lecture de confort : une panne n'empêche jamais d'afficher les règles.
    pendingRuleSummaries(channelId).catch((err: unknown): Record<string, PendingSummary> => {
      console.warn("[canaux] demandes en attente de l'ancienne règle illisibles", {
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }),
    prisma.sequence.findFirst({
      where: { channelId, trigger: "JOIN_REQUEST", isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { steps: { orderBy: { order: "asc" }, take: 1, select: { texts: true } } },
    }),
  ]);
  const { defaultRow, defaultRule: rule, exceptions } = data;
  const initial = initialEntryState(rule);
  const [channels, gateView, exceptionViews, landingPages] = await Promise.all([
    loadGateChannelChoices(channelId, initial.gateIds),
    loadGateLinkView(channelId, rule),
    loadExceptionGateViews(channelId, exceptions),
    // Pages d'atterrissage du canal, et celles que visent déjà des exceptions (phase 15).
    loadChannelLandingPages(
      channelId,
      exceptions.flatMap((e) => (e.landingPageId ? [e.landingPageId] : [])),
    ),
  ]);

  const names = {
    titles: Object.fromEntries(data.channels.map((c) => [c.id, c.title])),
    linkNames: Object.fromEntries(data.links.map((l) => [l.id, l.name])),
    // Affiliés Link Affi (phase 13) : « de l'affilié « Paul » », « de la campagne « … » de l'affilié « Paul » ».
    ...affiliateNameMaps({ affiliates: data.affiliates, affiliateLinks: data.affiliateLinks }),
    // Pages d'atterrissage (phase 15) : « de la page « Promo » ».
    landingPageNames: Object.fromEntries(landingPages.map((p) => [p.id, p.name])),
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
    // Campagnes d'affiliés Link Affi du canal, et « un autre affilié » dès qu'un affilié est connu (phase 13).
    affiliateLinks: data.affiliateLinks,
    withAffiliates:
      data.affiliates.length > 0 ||
      exceptions.some(
        (e) => e.sourceKind === "LINKAFFI_ANY" || e.sourceKind === "LINKAFFI_AFFILIATE",
      ),
    // Pages d'atterrissage du canal, et « une autre page » dès qu'une exception en vise une (phase 15).
    landingPages,
    withLandingPages: exceptions.some(
      (e) => e.sourceKind === "LANDING_ANY" || e.sourceKind === "LANDING_PAGE",
    ),
  });
  const activeExceptions = exceptions.filter((e) => e.isActive).length;
  // Personnes envoyées ici par le bouton d'un autre canal : l'exception qui les vise, comme le bot (rappelée dans
  // la note de la règle par défaut, sous les canaux à rejoindre).
  const gateSkip = gateSenderExceptions(exceptions, data.senders, names);

  // Demandes en cours qui suivent l'ancienne version de chaque règle (règle par défaut, exceptions actives).
  const pending: Record<string, PendingRuleView> = {};
  if (defaultRow?.isActive) {
    const view = pendingRuleView(summaries[defaultRow.id]);
    if (view) pending[defaultRow.id] = view;
  }
  const exceptionPending: PendingRuleView[] = [];
  for (const e of exceptions) {
    if (!e.isActive) continue;
    const view = pendingRuleView(summaries[e.id], `Personnes venues ${conditionText(e, names)}`);
    if (view) {
      pending[e.id] = view;
      exceptionPending.push(view);
    }
  }
  const welcomeTexts = welcome?.steps[0]?.texts;
  const rulesContext = {
    channelId,
    welcomeMentionsStep: textsMentionRequiredStep(
      welcomeTexts && typeof welcomeTexts === "object"
        ? (welcomeTexts as Record<string, string>)
        : null,
    ),
    welcomeHref: `${channelTabHref(channelId, "sequences")}&open=JOIN_REQUEST#JOIN_REQUEST`,
    pending,
    applyAction: applyRuleToPendingAction,
  };

  return (
    <ChannelRulesProvider value={rulesContext}>
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
            ruleId={defaultRow?.id ?? null}
            hasRule={isRuleInForce(rule)}
            initial={initial}
            channels={channels}
            action={saveRuleAction}
            requestsHref={channelTabHref(channelId, "requests")}
            exceptionsCount={activeExceptions}
            gateSkip={gateSkip}
            gateStatus={
              gateView ? (
                <GateLinksStatus view={gateView} checkAction={checkGateLinksAction} />
              ) : null
            }
          />
        </section>

        {exceptionPending.length > 0 ? (
          <div className="space-y-3">
            {exceptionPending.map((v) => (
              <ApplyRulePending key={v.ruleId} ruleId={v.ruleId} />
            ))}
          </div>
        ) : null}

        <ExceptionList
          channelId={channelId}
          items={exceptions}
          names={names}
          canDelete={me.role === "ADMIN"}
          menuInput={{
            channels: data.channels.map((c) => ({
              id: c.id,
              title: c.title,
              isActive: c.isActive,
            })),
            links: data.links.map((l) => ({
              id: l.id,
              name: l.name,
              kind: l.kind,
              isActive: l.isActive,
            })),
            senders: data.senders,
            affiliates: data.affiliates.map((a) => ({ id: a.id, name: a.name })),
            affiliateLinks: data.affiliateLinks.map((l) => ({
              id: l.id,
              campaignName: l.campaignName,
              affiliateName: l.affiliateName,
              isActive: l.isActive,
            })),
            landingPages,
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
    </ChannelRulesProvider>
  );
}
