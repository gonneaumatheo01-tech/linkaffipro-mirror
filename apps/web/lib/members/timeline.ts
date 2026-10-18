/** Construction de la chronologie d'un membre : fusion de sources hétérogènes, triée par date (fonction pure). */

import type { OutboundKind } from "@linkaffipro/db";
import { withMinusSign } from "@/lib/campaigns/cards";
import { fmtMoney } from "@/lib/format";
import { eventLabel } from "@/lib/journal/event-labels";
import { linkLabel } from "@/lib/links/label";

export type TimelineKind = "membership" | "message" | "click" | "player" | "event";

export type TimelineEntry = {
  at: Date;
  kind: TimelineKind;
  /** Titre court en français. */
  title: string;
  /** Détail optionnel (canal, montant, identifiant de suivi…). */
  detail?: string;
  /** Lien interne optionnel. */
  href?: string;
};

export type MembershipLike = {
  id: string;
  channelTitle: string;
  status: string;
  requestedAt: Date;
  gateSatisfiedAt?: Date | null;
  approveAt?: Date | null;
  approvedAt?: Date | null;
  declinedAt?: Date | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  sourceName?: string | null;
};

export type OutboundLike = {
  kind: string;
  status: string;
  queuedAt: Date;
  sentAt?: Date | null;
  botUsername?: string | null;
  /**
   * Note du service d'arrière-plan (`OutboundMessage.error`). Sur un message parti : « Envoyé avec les emojis normaux :
   * Telegram a refusé les emojis animés. » (phase 12), « Média non envoyé : … ». Montrée dans l'historique.
   */
  error?: string | null;
};

/** « envoyé », ou la note d'un message parti quand même (sans répéter « envoyé »). */
function sentDetail(error: string | null | undefined): string {
  const note = error?.trim().replace(/\.$/, "");
  if (!note) return "envoyé";
  return /^envoyé/i.test(note) ? note : `envoyé · ${note}`;
}
export type ClickLike = {
  createdAt: Date;
  subId?: string | null;
  kind?: string | null;
  label?: string | null;
  postId?: string | null;
  isBot?: boolean;
};
export type PlayerEventLike = {
  type: string;
  occurredAt: Date;
  amount?: number | null;
  currency?: string | null;
  campaignName?: string | null;
};
export type EventLike = { type: string; occurredAt: Date };

const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Demande en attente",
  PENDING_GATE: "En attente des canaux à rejoindre",
  SCHEDULED: "Acceptation programmée",
  APPROVED: "Accepté",
  DECLINED: "Refusé",
  LEFT: "Parti",
  KICKED: "Exclu",
  EXPIRED: "Demande expirée",
  FAILED: "Acceptation échouée",
};

const OUTBOUND_KIND_LABEL: Record<OutboundKind, string> = {
  WELCOME: "Message d'accueil",
  GATE_REMINDER: "Rappel « rejoins les canaux »",
  ACCEPTED: "Message « accepté »",
  OFFER_REPLY: "Réponse à un clic sur une offre",
  BROADCAST: "Message à un groupe",
  AUTOMATION: "Relance automatique",
  TEST: "Message de test",
  ASSISTANT: "Message de l'assistant de conversation",
};

const PLAYER_EVENT_LABEL: Record<string, string> = {
  CLICK: "Clic Link Affi",
  REGISTRATION: "Inscription",
  FTD: "Premier dépôt",
  DEPOSIT: "Dépôt",
  REDEPOSIT: "Redépôt",
  NGR: "Variation du revenu net",
  OTHER: "Événement joueur",
};

/**
 * Montant d'un événement joueur, écrit comme les cartes de la fiche (« 26,34 € », vrai signe moins « −12,96 € ») ;
 * une devise inconnue d'Intl garde son code (« 5,00 XYZ »).
 */
