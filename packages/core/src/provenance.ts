/**
 * Provenance d'une demande d'adhésion et choix de la règle qui s'applique (phase 11) : fonctions pures, partagées par
 * le flux d'adhésion du bot (packages/telegram), le worker et le site (résumés et simulateur de « Qui peut entrer et
 * quand »).
 *
 * Exemple du client (11 octobre) : « Zone Interdite » accepte au bout de 5 minutes, sauf les personnes venues du bouton
 * « canal à rejoindre » de « Tir Cadré », acceptées au bout de 1 jour. Une règle par défaut (scope DEFAULT) et une
 * exception (scope SOURCE_CHANNEL, sourceChannelId = Tir Cadré).
 *
 * Résolution, du plus précis au plus général : règle du lien précis (INVITE_LINK) → règle du canal d'origine
 * (SOURCE_CHANNEL) → règle du type de provenance (SOURCE_KIND) → règle par défaut du canal (DEFAULT) → aucune règle.
 * À niveau égal, l'ordre choisi par l'équipe (`sortOrder`) départage.
 */

/** D'où vient la personne, d'après le lien d'invitation de sa demande. */
export type ProvenanceType =
  /** Bouton « canal à rejoindre » d'un de nos canaux (lien GATE). */
  | "GATE"
  /** Lien de partage créé depuis la fiche du canal (lien SHARE). */
  | "SHARE"
  /** Lien d'entrée d'une pub (lien AD_ENTRY). */
  | "AD"
  /** Lien d'invitation créé à la main par la plateforme (lien MANUAL). */
  | "MANUAL"
  /** Lien d'une campagne Telegram d'affilié créée dans Link Affi (lien LINKAFFI, phase 13). */
  | "LINKAFFI"
  /** Lien que la plateforme n'a pas créé (Telegram en masque la fin), lien public ou entrée sans lien. */
  | "UNKNOWN";

export type ProvenanceAdPlatform = "TIKTOK" | "META" | "OTHER";

export type Provenance = {
  type: ProvenanceType;
  /** Lien d'invitation de la plateforme (null : lien inconnu ou entrée sans lien). */
  inviteLinkId: string | null;
  /** Canal d'où vient la personne : canal qui l'a envoyée (GATE), canal où le lien de partage est posté (SHARE). */
  sourceChannelId: string | null;
  /** Plateforme de la pub (type AD seulement). */
  adPlatform: ProvenanceAdPlatform | null;
  /** Campagne Telegram d'affilié Link Affi (type LINKAFFI seulement, phase 13). */
  linkaffi?: ProvenanceLinkaffi | null;
};

/** Affilié et campagne Telegram Link Affi d'une provenance LINKAFFI (phase 13). */
export type ProvenanceLinkaffi = {
  campaignKey: string | null;
  campaignName: string | null;
  affiliateId: string | null;
  affiliateName: string | null;
};

/** Ce qu'il faut d'un lien d'invitation pour en déduire la provenance (`InviteLink` relu en base). */
export type ProvenanceLink = {
  id: string;
  kind: "AD_ENTRY" | "GATE" | "MANUAL" | "SHARE" | "LINKAFFI";
  sourceChannelId: string | null;
  adPlatform: string | null;
  /** Lien LINKAFFI (phase 13) : campagne et affilié Link Affi. */
  linkaffiCampaignKey?: string | null;
  linkaffiCampaignName?: string | null;
  linkaffiAffiliateId?: string | null;
  linkaffiAffiliateName?: string | null;
};

/** Provenance inconnue (lien absent ou créé hors de la plateforme) : la règle par défaut s'applique. */
export const UNKNOWN_PROVENANCE: Provenance = {
  type: "UNKNOWN",
  inviteLinkId: null,
  sourceChannelId: null,
  adPlatform: null,
};

function adPlatformOf(v: string | null): ProvenanceAdPlatform {
  return v === "TIKTOK" || v === "META" ? v : "OTHER";
}

