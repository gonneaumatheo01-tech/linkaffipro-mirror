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
import { PILL_TONES, pillShowsDot, pillToneClasses } from "@/components/admin/status-pill";
import {
  STATUS_DICT,
  entryTone,
  statusEntry,
  statusTone,
  statusLabel,
  statusLabels,
  statusVariant,
  type StatusEntry,
  type StatusKind,
} from "./status-badges";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";

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

  it("aucun libellé ne contient de jargon ; le terme technique passe au survol (`term`)", () => {
    for (const kind of Object.keys(STATUS_DICT) as StatusKind[])
      for (const [value, entry] of Object.entries(STATUS_DICT[kind] as Record<string, StatusEntry>))
        expect(jargonIn(entry.label), `${kind}.${value} : ${entry.label}`).toEqual([]);
    expect(statusEntry("playerEvent", "FTD")).toMatchObject({
      label: "Premier dépôt",
      term: "FTD",
    });
    expect(statusEntry("playerEvent", "NGR")).toMatchObject({ label: "Revenu net", term: "NGR" });
    expect(statusLabel("outboundKind", "BROADCAST")).toBe("Message à un groupe");
    expect(statusLabel("outboundKind", "AUTOMATION")).toBe("Relance automatique");
    expect(statusLabel("vertical", "DATING")).toBe("Rencontres");
  });

  it("couvre aussi les statuts hors Prisma (synchro, connexion Telegram, actif)", () => {
    expect(statusLabel("sync", "error")).toBe("Erreur");
    // Synchro dont la dernière réussite est trop ancienne (État du système) : à surveiller, pas une erreur.
    expect(statusLabel("sync", "late")).toBe("En retard");
    expect(statusTone("sync", "late")).toBe("warning");
    expect(statusLabel("webhook", "check")).toBe("À vérifier");
    expect(statusLabel("active", "inactive")).toBe("Inactif");
  });
});

describe("pastilles d'état (StatusPill)", () => {
  it("donne une nuance de pastille à chaque statut du dictionnaire", () => {
    for (const kind of Object.keys(STATUS_DICT) as StatusKind[]) {
      for (const value of Object.keys(STATUS_DICT[kind])) {
        expect(PILL_TONES, `${kind}.${value}`).toContain(statusTone(kind, value));
      }
    }
  });

  it("garde le sens des couleurs : réussi en vert, à surveiller en ambre, échec en rouge", () => {
    expect(statusTone("post", "SENT")).toBe("success");
    expect(statusTone("membership", "REQUESTED")).toBe("warning");
    expect(statusTone("post", "FAILED")).toBe("danger");
    expect(statusTone("post", "SCHEDULED")).toBe("info");
    expect(statusTone("post", "CANCELLED")).toBe("muted");
    expect(statusTone("post", "DRAFT")).toBe("neutral");
    // Valeur inconnue : neutre, jamais une couleur d'alerte.
    expect(statusTone("post", "WHAT_EVER")).toBe("neutral");
  });

  it("dérive la nuance de l'entrée (variante + nuance)", () => {
    expect(entryTone({ label: "x", variant: "outline", tone: "success" })).toBe("success");
    expect(entryTone({ label: "x", variant: "outline", tone: "warning" })).toBe("warning");
    expect(entryTone({ label: "x", variant: "destructive" })).toBe("danger");
    expect(entryTone({ label: "x", variant: "default" })).toBe("info");
    expect(entryTone({ label: "x", variant: "secondary" })).toBe("muted");
    expect(entryTone({ label: "x", variant: "outline" })).toBe("neutral");
  });

  it("a des classes de fond doux, de texte et de point pour chaque nuance", () => {
    for (const tone of PILL_TONES) {
      const c = pillToneClasses(tone);
      expect(c.pill, tone).toMatch(/\bbg-/);
      expect(c.pill, tone).toMatch(/\btext-/);
      expect(c.dot, tone).toMatch(/\bbg-/);
      // Jamais de couleur en dur : uniquement les jetons du thème.
      expect(`${c.pill} ${c.dot}`, tone).not.toMatch(/#|emerald|amber|red-|green-|slate-|gray-/);
    }
  });

  it("n'affiche le point que pour les états (pas pour les simples catégories)", () => {
    expect(pillShowsDot("success")).toBe(true);
    expect(pillShowsDot("danger")).toBe(true);
    expect(pillShowsDot("neutral")).toBe(false);
  });
});
