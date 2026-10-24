import { describe, expect, it } from "vitest";
import {
  aiCostText,
  pctText,
  assistantNoun,
  assistantWord,
  botStatusLabel,
  closedReasonLabel,
  excerpt,
  JOURNEY_STAGES,
  lastAuthorPrefix,
  mediaKindOf,
  messageText,
  NONE_KEY,
  PERSON_FALLBACK,
  personName,
  releaseLabel,
  sourceLabel,
  TEAM_CLOSED_REASON,
} from "./labels";
import {
  CONVERSATION_UNIVERSES,
  conversationUniverseLabel,
  isConversationUniverse,
  NEEDS_HUMAN_FALLBACK,
  NEEDS_HUMAN_LABEL,
  needsHumanReasonLabel,
} from "./labels";
import { PERSONA_UNIVERSES } from "@linkaffipro/core";
import { statusLabel } from "@/lib/status-badges";
import { UNIVERSE_LABELS } from "@/lib/universe";

const m = (over: Partial<Parameters<typeof personName>[0]> = {}) => ({
  firstName: null,
  lastName: null,
  username: null,
  anonymizedAt: null,
  ...over,
});

describe("personName : prénom ou @pseudo, jamais l'identifiant Telegram", () => {
  it("prénom (et nom), sinon @pseudo, sinon « Personne sans nom »", () => {
    expect(personName(m({ firstName: "Léa", lastName: "M." }))).toBe("Léa M.");
    expect(personName(m({ firstName: "  Jean ", username: "jean_m" }))).toBe("Jean");
    expect(personName(m({ username: "jean_m" }))).toBe("@jean_m");
    expect(personName(m())).toBe(PERSON_FALLBACK);
    expect(personName(m({ firstName: " ", username: " " }))).toBe(PERSON_FALLBACK);
  });
  it("membre anonymisé à sa demande", () => {
    expect(personName(m({ firstName: "Léa", anonymizedAt: new Date() }))).toBe("Membre anonymisé");
  });
});

describe("l'assistante ou l'assistant selon la persona", () => {
  it("féminin par défaut, masculin pour « M »", () => {
    expect(assistantWord("F")).toBe("l'assistante");
    expect(assistantWord(null)).toBe("l'assistante");
    expect(assistantWord("M")).toBe("l'assistant");
    expect(assistantNoun("M")).toBe("assistant");
    expect(releaseLabel("F")).toBe("Rendre à l'assistante");
    expect(releaseLabel("M")).toBe("Rendre à l'assistant");
  });
});

describe("médias décrits entre crochets", () => {
  it("photo, vocal, autocollant ; nature inconnue → pièce jointe ; sans média → null", () => {
    expect(mediaKindOf({ kind: "photo" })).toBe("photo");
    expect(mediaKindOf({ kind: "bizarre" })).toBe("other");
    expect(mediaKindOf(null)).toBeNull();
    expect(mediaKindOf([1])).toBeNull();
    expect(messageText("", { kind: "photo" })).toBe("[photo]");
    expect(messageText("Regarde ça", { kind: "photo" })).toBe("[photo] Regarde ça");
    expect(messageText("", { kind: "voice" })).toBe("[message vocal]");
    expect(messageText("", { kind: "sticker" })).toBe("[autocollant]");
    expect(messageText("  salut  ", null)).toBe("salut");
  });
});

