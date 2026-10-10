/**
 * Lecture d'un lien public de canal tel que saisi par l'utilisateur : `t.me/<nom>`, `https://t.me/<nom>`, `t.me/s/<nom>`
 * (aperçu web), `@nom` ou `nom`.
 * - `invite` : lien d'invitation privé (`t.me/+…`, `t.me/joinchat/…`) ;
 * - `private` : lien d'un message de canal privé (`t.me/c/<chiffres>/…`) ;
 * dans les deux cas le canal ne se retrouve pas par son nom : il faut la méthode 1 (transférer un message du canal).
 * Pure (sans réseau ni base) : testée unitairement.
 */
export type ParsedChannelLink =
  | { kind: "username"; username: string }
  | { kind: "invite" }
  | { kind: "private" }
  | { kind: "invalid" };

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
/** Ponctuation ou guillemets collés au lien (« (t.me/canal). », « <t.me/canal> ») : jamais dans un nom de canal. */
const LEADING_PUNCT_RE = /^[\s(«[<"'“‘]+/;
const TRAILING_PUNCT_RE = /[\s.,;:!?)»\]>"'”’…]+$/;
const TELEGRAM_LINK_RE = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i;

/** Retire les espaces, la ponctuation et les guillemets autour d'un lien ou d'un @nom. */
export function stripLinkPunctuation(raw: string): string {
  return String(raw ?? "")
    .replace(LEADING_PUNCT_RE, "")
    .replace(TRAILING_PUNCT_RE, "");
}

export function parseChannelLink(raw: string): ParsedChannelLink {
  let s = stripLinkPunctuation(raw);
  if (!s) return { kind: "invalid" };
  s = s.replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "");
  s = s.replace(/^tg:\/\/resolve\?domain=/i, "");
  s = s.split(/[?#]/)[0] ?? "";
  s = s.replace(/\/+$/, "");
  // Lien d'invitation privé (t.me/+xxxx ou t.me/joinchat/xxxx) : impossible par getChat → méthode 1.
  if (s.startsWith("+") || /^joinchat\//i.test(s)) return { kind: "invite" };
  // Lien d'un message de canal privé (t.me/c/1234567890/5) : seul l'identifiant interne y figure → méthode 1.
  if (/^c\/\d+(\/|$)/i.test(s)) return { kind: "private" };
  // Aperçu web d'un canal public (t.me/s/nom).
  s = s.replace(/^s\//i, "");
  // `t.me/nom/123` (lien vers un message) : on garde le nom.
  s = s.split("/")[0] ?? "";
  if (s.startsWith("@")) s = s.slice(1);
  if (!USERNAME_RE.test(s)) return { kind: "invalid" };
  return { kind: "username", username: s };
}

/**
 * Lien d'un bot plutôt que d'un canal : paramètre de démarrage (`?start=`, `?startgroup=`, `?startapp=`…, typiquement un lien
 * d'offre `t.me/<bot>?start=o…`) ou nom finissant par « bot » (Telegram réserve cette fin aux bots).
 */
function isBotLink(link: string): boolean {
  if (/[?&]start(?:group|channel|app)?(?:=|&|$)/i.test(link)) return true;
  const name = link.replace(TELEGRAM_LINK_RE, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /bot$/i.test(name ?? "");
}

/**
 * Lien de canal envoyé au bot : seulement si le message se réduit au lien t.me/… ou au `@nom` (ponctuation autour tolérée).
 * Un lien au milieu d'une phrase (réponse au dialogue, canal d'un autre cité en passant) ou un lien de bot (offre) n'en est pas un.
 * Renvoie le lien nettoyé à passer à `parseChannelLink`, sinon null (texte ordinaire).
 */
export function findChannelLinkInText(text: string): string | null {
  const s = stripLinkPunctuation(text);
  if (!s || /\s/.test(s)) return null;
  if (!TELEGRAM_LINK_RE.test(s) && !/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s)) return null;
  if (isBotLink(s)) return null;
  return s;
}
