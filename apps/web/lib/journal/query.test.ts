import { describe, expect, it } from "vitest";
import {
  ACTION_FAMILIES,
  actionFamily,
  actionFilterOptions,
  actionLabel,
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
    expect(actionLabel("invite_link.share_created")).toBe("Lien de partage créé");
    expect(actionLabel("invite_link.share_disabled")).toBe("Lien de partage désactivé");
    // Les exceptions se retrouvent avec les règles d'adhésion ; les liens de partage avec les liens.
    expect(where("membership.")).toEqual({
      OR: [{ action: { startsWith: "membership." } }, { action: { startsWith: "approval_rule." } }],
    });
    expect(
      ACTION_FAMILIES.find((a) => a.prefixes.some((p) => "invite_link.share_created".startsWith(p)))
        ?.label,
    ).toBe("Campagnes et liens");
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