/** Provenance d'une demande d'après son lien d'invitation (null : lien inconnu). */
export function provenanceOfLink(link: ProvenanceLink | null | undefined): Provenance {
  if (!link) return UNKNOWN_PROVENANCE;
  switch (link.kind) {
    case "GATE":
      return {
        type: "GATE",
        inviteLinkId: link.id,
        sourceChannelId: link.sourceChannelId,
        adPlatform: null,
      };
    case "SHARE":
      return {
        type: "SHARE",
        inviteLinkId: link.id,
        sourceChannelId: link.sourceChannelId,
        adPlatform: null,
      };
    case "AD_ENTRY":
      return {
        type: "AD",
        inviteLinkId: link.id,
        sourceChannelId: null,
        adPlatform: adPlatformOf(link.adPlatform),
      };
    case "LINKAFFI":
      return {
        type: "LINKAFFI",
        inviteLinkId: link.id,
        sourceChannelId: null,
        adPlatform: null,
        linkaffi: {
          campaignKey: link.linkaffiCampaignKey ?? null,
          campaignName: link.linkaffiCampaignName ?? null,
          affiliateId: link.linkaffiAffiliateId ?? null,
          affiliateName: link.linkaffiAffiliateName ?? null,
        },
      };
    default:
      return { type: "MANUAL", inviteLinkId: link.id, sourceChannelId: null, adPlatform: null };
  }
}

/** Relit une provenance enregistrée (`Membership.source.provenance`), prudemment ; null si absente ou illisible. */
export function provenanceFromJson(raw: unknown): Provenance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const types: ProvenanceType[] = ["GATE", "SHARE", "AD", "MANUAL", "LINKAFFI", "UNKNOWN"];
  if (!types.includes(r.type as ProvenanceType)) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const la =
    r.linkaffi && typeof r.linkaffi === "object" ? (r.linkaffi as Record<string, unknown>) : null;
  return {
    type: r.type as ProvenanceType,
    inviteLinkId: str(r.inviteLinkId),
    sourceChannelId: str(r.sourceChannelId),
    adPlatform: r.type === "AD" ? adPlatformOf(str(r.adPlatform)) : null,
    ...(r.type === "LINKAFFI"
      ? {
          linkaffi: {
            campaignKey: str(la?.campaignKey),
            campaignName: str(la?.campaignName),
            affiliateId: str(la?.affiliateId),
            affiliateName: str(la?.affiliateName),
          },
        }
      : {}),
  };
}

/** Portée d'une règle d'adhésion (enum Prisma `ApprovalRuleScope`). */
export type RuleScope = "DEFAULT" | "INVITE_LINK" | "SOURCE_CHANNEL" | "SOURCE_KIND";

/** Type de provenance d'une exception SOURCE_KIND (enum Prisma `ApprovalSourceKind`). */
export type SourceKind =
  | "GATE"
  | "ANY_CHANNEL"
  | "AD_ANY"
  | "AD_TIKTOK"
  | "AD_META"
  | "SHARE"
  /** N'importe quelle campagne Telegram d'affilié Link Affi (phase 13). */
  | "LINKAFFI_ANY"
  /** Les campagnes d'un affilié Link Affi précis (`ScopedRule.linkaffiAffiliateId`, phase 13). */
  | "LINKAFFI_AFFILIATE";

export const SOURCE_KINDS: readonly SourceKind[] = [
  "GATE",
  "ANY_CHANNEL",
  "AD_TIKTOK",
  "AD_META",
  "AD_ANY",
  "SHARE",
  "LINKAFFI_AFFILIATE",
  "LINKAFFI_ANY",
];

/** Ce qu'il faut d'une règle (`ApprovalRule`) pour savoir si elle s'applique à une provenance. */
export type ScopedRule = {
  id: string;
  scope: RuleScope;
  /** Règle par défaut du canal (`isDefault`) : une règle DEFAULT qui ne l'est pas est ignorée, comme avant la phase 11. */
  isDefault?: boolean;
  isActive: boolean;
  inviteLinkId: string | null;
  sourceChannelId: string | null;
  sourceKind: SourceKind | null;
  sortOrder: number;
  /** Affilié visé par une exception LINKAFFI_AFFILIATE (phase 13). */
  linkaffiAffiliateId?: string | null;
};

/** Niveaux de résolution, du plus précis au plus général. */
export const RULE_LEVELS: readonly RuleScope[] = [
  "INVITE_LINK",
  "SOURCE_CHANNEL",
  "SOURCE_KIND",
  "DEFAULT",
];

