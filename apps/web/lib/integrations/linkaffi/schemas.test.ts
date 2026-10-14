import { describe, expect, it } from "vitest";
import { IntegrationError } from "./http";
import {
  createInviteLinkSchema,
  MAX_BODY_BYTES,
  membersQuerySchema,
  parseOrThrow,
  patchInviteLinkSchema,
  readJsonBody,
} from "./schemas";

/** Validation stricte des appels de Link Affi, messages en français. */
const valid = {
  campaignKey: "paul_tg-01",
  campaignName: "Paul · Zone Interdite",
  affiliateId: "aff-123",
  affiliateName: "Paul",
  channelId: "cm0channel000000000000001",
};

function errorOf(fn: () => unknown): IntegrationError {
  try {
    fn();
  } catch (err) {
    if (err instanceof IntegrationError) return err;
    throw err;
  }
  throw new Error("aucune erreur");
}

describe("POST /invite-links : corps", () => {
  it("accepte le corps du contrat ; attributionDays null ou 0 = à vie, absent = non précisé", () => {
    // Absent : rien n'est précisé (un lien nouveau sera « à vie », un lien existant garde sa durée).
    const absent = parseOrThrow(createInviteLinkSchema, valid, "invalid_body");
    expect(absent).toEqual(valid);
    expect(absent.attributionDays).toBeUndefined();
    expect(
      parseOrThrow(createInviteLinkSchema, { ...valid, attributionDays: undefined }, "invalid_body")
        .attributionDays,
    ).toBeUndefined();
    for (const d of [null, 0])
      expect(
        parseOrThrow(createInviteLinkSchema, { ...valid, attributionDays: d }, "invalid_body")
          .attributionDays,
      ).toBeNull();
    expect(
      parseOrThrow(createInviteLinkSchema, { ...valid, attributionDays: 30 }, "invalid_body")
        .attributionDays,
    ).toBe(30);
  });

  it("nettoie les espaces, accepte un identifiant d'affilié numérique et un nom d'affilié absent", () => {
    const r = parseOrThrow(
      createInviteLinkSchema,
      { ...valid, campaignName: "  Paul  ", affiliateId: 42, affiliateName: "", extra: "ignoré" },
      "invalid_body",
    );
    expect(r).toMatchObject({ campaignName: "Paul", affiliateId: "42", affiliateName: null });
    expect(r).not.toHaveProperty("extra");
    // Nom absent : non précisé (un lien existant garde son nom) ; null explicite : pas de nom.
    expect(
      parseOrThrow(createInviteLinkSchema, { ...valid, affiliateName: undefined }, "invalid_body")
        .affiliateName,
    ).toBeUndefined();
    const { affiliateName: _omit, ...noName } = valid;
    expect(
      parseOrThrow(createInviteLinkSchema, noName, "invalid_body").affiliateName,
    ).toBeUndefined();
    expect(
      parseOrThrow(createInviteLinkSchema, { ...valid, affiliateName: null }, "invalid_body")
        .affiliateName,
    ).toBeNull();
  });

  it("un champ présent mais du mauvais type n'est pas annoncé « obligatoire »", () => {
    const e = errorOf(() =>
      parseOrThrow(
        createInviteLinkSchema,
        { campaignKey: 123, campaignName: true, affiliateId: {}, channelId: 5, affiliateName: 7 },
        "invalid_body",
      ),
    );
    const byField = Object.fromEntries(e.details!.map((d) => [d.field, d.message]));
    expect(byField.campaignKey).toMatch(/^« campaignKey » doit être un texte/);
    expect(byField.campaignName).toMatch(/^« campaignName » doit être un texte/);
    expect(byField.affiliateId).toMatch(/^« affiliateId » doit être un texte ou un nombre/);
    expect(byField.channelId).toMatch(/^« channelId » doit être un texte/);
    expect(byField.affiliateName).toMatch(/^« affiliateName » doit être un texte/);
    expect(e.message).not.toMatch(/obligatoire/);
    // Absents : « obligatoire », comme avant.
    const missing = errorOf(() => parseOrThrow(createInviteLinkSchema, {}, "invalid_body"));
    for (const d of missing.details!) expect(d.message).toMatch(/est obligatoire/);
    // Paramètre de GET /members : même règle.
    expect(errorOf(() => parseOrThrow(membersQuerySchema, {}, "invalid_query")).message).toMatch(
      /« campaignKey » est obligatoire/,
    );
  });

  it("refuse en 400 avec un message en français par champ", () => {
    const missing = errorOf(() => parseOrThrow(createInviteLinkSchema, {}, "invalid_body"));
    expect(missing.status).toBe(400);
    expect(missing.code).toBe("invalid_body");
    expect(missing.message).toMatch(/^Requête invalide : /);
    expect(missing.details?.map((d) => d.field)).toEqual([
      "campaignKey",
      "campaignName",
      "affiliateId",
      "channelId",
    ]);
    expect(missing.message).toMatch(/« campaignKey » est obligatoire/);

    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ campaignKey: "a b" }, /campaignKey.*lettres, les chiffres/],
      [{ campaignKey: "x".repeat(65) }, /campaignKey.*de 1 à 64/],
      [{ campaignName: "   " }, /campaignName.*vide/],
      [{ campaignName: "x".repeat(201) }, /campaignName.*trop long/],
      [{ affiliateId: "" }, /affiliateId.*vide/],
      [{ affiliateId: { id: 1 } }, /affiliateId.*doit être un texte ou un nombre/],
      [{ channelId: 12 }, /channelId.*doit être un texte/],
      [{ attributionDays: 1.5 }, /attributionDays.*entier/],
      [{ attributionDays: -1 }, /attributionDays.*négatif/],
      [{ attributionDays: 4000 }, /attributionDays.*trop grand/],
      [{ attributionDays: "30" }, /attributionDays.*nombre entier/],
    ];
    for (const [patch, re] of cases) {
      const e = errorOf(() =>
        parseOrThrow(createInviteLinkSchema, { ...valid, ...patch }, "invalid_body"),
      );
      expect(e.status).toBe(400);
      expect(e.message).toMatch(re);
    }
    for (const body of [[], "texte", null, 3])
      expect(
        errorOf(() => parseOrThrow(createInviteLinkSchema, body, "invalid_body")).message,
      ).toMatch(/objet JSON/);
  });
});

