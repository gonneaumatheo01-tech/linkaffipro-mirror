import {
  effectiveGateChannelIds,
  noRuleOutcome,
  pickRuleForProvenance,
  provenanceOfLink,
  welcomeKindFor,
  type Provenance,
  type ProvenanceLink,
  type ScopedRule,
} from "@linkaffipro/core";
import { channelList, delayLabel, effectiveDelay, hasGate, type EntryRule } from "./entry-rule";
import { conditionText, frQuotes, type NameMaps } from "./exceptions";

/**
 * Simulateur de « Qui peut entrer et quand » (fiche canal, phase 11) : « Si quelqu'un vient de [▾], il se passe : … ».
 * Même logique que le bot, prise dans `packages/core/src/provenance.ts` : règle retenue (`pickRuleForProvenance`),
 * canaux à rejoindre réellement demandés (`effectiveGateChannelIds`), canal sans règle (`noRuleOutcome`) et message à
 * l'arrivée (`welcomeKindFor`). Fonctions pures, sur les règles enregistrées.
 */

/** Une règle du canal (règle par défaut ou exception), relue pour la simulation. */
export type SimRule = ScopedRule & { label: string | null; rule: EntryRule };

export type SimChoice = { key: string; label: string; provenance: Provenance };
export type SimGroup = { label: string; choices: SimChoice[] };

const none = { inviteLinkId: null, sourceChannelId: null, adPlatform: null } as const;

/** Lien visé par une exception « lien précis » (lien d'entrée de pub, lien de partage, lien manuel), actif ou non. */
export type SimPreciseLink = ProvenanceLink & { name: string; isActive: boolean };

/**
 * Provenances proposées (phrases après « Si quelqu'un vient ») : le bouton « canal à rejoindre » de chacun de nos
 * canaux (ceux qui envoient leurs membres ici d'abord), chaque lien de partage du canal et un autre lien de partage,
 * une pub TikTok, une pub Meta, une autre pub, chaque lien qui a sa propre règle (ex. lien d'entrée d'une pub réglé
 * dans Campagnes → Tous les liens ; provenance lue comme le bot : `provenanceOfLink`), un autre lien.
 */
export function simulationChoices(input: {
  channelId: string;
  channels: ReadonlyArray<{ id: string; title: string; isActive: boolean }>;
  senders: readonly string[];
  shareLinks: ReadonlyArray<{ id: string; name: string; sourceChannelId: string | null }>;
  /** Liens visés par une exception « lien précis » (hors liens de partage déjà proposés). */
  preciseLinks?: readonly SimPreciseLink[];
}): SimGroup[] {
  const senders = new Set(input.senders);
  const channels = input.channels
    .filter((c) => c.id !== input.channelId && c.isActive)
    .sort(
      (a, b) =>
        Number(senders.has(b.id)) - Number(senders.has(a.id)) ||
        a.title.localeCompare(b.title, "fr"),
    );
  const shared = new Set(input.shareLinks.map((l) => l.id));
  const precise = (input.preciseLinks ?? [])
    .filter((l, i, all) => !shared.has(l.id) && all.findIndex((x) => x.id === l.id) === i)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const groups: SimGroup[] = [
    {
      label: "Le bouton « canal à rejoindre » d'un de nos canaux",
      choices: channels.map((c) => ({
        key: `gate:${c.id}`,
        label: `du bouton « canal à rejoindre » de « ${c.title} »`,
        provenance: { ...none, type: "GATE", sourceChannelId: c.id },
      })),
    },
    {
      label: "Un lien de partage",
      choices: [
        ...input.shareLinks.map((l) => ({
          key: `share:${l.id}`,
          label: `du lien de partage « ${l.name} »`,
          provenance: {
            ...none,
            type: "SHARE" as const,
            inviteLinkId: l.id,
            sourceChannelId: l.sourceChannelId,
          },
        })),
        {
          key: "share:other",
          label:
            input.shareLinks.length > 0 ? "d'un autre lien de partage" : "d'un lien de partage",
          provenance: { ...none, type: "SHARE" },
        },
      ],
    },
    {
      label: "Une pub",
      choices: [
        {
          key: "ad:TIKTOK",
          label: "d'une pub TikTok",
          provenance: { ...none, type: "AD", adPlatform: "TIKTOK" },
        },
        {
          key: "ad:META",
          label: "d'une pub Meta",
          provenance: { ...none, type: "AD", adPlatform: "META" },
        },
        {
          key: "ad:OTHER",
          label: "d'une autre pub",
          provenance: { ...none, type: "AD", adPlatform: "OTHER" },
        },
      ],
    },
    {
      label: "Un lien précis",
      choices: precise.map((l) => ({
        key: `link:${l.id}`,
        label: frQuotes(`du lien « ${l.name} »${l.isActive ? "" : " (désactivé)"}`),
        provenance: provenanceOfLink(l),
      })),
    },
    {
      label: "Autre",
      choices: [
        {
          key: "other",
          label: "d'un autre lien (lien public, lien créé dans Telegram)",
          provenance: { ...none, type: "UNKNOWN" },
        },
      ],
    },
  ];
  return groups.filter((g) => g.choices.length > 0);
}

