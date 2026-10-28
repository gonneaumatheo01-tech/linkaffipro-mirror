import { describe, expect, it } from "vitest";
import {
  MAX_PERSONA_BOOKMAKERS,
  bookmakerKeyOf,
  bookmakersToDraft,
  emptyBookmakerDraft,
  sameBookmakers,
  validateBookmakers,
} from "./bookmakers";
import { activationProblems, personaToForm, validatePersonaForm, emptyPersonaForm } from "./form";
import { personaTurnInput } from "./test-turn";

const draft = (label: string, offer = "off-1", link = "", key = "") => ({
  bookmakerKey: key,
  label,
  affiliateCampaignId: offer,
  inviteLinkId: link,
});

describe("bookmakers partenaires : lecture du formulaire", () => {
  it("ordre = priorité, clé tirée du nom, clé enregistrée gardée, lien VIP facultatif", () => {
    const r = validateBookmakers(
      [
        draft("Celsius Casino", "c1", "l1", "celsius"),
        draft(" Bet  Portal ", "c2"),
        draft("Sportazá", "c3", "l3"),
      ],
      "sports",
    );
    expect(r).toEqual({
      ok: true,
      books: [
        {
          bookmakerKey: "celsius",
          label: "Celsius Casino",
          priority: 1,
          affiliateCampaignId: "c1",
          inviteLinkId: "l1",
        },
        {
          bookmakerKey: "betportal",
          label: "Bet Portal",
          priority: 2,
          affiliateCampaignId: "c2",
          inviteLinkId: null,
        },
        {
          bookmakerKey: "sportaza",
          label: "Sportazá",
          priority: 3,
          affiliateCampaignId: "c3",
          inviteLinkId: "l3",
        },
      ],
    });
  });

  it("refus : hors Paris sportifs, sans nom, sans offre, en double, trop nombreux", () => {
    expect(validateBookmakers([draft("Celsius")], "casino").ok).toBe(false);
    expect(validateBookmakers([draft("  ")], "sports")).toMatchObject({
      ok: false,
      error: "Bookmaker 1 : écrivez son nom.",
    });
    expect(validateBookmakers([draft("Celsius", "")], "sports")).toMatchObject({ ok: false });
    expect(validateBookmakers([draft("Bet Portal"), draft("bet-portal")], "sports")).toMatchObject({
      ok: false,
    });
    const many = Array.from({ length: MAX_PERSONA_BOOKMAKERS + 1 }, (_, i) => draft(`Book ${i}`));
    expect(validateBookmakers(many, "sports").ok).toBe(false);
    expect(validateBookmakers([], "casino")).toEqual({ ok: true, books: [] });
  });

  it("brouillon depuis la base, dans l'ordre ; comparaison", () => {
    const rows = [
      { bookmakerKey: "b", label: "B", priority: 2, affiliateCampaignId: null, inviteLinkId: null },
      { bookmakerKey: "a", label: "A", priority: 1, affiliateCampaignId: "c1", inviteLinkId: "l1" },
    ];
    expect(bookmakersToDraft(rows).map((d) => d.bookmakerKey)).toEqual(["a", "b"]);
    expect(bookmakersToDraft(rows)[1]).toEqual({
      bookmakerKey: "b",
      label: "B",
      affiliateCampaignId: "",
      inviteLinkId: "",
    });
    expect(bookmakerKeyOf("Bet Portal !")).toBe("betportal");
    expect(emptyBookmakerDraft()).toEqual(draft("", ""));
    const one = {
      bookmakerKey: "a",
      label: "A",
      priority: 1,
      affiliateCampaignId: "c1",
      inviteLinkId: null,
    };
    expect(sameBookmakers([one], [{ ...one }])).toBe(true);
    expect(sameBookmakers([one], [{ ...one, inviteLinkId: "l1" }])).toBe(false);
  });
});