/** Le type de provenance d'une exception SOURCE_KIND correspond-il à la provenance ? */
export function sourceKindMatches(kind: SourceKind, p: Provenance): boolean {
  switch (kind) {
    case "GATE":
      return p.type === "GATE";
    case "ANY_CHANNEL":
      // Venue d'un de nos canaux : bouton « canal à rejoindre », ou lien de partage posté dans un de nos canaux.
      return p.type === "GATE" || (p.type === "SHARE" && p.sourceChannelId !== null);
    case "AD_ANY":
      return p.type === "AD";
    case "AD_TIKTOK":
      return p.type === "AD" && p.adPlatform === "TIKTOK";
    case "AD_META":
      return p.type === "AD" && p.adPlatform === "META";
    case "SHARE":
      return p.type === "SHARE";
    case "LINKAFFI_ANY":
    case "LINKAFFI_AFFILIATE":
      // L'affilié précis est contrôlé par `ruleMatches` (la règle porte `linkaffiAffiliateId`).
      return p.type === "LINKAFFI";
  }
}

/** La règle s'applique-t-elle à cette provenance ? (une règle inactive ne s'applique jamais) */
export function ruleMatches(rule: ScopedRule, p: Provenance): boolean {
  if (!rule.isActive) return false;
  switch (rule.scope) {
    case "DEFAULT":
      return rule.isDefault !== false;
    case "INVITE_LINK":
      return rule.inviteLinkId !== null && rule.inviteLinkId === p.inviteLinkId;
    case "SOURCE_CHANNEL":
      return (
        rule.sourceChannelId !== null &&
        (p.type === "GATE" || p.type === "SHARE") &&
        p.sourceChannelId === rule.sourceChannelId
      );
    case "SOURCE_KIND":
      if (rule.sourceKind === "LINKAFFI_AFFILIATE")
        return (
          p.type === "LINKAFFI" &&
          !!rule.linkaffiAffiliateId &&
          p.linkaffi?.affiliateId === rule.linkaffiAffiliateId
        );
      return rule.sourceKind !== null && sourceKindMatches(rule.sourceKind, p);
  }
}

/** Règles dans l'ordre de résolution : niveau, puis `sortOrder`, puis l'ordre reçu (tri stable). */
export function orderRules<R extends ScopedRule>(rules: readonly R[]): R[] {
  return rules
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        RULE_LEVELS.indexOf(a.r.scope) - RULE_LEVELS.indexOf(b.r.scope) ||
        a.r.sortOrder - b.r.sortOrder ||
        a.i - b.i,
    )
    .map((x) => x.r);
}

/** Règle qui s'applique à une provenance (la première dans l'ordre de résolution), ou null : aucune règle. */
export function pickRuleForProvenance<R extends ScopedRule>(
  rules: readonly R[],
  p: Provenance,
): R | null {
  return orderRules(rules).find((r) => ruleMatches(r, p)) ?? null;
}

/**
 * `a` s'applique-t-elle à toutes les personnes auxquelles `b` s'appliquerait ? (même niveau seulement : un niveau
 * plus précis passe toujours avant)
 */
export function ruleCovers(a: ScopedRule, b: ScopedRule): boolean {
  if (a.scope !== b.scope) return false;
  switch (a.scope) {
    case "DEFAULT":
      return true;
    case "INVITE_LINK":
      return a.inviteLinkId !== null && a.inviteLinkId === b.inviteLinkId;
    case "SOURCE_CHANNEL":
      return a.sourceChannelId !== null && a.sourceChannelId === b.sourceChannelId;
    case "SOURCE_KIND":
      if (!a.sourceKind || !b.sourceKind) return false;
      if (a.sourceKind === "LINKAFFI_AFFILIATE" || b.sourceKind === "LINKAFFI_AFFILIATE")
        // Un affilié précis : couvert par la même exception d'affilié, ou par « n'importe quel affilié ».
        return b.sourceKind === "LINKAFFI_AFFILIATE"
          ? a.sourceKind === "LINKAFFI_ANY" ||
              (a.sourceKind === "LINKAFFI_AFFILIATE" &&
                !!a.linkaffiAffiliateId &&
                a.linkaffiAffiliateId === b.linkaffiAffiliateId)
          : false;
      if (a.sourceKind === b.sourceKind) return true;
      if (a.sourceKind === "ANY_CHANNEL") return b.sourceKind === "GATE";
      if (a.sourceKind === "AD_ANY")
        return b.sourceKind === "AD_TIKTOK" || b.sourceKind === "AD_META";
      return false;
  }
}

/**
 * Exception active placée avant `target` (même niveau) qui s'applique déjà à toutes ses personnes : `target` ne sert
 * jamais (« jamais utilisée : … passe avant »). Null si `target` peut s'appliquer.
 */
