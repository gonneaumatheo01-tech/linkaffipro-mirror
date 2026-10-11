import { describe, expect, it } from "vitest";
import { customEmojiTag, textLength, validateTelegramHtml } from "@linkaffipro/core";
import {
  htmlToTelegram,
  plainPasteToTelegram,
  telegramToEditorHtml,
  visibleText,
} from "./telegram-format";
import { customEmojiChipHtml, fallbackImageSrc, telegramHtmlWithChips } from "./custom-emoji-chip";

/** Aller-retour complet : HTML Telegram → éditeur → HTML Telegram. */
const roundTrip = (tg: string) => htmlToTelegram(telegramToEditorHtml(tg), "editor");
const ID = "5368324170671202286";
const ID2 = "5235837920081887219";
const tag = (id: string, fb: string) => `<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`;
const chip = (id: string, fb: string) => customEmojiChipHtml(id, fb);

function expectValid(tg: string) {
  expect(validateTelegramHtml(tg), tg).toMatchObject({ ok: true });
}

describe("emoji animé : HTML Telegram → éditeur (puce atomique)", () => {
  it("une image (caractère indivisible) : identifiant et emoji de remplacement en attributs, emoji dessiné", () => {
    expect(chip(ID, "👍")).toBe(
      `<img class="lap-ce" data-ce-id="${ID}" data-ce-fallback="👍" alt="👍" title="Emoji animé" draggable="false" src="${fallbackImageSrc("👍")}">`,
    );
    expect(fallbackImageSrc("👍")).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(decodeURIComponent(fallbackImageSrc("👍"))).toContain(">👍</text>");
    expect(telegramToEditorHtml(`Salut ${tag(ID, "👍")} !`)).toBe(`Salut ${chip(ID, "👍")} !`);
  });

  it("emoji de remplacement échappé (aucune balise ne passe)", () => {
    expect(chip(ID, '<b>"&')).toContain('data-ce-fallback="&lt;b&gt;&quot;&amp;"');
    expect(chip(ID, '<b>"&')).toContain('alt="&lt;b&gt;&quot;&amp;"');
    expect(decodeURIComponent(fallbackImageSrc('<b>"&'))).toContain(">&lt;b&gt;&quot;&amp;</text>");
    expect(chip(ID, '<b>"&')).not.toContain("<b>");
    expect(/src="([^"]*)"/.exec(chip(ID, '<b>"&'))?.[1]).not.toMatch(/[<>&]/);
  });

  it("guillemets simples, espaces et majuscules acceptés à la lecture", () => {
    expect(telegramToEditorHtml(`<TG-EMOJI emoji-id='${ID}' >🔥</TG-EMOJI>`)).toBe(chip(ID, "🔥"));
  });

  it("identifiant invalide : seul l'emoji de remplacement reste (texte)", () => {
    expect(telegramToEditorHtml(`<tg-emoji emoji-id="abc">🔥</tg-emoji> ok`)).toBe("🔥 ok");
    expect(telegramToEditorHtml(`<tg-emoji emoji-id="0">🔥</tg-emoji>`)).toBe("🔥");
    expect(telegramToEditorHtml(`<tg-emoji>🔥</tg-emoji>`)).toBe("🔥");
  });

  it("balise vide (ancien texte) : emoji de remplacement « ⭐ » (Telegram exige un emoji)", () => {
    expect(roundTrip(`a <tg-emoji emoji-id="${ID}"></tg-emoji>`)).toBe(`a ${tag(ID, "⭐")}`);
  });
});