describe("bookmakers partenaires : fiche de la persona", () => {
  const base = {
    ...emptyPersonaForm(),
    name: "Mehdi",
    gender: "M" as const,
    universe: "sports" as const,
  };

  it("validés avec la persona ; absents du brouillon → liste enregistrée inchangée (null)", () => {
    const v = validatePersonaForm({ ...base, bookmakers: [draft("Celsius Casino", "c1")] });
    expect(v.ok && v.data.bookmakers?.map((b) => b.bookmakerKey)).toEqual(["celsiuscasino"]);
    const { bookmakers: _omit, ...withoutBooks } = base;
    const w = validatePersonaForm(withoutBooks);
    expect(w.ok && w.data.bookmakers).toBeNull();
    const bad = validatePersonaForm({
      ...base,
      universe: "casino",
      bookmakers: [draft("Celsius")],
    });
    expect(bad.ok ? null : bad.errors.bookmakers).toMatch(/Paris sportifs/);
  });

  it("activation : des bookmakers valent une offre liée (présentation de l'offre obligatoire)", () => {
    expect(
      activationProblems({
        name: "Mehdi",
        affiliateCampaignId: null,
        offerPitch: "",
        bookmakerOffers: 2,
      }),
    ).toHaveLength(1);
    const v = validatePersonaForm({
      ...base,
      isActive: true,
      bookmakers: [draft("Celsius", "c1")],
    });
    expect(v.ok ? null : v.errors.offerPitch).toBeTruthy();
  });

  it("formulaire pré-rempli depuis la persona enregistrée", () => {
    const form = personaToForm({
      id: "p1",
      name: "Mehdi",
      gender: "M",
      identityKind: "ASSISTANT",
      universe: "sports",
      age: null,
      personality: "",
      tone: "",
      styleExamples: null,
      languages: ["fr"],
      interests: [],
      extraPrompt: null,
      model: null,
      temperature: null,
      minExchangesBeforeOffer: 1,
      requireInterest: false,
      maxOfferSends: 3,
      followUpAfterHours: 24,
      followUpsMax: 2,
      affiliateCampaignId: null,
      campaignId: null,
      offerPitch: "VIP gratuit",
      offerButtonText: "S'inscrire",
      offerMediaAssetId: null,
      botDescription: "Assistant du canal",
      botShortDescription: "Assistant du canal",
      isActive: false,
      bookmakers: [
        {
          bookmakerKey: "celsius",
          label: "Celsius Casino",
          priority: 1,
          affiliateCampaignId: "c1",
          inviteLinkId: "l1",
        },
      ],
    });
    expect(form.bookmakers).toEqual([draft("Celsius Casino", "c1", "l1", "celsius")]);
  });

  it("« Tester » : seuls les bookmakers à offre active, dans l'ordre ; ils suffisent pour avoir une offre", () => {
    const live = { isActive: true, trackingUrlTemplate: "https://linkaffi.me/go/x" };
    const input = personaTurnInput(
      {
        name: "Mehdi",
        gender: "M",
        personality: "",
        tone: "",
        languages: ["fr"],
        interests: [],
        extraPrompt: null,
        model: null,
        temperature: null,
        minExchangesBeforeOffer: 1,
        requireInterest: false,
        maxOfferSends: 3,
        followUpAfterHours: 24,
        followUpsMax: 2,
        affiliateCampaignId: null,
        offerPitch: "VIP gratuit",
        offerButtonText: "S'inscrire",
        offerMediaAssetId: null,
        universe: "sports",
        bookmakers: [
          {
            bookmakerKey: "sportaza",
            label: "Sportaza",
            priority: 3,
            affiliateCampaign: { ...live, isActive: false },
            inviteLink: null,
          },
          {
            bookmakerKey: "betportal",
            label: "Bet Portal",
            priority: 2,
            affiliateCampaign: live,
            inviteLink: null,
          },
          {
            bookmakerKey: "celsius",
            label: "Celsius",
            priority: 1,
            affiliateCampaign: live,
            inviteLink: { telegramInviteLink: "https://t.me/+v", isActive: true },
          },
        ],
      },
      { offerUsable: false, channelTitle: null, botName: null },
    );
    expect(input.hasOffer).toBe(true);
    expect(input.bookmakers).toEqual([
      { bookmakerKey: "celsius", label: "Celsius", priority: 1, hasInviteLink: true },
      { bookmakerKey: "betportal", label: "Bet Portal", priority: 2, hasInviteLink: false },
    ]);
  });
});