describe("PATCH /invite-links/{id} : corps", () => {
  it("isActive booléen obligatoire", () => {
    expect(parseOrThrow(patchInviteLinkSchema, { isActive: false }, "invalid_body")).toEqual({
      isActive: false,
    });
    expect(errorOf(() => parseOrThrow(patchInviteLinkSchema, {}, "invalid_body")).message).toMatch(
      /« isActive » est obligatoire/,
    );
    for (const body of [{ isActive: "false" }, { isActive: 0 }])
      expect(
        errorOf(() => parseOrThrow(patchInviteLinkSchema, body, "invalid_body")).message,
      ).toMatch(/« isActive » doit être un booléen \(true ou false\)/);
  });
});

describe("GET /members : paramètres", () => {
  it("campaignKey obligatoire ; since facultatif, en date ISO", () => {
    expect(parseOrThrow(membersQuerySchema, { campaignKey: "k1" }, "invalid_query")).toEqual({
      campaignKey: "k1",
    });
    expect(
      parseOrThrow(
        membersQuerySchema,
        { campaignKey: "k1", since: "2026-10-14T08:00:00Z" },
        "invalid_query",
      ).since?.toISOString(),
    ).toBe("2026-10-14T08:00:00.000Z");
    const e = errorOf(() => parseOrThrow(membersQuerySchema, { since: "hier" }, "invalid_query"));
    expect(e.code).toBe("invalid_query");
    expect(e.message).toMatch(/^Paramètres invalides : .*campaignKey.*since.*ISO 8601/);
  });
});

describe("lecture du corps", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://x/api", { method: "POST", body, headers });
  it("JSON valide", async () => {
    expect(await readJsonBody(req('{"a":1}'))).toEqual({ a: 1 });
  });
  it("corps vide, illisible ou trop gros : 400 / 413 en français", async () => {
    await expect(readJsonBody(req(""))).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
    });
    await expect(readJsonBody(req("{oups"))).rejects.toMatchObject({
      status: 400,
      message: "Le corps de la requête n'est pas du JSON valide.",
    });
    await expect(readJsonBody(req("x".repeat(MAX_BODY_BYTES + 1)))).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
    await expect(
      readJsonBody(req("{}", { "content-length": String(MAX_BODY_BYTES * 10) })),
    ).rejects.toMatchObject({ status: 413 });
  });
});