describe("emoji animé : aller-retour sans perte", () => {
  const cases: Array<[string, string]> = [
    ["seul", tag(ID, "👍")],
    ["dans une phrase", `Salut ${tag(ID, "👍")} et bienvenue ${tag(ID2, "🎰")}`],
    ["deux fois le même, collés", `${tag(ID, "🔥")}${tag(ID, "🔥")}${tag(ID, "🔥")}`],
    ["dans du gras", `<b>Gros ${tag(ID, "🔥")} bonus</b>`],
    ["gras et italique autour", `<b><i>${tag(ID, "🔥")}</i></b> fin`],
    ["dans un texte masqué", `<tg-spoiler>surprise ${tag(ID, "🎁")}</tg-spoiler>`],
    ["dans une citation", `<blockquote>Avis ${tag(ID, "⭐")}</blockquote>`],
    ["dans une citation repliable", `<blockquote expandable>${tag(ID, "⭐")} long</blockquote>`],
    ["en début de ligne", `ligne 1\n${tag(ID, "👉")} ligne 2\n`],
    ["en fin de texte", `fin ${tag(ID, "✅")}`],
    ["emoji composé (drapeau, peau, ZWJ)", `${tag(ID, "🇫🇷")} ${tag(ID2, "👍🏽")} ${tag(ID, "👨‍👩‍👧")}`],
    ["emoji de remplacement avec variation", tag(ID, "❤️")],
    ["identifiant absent de la bibliothèque", tag("1", "😀")],
    ["identifiant de 20 chiffres", tag("18446744073709551615", "😀")],
  ];
  for (const [name, tg] of cases) {
    it(name, () => {
      expect(roundTrip(tg)).toBe(tg);
      // La validation de @linkaffipro/core ne connaît pas l'attribut sans valeur « expandable » (déjà le cas avant).
      if (!tg.includes("expandable")) expectValid(tg);
      // Second passage : stable.
      expect(roundTrip(roundTrip(tg))).toBe(tg);
    });
  }

  it("deux emojis collés ne fusionnent jamais en un seul", () => {
    const tg = `${tag(ID, "🔥")}${tag(ID, "🔥")}`;
    expect(telegramToEditorHtml(tg)).toBe(`${chip(ID, "🔥")}${chip(ID, "🔥")}`);
  });

  it("customEmojiTag de @linkaffipro/core relu tel quel", () => {
    const tg = `Top ${customEmojiTag(ID, "🚀")}`;
    expect(roundTrip(tg)).toBe(tg);
  });
});

describe("emoji animé : règles d'imbrication de Telegram", () => {
  it("dans un lien : le lien est coupé autour de l'emoji (un lien ne peut pas contenir d'emoji animé)", () => {
    const out = roundTrip(`<a href="https://x.fr">Voir ${tag(ID, "👉")} ici</a>`);
    expect(out).toBe(
      `<a href="https://x.fr">Voir </a>${tag(ID, "👉")}<a href="https://x.fr"> ici</a>`,
    );
    expectValid(out);
  });
  it("dans du code ou un bloc de code : l'emoji de remplacement reste, en texte", () => {
    expect(roundTrip(`<code>a ${tag(ID, "👍")} b</code>`)).toBe("<code>a 👍 b</code>");
    expect(roundTrip(`<pre>x${tag(ID, "👍")}</pre>`)).toBe("<pre>x👍</pre>");
  });
});

