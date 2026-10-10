/**
 * Définition en une phrase de chaque indicateur du tableau de bord (infobulles « ? »).
 * Clé = clé de métrique (`lib/dashboard/queries.ts`, `components/dashboard/ads-table.tsx`, entonnoir, cohortes).
 */
export const METRIC_HELP: Record<string, string> = {
  spend:
    "Argent dépensé en publicité sur la période (comptes connectés, imports TikTok / Meta ou saisie dans la page Campagnes, onglet Pubs).",
  entryClicks: "Clics sur le lien de la pub (lien goolink) par de vraies personnes, robots exclus.",
  requests: "Demandes d'adhésion reçues par le bot sur le canal Telegram.",
  approved: "Demandes acceptées par le bot (tout de suite, après le délai ou à la main).",
  joined: "Membres effectivement entrés dans le canal.",
  left: "Membres qui ont quitté le canal (ou en ont été exclus).",
  offerClicks:
    "Clics sur un bouton « Offre » d'un message : chaque clic reçoit un identifiant de suivi (sub-ID) propre au membre.",
  registrations:
    "Inscriptions de vos joueurs chez l'opérateur (rattachés par l'identifiant de suivi ou par l'offre d'une de vos campagnes), à la date d'inscription Link Affi.",
  ftds: "Premiers dépôts (FTD = first time deposit) : joueurs qui ont déposé de l'argent pour la première fois.",
  deposits: "Nombre total de dépôts (un joueur peut déposer plusieurs fois).",
  depositAmount: "Somme des montants déposés par les joueurs rattachés, en euros.",
  ngr: "Revenu net (NGR = net gaming revenue) : ce que l'opérateur a gagné sur vos joueurs pendant la période (somme des variations datées), base de la commission.",
  cpl: "Coût par membre arrivé (CPL) = dépense ÷ membres entrés. Plus c'est bas, mieux c'est.",
  cpa: "Coût par inscription (CPA) = dépense ÷ inscriptions. Plus c'est bas, mieux c'est.",
  costPerFtd: "Coût par premier dépôt = dépense ÷ FTD. Plus c'est bas, mieux c'est.",
  roas: "Retour sur dépense publicitaire : revenu net (NGR) ÷ dépense. Au-dessus de 1, la campagne rapporte plus qu'elle ne coûte.",
  profit: "Bénéfice : revenu net (NGR) − dépense publicitaire.",
  clickRate: "Taux de clic : clics ÷ vues du message.",
  funnel:
    "Entonnoir : à chaque étape, le pourcentage de personnes conservées par rapport à l'étape précédente, et la perte.",
  cohort:
    "Cohorte : tous les membres arrivés la même semaine (première demande d'adhésion), suivis dans le temps.",
  ltv: "Valeur par membre (LTV) : revenu net (somme des variations datées) de vos joueurs rattachés ÷ nombre de membres de la cohorte.",
  deposits7: "Montant déposé par les membres de la cohorte dans les 7 jours suivant leur arrivée.",
  deposits30:
    "Montant déposé par les membres de la cohorte dans les 30 jours suivant leur arrivée.",
  members: "Membres arrivés cette semaine-là (première demande d'adhésion de la période).",
  registered: "Membres de la cohorte qui se sont inscrits chez l'opérateur (et leur part en %).",
  net: "Croissance nette : entrées − départs sur la période.",
  clicksPerPost: "Clics moyens par message envoyé à cette heure ou dans cette catégorie.",
  reactions: "Réactions (emoji) laissées par les membres sous le message.",
  views: "Vues du message indiquées par Telegram (si disponibles).",
  uniqueClickers:
    "Personnes distinctes ayant cliqué au moins une fois (membres identifiés, sinon appareil distinct).",
};

export function metricHelp(key: string): string | undefined {
  return METRIC_HELP[key];
}
