import { describe, expect, it } from "vitest";
import { renderLandingHtml } from "@linkaffipro/core";
import {
  MAX_LANDING_SOURCES,
  advancedModifiedCount,
  checkPixel,
  effectiveSlug,
  emptyLandingForm,
  formFromPage,
  mainSource,
  newSource,
  pageContentChanged,
  planSourceChanges,
  previewInput,
  savedPagePreviewInput,
  shortUrl,
  slugProblem,
  sourceKeyProblem,
  adUsedElsewhere,
  missingLandingException,
  orderAdGroups,
  slugPlaceholder,
  slugWillChange,
  sourcePublicUrl,
  suggestedPageName,
  validateLandingForm,
  type LandingFormState,
} from "./form";

const ctx = {
  channelIds: new Set(["ch1"]),
  adIds: new Set(["ad1", "ad2"]),
  channelTitle: "Casino VIP",
};

function form(over: Partial<LandingFormState> = {}): LandingFormState {
  return { ...emptyLandingForm("ch1"), headline: "Les meilleurs bonus", ...over };
}

describe("formulaire d'une page : état initial", () => {
  it("nouvelle page : lien principal seul, français, en ligne", () => {
    const f = emptyLandingForm("ch1");
    expect(f.sources).toEqual([mainSource()]);
    expect(f.language).toBe("fr");
    expect(f.isActive).toBe(true);
    expect(advancedModifiedCount(f)).toBe(0);
  });

  it("page enregistrée : lien principal en tête, sources retirées absentes", () => {
    const f = formFromPage({
      id: "p1",
      channelId: "ch1",
      name: "Promo",
      slug: "promo",
      language: "pt-BR",
      headline: "Bonus",
      subtext: null,
      buttonText: null,
      footnote: "Gratuit",
      showPhoto: true,
      cookieBanner: false,
      tiktokPixelId: null,
      metaPixelId: null,
      isActive: true,
      sources: [
        { id: "s2", key: "tk01", adId: "ad1", isActive: true },
        { id: "s1", key: "", adId: null, isActive: true },
        { id: "s3", key: "old", adId: null, isActive: false },
      ],
    });
    expect(f.language).toBe("pt");
    expect(f.sources.map((s) => [s.id, s.key, s.main])).toEqual([
      ["s1", "", true],
      ["s2", "tk01", false],
    ]);
    expect(advancedModifiedCount(f, { name: "Promo", slug: "promo" })).toBe(3);
  });
});

describe("contrôles à la frappe", () => {
  it("pixels : vide, identifiant seul, code complet collé, refusé", () => {
    expect(checkPixel("tiktok", "  ")).toEqual({ state: "empty" });
    expect(checkPixel("tiktok", "cd2uc93c77u35bvuo310")).toEqual({
      state: "ok",
      id: "CD2UC93C77U35BVUO310",
    });
    expect(checkPixel("tiktok", "ttq.load('CD2UC93C77U35BVUO310'); ttq.page();")).toEqual({
      state: "ok",
      id: "CD2UC93C77U35BVUO310",
    });
    expect(checkPixel("meta", "fbq('init', '1070571443971391');")).toEqual({
      state: "ok",
      id: "1070571443971391",
    });
    expect(checkPixel("meta", "abc").state).toBe("invalid");
    expect(checkPixel("tiktok", "1070571443971391").state).toBe("invalid");
  });

  it("nom d'une source : obligatoire, caractères permis, pas deux fois", () => {
    expect(sourceKeyProblem("", [])).toMatch(/Donnez un nom/);
    expect(sourceKeyProblem("tk 01", [])).toMatch(/lettres sans accents/);
    expect(sourceKeyProblem("TK01", ["tk01"])).toBe(
      "La source « tk01 » existe déjà sur cette page.",
    );
    expect(sourceKeyProblem("exo1", ["tk01"])).toBeNull();
  });

  it("adresse de la page : vide permise (proposée), format contrôlé, jamais un segment réservé", () => {
    expect(slugProblem("")).toBeNull();
    expect(slugProblem("promo-vip")).toBeNull();
    expect(slugProblem("_e")).not.toBeNull();
    expect(slugProblem("Promo")).not.toBeNull();
    expect(slugProblem("ab")).not.toBeNull();
    expect(slugProblem("-promo")).not.toBeNull();
  });

  it("nom et adresse proposés d'après le canal, sans doublon de nom", () => {
    expect(suggestedPageName("Casino VIP 🎰")).toBe("Casino VIP 🎰");
    expect(suggestedPageName("Casino VIP", ["casino vip", "Casino VIP 2"])).toBe("Casino VIP 3");
    expect(suggestedPageName("   ")).toBe("Page");
    expect(effectiveSlug({ slug: "", name: "" }, "Démo · Casino VIP")).toBe("demo-casino-vip");
    expect(effectiveSlug({ slug: "promo", name: "x" }, "Casino")).toBe("promo");
  });

  it("adresse publique d'une source : le lien principal n'a pas de source", () => {
    expect(sourcePublicUrl("https://go.goolink.eu/", "promo", "")).toBe(
      "https://go.goolink.eu/j/promo",
    );
    expect(sourcePublicUrl("https://go.goolink.eu", "promo", "tk01")).toBe(
      "https://go.goolink.eu/j/promo?src=tk01",
    );
    expect(shortUrl("https://go.goolink.eu/j/promo?src=tk01")).toBe(
      "go.goolink.eu/j/promo?src=tk01",
    );
  });
});