export function shadowingRule<R extends ScopedRule>(rules: readonly R[], target: R): R | null {
  if (!target.isActive) return null;
  for (const r of orderRules(rules)) {
    if (r.id === target.id) return null;
    if (r.isActive && ruleCovers(r, target)) return r;
  }
  return null;
}

/**
 * Place une nouvelle exception parmi celles du même niveau (dans l'ordre de résolution) : juste avant la première qui
 * la couvrirait (« n'importe quelle pub » ne doit pas masquer une nouvelle « pub TikTok »), sinon à la fin. Renvoie la
 * liste ordonnée ; l'appelant renumérote `sortOrder` (10, 20, 30…).
 */
export function placeNewRule<R extends ScopedRule>(sameLevel: readonly R[], rule: R): R[] {
  const ordered = orderRules(sameLevel.filter((r) => r.id !== rule.id));
  const at = ordered.findIndex((r) => ruleCovers(r, rule));
  if (at < 0) return [...ordered, rule];
  return [...ordered.slice(0, at), rule, ...ordered.slice(at)];
}

/** Ce que fait la règle retenue des canaux à rejoindre, pour cette provenance. */
export type EffectiveGates = {
  /** Canaux à rejoindre réellement demandés (dans l'ordre de la règle). */
  gateChannelIds: string[];
  /**
   * Vrai quand une personne venue du bouton « canal à rejoindre » d'un autre canal tombe sur la règle par défaut : ses
   * canaux à rejoindre ne sont pas imposés (pas de chaîne sans fin d'un canal à l'autre ; une exception peut en
   * demander explicitement).
   */
  noGates: boolean;
};

/**
 * Canaux à rejoindre effectifs : sans le canal lui-même ni le canal d'où vient la personne (déjà « rejoint » : sa
 * demande y est en cours ; exigences croisées sans boucle), et aucun pour une personne venue d'un canal obligatoire
 * qui tombe sur la règle par défaut.
 */
export function effectiveGateChannelIds(
  rule: { scope: RuleScope; gateChannelIds: readonly string[] },
  p: Provenance,
  channelId: string,
): EffectiveGates {
  if (p.type === "GATE" && rule.scope === "DEFAULT") return { gateChannelIds: [], noGates: true };
  const ids = rule.gateChannelIds.filter(
    (id, i, all) => id !== channelId && id !== p.sourceChannelId && all.indexOf(id) === i,
  );
  return { gateChannelIds: ids, noGates: false };
}

/**
 * Canal sans aucune règle : validation à la main (comportement d'avant), sauf pour une personne venue du bouton
 * « canal à rejoindre » d'un de nos canaux : elle entre tout de suite, comme avec les anciens liens GATE à entrée
 * directe (sinon le canal obligatoire la bloquerait sans que personne ne l'ait voulu).
 */
export function noRuleOutcome(p: Provenance): "MANUAL" | "IMMEDIATE" {
  return p.type === "GATE" ? "IMMEDIATE" : "MANUAL";
}

/** Message privé envoyé à l'arrivée d'une demande. */
export type WelcomeKind =
  /** Accueil complet (texte de « Ce que dit le bot » ; boutons des canaux à rejoindre et « ✅ J'ai rejoint »). */
  | "full"
  /** Court message « Ta demande pour <canal> est bien reçue, accès <délai> » (personne venue d'un canal obligatoire). */
  | "short"
  /** Aucun message. */
  | "none";

/**
 * Quel message envoyer : l'accueil complet dès que des canaux sont à rejoindre (sans lui la personne resterait
 * bloquée) ; sinon rien si l'équipe l'a coupé (`sendWelcome`) ; un court message pour une personne venue du bouton
 * « canal à rejoindre » d'un autre canal (jamais deux accueils complets à la suite) ; l'accueil complet sinon.
 */
export function welcomeKindFor(input: {
  provenance: Provenance;
  hasGates: boolean;
  sendWelcome: boolean;
}): WelcomeKind {
  if (input.hasGates) return "full";
  if (!input.sendWelcome) return "none";
  return input.provenance.type === "GATE" ? "short" : "full";
}

/** Anti-doublon : un même bot n'envoie pas plus d'un message d'accueil à la même personne en 10 minutes. */
export const WELCOME_DEDUP_MS = 10 * 60_000;

/**
 * Faut-il taire ce message d'accueil (un accueil du même bot à la même personne il y a moins de 10 minutes) ? Jamais un
 * accueil avec des canaux à rejoindre : ses boutons sont nécessaires pour entrer.
 */
