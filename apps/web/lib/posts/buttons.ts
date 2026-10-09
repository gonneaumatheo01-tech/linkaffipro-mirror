/** Format JSON des boutons d'un message (`Post.buttons`) — identique à apps/worker/src/sending/keyboard.ts. */
export type PostButtonType = "URL" | "BUTTON" | "OFFER";
export type PostButton = { text: string; type: PostButtonType; url?: string; trackingLinkId?: string; slug?: string; affiliateCampaignId?: string };
export type PostButtonRow = PostButton[];

export const BUTTON_TYPE_LABELS: Record<PostButtonType, string> = { URL: "Lien direct", BUTTON: "Lien traqué", OFFER: "Offre personnalisée (sub-ID)" };

export function parseButtons(value: unknown): PostButtonRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => (Array.isArray(row) ? row.filter((b) => b && typeof b === "object" && typeof (b as PostButton).text === "string") : []))
    .filter((row) => row.length > 0) as PostButtonRow[];
}

/** URL affichée pour un bouton (aperçu) ; identique à celle construite par le worker. */
export function previewButtonUrl(b: PostButton, ctx: { trackingBaseUrl: string; botUsername: string; postCode: string }): string {
  const base = ctx.trackingBaseUrl.replace(/\/$/, "");
  if (b.type === "URL") return b.url ?? "";
  if (b.type === "BUTTON") return b.slug ? `${base}/${b.slug}` : "(créé à l'enregistrement)";
  return b.slug ? `https://t.me/${ctx.botUsername}?start=o${b.slug}_${ctx.postCode}` : "(créé à l'enregistrement)";
}
