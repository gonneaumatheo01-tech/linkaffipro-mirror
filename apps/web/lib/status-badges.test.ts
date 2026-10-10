import { describe, expect, it } from "vitest";
import {
  AdPlatform,
  AffiliateSource,
  AlertSeverity,
  ApprovalMode,
  AutomationRunStatus,
  AutomationTrigger,
  BroadcastStatus,
  CampaignStatus,
  ChatType,
  ConnectionStatus,
  CostSource,
  ExpireAction,
  GateMode,
  ImportKind,
  InviteLinkKind,
  MembershipStatus,
  OutboundKind,
  OutboundStatus,
  PlayerEventType,
  PostbackStatus,
  PostStatus,
  Role,
  SequenceTrigger,
  TrackingLinkKind,
  Vertical,
} from "@linkaffipro/db";
import {
  STATUS_DICT,
  statusEntry,
  statusLabel,
  statusLabels,
  statusVariant,
  type StatusKind,
} from "./status-badges";

/** Chaque enum Prisma affiché dans l'interface et le genre du dictionnaire qui le couvre. */
const ENUMS: Array<[StatusKind, Record<string, string>]> = [
  ["membership", MembershipStatus],
  ["post", PostStatus],
  ["broadcast", BroadcastStatus],
  ["outbound", OutboundStatus],
  ["outboundKind", OutboundKind],
  ["alert", AlertSeverity],
  ["automationRun", AutomationRunStatus],
  ["automationTrigger", AutomationTrigger],
  ["importKind", ImportKind],
  ["postback", PostbackStatus],
  ["campaign", CampaignStatus],
  ["costSource", CostSource],
  ["playerEvent", PlayerEventType],
  ["affiliateSource", AffiliateSource],
  ["role", Role],
  ["vertical", Vertical],
  ["chatType", ChatType],
  ["connection", ConnectionStatus],
  ["approvalMode", ApprovalMode],
  ["gateMode", GateMode],
  ["expireAction", ExpireAction],
  ["inviteLinkKind", InviteLinkKind],
  ["adPlatform", AdPlatform],
  ["trackingLinkKind", TrackingLinkKind],
  ["sequenceTrigger", SequenceTrigger],
];

describe("badges de statut", () => {
  it.each(ENUMS)("couvre toutes les valeurs de l'enum « %s »", (kind, enumObj) => {
    const values = Object.values(enumObj);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      const label = statusLabel(kind, v);
      expect(label, `${kind}.${v}`).toBeTruthy();
      // Le libellé est bien une traduction, pas la valeur brute.
      expect(label, `${kind}.${v}`).not.toBe(v);
      expect(["default", "secondary", "destructive", "outline"]).toContain(statusVariant(kind, v));
    }
    // Et rien de plus : pas de valeur fantôme dans le dictionnaire.
    expect(Object.keys(STATUS_DICT[kind]).sort()).toEqual([...values].sort());
  });

  it("donne un repli lisible pour une valeur inconnue", () => {
    expect(statusEntry("post", "WHAT_EVER").label).toBe("what ever");
    expect(statusEntry("post", "WHAT_EVER").variant).toBe("outline");
  });

  it("expose les libellés d'un genre pour un <select>", () => {
    const labels = statusLabels("post");
    expect(labels.DRAFT).toBe("Brouillon");
    expect(Object.keys(labels)).toEqual(Object.keys(PostStatus));
  });

  it("couvre aussi les statuts hors Prisma (synchro, connexion Telegram, actif)", () => {
    expect(statusLabel("sync", "error")).toBe("Erreur");
    expect(statusLabel("webhook", "check")).toBe("À vérifier");
    expect(statusLabel("active", "inactive")).toBe("Inactif");
  });
});
