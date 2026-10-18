import { describe, expect, it } from "vitest";
import {
  ACTION_FAMILIES,
  entityLabel,
  actionFamily,
  actionFilterOptions,
  actionLabel,
  auditActionLabel,
  journalWhere,
} from "./query";

/** Codes d'actions réellement écrits par le site (échantillon de chaque préfixe utilisé). */
const REAL_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "user.password_changed",
  "user.role_changed",
  "invitation.created",
  "bot.created",
  "bot.webhook_resync",
  "channel.updated",
  "membership.approve_now",
  "approval_rule.created",
  "approval_rule.exception_created",
  "approval_rule.exception_updated",
  "approval_rule.exception_deleted",
  "approval_rule.exceptions_reordered",
  "invite_link.share_created",
  "invite_link.share_disabled",
  "member.anonymized",
  "member.affiliate_changed",
  "member.affiliate_removed",
  "integration.linkaffi.get_channels",
  "integration.linkaffi_key_generated",
  "integration.linkaffi_test_sent",
  "tag.created",
  "post.updated",
  "media.uploaded",
  "sequence.text_saved",
  "broadcast.sent_now",
  "automation.created",
  "campaign.created",
  "link.entry_created",
  "ad.created",
  "adset.created",
  "adcost.manual",
  "import.costs",
  "category.merged",
  "connector.app_saved",
  "linkaffi.sync_requested",
  "telegram.session_connected",
  "postback.endpoint_created",
  "ai.key_verified",
  "settings.retention_changed",
  "alert.resolved",
  "reports.send_requested",
  "stats.recompute_requested",
  "system.job_retried",
  "maintenance.purge",
  "landing.page_created",
  "landing.page_updated",
  "landing.page_deleted",
  "landing.test_page_created",
  "landing.test_page_updated",
  "invite_link.landing_created",
  "invite_link.landing_revoked",
  "assistant.settings_saved",
  "assistant.key_verified",
  "assistant.key_removed",
  "assistant.activation_changed",
];

const where = (action: string) => journalWhere({ userId: "", action, from: "", to: "" });

