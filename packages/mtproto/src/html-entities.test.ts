import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  entitiesToTelegramHtml,
  parseTelegramHtml,
  telegramTextLength,
  type TextEntitySpec,
} from "./html-entities";

const ID = "5368324170671202286";
const ID2 = "5370869711888194012";

describe("parseTelegramHtml : HTML Telegram → texte + entités (positions UTF-16)", () => {
  it("texte sans balise : aucune entité, entités HTML décodées", () => {
    expect(parseTelegramHtml("Gagnez &lt;vite&gt; &amp; bien &quot;ok&quot; &#39;x&#39;")).toEqual({
      text: `Gagnez <vite> & bien "ok" 'x'`,
      entities: [],
    });
  });

  it("emoji animé : l'entité couvre exactement son emoji de remplacement", () => {
    const r = parseTelegramHtml(`Bonus <tg-emoji emoji-id="${ID}">🎁</tg-emoji> du jour`);
    expect(r.text).toBe("Bonus 🎁 du jour");
    // 🎁 est hors du plan de base : 2 unités UTF-16.
    expect(r.entities).toEqual([{ type: "custom_emoji", offset: 6, length: 2, customEmojiId: ID }]);
    expect(r.text.slice(6, 8)).toBe("🎁");
  });

  it("positions après des emojis hors du plan de base, accents et emoji composé", () => {
    const html = `😀😀 été <b>gras</b> 👨‍👩‍👧 <tg-emoji emoji-id="${ID}">❤️</tg-emoji><tg-emoji emoji-id="${ID2}">🔥</tg-emoji>`;
    const r = parseTelegramHtml(html);
    expect(r.text).toBe("😀😀 été gras 👨‍👩‍👧 ❤️🔥");
    const bold = r.entities.find((e) => e.type === "bold")!;
    expect(r.text.slice(bold.offset, bold.offset + bold.length)).toBe("gras");
    expect(bold.offset).toBe(9); // 2 × 2 unités + espace + « été » + espace
    const emojis = r.entities.filter((e) => e.type === "custom_emoji");
    expect(emojis.map((e) => r.text.slice(e.offset, e.offset + e.length))).toEqual(["❤️", "🔥"]);
    expect(emojis.map((e) => e.length)).toEqual([2, 2]); // ❤ + sélecteur de variante ; 🔥 (2 unités)
    expect(emojis.map((e) => e.customEmojiId)).toEqual([ID, ID2]);
  });

  it("mises en forme imbriquées autour d'un emoji animé, triées englobante d'abord", () => {
    const r = parseTelegramHtml(`<b>Top <i>bonus <tg-emoji emoji-id="${ID}">🎁</tg-emoji></i></b>`);
    expect(r.text).toBe("Top bonus 🎁");
    expect(r.entities).toEqual([
      { type: "bold", offset: 0, length: 12 },
      { type: "italic", offset: 4, length: 8 },
      { type: "custom_emoji", offset: 10, length: 2, customEmojiId: ID },
    ]);
  });

  it("toutes les balises acceptées par Telegram", () => {
    const html =
      "<strong>a</strong><em>b</em><ins>c</ins><del>d</del><strike>e</strike><tg-spoiler>f</tg-spoiler>" +
      '<span class="tg-spoiler">g</span><code>h</code><pre><code class="language-js">i</code></pre>' +
      '<pre language="py">j</pre><a href="https://go.goolink.eu/abc">k</a><blockquote>l</blockquote>' +
      "<blockquote expandable>m</blockquote><u>n</u><s>o</s>";
    const r = parseTelegramHtml(html);
    expect(r.text).toBe("abcdefghijklmno");
    expect(r.entities.map((e) => [e.type, r.text.slice(e.offset, e.offset + e.length)])).toEqual([
      ["bold", "a"],
      ["italic", "b"],
      ["underline", "c"],
      ["strikethrough", "d"],
      ["strikethrough", "e"],
      ["spoiler", "f"],
      ["spoiler", "g"],
      ["code", "h"],
      ["pre", "i"],
      ["pre", "j"],
      ["text_link", "k"],
      ["blockquote", "l"],
      ["blockquote", "m"],
      ["underline", "n"],
      ["strikethrough", "o"],
    ]);
    const byText = (t: string) =>
      r.entities.find((e) => r.text.slice(e.offset, e.offset + e.length) === t)!;
    expect(byText("i").language).toBe("js");
    expect(byText("j").language).toBe("py");
    expect(byText("k").url).toBe("https://go.goolink.eu/abc");
    expect(byText("l").collapsed).toBeUndefined();
    expect(byText("m").collapsed).toBe(true);
  });

  it("retours à la ligne gardés, <br> → retour à la ligne, espaces des bords retirés avec les positions recalées", () => {
    const r = parseTelegramHtml(`\n\n  <b>Titre</b>\nLigne<br>suite  \n`);
    expect(r.text).toBe("Titre\nLigne\nsuite");
    expect(r.entities).toEqual([{ type: "bold", offset: 0, length: 5 }]);
  });

  it("span ordinaire, lien non sûr, mention par identifiant, balise inconnue : texte gardé, sans mise en forme", () => {
    const r = parseTelegramHtml(
      '<span>a</span><a href="javascript:alert(1)">b</a><a href="tg://user?id=1">c</a><x-y>d</x-y>',
    );
    expect(r).toEqual({ text: "abcd", entities: [] });
  });

  it("emoji animé vide : remplacé par ⭐ ; identifiant invalide : texte simple", () => {
    expect(parseTelegramHtml(`<tg-emoji emoji-id="${ID}"></tg-emoji>`)).toEqual({
      text: "⭐",
      entities: [{ type: "custom_emoji", offset: 0, length: 1, customEmojiId: ID }],
    });
    expect(parseTelegramHtml('<tg-emoji emoji-id="abc">😀</tg-emoji>')).toEqual({
      text: "😀",
      entities: [],
    });
    expect(parseTelegramHtml("<tg-emoji emoji-id='0'>😀</tg-emoji>").entities).toEqual([]);
  });

  it("attribut entre apostrophes et balises en majuscules", () => {
    const r = parseTelegramHtml(`<B>x</B><TG-EMOJI EMOJI-ID='${ID}'>👍</TG-EMOJI>`);
    expect(r.entities).toEqual([
      { type: "bold", offset: 0, length: 1 },
      { type: "custom_emoji", offset: 1, length: 2, customEmojiId: ID },
    ]);
  });

  it("entités numériques hors du plan de base : 2 unités UTF-16", () => {
    expect(decodeHtmlEntities("&#128512;&#x1F600;&#0;")).toBe("😀😀&#0;");
    const r = parseTelegramHtml("&#128512;<b>x</b>");
    expect(r.entities).toEqual([{ type: "bold", offset: 2, length: 1 }]);
  });

  it("longueur comptée comme Telegram (un emoji animé = son emoji de remplacement)", () => {
    expect(telegramTextLength(`<b>ab</b> <tg-emoji emoji-id="${ID}">🎁</tg-emoji>`)).toBe(5);
  });
});

