/** Offre ajoutée comme lien dans le texte (phase 12, D10) : règles pures. */
import { describe, expect, it } from "vitest";
import { validateTelegramHtml } from "@linkaffipro/core";
import {
  appendToText,
  replaceTrackedSlug,
  textOfferDestination,
  textOfferLabelError,
  textOfferLinkHtml,
  trackedLinkSlugs,
} from "./offer-link";

const BASE = "https://go.goolink.eu";

describe("adresse de l'offre sans identifiant par membre", () => {
  it("retire le paramètre qui ne contient que le repère du membre", () => {
    expect(textOfferDestination("https://linkaffi.me/go/47eb8mwc?sub_id={subid}")).toBe(
      "https://linkaffi.me/go/47eb8mwc",
    );
    expect(textOfferDestination("https://x.test/go?a=1&sub={subid}&b=2#top")).toBe(
      "https://x.test/go?a=1&b=2#top",
    );
    expect(textOfferDestination("https://x.test/go?c={click_id}{member_id}")).toBe(
      "https://x.test/go",
    );
  });

  it("garde le reste tel quel", () => {
    expect(textOfferDestination("https://x.test/go")).toBe("https://x.test/go");
    expect(textOfferDestination("https://x.test/go?ref=abc")).toBe("https://x.test/go?ref=abc");
    expect(textOfferDestination("https://x.test/go?s=pre{subid}")).toBe(
      "https://x.test/go?s=pre{subid}",
    );
  });
});

describe("liens traqués d'un texte", () => {
  const html = `Hey <a href="${BASE}/AbCd1234">ici</a> et <b><a href="${BASE}/Zz99Yy88">là</a></b> <a href="${BASE}/AbCd1234">encore</a> <a href="https://autre.test/AbCd1234">non</a>`;

  it("trouve chaque adresse une fois, dans l'ordre", () => {
    expect(trackedLinkSlugs(html, BASE)).toEqual(["AbCd1234", "Zz99Yy88"]);
    expect(trackedLinkSlugs(html, `${BASE}/`)).toEqual(["AbCd1234", "Zz99Yy88"]);
    expect(trackedLinkSlugs("rien", BASE)).toEqual([]);
  });

  it("remplace toutes les occurrences d'une adresse, sans toucher aux autres liens", () => {
    const out = replaceTrackedSlug(html, BASE, "AbCd1234", "Nouv1234");
    expect(trackedLinkSlugs(out, BASE)).toEqual(["Nouv1234", "Zz99Yy88"]);
    expect(out).toContain('href="https://autre.test/AbCd1234"');
  });
});

describe("lien ajouté au texte", () => {
  it("HTML Telegram valide, texte échappé", () => {
    const link = textOfferLinkHtml(`${BASE}/AbCd1234`, "Jouer <maintenant> & gagner");
    expect(link).toBe(`<a href="${BASE}/AbCd1234">Jouer &lt;maintenant&gt; &amp; gagner</a>`);
    expect(validateTelegramHtml(link).ok).toBe(true);
  });

  it("à la fin du texte, sur un nouveau paragraphe", () => {
    expect(appendToText("Bonjour  \n", "<a>x</a>")).toBe("Bonjour\n\n<a>x</a>");
    expect(appendToText("", "<a>x</a>")).toBe("<a>x</a>");
  });

  it("texte du lien obligatoire, 64 caractères au plus", () => {
    expect(textOfferLabelError("  ")).toMatch(/Écrivez le texte du lien/);
    expect(textOfferLabelError("x".repeat(65))).toMatch(/64 caractères/);
    expect(textOfferLabelError("Profiter de l'offre")).toBeNull();
  });
});
