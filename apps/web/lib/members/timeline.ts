/** Construction de la chronologie d'un membre : fusion de sources hétérogènes, triée par date (fonction pure). */

import { eventLabel } from "@/lib/journal/event-labels";

export type TimelineKind = "membership" | "message" | "click" | "player" | "event";

export type TimelineEntry = {
  at: Date;
  kind: TimelineKind;
  /** Titre court en français. */
  title: string;
  /** Détail optionnel (canal, montant, sub-ID…). */
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
};
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

const OUTBOUND_KIND_LABEL: Record<string, string> = {
  WELCOME: "Message d'accueil",
  GATE_REMINDER: "Rappel « rejoins les canaux »",
  ACCEPTED: "Message « accepté »",
  OFFER_REPLY: "Réponse à un clic offre",
  BROADCAST: "Envoi groupé",
  AUTOMATION: "Message automatique",
  TEST: "Message de test",
};

const PLAYER_EVENT_LABEL: Record<string, string> = {
  CLICK: "Clic Link Affi",
  REGISTRATION: "Inscription",
  FTD: "Premier dépôt",
  DEPOSIT: "Dépôt",
  REDEPOSIT: "Redépôt",
  NGR: "Variation du NGR",
  OTHER: "Événement joueur",
};

function money(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | undefined {
  if (amount === null || amount === undefined) return undefined;
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? "EUR"}`;
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
      title: `Demande d'adhésion à ${m.channelTitle}`,
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
        ? "envoyé"
        : o.status === "FAILED"
          ? "échec"
          : o.status === "BLOCKED"
            ? "bloqué"
            : "en attente";
    out.push({
      at: o.sentAt ?? o.queuedAt,
      kind: "message",
      title: `${OUTBOUND_KIND_LABEL[o.kind] ?? o.kind}${bot}`,
      detail: status,
    });
  }

  for (const c of input.clicks ?? []) {
    if (c.isBot) continue;
    const label = c.label ? ` — ${c.label}` : "";
    out.push({
      at: c.createdAt,
      kind: "click",
      title: c.kind === "OFFER" ? `Clic offre${label}` : `Clic${label}`,
      detail: c.subId ? `sub-ID ${c.subId}` : undefined,
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
