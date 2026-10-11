import type { PostStatus, Vertical } from "@linkaffipro/db";
import type { CalendarItem } from "@/components/messages/calendar/types";
import { parseButtons } from "@/lib/posts/buttons";
import { canEdit, canMove, toLocal } from "@/lib/posts/calendar";
import { postExcerpt } from "@/lib/posts/display";
import { toUniverse } from "@/lib/universe";

/** Options des filtres de la page Messages (chargées une fois par la page). */
export type MessagesOptions = {
  channels: Array<{ id: string; title: string; vertical: Vertical | null }>;
  categories: Array<{ id: string; name: string; color: string }>;
  campaigns: Array<{ id: string; name: string }>;
};

export type SearchParams = Record<string, string | string[] | undefined>;

/** Première valeur d'un paramètre d'adresse. */
export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Message préparé pour le volet de détail (même volet dans le calendrier et dans la liste) et pour les cartes du
 * calendrier. Sans date (brouillon jamais programmé) : `local` vide, et pas de « Déplacer ».
 */
export function toPanelItem(p: {
  id: string;
  text: string;
  status: PostStatus;
  isTemplate?: boolean;
  scheduledAt: Date | null;
  channelId: string;
  channel: { title: string; vertical: Vertical | null };
  category: { name: string; color: string } | null;
  buttons: unknown;
  mediaAssetIds: unknown;
  abGroupId: string | null;
  abVariant: string | null;
  publisher?: string | null;
}): CalendarItem {
  return {
    id: p.id,
    local: p.scheduledAt ? toLocal(p.scheduledAt) : "",
    status: p.status,
    universe: toUniverse(p.channel.vertical),
    channelId: p.channelId,
    channelTitle: p.channel.title,
    category: p.category ? { name: p.category.name, color: p.category.color } : null,
    excerpt: postExcerpt(p.text, 140),
    html: p.text,
    buttons: parseButtons(p.buttons).map((row) => row.map((b) => ({ text: b.text }))),
    mediaCount: Array.isArray(p.mediaAssetIds) ? p.mediaAssetIds.length : 0,
    abGroupId: p.abGroupId,
    abVariant: p.abVariant,
    movable: canMove(p) && p.scheduledAt !== null,
    editable: canEdit(p),
    publisher: p.publisher === "ACCOUNT" ? "ACCOUNT" : "BOT",
  };
}
