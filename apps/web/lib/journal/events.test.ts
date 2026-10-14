import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));

import { eventsQuery, eventsWhere, parseEventFilters, VISIBLE_EVENT_WHERE } from "./events";
import { EVENT_FAMILIES, EVENT_TYPE_LABELS, eventLabel } from "./event-labels";
import { actionLabel, entityLabel, journalWhere } from "./query";

describe("Journal → vue « Événements »", () => {
  it("lit les filtres et les garde dans les liens (pagination, export)", () => {
    const f = parseEventFilters({
      view: "events",
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
      page: "2",
    });
    expect(f).toEqual({
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
      page: 2,
    });
    expect(eventsQuery(f)).toBe(
      "view=events&type=telegram.&channelId=c1&botId=b1&from=2026-10-01&to=2026-10-09",
    );
  });

  it("filtre par famille (préfixe) ou type exact, canal, bot et période en heure de Paris", () => {
    const w = eventsWhere({
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
    });
    expect(w.AND).toContainEqual(VISIBLE_EVENT_WHERE);
    expect(w.AND).toContainEqual({ type: { startsWith: "telegram." } });
    expect(w.AND).toContainEqual({ channelId: "c1" });
    expect(w.AND).toContainEqual({ botId: "b1" });
    expect(w.AND).toContainEqual({
      occurredAt: { gte: new Date("2026-09-30T22:00:00Z"), lt: new Date("2026-10-09T22:00:00Z") },
    });
    expect(
      eventsWhere({ type: "member.start", channelId: "", botId: "", from: "", to: "" }).AND,
    ).toContainEqual({ type: "member.start" });
  });

  it("n'affiche jamais les événements joueurs sans membre (autres affiliés Link Affi)", () => {
    expect(VISIBLE_EVENT_WHERE).toEqual({
      NOT: { type: { startsWith: "player." }, memberId: null },
    });
  });

  it("libellés en français, jamais le code brut seul", () => {
    expect(eventLabel("telegram.chat_join_request")).toBe("Demande d'adhésion reçue");
    expect(eventLabel("telegram.something_new")).toBe("Mise à jour Telegram");
    expect(eventLabel("player.ftd")).toBe("Premier dépôt");
    expect(eventLabel("membership.approved")).toBe("Demande acceptée");
    expect(eventLabel("membership.gate_links_missing")).toBe(
      "Liens de canaux à rejoindre impossibles à créer",
    );
    expect(eventLabel("membership.welcome_resent")).toBe("Accueil renvoyé avec les liens");
    expect(eventLabel("channel.gate_links_checked")).toBe("Liens des canaux à rejoindre vérifiés");
    expect(eventLabel("player.cpa_credited")).toBe("Commission créditée");
    expect(eventLabel("player.cpa_reversed")).toBe("Commission annulée");
    expect(eventLabel("membership.welcome_skipped")).toBe(
      "Accueil non renvoyé (déjà envoyé il y a moins de 10 minutes)",
    );
    expect(eventLabel("invite_link.legacy_revoked")).toBe(
      "Ancien lien de canal à rejoindre retiré",
    );
    expect(eventLabel("invite_link.autre")).toBe("Lien d'invitation");
    // Phase 12 : emojis animés.
    expect(eventLabel("custom_emoji.added")).toBe("Emojis animés ajoutés à la bibliothèque");
    expect(eventLabel("dm.custom_emoji_fallback")).toBe(
      "Message privé renvoyé avec des emojis normaux (emojis animés refusés)",
    );
    expect(eventLabel("custom_emoji.autre")).toBe("Emojis animés");
    expect(EVENT_FAMILIES.find((f) => f.prefix === "custom_emoji.")?.label).toBe("Emojis animés");
    expect(entityLabel("CustomEmoji")).toBe("Emoji animé");
    expect(EVENT_FAMILIES.find((f) => f.prefix === "invite_link.")?.label).toBe(
      "Liens d'invitation",
    );
    expect(entityLabel("InviteLink")).toBe("Lien d'invitation");
    // Phase 13 : affiliés Link Affi.
    expect(eventLabel("member.affiliate_attributed")).toBe("Rattaché à un affilié Link Affi");
    expect(eventLabel("membership.affiliate_not_attributed")).toBe(
      "Pas rattaché à l'affilié (déjà rattaché à un autre, ou déjà dans le canal)",
    );
    expect(eventLabel("member.affiliate_changed")).toBe(
      "Affilié Link Affi changé par un administrateur",
    );
    expect(eventLabel("member.affiliate_removed")).toBe(
      "Affilié Link Affi retiré par un administrateur",
    );
    expect(eventLabel("linkaffi_event.sent")).toBe("Événement transmis à Link Affi");
    expect(eventLabel("linkaffi_event.failed")).toBe(
      "Événement non transmis à Link Affi (abandonné après 24 h)",
    );
    expect(eventLabel("linkaffi_event.autre")).toBe("Événement pour Link Affi");
    expect(EVENT_FAMILIES.find((f) => f.prefix === "linkaffi_event.")?.label).toBe(
      "Événements envoyés à Link Affi",
    );
    expect(eventLabel("foo.bar")).toBe("Autre événement");
  });

  it("vocabulaire de la refonte : pas de jargon dans les libellés ni dans les familles du filtre", () => {
    const jargon = /\b(ngr|ftd|sub-id|postback|webhook|automatisation|envoi groupé|goolink)\b/i;
    for (const label of [
      ...Object.values(EVENT_TYPE_LABELS),
      ...EVENT_FAMILIES.map((f) => f.label),
    ])
      expect(label).not.toMatch(jargon);
    expect(eventLabel("player.ngr_updated")).toBe("Revenu net mis à jour");
    expect(eventLabel("automation.run")).toBe("Relance automatique exécutée");
  });
});

describe("Journal → actions de l'équipe", () => {
  it("vocabulaire : « Campagne » pour les nôtres, « Campagne pub » pour la structure TikTok / Meta", () => {
    expect(actionLabel("campaign.created")).toBe("Campagne");
    expect(actionLabel("adset.created")).toBe("Campagne pub");
    expect(actionLabel("ad.created")).toBe("Campagne pub");
    expect(actionLabel("adcost.saved")).toBe("Campagne pub");
    expect(actionLabel("import.costs")).toBe("Campagne pub");
  });

  it("vocabulaire : écrire à un groupe, relance automatique, retour du casino ; objets en français", () => {
    expect(actionLabel("broadcast.sent")).toBe("Écrire à un groupe");
    expect(actionLabel("automation.created")).toBe("Relance automatique");
    expect(actionLabel("postback.created")).toBe("Retour du casino");
    expect(actionLabel("auth.login_failed")).toBe("Connexion au site refusée");
    expect(actionLabel("tag.created")).toBe("Étiquette");
    expect(actionLabel("inconnu.x")).toBe("Autre");
    expect(entityLabel("Post")).toBe("Message");
    expect(entityLabel("PostbackEndpoint")).toBe("Retour du casino");
    expect(entityLabel(null)).toBe("—");
    expect(entityLabel("Nouveau")).toBe("Autre");
  });

  it("dates du filtre en heure de Paris, y compris en hiver", () => {
    expect(
      journalWhere({ userId: "", action: "", from: "2026-11-02", to: "2026-11-02" }).createdAt,
    ).toEqual({ gte: new Date("2026-11-01T23:00:00Z"), lt: new Date("2026-11-02T23:00:00Z") });
    expect(journalWhere({ userId: "", action: "", from: "2026-10-01", to: "" }).createdAt).toEqual({
      gte: new Date("2026-09-30T22:00:00Z"),
    });
  });
});
