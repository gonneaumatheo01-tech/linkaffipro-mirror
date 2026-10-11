/**
 * Automatisations « si… alors… » : types, validation et correspondance des conditions (fonctions pures).
 * Les règles vivent dans `AutomationRule` (conditions et actions en JSON) ; l'exécution est dans le worker.
 */
import { SPEND_LEVELS, type SpendLevel } from "./spend-level";
import { TELEGRAM_TEXT_MAX, textLength } from "./telegram-html";

export const AUTOMATION_TRIGGERS = [
  "JOINED",
  "OFFER_CLICKED",
  "REGISTERED",
  "DEPOSITED",
  "INACTIVE",
  "LEFT",
  "SPEND_LEVEL_REACHED",
] as const;
export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTriggerKey, string> = {
  JOINED: "A rejoint un canal",
  OFFER_CLICKED: "A cliqué sur une offre",
  REGISTERED: "S'est inscrit chez un programme",
  DEPOSITED: "A déposé",
  INACTIVE: "Inactif depuis N jours",
  LEFT: "A quitté un canal",
  SPEND_LEVEL_REACHED: "A atteint un niveau de dépense",
};

export type AutomationConditions = {
  channelIds?: string[];
  campaignIds?: string[];
  languages?: string[];
  spendLevels?: SpendLevel[];
  /** Jours d'inactivité minimum (déclencheur INACTIVE, ou filtre pour les autres). */
  inactiveDays?: number;
  categoryIds?: string[];
};

/** Bouton « lien » d'un message de relance : ouvre l'adresse (forme d'avant la phase 10, toujours valable). */
export type AutomationLinkButton = { text: string; url: string };

/**
 * Bouton « Offre (campagne) » d'un message de relance (phase 10) : une de nos campagnes et l'une de ses offres Link Affi,
 * comme le bouton Offre d'un message de canal. Rien d'autre n'est enregistré : à l'envoi, le worker le change en lien
 * du bot propre à la relance (`TrackingLink` OFFER rattaché à la relance, `automationRuleId`) ; au clic, le bot donne
 * au membre un identifiant de suivi neuf (sub-ID), ce qui attribue à la relance ses inscriptions, premiers dépôts et
 * commissions (voir `apps/worker/src/automations/offer-links.ts`).
 */
export type AutomationOfferButton = {
  text: string;
  type: "OFFER";
  campaignId: string;
  affiliateCampaignId: string;
};

export type AutomationButton = AutomationLinkButton | AutomationOfferButton;

/** Vrai pour un bouton « Offre (campagne) ». */
export function isOfferButton(b: AutomationButton): b is AutomationOfferButton {
  return (b as { type?: unknown }).type === "OFFER";
}

export type AutomationAction =
  | {
      type: "send_message";
      text: string;
      buttons?: AutomationButton[][];
      mediaAssetId?: string | null;
      botId?: string | null;
    }
  | {
      type: "send_sequence";
      trigger:
        "JOIN_REQUEST" | "GATE_REMINDER" | "GATE_SATISFIED" | "APPROVED" | "START" | "OFFER_REPLY";
    }
  | { type: "wait"; hours: number }
  | { type: "tag"; tag: string }
  | { type: "suggest_channel"; channelId: string; text?: string }
  | { type: "notify_team"; text: string };

/** Messages du bot (séquences) qu'une action « Envoyer un message du bot » peut envoyer, en langage courant. */
export const AUTOMATION_SEQUENCE_LABELS: Record<
  Extract<AutomationAction, { type: "send_sequence" }>["trigger"],
  string
