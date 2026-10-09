import { describe, expect, it } from "vitest";
import { escapeHtml, fillPlaceholders, stripHtml, textLength, validateTelegramHtml } from "./telegram-html";

describe("HTML Telegram", () => {
  it("accepte les balises autorisées et normalise", () => {
    const r = validateTelegramHtml('<B>Gras</B> <i>ital</i> <a href="https://x.y">lien</a> <span class="tg-spoiler">s</span> <tg-spoiler>t</tg-spoiler> <pre language="js">x</pre>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain("<b>Gras</b>");
  });
  it("refuse une balise inconnue", () => {
    const r = validateTelegramHtml("<div>x</div>");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/div/);
  });
  it("refuse une balise non fermée et un mauvais imbriquement", () => {
    expect(validateTelegramHtml("<b>x")).toMatchObject({ ok: false });
    expect(validateTelegramHtml("<b><i>x</b></i>")).toMatchObject({ ok: false });
    expect(validateTelegramHtml("x</b>")).toMatchObject({ ok: false });
  });
  it("refuse les attributs interdits et les liens non https", () => {
    expect(validateTelegramHtml('<b onclick="x">y</b>')).toMatchObject({ ok: false });
    expect(validateTelegramHtml('<a href="javascript:alert(1)">y</a>')).toMatchObject({ ok: false });
    expect(validateTelegramHtml('<span class="x">y</span>')).toMatchObject({ ok: false });
  });
  it("mesure la longueur hors balises et applique la limite", () => {
    expect(textLength("<b>ab</b>c&amp;")).toBe(4);
    const r = validateTelegramHtml(`<b>${"x".repeat(5000)}</b>`);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/trop long/);
    expect(validateTelegramHtml("x".repeat(1025), { max: 1024 })).toMatchObject({ ok: false });
  });
  it("exige l'échappement de <", () => {
    expect(validateTelegramHtml("a < b")).toMatchObject({ ok: false });
    expect(validateTelegramHtml("a &lt; b")).toMatchObject({ ok: true });
  });
  it("échappe, retire et remplit", () => {
    expect(escapeHtml("<a&b>")).toBe("&lt;a&amp;b&gt;");
    expect(stripHtml("<b>a</b>&amp;")).toBe("a&");
    expect(fillPlaceholders("Salut {prenom} ! {inconnu}", { prenom: "<Jo>" })).toBe("Salut &lt;Jo&gt; ! {inconnu}");
  });
});