export function isDuplicateWelcome(input: {
  kind: WelcomeKind;
  hasGates: boolean;
  lastWelcomeAt: Date | null;
  now: Date;
}): boolean {
  if (input.kind === "none" || input.hasGates || !input.lastWelcomeAt) return false;
  return input.now.getTime() - input.lastWelcomeAt.getTime() < WELCOME_DEDUP_MS;
}

/** Titre d'un de nos canaux, ou undefined s'il est inconnu (supprimé, pas encore relu). */
function titleOf(id: string | null, titles: Readonly<Record<string, string>>): string | undefined {
  return id ? titles[id] : undefined;
}

/**
 * Provenance en français, pour les listes de demandes et la fiche membre : « Venu de « Tir Cadré » (canal
 * obligatoire) », « Venu du lien de partage « Post Tir Cadré » », « Venu d'une pub TikTok », « Venu d'un autre lien ».
 * `linkName` : nom du lien (lien de partage, lien manuel, pub).
 */
export function provenanceLabel(
  p: Provenance,
  titles: Readonly<Record<string, string>> = {},
  linkName?: string | null,
): string {
  switch (p.type) {
    case "GATE": {
      const t = titleOf(p.sourceChannelId, titles);
      return t
        ? `Venu de « ${t} » (canal obligatoire)`
        : "Venu d'un de nos canaux (canal obligatoire)";
    }
    case "SHARE":
      return linkName ? `Venu du lien de partage « ${linkName} »` : "Venu d'un lien de partage";
    case "AD": {
      const platform =
        p.adPlatform === "TIKTOK" ? "TikTok" : p.adPlatform === "META" ? "Meta" : null;
      const base = platform ? `Venu d'une pub ${platform}` : "Venu d'une pub";
      return linkName ? `${base} (« ${linkName} »)` : base;
    }
    case "MANUAL":
      return linkName ? `Venu du lien « ${linkName} »` : "Venu d'un lien du canal";
    case "LINKAFFI": {
      const who = p.linkaffi?.affiliateName
        ? `l'affilié « ${p.linkaffi.affiliateName} »`
        : "un affilié Link Affi";
      const camp = p.linkaffi?.campaignName ?? linkName;
      return camp ? `Venu de ${who} (campagne « ${camp} »)` : `Venu de ${who}`;
    }
    default:
      return "Venu d'un autre lien";
  }
}

/** Condition d'une exception, après « Si la personne vient » : « de « Tir Cadré » », « d'une pub TikTok »… */
export function exceptionCondition(
  rule: Pick<ScopedRule, "scope" | "sourceChannelId" | "sourceKind" | "inviteLinkId"> &
    Partial<Pick<ScopedRule, "linkaffiAffiliateId">>,
  titles: Readonly<Record<string, string>> = {},
  linkNames: Readonly<Record<string, string>> = {},
  /** Noms des affiliés Link Affi par identifiant (exception LINKAFFI_AFFILIATE, phase 13). */
  affiliateNames: Readonly<Record<string, string>> = {},
): string {
  switch (rule.scope) {
    case "DEFAULT":
      return "d'ailleurs (règle par défaut)";
    case "INVITE_LINK": {
      const name = rule.inviteLinkId ? linkNames[rule.inviteLinkId] : undefined;
      return name ? `du lien « ${name} »` : "d'un lien supprimé";
    }
    case "SOURCE_CHANNEL": {
      const t = titleOf(rule.sourceChannelId, titles);
      return t ? `de « ${t} »` : "d'un canal supprimé";
    }
    case "SOURCE_KIND":
      switch (rule.sourceKind) {
        case "GATE":
          return "du bouton « canal à rejoindre » d'un de nos canaux";
        case "ANY_CHANNEL":
          return "de n'importe lequel de nos canaux";
        case "AD_TIKTOK":
          return "d'une pub TikTok";
        case "AD_META":
          return "d'une pub Meta";
        case "AD_ANY":
          return "de n'importe quelle pub";
        case "SHARE":
          return "d'un lien de partage";
        case "LINKAFFI_ANY":
          return "de n'importe quel affilié Link Affi";
        case "LINKAFFI_AFFILIATE": {
          const name = rule.linkaffiAffiliateId
            ? affiliateNames[rule.linkaffiAffiliateId]
            : undefined;
          return name ? `de l'affilié « ${name} »` : "d'un affilié Link Affi précis";
        }
        default:
          return "d'une provenance inconnue";
      }
  }
}