> = {
  JOIN_REQUEST: "Accueil à la demande",
  GATE_REMINDER: "Rappel",
  GATE_SATISFIED: "Canaux rejoints",
  APPROVED: "Accepté",
  START: "Réponse à /start",
  OFFER_REPLY: "Réponse à un clic sur une offre",
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationAction["type"], string> = {
  send_message: "Envoyer un message",
  send_sequence: "Envoyer un message du bot",
  wait: "Attendre",
  tag: "Étiqueter le membre",
  suggest_channel: "Proposer un canal",
  notify_team: "Prévenir l'équipe (Telegram)",
};

export const MAX_ACTIONS = 8;

function strArray(v: unknown, field: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
    throw new Error(`Condition « ${field} » invalide : liste de textes attendue.`);
  const out = (v as string[]).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

/** Valide des conditions brutes (JSON). Lève une erreur en français si invalide. */
export function parseConditions(raw: unknown): AutomationConditions {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Conditions invalides : objet attendu.");
  const o = raw as Record<string, unknown>;
  const out: AutomationConditions = {};
  const ch = strArray(o.channelIds, "canaux");
  if (ch) out.channelIds = ch;
  const ca = strArray(o.campaignIds, "campagnes");
  if (ca) out.campaignIds = ca;
  const la = strArray(o.languages, "langues");
  if (la) out.languages = la.map((l) => l.toLowerCase());
  const cat = strArray(o.categoryIds, "catégories");
  if (cat) out.categoryIds = cat;
  const sl = strArray(o.spendLevels, "niveaux de dépense");
  if (sl) {
    for (const s of sl)
      if (!(SPEND_LEVELS as readonly string[]).includes(s))
        throw new Error(`Niveau de dépense inconnu : ${s}.`);
    out.spendLevels = sl as SpendLevel[];
  }
  if (o.inactiveDays !== undefined && o.inactiveDays !== null && o.inactiveDays !== "") {
    const n = Number(o.inactiveDays);
    if (!Number.isInteger(n) || n < 1 || n > 3650)
      throw new Error("« Jours d'inactivité » doit être un entier entre 1 et 3650.");
    out.inactiveDays = n;
  }
  return out;
}

const nonEmpty = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Valide un bouton d'un message de relance : lien http(s), ou « Offre (campagne) » (campagne + offre). */
function parseButton(b: unknown, n: number): AutomationButton {
  const bb = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  if (bb.type === "OFFER") {
    const text = nonEmpty(bb.text);
    if (!text) throw new Error(`Action ${n} : écrivez le libellé du bouton Offre.`);
    const campaignId = nonEmpty(bb.campaignId);
    const affiliateCampaignId = nonEmpty(bb.affiliateCampaignId);
    if (!campaignId || !affiliateCampaignId)
      throw new Error(
        `Action ${n} : bouton « ${text} » : choisissez la campagne (menu Campagnes) et son offre.`,
      );
    return { text, type: "OFFER", campaignId, affiliateCampaignId };
  }
  if (typeof bb.text !== "string" || typeof bb.url !== "string" || !/^https?:\/\//.test(bb.url))
    throw new Error(`Action ${n} : chaque bouton a un libellé et une URL http(s).`);
  return { text: bb.text.trim(), url: bb.url.trim() };
}

/** Boutons « Offre (campagne) » d'une liste d'actions (vérifiés à l'enregistrement d'une relance). */
export function automationOfferButtons(
  actions: readonly AutomationAction[],
): AutomationOfferButton[] {
  return actions.flatMap((a) =>
    a.type === "send_message" ? (a.buttons ?? []).flat().filter(isOfferButton) : [],
  );
}

/** Valide une liste d'actions brutes (JSON). */
export function parseActions(raw: unknown): AutomationAction[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("Actions invalides : liste attendue.");
  if (raw.length > MAX_ACTIONS) throw new Error(`Au maximum ${MAX_ACTIONS} actions par relance.`);
  return raw.map((a, i) => {
    const n = i + 1;
    if (!a || typeof a !== "object") throw new Error(`Action ${n} invalide.`);
    const o = a as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    switch (o.type) {
      case "send_message": {
        if (!text) throw new Error(`Action ${n} : le texte du message est obligatoire.`);
        // Longueur visible (comme Telegram) : un emoji animé compte comme son emoji de remplacement (phase 12).
        if (textLength(text) > TELEGRAM_TEXT_MAX)
          throw new Error(`Action ${n} : texte trop long (4096 caractères maximum).`);
        let buttons: AutomationButton[][] | undefined;
        if (o.buttons !== undefined && o.buttons !== null) {
          if (!Array.isArray(o.buttons)) throw new Error(`Action ${n} : boutons invalides.`);
          buttons = (o.buttons as unknown[])
            .map((row) => {
              if (!Array.isArray(row)) throw new Error(`Action ${n} : ligne de boutons invalide.`);
              return row.map((b) => parseButton(b, n));
            })
            .filter((r) => r.length > 0);
        }
        return {
          type: "send_message",
          text,
          buttons,
          mediaAssetId:
            typeof o.mediaAssetId === "string" && o.mediaAssetId ? o.mediaAssetId : null,
          botId: typeof o.botId === "string" && o.botId ? o.botId : null,
        };
      }
      case "send_sequence": {
        const t = o.trigger;
        if (
          ![
            "JOIN_REQUEST",
            "GATE_REMINDER",
            "GATE_SATISFIED",
            "APPROVED",
            "START",
            "OFFER_REPLY",
          ].includes(String(t))
        )
          throw new Error(`Action ${n} : message du bot inconnu.`);
        return {
          type: "send_sequence",
          trigger: t as Extract<AutomationAction, { type: "send_sequence" }>["trigger"],
        };
      }
      case "wait": {
        const h = Number(o.hours);
        if (!Number.isFinite(h) || h <= 0 || h > 24 * 90)
          throw new Error(`Action ${n} : « attendre » exige un nombre d'heures entre 0,1 et 2160.`);
        return { type: "wait", hours: h };
      }
      case "tag": {
        const tag = typeof o.tag === "string" ? o.tag.trim().slice(0, 40) : "";
        if (!tag) throw new Error(`Action ${n} : l'étiquette est obligatoire.`);
        return { type: "tag", tag };
      }
      case "suggest_channel": {
        if (typeof o.channelId !== "string" || !o.channelId)
          throw new Error(`Action ${n} : choisissez le canal à proposer.`);
        return { type: "suggest_channel", channelId: o.channelId, text: text || undefined };
      }
      case "notify_team": {
        if (!text) throw new Error(`Action ${n} : le texte de la notification est obligatoire.`);
        return { type: "notify_team", text };
      }
      default:
        throw new Error(`Action ${n} : type inconnu.`);
    }
  });
}

/** Contexte d'un membre au moment de l'évaluation. */
export type AutomationContext = {
  channelId?: string | null;
  campaignId?: string | null;
  languageCode?: string | null;
  spendLevel?: SpendLevel | null;
  inactiveDays?: number | null;
  categoryId?: string | null;
};

/** Toutes les conditions renseignées doivent être satisfaites (ET logique) ; une condition vide est ignorée. */
export function matchesConditions(ctx: AutomationContext, c: AutomationConditions): boolean {
  if (c.channelIds?.length && !(ctx.channelId && c.channelIds.includes(ctx.channelId)))
    return false;
  if (c.campaignIds?.length && !(ctx.campaignId && c.campaignIds.includes(ctx.campaignId)))
    return false;
  if (c.languages?.length) {
    const base = (ctx.languageCode ?? "").toLowerCase().split("-")[0] ?? "";
    if (!c.languages.includes(base)) return false;
  }
  if (c.spendLevels?.length && !(ctx.spendLevel && c.spendLevels.includes(ctx.spendLevel)))
    return false;
  if (
    c.inactiveDays !== undefined &&
    !(typeof ctx.inactiveDays === "number" && ctx.inactiveDays >= c.inactiveDays)
  )
    return false;
  if (c.categoryIds?.length && !(ctx.categoryId && c.categoryIds.includes(ctx.categoryId)))
    return false;
  return true;
}

/** Remplace {prenom}, {canal}, {bot} (et toute autre clé fournie) dans un texte. */
export function renderActionText(
  text: string,
  vars: Record<string, string | null | undefined>,
): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m,
  );
}

/** Résumé lisible d'une liste d'actions (interface). */
export function summarizeActions(actions: AutomationAction[]): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case "send_message":
          return "Message";
        case "send_sequence":
          return `Message du bot « ${AUTOMATION_SEQUENCE_LABELS[a.trigger]} »`;
        case "wait":
          return `Attendre ${a.hours} h`;
        case "tag":
          return `Étiquette « ${a.tag} »`;
        case "suggest_channel":
          return "Proposer un canal";
        case "notify_team":
          return "Prévenir l'équipe";
      }
    })
    .join(" → ");
}
