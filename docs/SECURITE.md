# Sécurité du site (phase 3)

## Limitation des tentatives de connexion
- Au plus **10 échecs en 15 minutes** par adresse e-mail **et** par adresse IP (`apps/web/lib/security/throttle.ts`, branché dans `apps/web/auth.ts`).
- Au-delà, la connexion est refusée **avant** la vérification du mot de passe (même message générique « identifiants invalides » : pas d'indice pour un attaquant).
- Compteurs dans Redis (`login:fail:email:<e-mail>`, `login:fail:ip:<ip>`, TTL 15 min) ; repli en mémoire du process si Redis est indisponible.
- Une connexion réussie remet les compteurs à zéro. Les refus sont journalisés dans `AuditLog` (`auth.login_throttled`), les échecs dans `auth.login_failed`.
- Déblocage manuel en cas d'urgence : `railway ssh --service web -- node -e "..."` n'est pas nécessaire, il suffit d'attendre 15 minutes.

## En-têtes de sécurité (`apps/web/proxy.ts`)
Posés sur toutes les réponses : `Strict-Transport-Security` (1 an, sous-domaines), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (caméra, micro, géolocalisation refusés), `x-request-id` (diagnostic).

`Content-Security-Policy` sur les pages du site uniquement (pas sur `/api/*` ni sur les redirections go.goolink.eu) : scripts et styles du site (`'unsafe-inline'` requis par Next 16 sans nonce), images `https:` (aperçus de médias Telegram), `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`.

## Limites de taille des webhooks
- Webhook Telegram et postbacks directs : corps refusé au-delà de 1 Mo (413).
- Postbacks : 60 requêtes / minute / jeton (déjà en place en phase 2).

## Droits
- Suppressions (messages, brouillons d'envoi, membres) réservées aux ADMIN (`requireAdmin`) ; les MANAGER voient tout mais ne suppriment rien.

## Ce qui n'est pas fait (volontairement)
- Pas de 2FA (décision produit).
- Pas de nonce CSP (Next 16 App Router : scripts inline générés ; un nonce imposerait une configuration dynamique par requête, à revoir si besoin).