describe("entitiesToTelegramHtml : aller-retour sans perte", () => {
  const samples = [
    `Bonus <tg-emoji emoji-id="${ID}">🎁</tg-emoji> du jour`,
    `<b>Top <i>bonus <tg-emoji emoji-id="${ID}">🎁</tg-emoji></i></b> et <a href="https://go.goolink.eu/x?a=1&amp;b=2">lien</a>`,
    `😀😀 <u>été</u>\n<blockquote expandable>cité <tg-emoji emoji-id="${ID2}">❤️</tg-emoji></blockquote>`,
    `<pre language="js">const a = 1 &lt; 2;</pre><code>x</code><tg-spoiler>caché</tg-spoiler><s>barré</s>`,
    "Texte simple avec &amp; et &lt;chevrons&gt;",
  ];
  for (const html of samples)
    it(`aller-retour : ${html.slice(0, 40)}…`, () => {
      const first = parseTelegramHtml(html);
      const back = entitiesToTelegramHtml(first.text, first.entities);
      expect(parseTelegramHtml(back)).toEqual(first);
    });

  it("produit les balises Telegram attendues", () => {
    const entities: TextEntitySpec[] = [
      { type: "bold", offset: 0, length: 8 },
      { type: "custom_emoji", offset: 6, length: 2, customEmojiId: ID },
    ];
    expect(entitiesToTelegramHtml("Bonus 🎁", entities)).toBe(
      `<b>Bonus <tg-emoji emoji-id="${ID}">🎁</tg-emoji></b>`,
    );
  });

  it("entités qui se chevauchent : coupées pour rester bien imbriquées", () => {
    const html = entitiesToTelegramHtml("abcdef", [
      { type: "bold", offset: 0, length: 4 },
      { type: "italic", offset: 2, length: 4 },
    ]);
    expect(html).toBe("<b>ab<i>cd</i></b><i>ef</i>");
    const r = parseTelegramHtml(html);
    expect(r.text).toBe("abcdef");
  });
});
