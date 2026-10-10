/**
 * Lecture d'un lien public de canal tel que saisi par l'utilisateur : `t.me/<nom>`, `https://t.me/<nom>`, `@nom` ou `nom`.
 * Pure (sans réseau ni base) : testée unitairement.
 */
export type ParsedChannelLink =
  | { kind: "username"; username: string }
  | { kind: "invite" }
  | { kind: "invalid" };

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function parseChannelLink(raw: string): ParsedChannelLink {
  let s = String(raw ?? "").trim();
  if (!s) return { kind: "invalid" };
  s = s.replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "");
  s = s.replace(/^tg:\/\/resolve\?domain=/i, "");
  s = s.split(/[?#]/)[0] ?? "";
  s = s.replace(/\/+$/, "");
  // Lien d'invitation privé (t.me/+xxxx ou t.me/joinchat/xxxx) : impossible par getChat → méthode 1.
  if (s.startsWith("+") || /^joinchat\//i.test(s)) return { kind: "invite" };
  // `t.me/nom/123` (lien vers un message) : on garde le nom.
  s = s.split("/")[0] ?? "";
  if (s.startsWith("@")) s = s.slice(1);
  if (!USERNAME_RE.test(s)) return { kind: "invalid" };
  return { kind: "username", username: s };
}
