/**
 * Phase 31, chantier B — page publique `https://t.me/<nom>` (section 3.1) : titre, description, nombre d'abonnés
 * (canal) ou de membres (→ groupe), aperçu `t.me/s/` disponible ou non. La photo est ignorée. Une page de personne,
 * de bot ou une page vide (« If you have Telegram, you can contact @x ») = canal introuvable.
 */
import type { ChannelPage, ProspectionDeps } from "../contract";
import { attrOf, classIndexOf, decodeHtmlEntities, hasClassToken, innerByClass, openTagAt, previewHtmlToText } from "./html";
import { enrichFetch } from "./net";

export type AudienceCount = { count: number; exact: boolean; kind: "CHANNEL" | "GROUP" };

/**
 * « 9 242 552 subscribers » → 9242552 (exact) ; « 12.3K subscribers » → 12300 (arrondi affiché) ; « 9 839 members,
 * 520 online » → groupe. Séparateurs de milliers acceptés : espace, espace insécable, virgule, point (« 12,345 »).
 */
export function parseAudienceCount(raw: string | null | undefined): AudienceCount | null {
  if (!raw) return null;
  const s = decodeHtmlEntities(raw).replace(/[\u00a0\u202f]/g, " ").trim();
  const m = /(\d[\d\s.,]*?)\s*([KMB])?\s+(subscribers?|members?|abonnés?|membres?)\b/i.exec(s);
  if (!m) return null;
  const kind = /^(members?|membres?)$/i.test(m[3]!) ? "GROUP" : "CHANNEL";
  const num = m[1]!.trim();
  const suffix = m[2]?.toUpperCase();
  if (suffix) {
    const v = Number(num.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(v)) return null;
    return { count: Math.round(v * { K: 1e3, M: 1e6, B: 1e9 }[suffix as "K" | "M" | "B"]), exact: false, kind };
  }
  // Sans suffixe : nombre entier écrit avec séparateurs de milliers (« 12 345 », « 12,345 », « 12.345 »).
  const digits = num.replace(/[\s.,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return { count: Number(digits), exact: true, kind };
}

/** Analyse la page `t.me/<nom>` (fonction pure). */
export function parseChannelPage(html: string): ChannelPage {
  if (!html || !hasClassToken(html, "tgme_page")) return { ok: false, reason: "error", message: "Page Telegram illisible." };
  const titleHtml = innerByClass(html, "tgme_page_title");
  const title = titleHtml !== null ? previewHtmlToText(titleHtml).replace(/\s*✔\s*$/, "").trim() : "";
  const extra = innerByClass(html, "tgme_page_extra");
  const audience = parseAudienceCount(extra ? previewHtmlToText(extra) : null);
  // Page vide de Telegram (nom inconnu) : icône de personne, pas de titre, bouton « Send Message ».
  if (!title || hasClassToken(html, "tgme_icon_user"))
    return { ok: false, reason: "not_found", message: "Aucun canal public à ce nom." };
  if (!audience) {
    // Personne ou bot (« @nom » en sous-titre, « Send Message ») : pas un canal ni un groupe.
    const action = innerByClass(html, "tgme_page_action") ?? "";
    if (/Send Message|Start Bot/i.test(action) || /^@\w+$/.test(previewHtmlToText(extra ?? "").trim()))
      return { ok: false, reason: "not_found", message: "Ce nom n'est pas un canal ni un groupe public." };
  }
  const descHtml = innerByClass(html, "tgme_page_description");
  const description = descHtml !== null ? previewHtmlToText(descHtml) || null : null;
  const ctxIdx = classIndexOf(html, "tgme_page_context_link");
  const ctxHref = ctxIdx >= 0 ? attrOf(openTagAt(html, ctxIdx), "href") : null;
  const hasPreview = ctxIdx >= 0 && (/^\/s\//.test(ctxHref ?? "") || /Preview channel/i.test(html.slice(ctxIdx, ctxIdx + 300)));
  return {
    ok: true,
    title,
    description,
    subscribers: audience?.count ?? null,
    kind: audience?.kind ?? "CHANNEL",
    hasPreview,
  };
}

/** Nombre affiché sur la page : exact ou arrondi (« 12.3K »). Sert au contrôle et à l'explication. */
export function audienceIsExact(html: string): boolean {
  const extra = innerByClass(html, "tgme_page_extra");
  return parseAudienceCount(extra ? previewHtmlToText(extra) : null)?.exact ?? false;
}

/** Lit `https://t.me/<nom>` par la lecture polie (1 requête). 404 → introuvable ; 5xx / 429 / réseau → erreur. */
export async function fetchChannelPage(deps: ProspectionDeps, username: string): Promise<ChannelPage> {
  const url = `https://t.me/${username}`;
  let res;
  try {
    res = await enrichFetch(deps, url, "tme");
  } catch (err) {
    return { ok: false, reason: "error", message: `Lecture de t.me/${username} impossible pour l'instant (${String((err as Error)?.message ?? err).slice(0, 80)}).` };
  }
  if (res.status === 404) return { ok: false, reason: "not_found", message: "Aucun canal public à ce nom." };
  if (res.status !== 200) return { ok: false, reason: "error", message: `Telegram ne répond pas pour t.me/${username} (code ${res.status}).` };
  // Redirection vers une invitation privée : jamais suivie (règle 2).
  if (/t\.me\/(\+|joinchat)/i.test(res.finalUrl)) return { ok: false, reason: "private", message: "Canal privé : lecture impossible sans le rejoindre." };
  return parseChannelPage(res.body);
}
