import type { AutomationAction, AutomationConditions, AutomationTriggerKey } from "@linkaffipro/core";

export type AutomationTemplate = { key: string; name: string; description: string; trigger: AutomationTriggerKey; conditions: AutomationConditions; actions: AutomationAction[] };

/** Modèles proposés à la création d'une règle. */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: "relance-24h",
    name: "Relance 24 h après l'entrée",
    description: "Un jour après l'entrée dans le canal, un petit message pour rappeler l'offre.",
    trigger: "JOINED",
    conditions: {},
    actions: [
      { type: "wait", hours: 24 },
      { type: "send_message", text: "Salut {prenom} ! Tu as rejoint {canal} hier. Si tu n'as pas encore regardé l'offre du moment, elle est toujours là dans le canal 😉" },
    ],
  },
  {
    key: "merci-depot",
    name: "Merci après le premier dépôt",
    description: "Dès qu'un dépôt est détecté : remerciement au membre et information à l'équipe.",
    trigger: "DEPOSITED",
    conditions: {},
    actions: [
      { type: "send_message", text: "Merci {prenom} ! Ton dépôt est bien pris en compte. Bonne chance, et n'hésite pas si tu as une question." },
      { type: "tag", tag: "deposant" },
      { type: "notify_team", text: "Nouveau dépôt détecté." },
    ],
  },
  {
    key: "inactif-7j",
    name: "Inactif 7 jours → message + canal",
    description: "Après 7 jours sans activité, un message et la proposition d'un autre canal.",
    trigger: "INACTIVE",
    conditions: { inactiveDays: 7 },
    actions: [
      { type: "send_message", text: "Hello {prenom}, ça fait un moment ! De nouvelles offres sont arrivées sur {canal}." },
      { type: "suggest_channel", channelId: "", text: "Et si tu veux encore plus de bons plans, rejoins aussi {canal_propose} :" },
    ],
  },
  {
    key: "vip",
    name: "Niveau VIP atteint → prévenir l'équipe",
    description: "Quand un membre passe VIP, l'équipe est prévenue et le membre étiqueté.",
    trigger: "SPEND_LEVEL_REACHED",
    conditions: { spendLevels: ["VIP"] },
    actions: [
      { type: "tag", tag: "vip" },
      { type: "notify_team", text: "Un membre vient de passer VIP." },
    ],
  },
];

export function findTemplate(key: string | undefined): AutomationTemplate | null {
  return AUTOMATION_TEMPLATES.find((t) => t.key === key) ?? null;
}
