import { prisma } from "@linkaffipro/db";
import { EntryRuleForm } from "@/components/channels/entry-rule-form";
import { GateLinksStatus } from "@/components/channels/gate-links-status";
import { entryRuleFromRow, initialEntryState, isRuleInForce } from "@/lib/channels/entry-rule";
import { loadGateLinkView } from "@/lib/channels/gate-links-server";
import { loadGateChannelChoices } from "@/lib/channels/queries";
import { channelTabHref } from "@/lib/channels/tabs";
import { checkGateLinksAction, saveRuleAction } from "../actions";

/**
 * Onglet « Qui peut entrer et quand » : la règle par défaut du canal, en trois choix et en langage courant.
 * Canal sans règle (ou règle inactive) : encadré « Aucune règle » et bouton « Choisir une règle ».
 * Les canaux que la règle demande encore mais qui sont inactifs ou supprimés restent visibles (et décochables).
 * Avec des canaux à rejoindre : état des liens de chaque canal (prêt, ou le canal en cause et la solution) et
 * « Vérifier les liens ».
 */
export async function RulesTab({ channelId }: { channelId: string }) {
  const row = await prisma.approvalRule.findFirst({ where: { channelId, isDefault: true } });
  const rule = row ? entryRuleFromRow(row) : null;
  const initial = initialEntryState(rule);
  const [channels, gateView] = await Promise.all([
    loadGateChannelChoices(channelId, initial.gateIds),
    loadGateLinkView(channelId, rule),
  ]);
  return (
    <EntryRuleForm
      key={row ? `${row.id}-${row.updatedAt.getTime()}` : "none"}
      channelId={channelId}
      hasRule={isRuleInForce(rule)}
      initial={initial}
      channels={channels}
      action={saveRuleAction}
      requestsHref={channelTabHref(channelId, "requests")}
      gateStatus={
        gateView ? <GateLinksStatus view={gateView} checkAction={checkGateLinksAction} /> : null
      }
    />
  );
}
