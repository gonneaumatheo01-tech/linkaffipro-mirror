/**
 * Boutons « Offre (campagne) » d'une relance, vérifiés à l'enregistrement (côté serveur, sans rien écrire) : mêmes
 * règles qu'un bouton Offre d'un message de canal (`resolveOfferButton`, lib/campaigns/offer-button.ts) : la campagne
 * existe, elle contient l'offre choisie, et l'offre est active. Le lien traqué de la relance n'est pas créé ici : le
 * worker le crée au premier envoi (apps/worker/src/automations/offer-links.ts), ce qui donne aussi un lien propre à
 * chaque copie de la relance.
 */
import {
  automationOfferButtons,
  graphForRule,
  type AutomationAction,
  type AutomationGraph,
  type AutomationOfferButton,
} from "@linkaffipro/core";
import { resolveOfferButton } from "@/lib/campaigns/offer-button";

/** Boutons Offre d'une relance enregistrée en liste d'actions ou en parcours à branches. */
export function ruleOfferButtons(rule: {
  actions: readonly AutomationAction[];
  graph: AutomationGraph | null;
}): AutomationOfferButton[] {
  const fromGraph = rule.graph
    ? rule.graph.nodes.flatMap((n) => (n.type === "action" ? [n.action] : []))
    : [];
  const all = automationOfferButtons([...rule.actions, ...fromGraph]);
  const seen = new Set<string>();
  return all.filter((b) => {
    const key = `${b.text}\u0000${b.campaignId}\u0000${b.affiliateCampaignId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Vrai si une relance enregistrée (actions et parcours en JSON, tels qu'en base) a au moins un bouton « Offre
 * (campagne) » ; faux pour un parcours illisible. Sert à montrer, ou non, clics, inscriptions, premiers dépôts et gains.
 */
export function storedRuleHasOfferButton(rule: { actions: unknown; graph: unknown }): boolean {
  try {
    return ruleOfferButtons({ actions: [], graph: graphForRule(rule) }).length > 0;
  } catch {
    return false;
  }
}

/** Lève la première erreur lisible (« Bouton « Voir l'offre » : … ») si un bouton Offre est refusé. */
export async function assertRuleOfferButtons(rule: {
  actions: readonly AutomationAction[];
  graph: AutomationGraph | null;
}): Promise<void> {
  for (const b of ruleOfferButtons(rule))
    await resolveOfferButton({
      text: b.text,
      type: "OFFER",
      campaignId: b.campaignId,
      affiliateCampaignId: b.affiliateCampaignId,
    });
}
