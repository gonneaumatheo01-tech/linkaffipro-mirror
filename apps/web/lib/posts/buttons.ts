/** Format JSON des boutons d'un message (`Post.buttons`) — identique à apps/worker/src/sending/keyboard.ts. */
export type PostButtonType = "URL" | "BUTTON" | "OFFER";
export type PostButton = {
  text: string;
  type: PostButtonType;
  url?: string;
  trackingLinkId?: string;
  slug?: string;
  /** Lien Link Affi (campagne d'affiliation) utilisé par le bouton Offre. */
  affiliateCampaignId?: string;
  /** Notre campagne (page Campagnes) choisie pour ce bouton Offre ; absent sur les boutons créés avant la phase 8. */
  campaignId?: string;
};
export type PostButtonRow = PostButton[];

export const BUTTON_TYPE_LABELS: Record<PostButtonType, string> = {
  URL: "Lien direct",
  BUTTON: "Lien traqué",
  OFFER: "Offre (campagne)",
};

/** Adresse d'un bouton « Lien direct » ou « Lien traqué » : message d'erreur si elle ne commence pas par http(s)://. */
export function buttonUrlError(b: Pick<PostButton, "text" | "type" | "url">): string | null {
  if (b.type === "OFFER") return null;
  if (!b.url || !/^https?:\/\//i.test(b.url))
    return `Bouton « ${b.text} » : l'adresse doit commencer par https://.`;
  return null;
}

export function parseButtons(value: unknown): PostButtonRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) =>
      Array.isArray(row)
        ? row.filter(
            (b) => b && typeof b === "object" && typeof (b as PostButton).text === "string",
          )
        : [],
    )
    .filter((row) => row.length > 0) as PostButtonRow[];
}

/** URL affichée pour un bouton (aperçu) ; identique à celle construite par le worker. */
export function previewButtonUrl(
  b: PostButton,
  ctx: { trackingBaseUrl: string; botUsername: string; postCode: string },
): string {
  const base = ctx.trackingBaseUrl.replace(/\/$/, "");
  if (b.type === "URL") return b.url ?? "";
  if (b.type === "BUTTON") return b.slug ? `${base}/${b.slug}` : "(créé à l'enregistrement)";
  return b.slug
    ? `https://t.me/${ctx.botUsername}?start=o${b.slug}_${ctx.postCode}`
    : "(créé à l'enregistrement)";
}