describe("aperçu en direct", () => {
  it("même rendu que la page publique, sans script ni pixel, avec le vrai titre du canal", () => {
    const html = renderLandingHtml(
      previewInput(
        form({ tiktokPixel: "CD2UC93C77U35BVUO310", cookieBanner: true, buttonText: "" }),
        { channelTitle: "Casino VIP 🎰", photoUrl: "/pages/photo/ch1" },
      ),
    );
    expect(html).toContain("Casino VIP 🎰");
    expect(html).toContain("Les meilleurs bonus");
    expect(html).toContain("Rejoindre le canal →");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("analytics.tiktok.com");
    // Bandeau cookies montré tel quel (un pixel est saisi) ; photo seulement si elle est demandée.
    expect(html).toContain('id="k"');
    expect(html).not.toContain("/pages/photo/ch1");
  });

  it("accroche vide : texte d'exemple ; photo affichée quand elle est demandée ; langue de la page", () => {
    const html = renderLandingHtml(
      previewInput(form({ headline: " ", showPhoto: true, language: "en" }), {
        channelTitle: "VIP",
        photoUrl: "/pages/photo/ch1",
      }),
    );
    // L'apostrophe peut rester telle quelle dans le texte de la page (sûre hors d'un attribut) ou être échappée.
    expect(html).toMatch(/Votre phrase d(?:&#39;|')accroche/);
    expect(html).toContain('src="/pages/photo/ch1"');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Join the channel →");
  });

  it("« Voir la page » : la page enregistrée en aperçu, jamais la vraie page (rien n'est compté, aucun pixel)", () => {
    const input = savedPagePreviewInput(
      {
        id: "p1",
        channelId: "ch1",
        name: "Promo",
        slug: "promo",
        language: "fr",
        headline: "Bonus du soir",
        subtext: null,
        buttonText: "Entrer →",
        footnote: null,
        showPhoto: true,
        cookieBanner: true,
        tiktokPixelId: "CD2UC93C77U35BVUO310",
        metaPixelId: "1234567890123456",
        isActive: true,
        sources: [{ id: "s0", key: "", adId: null, isActive: true }],
      },
      { id: "ch 1", title: "Casino VIP", hasPhoto: true },
    );
    expect(input.preview).toBe(true);
    const html = renderLandingHtml(input);
    expect(html).toContain("Casino VIP");
    expect(html).toContain("Bonus du soir");
    expect(html).toContain("Entrer →");
    expect(html).toContain('src="/pages/photo/ch%201"');
    // Ni script (aucune visite ni aucun clic envoyé), ni pixel, ni page à compter, ni vrai lien d'invitation.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("data-p=");
    expect(html).not.toContain("data-tt=");
    expect(html).not.toContain("data-fb=");
    expect(html).toContain('href="https://t.me/+apercu"');
    // Le bandeau cookies est montré tel que les visiteurs le voient.
    expect(html).toContain('id="k"');
    // Canal sans photo : pas de photo, même demandée.
    expect(
      renderLandingHtml(
        savedPagePreviewInput(
          {
            id: "p1",
            channelId: "ch1",
            name: "Promo",
            slug: "promo",
            language: "fr",
            headline: "Bonus",
            subtext: null,
            buttonText: null,
            footnote: null,
            showPhoto: true,
            cookieBanner: false,
            tiktokPixelId: null,
            metaPixelId: null,
            isActive: false,
            sources: [],
          },
          { id: "ch1", title: "VIP", hasPhoto: false },
        ),
      ),
    ).not.toContain("<img");
  });
});

describe("validation complète (action serveur)", () => {
  it("page correcte : textes nettoyés, pixels retrouvés, lien principal en tête", () => {
    const v = validateLandingForm(
      {
        ...form({
          subtext: "  Bonus   du jour ",
          tiktokPixel: "ttq.load('CD2UC93C77U35BVUO310')",
          metaPixel: "",
        }),
        sources: [
          mainSource("s1"),
          { id: null, key: "TK01", adId: "ad1", removed: false, main: false },
          { id: null, key: "exo1", adId: null, removed: true, main: false },
        ],
      },
      ctx,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toMatchObject({
      channelId: "ch1",
      name: "Casino VIP",
      slug: null,
      headline: "Les meilleurs bonus",
      subtext: "Bonus du jour",
      buttonText: null,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: null,
      isActive: true,
    });
    expect(v.value.sources).toEqual([
      { key: "", adId: null },
      { key: "tk01", adId: "ad1" },
    ]);
  });

  it("refus : canal inconnu, accroche vide ou trop longue, pixel illisible, source en double, pub inconnue", () => {
    const v = validateLandingForm(
      {
        ...form({
          channelId: "autre",
          headline: "x".repeat(121),
          metaPixel: "pas un pixel",
          slug: "Mauvaise Adresse",
        }),
        sources: [
          mainSource(),
          { id: null, key: "tk01", adId: null, removed: false, main: false },
          { id: null, key: "TK01", adId: null, removed: false, main: false },
          { id: null, key: "exo1", adId: "inconnue", removed: false, main: false },
          newSource(),
        ],
      },
      ctx,
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toBe("Choisissez le canal.");
    expect(v.errors.headline).toMatch(/120 caractères/);
    expect(v.errors.metaPixel).toMatch(/pixel Meta non reconnu/);
    expect(v.errors.slug).toMatch(/Adresse de la page/);
    expect(v.errors.sourceErrors).toEqual({
      2: "La source « tk01 » existe déjà sur cette page.",
      3: "Cette pub n'existe plus : choisissez-en une autre, ou « Aucune pub ».",
      4: "Donnez un nom à la source (par exemple tk01).",
    });
  });

  it("accroche absente ; lien principal recréé s'il manque ; trop de sources refusées", () => {
    expect(validateLandingForm({ ...form({ headline: "" }) }, ctx)).toMatchObject({
      ok: false,
      message: "Écrivez la phrase d'accroche.",
    });
    const v = validateLandingForm(
      { ...form(), sources: [{ id: null, key: "tk01", adId: null, removed: false, main: false }] },
      ctx,
    );
    expect(v.ok && v.value.sources.map((s) => s.key)).toEqual(["", "tk01"]);
    const many = Array.from({ length: MAX_LANDING_SOURCES }, (_, i) => ({
      id: null,
      key: `s${i}`,
      adId: null,
      removed: false,
      main: false,
    }));
    expect(validateLandingForm({ ...form(), sources: [mainSource(), ...many] }, ctx)).toMatchObject(
      {
        ok: false,
        message: `${MAX_LANDING_SOURCES} sources au plus par page (lien principal compris).`,
      },
    );
  });
});

describe("nom ou adresse vidés : le serveur fait ce que le formulaire annonce", () => {
  it("nouvelle page sans nom : le nom proposé, sans doublon (comme le formulaire)", () => {
    const v = validateLandingForm(
      { ...form({ name: "" }) },
      { ...ctx, takenNames: ["Casino VIP", "Autre page"] },
    );
    expect(v.ok && v.value.name).toBe("Casino VIP 2");
  });

  it("page existante dont on vide le nom : elle garde son nom (jamais renommée au titre du canal)", () => {
    const v = validateLandingForm(
      { ...form({ pageId: "p1", name: "   " }) },
      { ...ctx, existingName: "Démo · Casino VIP" },
    );
    expect(v.ok && v.value.name).toBe("Démo · Casino VIP");
    // Un nouveau nom saisi est bien pris.
    const w = validateLandingForm(
      { ...form({ pageId: "p1", name: "Promo TikTok" }) },
      { ...ctx, existingName: "Démo · Casino VIP" },
    );
    expect(w.ok && w.value.name).toBe("Promo TikTok");
  });

  it("adresse vidée d'une page existante : aucun avertissement, l'adresse enregistrée en exemple", () => {
    const saved = { name: "Démo · Casino VIP", slug: "demo-casino-vip" };
    expect(slugWillChange("", saved)).toBe(false);
    expect(slugWillChange("  ", saved)).toBe(false);
    expect(slugWillChange("demo-casino-vip", saved)).toBe(false);
    expect(slugWillChange("promo", saved)).toBe(true);
    expect(slugWillChange("promo", null)).toBe(false);
    expect(slugPlaceholder(form({ pageId: "p1", slug: "", name: "" }), saved, "Casino VIP")).toBe(
      "demo-casino-vip",
    );
    // Nouvelle page : proposée d'après le nom (ou le nom proposé, sans doublon).
    expect(slugPlaceholder(form({ slug: "", name: "" }), null, "Casino VIP", ["Casino VIP"])).toBe(
      "casino-vip-2",
    );
    expect(slugPlaceholder(form({ slug: "", name: "Promo" }), null, "Casino VIP")).toBe("promo");
  });

  it("« Avancé » : un nom ou une adresse vidés ne comptent pas comme une modification", () => {
    const saved = { name: "Démo · Casino VIP", slug: "demo-casino-vip" };
    expect(advancedModifiedCount(form({ pageId: "p1", name: "", slug: "" }), saved)).toBe(0);
    expect(advancedModifiedCount(form({ pageId: "p1", name: "Promo", slug: "" }), saved)).toBe(1);
  });
});

describe("pub reliée : les pubs du canal d'abord, « déjà reliée » signalé", () => {
  const groups = [
    {
      campaignId: "c-autre",
      label: "Autre",
      channelIds: ["ch9"],
      vertical: "SPORTS" as const,
      ads: [],
    },
    {
      campaignId: "c-univers",
      label: "Univers",
      channelIds: [],
      vertical: "CASINO" as const,
      ads: [],
    },
    {
      campaignId: "c-canal",
      label: "Canal",
      channelIds: ["ch1", "ch2"],
      vertical: "CASINO" as const,
      ads: [],
    },
  ];
  it("campagnes du canal de la page, puis de son univers, puis les autres (ordre reçu gardé)", () => {
    expect(orderAdGroups(groups, "ch1", "CASINO").map((g) => g.campaignId)).toEqual([
      "c-canal",
      "c-univers",
      "c-autre",
    ]);
    expect(orderAdGroups(groups, "", null).map((g) => g.campaignId)).toEqual([
      "c-autre",
      "c-univers",
      "c-canal",
    ]);
  });

  it("déjà reliée à une autre page, ou à une autre source de ce formulaire", () => {
    const ad = {
      id: "ad1",
      label: "Vidéo bonus",
      usedBy: [{ pageId: "p2", pageName: "Autre", key: "tk09" }],
    };
    const st = form({
      pageId: "p1",
      sources: [
        mainSource("s0"),
        { id: "s1", key: "tk01", adId: "ad2", removed: false, main: false },
        { id: "s2", key: "tk03", adId: null, removed: false, main: false },
        { id: "s3", key: "old", adId: "ad3", removed: true, main: false },
      ],
    });
    expect(adUsedElsewhere(ad, st, 2)).toBe(true);
    const mine = {
      id: "ad2",
      label: "Carrousel",
      usedBy: [{ pageId: "p1", pageName: "Ici", key: "tk01" }],
    };
    // Sa propre source ne compte pas ; une autre source du formulaire, si.
    expect(adUsedElsewhere(mine, st, 1)).toBe(false);
    expect(adUsedElsewhere(mine, st, 2)).toBe(true);
    // Une source retirée dans le formulaire libère sa pub.
    expect(adUsedElsewhere({ id: "ad3", usedBy: [] }, st, 2)).toBe(false);
  });
});

describe("exceptions « pub » qui ne visent pas les pages", () => {
  const rule = (sourceKind: string, over: Record<string, unknown> = {}) => ({
    scope: "SOURCE_KIND",
    sourceKind,
    landingPageId: null,
    isActive: true,
    ...over,
  });
  it("exception « pub » active sans exception pour les pages : à signaler", () => {
    expect(missingLandingException([rule("AD_TIKTOK")], null)).toBe(true);
    expect(missingLandingException([rule("AD_ANY"), rule("LANDING_ANY")], null)).toBe(false);
    expect(
      missingLandingException(
        [rule("AD_META"), rule("LANDING_PAGE", { landingPageId: "p1" })],
        "p1",
      ),
    ).toBe(false);
    // Une exception pour une AUTRE page ne couvre pas celle-ci.
    expect(
      missingLandingException(
        [rule("AD_META"), rule("LANDING_PAGE", { landingPageId: "p2" })],
        "p1",
      ),
    ).toBe(true);
    expect(missingLandingException([rule("AD_ANY", { isActive: false })], null)).toBe(false);
    expect(
      missingLandingException(
        [rule("GATE"), { scope: "DEFAULT", sourceKind: null, landingPageId: null, isActive: true }],
        null,
      ),
    ).toBe(false);
  });
});

describe("sources à écrire", () => {
  const existing = [
    { id: "s0", key: "", adId: null, isActive: true },
    { id: "s1", key: "tk01", adId: "ad1", isActive: true },
    { id: "s2", key: "tk03", adId: null, isActive: true },
    { id: "s3", key: "exo1", adId: null, isActive: false },
  ];

  it("ajout, remise en service, pub changée, retrait ; le lien principal n'est jamais retiré", () => {
    const plan = planSourceChanges(existing, [
      { key: "", adId: null },
      { key: "tk01", adId: "ad2" },
      { key: "exo1", adId: null },
      { key: "nouvelle", adId: null },
    ]);
    expect(plan).toEqual({
      create: [{ key: "nouvelle", adId: null }],
      reactivate: [{ id: "s3", key: "exo1", adId: null }],
      updateAd: [{ id: "s1", key: "tk01", adId: "ad2" }],
      deactivate: [{ id: "s2", key: "tk03" }],
      adsChanged: true,
    });
    expect(planSourceChanges(existing, [{ key: "tk01", adId: "ad1" }]).deactivate).toEqual([
      { id: "s2", key: "tk03" },
    ]);
  });

  it("rien ne change : aucun recalcul ; source reliée à une pub retirée : recalcul", () => {
    const same = planSourceChanges(existing, [
      { key: "", adId: null },
      { key: "tk01", adId: "ad1" },
      { key: "tk03", adId: null },
    ]);
    expect(same).toEqual({
      create: [],
      reactivate: [],
      updateAd: [],
      deactivate: [],
      adsChanged: false,
    });
    expect(
      planSourceChanges(existing, [
        { key: "", adId: null },
        { key: "tk03", adId: null },
      ]).adsChanged,
    ).toBe(true);
  });

  it("nouvelle version seulement si un texte ou un réglage affiché change", () => {
    const before = {
      language: "fr" as const,
      headline: "A",
      subtext: null,
      buttonText: null,
      footnote: null,
      tiktokPixelId: null,
      metaPixelId: null,
      cookieBanner: false,
      showPhoto: false,
      isActive: true,
      slug: "promo",
      name: "Promo",
    };
    const after = { ...before, channelId: "ch1", sources: [] };
    expect(pageContentChanged(before, after)).toBe(false);
    expect(pageContentChanged(before, { ...after, headline: "B" })).toBe(true);
    expect(pageContentChanged(before, { ...after, slug: "promo-2" })).toBe(true);
  });
});