describe("extrait d'une ligne", () => {
  it("espaces fusionnés, coupé avec « … »", () => {
    expect(excerpt("salut\n\n  toi")).toBe("salut toi");
    expect(excerpt("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
    expect(excerpt("😀".repeat(12), 10)).toBe(`${"😀".repeat(9)}…`);
  });
  it("auteur du dernier message en tête", () => {
    expect(lastAuthorPrefix("ASSISTANT", "F")).toBe("Assistante : ");
    expect(lastAuthorPrefix("ASSISTANT", "M")).toBe("Assistant : ");
    expect(lastAuthorPrefix("TEAM", null)).toBe("Équipe : ");
    expect(lastAuthorPrefix("SYSTEM", null)).toBe("Message automatique : ");
    expect(lastAuthorPrefix("MEMBER", null)).toBe("");
  });
});

describe("source, fermeture, parcours, coût", () => {
  it("« Sans source » ; la valeur « sans » ne peut pas être une vraie source", () => {
    expect(sourceLabel(null)).toBe("Sans source");
    expect(sourceLabel("tk01")).toBe("tk01");
    expect(/^[A-Za-z0-9_-]{1,64}$/.test(NONE_KEY)).toBe(false);
  });
  it("raisons de fermeture en clair", () => {
    expect(closedReasonLabel("STOP")).toContain("/stop");
    expect(closedReasonLabel("TEAM")).toBe("Bloquée par l'équipe");
    expect(closedReasonLabel(TEAM_CLOSED_REASON)).toBe("Fermée par l'équipe");
    expect(closedReasonLabel("AUTRE")).toBe("Fermée");
    expect(closedReasonLabel(null)).toBeNull();
  });
  it("parcours : de l'accueil à l'inscription, sans « Fermée »", () => {
    expect(JOURNEY_STAGES).toEqual([
      "WELCOME",
      "CHAT",
      "PROPOSAL",
      "LINK_SENT",
      "FOLLOW_UP",
      "CONVERTED",
    ]);
  });
  it("coût : « moins de 0,01 € » pour quelques appels", () => {
    expect(aiCostText(0)).toMatch(/^0,00\s€$/);
    expect(aiCostText(0.0042)).toMatch(/^moins de 0,01\s€$/);
    expect(aiCostText(1.236)).toMatch(/^1,24\s€$/);
  });
  it("pourcentage : espace insécable avant « % » (jamais seul à la ligne), « — » sans valeur", () => {
    expect(pctText(0)).toBe("0\u00a0%");
    expect(pctText(0.8333)).toBe("83,3\u00a0%");
    expect(pctText(0.2, 0)).toBe("20\u00a0%");
    expect(pctText(null)).toBe("—");
    expect(pctText(0.5)).not.toContain(" %");
  });
});

describe("« Qui répond » quand l'assistante a la main", () => {
  it("même libellé que la pastille par défaut (« L'assistante répond »), accordé à une persona masculine", () => {
    expect(botStatusLabel(null)).toBe("L'assistante répond");
    expect(botStatusLabel(null)).toBe(statusLabel("conversationStatus", "BOT"));
    expect(botStatusLabel("F")).toBe("L'assistante répond");
    expect(botStatusLabel("M")).toBe("L'assistant répond");
  });
});

describe("conversations à traiter (phase 25)", () => {
  it("motifs connus en clair, repli générique pour toute autre valeur", () => {
    expect(NEEDS_HUMAN_LABEL).toBe("À traiter");
    expect(needsHumanReasonLabel("hors_fiche")).toBe("Question hors de la fiche d'informations");
    expect(needsHumanReasonLabel("reclamation")).toBe("Réclamation");
    expect(needsHumanReasonLabel("argent")).toBe("Demande d'argent");
    expect(needsHumanReasonLabel("mineur")).toBe("Mineur possible");
    expect(needsHumanReasonLabel("insulte")).toBe("Insulte");
    expect(needsHumanReasonLabel(" ARGENT ")).toBe("Demande d'argent");
    for (const v of [null, undefined, "", "autre", "toString", "__proto__", "constructor"])
      expect(needsHumanReasonLabel(v)).toBe(NEEDS_HUMAN_FALLBACK);
    expect(NEEDS_HUMAN_FALLBACK).toBe("À reprendre par l'équipe");
  });

  it("univers : mêmes valeurs que le contrat des personas, libellés du site", () => {
    expect([...CONVERSATION_UNIVERSES]).toEqual([...PERSONA_UNIVERSES]);
    expect(conversationUniverseLabel("dating")).toBe(UNIVERSE_LABELS.DATING);
    expect(conversationUniverseLabel("casino")).toBe(UNIVERSE_LABELS.CASINO);
    expect(conversationUniverseLabel("sports")).toBe(UNIVERSE_LABELS.SPORTS);
    expect(conversationUniverseLabel(null)).toBe("Sans univers");
    expect(conversationUniverseLabel("DATING")).toBe("Sans univers");
    expect(isConversationUniverse("casino")).toBe(true);
    expect(isConversationUniverse("autre")).toBe(false);
  });
});
