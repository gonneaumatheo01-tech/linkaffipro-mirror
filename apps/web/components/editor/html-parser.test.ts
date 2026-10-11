import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, parseHtml, type HtmlNode } from "./html-parser";

/** Forme compacte d'un arbre pour comparer facilement. */
function shape(nodes: HtmlNode[]): unknown[] {
  return nodes.map((n) =>
    n.type === "text"
      ? n.text
      : {
          [n.tag]: shape(n.children),
          ...(Object.keys(n.attrs).length ? { attrs: n.attrs } : {}),
        },
  );
}

describe("decodeHtmlEntities", () => {
  it("décode les entités nommées courantes et numériques", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &nbsp;")).toBe(
      "a & b <c> \"d\" 'e'  ",
    );
    expect(decodeHtmlEntities("&eacute;t&eacute; &hellip; &#128293;")).toBe("été … 🔥");
  });
  it("laisse une entité inconnue ou incomplète telle quelle", () => {
    expect(decodeHtmlEntities("&inconnu; &amp")).toBe("&inconnu; &amp");
    expect(decodeHtmlEntities("R&D")).toBe("R&D");
  });
  it("remplace les codes invalides", () => {
    expect(decodeHtmlEntities("&#0;&#xD800;&#x110000;")).toBe("���");
  });
});

describe("parseHtml", () => {
  it("lit balises, attributs (guillemets doubles, simples, sans guillemets, booléens) et texte", () => {
    expect(shape(parseHtml(`a<b class="x" data-k='y' id=z hidden>b</b>c`))).toEqual([
      "a",
      { b: ["b"], attrs: { class: "x", "data-k": "y", id: "z", hidden: "" } },
      "c",
    ]);
  });
  it("décode les entités du texte et des attributs", () => {
    expect(shape(parseHtml('<a href="https://x.y/?a=1&amp;b=2">x &amp; y</a>'))).toEqual([
      { a: ["x & y"], attrs: { href: "https://x.y/?a=1&b=2" } },
    ]);
  });
  it("éléments vides, <br/> et </br>", () => {
    expect(shape(parseHtml("a<br>b<br/>c</br>d<img src=x alt='🔥'>"))).toEqual([
      "a",
      { br: [] },
      "b",
      { br: [] },
      "c",
      { br: [] },
      "d",
      { img: [], attrs: { src: "x", alt: "🔥" } },
    ]);
  });
  it("ignore commentaires, doctype et instructions", () => {
    expect(
      shape(
        parseHtml("<!DOCTYPE html><?xml x?><!--StartFragment-->a<!-- b -->c<!--EndFragment-->"),
      ),
    ).toEqual(["ac"]);
  });
  it("referme les balises non fermées et ignore les fermetures orphelines", () => {
    expect(shape(parseHtml("<b>a<i>b</b>c</u>"))).toEqual([{ b: ["a", { i: ["b"] }] }, "c"]);
  });
  it("garde un « < » isolé comme texte", () => {
    expect(shape(parseHtml("a < b et 3<4 <"))).toEqual(["a < b et 3<4 <"]);
    expect(shape(parseHtml('x <b class="non fermée'))).toEqual(['x <b class="non fermée']);
  });
  it("lit le contenu de <style> et <script> sans l'interpréter", () => {
    expect(shape(parseHtml("<style>b{x:1}</style><script>if(a<b)alert(1)</script>t"))).toEqual([
      { style: ["b{x:1}"] },
      { script: ["if(a<b)alert(1)"] },
      "t",
    ]);
  });
  it("normalise les fins de ligne et met les noms en minuscules", () => {
    expect(shape(parseHtml("<B>a\r\nb</B>"))).toEqual([{ b: ["a\nb"] }]);
  });
  it("tg-spoiler et attributs sans valeur", () => {
    expect(
      shape(parseHtml("<tg-spoiler>s</tg-spoiler><blockquote expandable>q</blockquote>")),
    ).toEqual([{ "tg-spoiler": ["s"] }, { blockquote: ["q"], attrs: { expandable: "" } }]);
  });
});