function money(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | undefined {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return undefined;
  const code = currency?.trim() || "EUR";
  try {
    return withMinusSign(fmtMoney(amount, code.toUpperCase()));
  } catch {
    const n = amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${withMinusSign(n)} ${code}`;
  }
}

/**
 * Nom du bouton après « Clic sur une offre » : sans le mot « Offre » répété (« Offre — Casino Bienvenue » →
 * « Casino Bienvenue » ; « Offre » seul → rien).
 */
function offerLabel(label: string | null | undefined): string {
  const l = (label ?? "").trim();
  if (!l || /^offres?$/i.test(l)) return "";
  return l.replace(/^offres?\s*[—–:·|-]\s*/i, "").trim();
}

export function buildTimeline(input: {
  memberships?: MembershipLike[];
  outbound?: OutboundLike[];
  clicks?: ClickLike[];
  playerEvents?: PlayerEventLike[];
  events?: EventLike[];
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];

  for (const m of input.memberships ?? []) {
    const src = m.sourceName ? ` · via ${m.sourceName}` : "";
    out.push({
      at: m.requestedAt,
      kind: "membership",
      title: `Demande pour rejoindre ${m.channelTitle}`,
      detail: `${MEMBERSHIP_STATUS_LABEL[m.status] ?? m.status}${src}`,
    });
    if (m.gateSatisfiedAt)
      out.push({
        at: m.gateSatisfiedAt,
        kind: "membership",
        title: `Canaux requis rejoints (${m.channelTitle})`,
      });
    if (m.approvedAt)
      out.push({ at: m.approvedAt, kind: "membership", title: `Accepté dans ${m.channelTitle}` });
    if (m.declinedAt)
      out.push({ at: m.declinedAt, kind: "membership", title: `Refusé pour ${m.channelTitle}` });
    if (m.joinedAt)
      out.push({ at: m.joinedAt, kind: "membership", title: `Entré dans ${m.channelTitle}` });
    if (m.leftAt)
      out.push({
        at: m.leftAt,
        kind: "membership",
        title: `${m.status === "KICKED" ? "Exclu de" : "A quitté"} ${m.channelTitle}`,
      });
  }

  for (const o of input.outbound ?? []) {
    const bot = o.botUsername ? ` (@${o.botUsername})` : "";
    const status =
      o.status === "SENT"
        ? sentDetail(o.error)
        : o.status === "FAILED"
          ? "échec"
          : o.status === "BLOCKED"
            ? "bloqué"
            : "en attente";
    out.push({
      at: o.sentAt ?? o.queuedAt,
      kind: "message",
      title: `${OUTBOUND_KIND_LABEL[o.kind as OutboundKind] ?? "Message du bot"}${bot}`,
      detail: status,
    });
  }

  for (const c of input.clicks ?? []) {
    if (c.isBot) continue;
    const offer = c.kind === "OFFER";
    const name = offer ? offerLabel(c.label) : linkLabel((c.label ?? "").trim());
    const label = name ? ` — ${name}` : "";
    out.push({
      at: c.createdAt,
      kind: "click",
      title: offer ? `Clic sur une offre${label}` : `Clic${label}`,
      detail: c.subId ? `identifiant de suivi ${c.subId}` : undefined,
      href: c.postId ? `/messages/${c.postId}` : undefined,
    });
  }

  for (const p of input.playerEvents ?? []) {
    const camp = p.campaignName ? ` (${p.campaignName})` : "";
    out.push({
      at: p.occurredAt,
      kind: "player",
      title: `${PLAYER_EVENT_LABEL[p.type] ?? p.type}${camp}`,
      detail: money(p.amount, p.currency),
    });
  }

  for (const e of input.events ?? []) {
    out.push({ at: e.occurredAt, kind: "event", title: eventLabel(e.type) });
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Page d'une chronologie déjà triée (taille fixe) : entrées de la page, total et nombre de pages. */
export function paginateTimeline(
  entries: TimelineEntry[],
  page: number,
  size = 50,
): { entries: TimelineEntry[]; total: number; pages: number; page: number } {
  const total = entries.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return {
    entries: entries.slice((current - 1) * size, current * size),
    total,
    pages,
    page: current,
  };
}