/** Ce qui se passe pour une provenance : règle retenue, canaux à rejoindre, délai, message du bot, remarques. */
export type SimResult = {
  /** « default » : règle par défaut ; « none » : aucune règle (canal pas encore réglé). */
  ruleKind: "exception" | "default" | "none";
  ruleText: string;
  gateIds: string[];
  gatesText: string;
  whenText: string;
  messageText: string;
  notes: string[];
};

/** Simule une demande venue de `p`, avec les règles enregistrées du canal. */
export function simulate(
  rules: readonly SimRule[],
  p: Provenance,
  ctx: NameMaps & { channelId: string; channelTitle: string },
): SimResult {
  const rule = pickRuleForProvenance(rules, p);
  if (!rule) {
    const outcome = noRuleOutcome(p);
    return {
      ruleKind: "none",
      ruleText: "Aucune règle : ce canal n'a pas encore de réglage par défaut.",
      gateIds: [],
      gatesText: "Aucun canal à rejoindre.",
      whenText:
        outcome === "IMMEDIATE"
          ? "Elle entre tout de suite, sans attendre."
          : "Sa demande attend votre validation (onglet Demandes).",
      messageText: "Le bot ne lui écrit pas.",
      notes: [],
    };
  }
  const ruleGates = hasGate(rule.rule) ? rule.rule.gateChannelIds : [];
  const eff = effectiveGateChannelIds(
    { scope: rule.scope, gateChannelIds: ruleGates },
    p,
    ctx.channelId,
  );
  const gateIds = eff.gateChannelIds;
  const hasGates = gateIds.length > 0;
  const required = hasGates && rule.rule.gateMode === "REQUIRED";
  const kind = welcomeKindFor({
    provenance: p,
    hasGates,
    sendWelcome: rule.rule.sendWelcome !== false,
  });
  const delay = effectiveDelay(rule.rule);
  const manual = rule.rule.mode === "MANUAL";
  const list = channelList(gateIds.map((id) => ctx.titles[id] ?? "un autre canal"));
  const notes: string[] = [];
  if (eff.noGates && ruleGates.some((id) => id !== ctx.channelId))
    notes.push(
      "Les canaux à rejoindre de la règle par défaut ne lui sont pas demandés : elle vient déjà d'un de nos canaux.",
    );
  else if (p.sourceChannelId && ruleGates.includes(p.sourceChannelId))
    notes.push(
      `« ${ctx.titles[p.sourceChannelId] ?? "Ce canal"} » compte comme déjà rejoint : elle en vient.`,
    );
  // Anti-doublon (`isDuplicateWelcome`) : surtout pour une personne envoyée par le bouton d'un autre de nos canaux,
  // qui vient souvent de recevoir l'accueil de ce même bot.
  if (p.type === "GATE" && kind !== "none" && !hasGates)
    notes.push(
      "Si ce bot lui a déjà envoyé un message d'accueil il y a moins de 10 minutes, il ne lui réécrit pas.",
    );
  const whenText = manual
    ? "Sa demande attend votre validation (onglet Demandes)."
    : required
      ? delay === 0
        ? "Elle est acceptée dès son clic sur « ✅ J'ai rejoint »."
        : `Elle est acceptée ${delayLabel(delay)} après son clic sur « ✅ J'ai rejoint ».`
      : delay === 0
        ? "Elle est acceptée tout de suite."
        : `Elle est acceptée ${delayLabel(delay)} après sa demande.`;
  // Court message : seulement sans canal à rejoindre (sinon l'accueil complet porte les boutons).
  const access = manual
    ? ""
    : delay === 0
      ? ", accès tout de suite"
      : `, accès dans ${delayLabel(delay)}`;
  const messageText =
    kind === "full"
      ? hasGates
        ? "Le bot lui envoie son message d'accueil, avec un bouton par canal et « ✅ J'ai rejoint »."
        : "Le bot lui envoie son message d'accueil."
      : kind === "short"
        ? `Le bot lui envoie seulement un court message : sa demande pour « ${ctx.channelTitle} » est bien reçue${access}.`
        : "Le bot ne lui écrit pas.";
  return {
    ruleKind: rule.scope === "DEFAULT" ? "default" : "exception",
    ruleText:
      rule.scope === "DEFAULT"
        ? "La règle par défaut."
        : `L'exception pour les personnes venues ${conditionText(rule, ctx)}.`,
    gateIds,
    gatesText: hasGates
      ? required
        ? `Elle doit d'abord rejoindre ${list}.`
        : `Le bot lui propose aussi de rejoindre ${list}.`
      : "Aucun canal à rejoindre.",
    whenText,
    messageText,
    notes,
  };
}
