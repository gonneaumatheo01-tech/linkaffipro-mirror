import type { PostStatus } from "@linkaffipro/db";
import type { Universe } from "@/lib/universe";

/** Message tel que le calendrier l'affiche (données sérialisables préparées par la page serveur). */
export type CalendarItem = {
  id: string;
  /** Heure de Paris « AAAA-MM-JJTHH:MM ». */
  local: string;
  status: PostStatus;
  universe: Universe | null;
  channelId: string;
  channelTitle: string;
  category: { name: string; color: string } | null;
  /** Début du texte, sans mise en forme. */
  excerpt: string;
  /** HTML Telegram (aperçu du volet). */
  html: string;
  buttons: Array<Array<{ text: string }>>;
  mediaCount: number;
  abGroupId: string | null;
  abVariant: string | null;
  movable: boolean;
  editable: boolean;
};