describe("emoji animé : contenu de l'éditeur → HTML Telegram", () => {
  it("puce marquée « prête » (animation affichée) : relue pareil", () => {
    const html = `a <img class="lap-ce" data-ce-id="${ID}" data-ce-fallback="🔥" alt="🔥" data-ce-ready="" src="data:image/svg+xml,x"> b`;
    expect(htmlToTelegram(html, "editor")).toBe(`a ${tag(ID, "🔥")} b`);
  });
  it("élément marqué comme puce : son contenu (animation, vidéo, dessin) n'est jamais relu", () => {
    const html = `a <span class="lap-ce" contenteditable="false" data-ce-id="${ID}" data-ce-fallback="🔥" data-ce-ready=""><span class="lap-ce-alt">🔥</span><span class="lap-ce-media" aria-hidden="true"><canvas width="40" height="40"></canvas><video src="/api/custom-emoji/1"></video><img src="/x.webp" alt=""></span></span> b`;
    expect(htmlToTelegram(html, "editor")).toBe(`a ${tag(ID, "🔥")} b`);
  });
  it("puce sans emoji de remplacement en attribut : son texte", () => {
    const html = `<span class="lap-ce" data-ce-id="${ID}"><span class="lap-ce-alt">🎯</span></span>`;
    expect(htmlToTelegram(html, "editor")).toBe(tag(ID, "🎯"));
  });
  it("mise en forme posée sur la puce par le navigateur (gras, italique, texte masqué)", () => {
    expect(htmlToTelegram(`<b>Bonus ${chip(ID, "🔥")}</b>`, "editor")).toBe(
      `<b>Bonus ${tag(ID, "🔥")}</b>`,
    );
    expect(htmlToTelegram(`<sub>${chip(ID, "🔥")}</sub>`, "editor")).toBe(
      `<tg-spoiler>${tag(ID, "🔥")}</tg-spoiler>`,
    );
  });
  it("saut de ligne après une puce en fin de texte : gardé, sans ligne fantôme", () => {
    expect(htmlToTelegram(`${chip(ID, "🔥")}<br>suite`, "editor")).toBe(`${tag(ID, "🔥")}\nsuite`);
    expect(htmlToTelegram(`${chip(ID, "🔥")}<br>`, "editor")).toBe(tag(ID, "🔥"));
  });
});

describe("emoji animé : copier-coller", () => {
  it("copié depuis l'éditeur (puces dans le HTML du presse-papiers)", () => {
    const pasted = `<meta charset="utf-8"><span style="color: rgb(0,0,0);">Promo </span>${chip(ID, "🔥")}<span> ok</span>`;
    expect(htmlToTelegram(pasted, "paste")).toBe(`Promo ${tag(ID, "🔥")} ok`);
  });
  it("HTML Telegram collé en texte brut : repris comme emoji animé", () => {
    expect(plainPasteToTelegram(`Salut ${tag(ID, "👋")}`)).toBe(`Salut ${tag(ID, "👋")}`);
  });
  it("emoji animé copié depuis Telegram Web (image avec l'identifiant du document)", () => {
    const pasted = `Top <img class="custom-emoji emoji" alt="🔥" data-document-id="${ID}" src="blob:x"> fin`;
    expect(htmlToTelegram(pasted, "paste")).toBe(`Top ${tag(ID, "🔥")} fin`);
    const div = `<div class="CustomEmoji" data-entity-type="MessageEntityCustomEmoji" data-document-id="${ID2}"><img alt="⚽"></div>`;
    expect(htmlToTelegram(div, "paste")).toBe(tag(ID2, "⚽"));
  });
  it("une image ordinaire avec un emoji en texte alternatif reste un emoji normal", () => {
    expect(htmlToTelegram(`<img alt="🔥" src="x.png">`, "paste")).toBe("🔥");
  });
});

describe("emoji animé : longueur du texte", () => {
  it("compte comme son emoji de remplacement", () => {
    const tg = `Salut ${tag(ID, "👍")}`;
    expect(textLength(tg)).toBe("Salut 👍".length);
    expect(visibleText(tg)).toBe("Salut 👍");
    expect(visibleText(telegramToEditorHtml(tg))).toBe("Salut 👍");
  });
});

describe("aperçu Telegram : balises remplacées par des puces, le reste intact", () => {
  it("seules les balises d'emoji animé changent", () => {
    expect(
      telegramHtmlWithChips(`<b>Top</b> ${tag(ID, "🔥")} &amp; <tg-spoiler>x</tg-spoiler>`),
    ).toBe(`<b>Top</b> ${chip(ID, "🔥")} &amp; <tg-spoiler>x</tg-spoiler>`);
    expect(telegramHtmlWithChips(`<tg-emoji emoji-id="1">&lt;3</tg-emoji>`)).toBe(chip("1", "<3"));
    expect(telegramHtmlWithChips("sans emoji")).toBe("sans emoji");
  });
});