describe("filtre « Type d'action » du Journal", () => {
  it("propose des familles en français, sans code technique, par ordre alphabétique", () => {
    const labels = ACTION_FAMILIES.map((a) => a.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "fr")));
    for (const label of labels) expect(label).not.toMatch(/[a-z_]+\.[a-z_]*/);
    expect(new Set(ACTION_FAMILIES.map((a) => a.value)).size).toBe(ACTION_FAMILIES.length);
    // La valeur est le premier préfixe : un ancien filtre mémorisé retombe sur sa famille.
    for (const a of ACTION_FAMILIES) expect(a.prefixes[0]).toBe(a.value);
    expect(actionFamily("broadcast.")?.label).toBe("Écrire à un groupe");
  });

  it("chaque action écrite par le site est atteignable par une famille", () => {
    for (const code of REAL_ACTIONS)
      expect(
        ACTION_FAMILIES.some((a) => a.prefixes.some((p) => code.startsWith(p))),
        code,
      ).toBe(true);
    expect(actionLabel("approval_rule.updated")).toBe("Règle d'adhésion");
  });

  it("phase 11 : exceptions selon la provenance et liens de partage, en français", () => {
    expect(actionLabel("approval_rule.exception_created")).toBe(
      "Règle d'adhésion : exception ajoutée",
    );
    expect(actionLabel("approval_rule.exception_updated")).toBe(
      "Règle d'adhésion : exception modifiée",
    );
    expect(actionLabel("approval_rule.exception_deleted")).toBe(
      "Règle d'adhésion : exception supprimée",
    );
    expect(actionLabel("approval_rule.exceptions_reordered")).toBe(
      "Règle d'adhésion : ordre des exceptions modifié",
    );
    // Phase 14 : nouvelle règle appliquée aux demandes en attente, « Tout accepter ».
    expect(actionLabel("approval_rule.applied_to_pending")).toBe(
      "Règle d'adhésion : appliquée aux demandes en attente",
    );
    expect(actionLabel("membership.approve_all")).toBe("Demandes : tout accepter");
    expect(actionLabel("membership.approve_now")).toBe("Adhésion");
    expect(actionLabel("invite_link.share_created")).toBe("Lien de partage créé");
    expect(actionLabel("invite_link.share_disabled")).toBe("Lien de partage désactivé");
    // Phase 12 : emojis animés (bibliothèque de l'équipe).
    expect(actionLabel("custom_emoji.pack_imported")).toBe("Emojis animés : pack ajouté");
    expect(actionLabel("custom_emoji.account_import_requested")).toBe(
      "Emojis animés : import des packs du compte Telegram demandé",
    );
    expect(actionLabel("custom_emoji.hidden")).toBe("Emoji animé retiré de la bibliothèque");
    expect(actionLabel("custom_emoji.restored")).toBe("Emoji animé remis dans la bibliothèque");
    expect(actionFamily("custom_emoji.")?.label).toBe("Emojis animés");
    expect(where("custom_emoji.")).toEqual({ OR: [{ action: { startsWith: "custom_emoji." } }] });
    // Les exceptions se retrouvent avec les règles d'adhésion ; les liens de partage avec les liens.
    expect(where("membership.")).toEqual({
      OR: [{ action: { startsWith: "membership." } }, { action: { startsWith: "approval_rule." } }],
    });
    expect(
      ACTION_FAMILIES.find((a) => a.prefixes.some((p) => "invite_link.share_created".startsWith(p)))
        ?.label,
    ).toBe("Campagnes et liens");
  });

  it("phase 17 : assistant de conversation (réglages, personas, conversations), en français", () => {
    expect(actionLabel("assistant.settings_saved")).toBe(
      "IA de conversation : réglages enregistrés",
    );
    expect(actionLabel("assistant.key_verified")).toBe("IA de conversation : clé vérifiée");
    expect(actionLabel("assistant.key_removed")).toBe("IA de conversation : clé retirée");
    expect(actionLabel("assistant.activation_changed")).toBe(
      "IA de conversation : activation modifiée",
    );
    expect(actionLabel("assistant.autre")).toBe("IA de conversation");
    expect(actionLabel("persona.created")).toBe("Persona créée");
    expect(actionLabel("persona.tested")).toBe("Persona");
    expect(actionLabel("conversation.taken_over")).toBe(
      "Conversation : reprise en main par l'équipe",
    );
    expect(actionLabel("conversation.released")).toBe("Conversation : rendue à l'assistant");
    expect(actionLabel("conversation.autre")).toBe("Conversation");
    // L'assistant d'écriture garde sa propre famille.
    expect(actionLabel("ai.key_verified")).toBe("Assistant IA");
    expect(actionFamily("assistant.")?.label).toBe("Assistant de conversation");
    expect(where("assistant.")).toEqual({
      OR: [
        { action: { startsWith: "assistant." } },
        { action: { startsWith: "persona." } },
        { action: { startsWith: "conversation." } },
      ],
    });
    expect(entityLabel("Persona")).toBe("Persona");
    expect(entityLabel("Conversation")).toBe("Conversation");
  });

  it("phase 13 : affiliés Link Affi (appels de Link Affi, clés, corrections d'affilié), en français", () => {
    expect(actionLabel("integration.linkaffi.get_channels")).toBe(
      "Link Affi : liste des canaux demandée",
    );
    expect(actionLabel("integration.linkaffi.post_invite_links")).toBe(
      "Link Affi : lien d'une campagne d'affilié demandé",
    );
    expect(actionLabel("integration.linkaffi.patch_invite_link")).toBe(
      "Link Affi : lien d'une campagne d'affilié désactivé",
    );
    expect(actionLabel("integration.linkaffi.get_members")).toBe(
      "Link Affi : membres d'une campagne relus",
    );
    expect(actionLabel("integration.linkaffi.nouvelle_route")).toBe(
      "Link Affi : appel de la connexion",
    );
    expect(actionLabel("integration.linkaffi_key_generated")).toBe(
      "Link Affi : clé de connexion générée",
    );
    expect(actionLabel("integration.linkaffi_secret_generated")).toBe(
      "Link Affi : secret de signature généré",
    );
    expect(actionLabel("integration.linkaffi_events_url_changed")).toBe(
      "Link Affi : adresse des événements modifiée",
    );
    expect(actionLabel("integration.linkaffi_test_sent")).toBe(
      "Link Affi : événement de test envoyé",
    );
    expect(actionLabel("member.affiliate_changed")).toBe("Membre : affilié Link Affi changé");
    expect(actionLabel("member.affiliate_removed")).toBe("Membre : affilié Link Affi retiré");
    expect(entityLabel("IntegrationKey")).toBe("Connexion Link Affi");
    expect(ACTION_FAMILIES.find((a) => a.prefixes.includes("integration."))?.label).toBe(
      "Link Affi, Meta, TikTok et compte Telegram",
    );
  });

  it("phase 15 : pages d'atterrissage et leurs liens, en français, filtrables dans « Pages d'atterrissage »", () => {
    expect(actionLabel("landing.page_created")).toBe("Page d'atterrissage créée");
    expect(actionLabel("landing.page_updated")).toBe("Page d'atterrissage modifiée");
    expect(actionLabel("landing.page_deleted")).toBe("Page d'atterrissage supprimée");
    expect(actionLabel("landing.test_page_created")).toBe("Page d'essai du canal TEST créée");
    expect(actionLabel("landing.test_page_updated")).toBe(
      "Page d'essai du canal TEST remise à jour",
    );
    expect(actionLabel("landing.autre_action")).toBe("Page d'atterrissage");
    expect(actionLabel("invite_link.landing_created")).toBe("Lien d'une page créé");
    expect(actionLabel("invite_link.landing_revoked")).toBe("Lien d'une page retiré");
    expect(actionLabel("invite_link.landing_failed")).toBe("Lien d'une page : refus de Telegram");
    expect(entityLabel("LandingPage")).toBe("Page d'atterrissage");
    expect(entityLabel("LandingSource")).toBe("Source d'une page");
    expect(actionFamily("landing.")?.label).toBe("Pages d'atterrissage");
    expect(where("landing.")).toEqual({
      OR: [
        { action: { startsWith: "landing." } },
        { action: { startsWith: "invite_link.landing_" } },
      ],
    });
  });

  it("appels de Link Affi : un appel refusé ne se lit jamais comme une action réussie", () => {
    const L = (action: string, metadata: unknown) =>
      auditActionLabel(`integration.linkaffi.${action}`, metadata);
    // Réussis : libellé de l'action, précisé quand c'est utile.
    expect(L("get_channels", { status: 200, count: 3 })).toBe(
      "Link Affi : liste des canaux demandée",
    );
    expect(L("post_invite_links", { status: 201, created: true })).toBe(
      "Link Affi : lien d'une campagne d'affilié créé",
    );
    expect(L("post_invite_links", { status: 200, created: false })).toBe(
      "Link Affi : lien d'une campagne d'affilié redemandé (déjà créé)",
    );
    expect(L("patch_invite_link", { status: 200, changed: true, isActive: false })).toBe(
      "Link Affi : lien d'une campagne d'affilié désactivé",
    );
    expect(L("patch_invite_link", { status: 200, changed: false, isActive: false })).toBe(
      "Link Affi : lien d'une campagne d'affilié déjà désactivé",
    );
    expect(L("get_members", { status: 200 })).toBe("Link Affi : membres d'une campagne relus");
    // Refusés : sans clé, clé fausse, trop de requêtes (tentative d'intrusion visible).
    expect(L("get_channels", { status: 401, error: "unauthorized", reason: "missing" })).toBe(
      "Link Affi : liste des canaux refusée (clé de connexion absente ou fausse)",
    );
    expect(L("get_members", { status: 429, error: "rate_limited" })).toBe(
      "Link Affi : lecture des membres d'une campagne refusée (trop de requêtes)",
    );
    expect(L("patch_invite_link", { status: 409, error: "reactivation_refused" })).toBe(
      "Link Affi : modification d'un lien d'affilié refusée (un lien désactivé ne revient pas)",
    );
    expect(L("patch_invite_link", { status: 404, error: "invite_link_not_found" })).toBe(
      "Link Affi : modification d'un lien d'affilié refusée (lien inconnu)",
    );
    expect(L("post_invite_links", { status: 400, error: "invalid_body" })).toBe(
      "Link Affi : demande de lien d'affilié refusée (demande invalide)",
    );
    expect(L("post_invite_links", { status: 409, error: "affiliate_mismatch" })).toBe(
      "Link Affi : demande de lien d'affilié refusée (clé d'un autre affilié)",
    );
    expect(L("unknown_route", { status: 405, error: "method_not_allowed" })).toBe(
      "Link Affi : appel refusé (méthode non prévue)",
    );
    expect(L("unknown_route", { status: 404, error: "not_found" })).toBe(
      "Link Affi : appel refusé (adresse inconnue)",
    );
    expect(L("post_invite_links", { status: 418 })).toBe(
      "Link Affi : demande de lien d'affilié refusée (code 418)",
    );
    // En échec de notre côté.
    expect(L("post_invite_links", { status: 503, error: "telegram_unavailable" })).toBe(
      "Link Affi : demande de lien d'affilié en échec (Telegram injoignable)",
    );
    expect(L("get_channels", { status: 500, error: "internal_error" })).toBe(
      "Link Affi : liste des canaux en échec (erreur interne)",
    );
    // Sans statut (ancienne ligne) ou autre action : le libellé habituel.
    expect(L("get_channels", null)).toBe("Link Affi : liste des canaux demandée");
    expect(auditActionLabel("member.anonymized", { status: 401 })).toBe(
      actionLabel("member.anonymized"),
    );
  });

  it("une famille filtre sur tous ses préfixes ; un ancien code garde son filtre exact", () => {
    expect(where("ad.")).toEqual({
      OR: [
        { action: { startsWith: "ad." } },
        { action: { startsWith: "adset." } },
        { action: { startsWith: "adcost." } },
        { action: { startsWith: "import.costs" } },
      ],
    });
    expect(where("bot.created")).toEqual({ action: { startsWith: "bot.created" } });
    expect(where("")).toEqual({});
  });

  it("options : les familles, plus l'ancien filtre mémorisé affiché par son libellé", () => {
    expect(actionFilterOptions("")).toHaveLength(ACTION_FAMILIES.length);
    expect(actionFilterOptions("bot.")).toHaveLength(ACTION_FAMILIES.length);
    const withOld = actionFilterOptions("bot.created");
    expect(withOld.at(-1)).toEqual({ value: "bot.created", label: "Filtre mémorisé : Bot" });
  });
});
