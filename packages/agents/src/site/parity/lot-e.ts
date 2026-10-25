/** Phase 34 — correspondance des actions serveur du lot E (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";
import { LOT_E_OPS } from "../ops/lot-e";

/**
 * Exclusions documentées (règle 5) : sécurité du compte, code de connexion Telegram, affichage seul. Chacune a sa
 * raison et le remplacement que Kevin propose.
 */
const SECURITY_LINK =
  "Kevin envoie le lien direct de la page (lien d'autorisation signé, usage unique, 15 minutes : `createAuthLink`).";

const CODE_REASON =
  "Telegram annule un code de connexion recopié dans une conversation Telegram (protection contre le vol de compte) : le code ne peut pas passer par Kevin.";

const EXCLUDED: Record<string, SiteParityEntry> = {
  "app/(auth)/login/actions.ts#loginAction": {
    excluded: {
      reason: "Connexion au site (e-mail et mot de passe) : sécurité du compte, elle se fait dans le navigateur.",
      replacement: `${SECURITY_LINK} (purpose « login »)`,
    },
  },
  "app/invite/[token]/actions.ts#acceptInviteAction": {
    excluded: {
      reason: "Acceptation d'une invitation (choix du mot de passe par la personne invitée) : sécurité du compte.",
      replacement: "Kevin envoie le lien direct de l'invitation (« equipe.inviter » rend le lien) ; la personne choisit son mot de passe sur la page.",
    },
  },
  "app/(admin)/account/actions.ts#changePasswordAction": {
    excluded: {
      reason: "Changement de mot de passe (mot de passe actuel exigé) : sécurité du compte, jamais un mot de passe du site dans une conversation.",
      replacement: `${SECURITY_LINK} (purpose « page », Mon compte)`,
    },
  },
  "app/(admin)/account/actions.ts#generateTelegramLinkAction": {
    excluded: {
      reason: "Lier son compte Telegram à son compte du site décide qui Kevin reconnaît : sécurité du compte, faite depuis la session du site.",
      replacement: `${SECURITY_LINK} (purpose « page », Mon compte → Lier Telegram)`,
    },
  },
  "app/(admin)/account/actions.ts#unlinkTelegramAction": {
    excluded: {
      reason: "Délier son compte Telegram retire l'accès à Kevin : sécurité du compte, faite depuis la session du site.",
      replacement: `${SECURITY_LINK} (purpose « page », Mon compte)`,
    },
  },
  "app/(admin)/settings/connectors/telegram/actions.ts#signInAction": {
    excluded: {
      reason: `Étape « code reçu » du compte qui relève les vues. ${CODE_REASON}`,
      replacement: `Kevin envoie le code (« connecteurs.telegram_envoyer_code »), puis le lien direct de Réglages → Connexions → Telegram pour taper le code ; le mot de passe en deux étapes, lui, passe par Kevin en privé. ${SECURITY_LINK}`,
    },
  },
  "app/(admin)/settings/accounts/actions.ts#submitCodeAction": {
    excluded: {
      reason: `Étape « code reçu » d'un vrai compte Telegram. ${CODE_REASON}`,
      replacement: `Kevin envoie le code (« connecteurs.compte_ajouter »), puis le lien direct de Réglages → Comptes pour taper le code ; le mot de passe en deux étapes, lui, passe par Kevin en privé. ${SECURITY_LINK}`,
    },
  },
  "lib/onboarding/actions.ts#completeTourAction": {
    excluded: {
      reason: "Visite guidée du site : affichage seul (la visite n'existe que dans le navigateur).",
      replacement: "L'aide de Kevin (« aide », « comment je fais … ? ») remplace la visite guidée.",
    },
  },
  "lib/onboarding/actions.ts#dismissChecklistAction": {
    excluded: {
      reason: "Masquer la liste « À faire pour démarrer » de l'accueil du site : affichage seul.",
      replacement: "L'aide de Kevin (« commencer », « aide ») donne la même liste de départ.",
    },
  },
  "lib/onboarding/actions.ts#restartTourAction": {
    excluded: {
      reason: "Revoir la visite guidée du site : affichage seul.",
      replacement: "L'aide de Kevin (« aide », « commencer ») remplace la visite guidée.",
    },
  },
};

/** Chaque action serveur couverte pointe vers la première opération qui la cite (`serverActions`). */
function fromOps(): Record<string, SiteParityEntry> {
  const out: Record<string, SiteParityEntry> = {};
  for (const op of LOT_E_OPS) for (const a of op.serverActions) out[a] ??= { op: op.key };
  return out;
}

export const LOT_E_PARITY: Record<string, SiteParityEntry> = { ...fromOps(), ...EXCLUDED };
