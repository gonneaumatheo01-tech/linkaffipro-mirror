import { describe, expect, it } from "vitest";
import { textLength } from "@linkaffipro/core";
import {
  CAPTION_MAX,
  TEXT_MAX,
  ariaShortcut,
  counterState,
  findPlaceholders,
  isBlockedInput,
  normalizeLinkUrl,
  shortcutCommand,
  shortcutLabel,
  toolbarIndex,
  unresolvedDisplay,
  unresolvedMessage,
  unresolvedPlaceholders,
} from "./editor-logic";

const nbsp = (s: string) => s.replace(/ | /g, " ");

describe("compteur de caractères", () => {
  it("sans média : limite 4 096", () => {
    const c = counterState(120, false);
    expect(nbsp(c.label)).toBe("120 / 4 096");
    expect(nbsp(c.srLabel)).toBe("120 caractères sur 4 096");
    expect(c).toMatchObject({ tone: "muted", message: null, over: false });
  });
  it("avec un média : limite 1 024 affichée", () => {
    expect(nbsp(counterState(10, true).label)).toBe("10 / 1 024");
    expect(nbsp(counterState(1, true).srLabel)).toBe("1 caractère sur 1 024");
  });
  it("prévient à 90 % de la limite", () => {
    expect(counterState(Math.ceil(TEXT_MAX * 0.9) + 1, false).tone).toBe("warning");
    expect(counterState(Math.ceil(CAPTION_MAX * 0.9) + 1, true).tone).toBe("warning");
  });
  it("avec un média au-delà de 1 024 : avertissement (le texte partira à part), pas d'erreur", () => {
    const c = counterState(1500, true);
    expect(c).toMatchObject({ tone: "warning", over: false });
    expect(nbsp(c.label)).toBe("1 500 / 4 096");
    expect(c.message).toMatch(/média part seul/);
  });
  it("au-delà de 4 096 : erreur avec le nombre de caractères en trop", () => {
    const c = counterState(4100, false);
    expect(c).toMatchObject({ tone: "danger", over: true });
    expect(nbsp(c.message!)).toBe(
      "Texte trop long de 4 caractères : Telegram en accepte 4 096 au plus.",
    );
    expect(counterState(4097, true).message).toMatch(/de 1 caractère :/);
  });
  it("compte comme Telegram (balises ignorées, entités décodées)", () => {
    expect(textLength('<b>Bonjour</b> &amp; à <a href="https://x.fr">vous</a>')).toBe(16);
  });
});

describe("repères", () => {
  it("trouve les repères remplacés et les repères connus non remplacés", () => {
    expect(
      findPlaceholders("Salut {prenom} : {offre} {inconnu} {canal}", ["prenom", "canal"]),
    ).toEqual([
      { start: 6, end: 14, key: "prenom", replaced: true },
      { start: 17, end: 24, key: "offre", replaced: false },
      { start: 35, end: 42, key: "canal", replaced: true },
    ]);
  });
  it("un repère propre au formulaire est reconnu", () => {
    expect(findPlaceholders("{canal_propose}", ["canal_propose"])[0]).toMatchObject({
      replaced: true,
    });
  });
  it("liste et phrase des repères non remplacés", () => {
    expect(unresolvedPlaceholders("{offre} {prenom} {offre}", [])).toEqual(["offre", "prenom"]);
    expect(unresolvedMessage([])).toBeNull();
    expect(unresolvedMessage(["offre"])).toBe(
      "{offre} ne sera pas remplacé ici : il partira tel quel. Écrivez le vrai mot à la place.",
    );
    expect(unresolvedMessage(["offre", "prenom"])).toMatch(/^\{offre\}, \{prenom\} ne seront pas/);
  });
});

describe("repères non remplacés : surlignage et phrase", () => {
  it("par défaut : surlignage jaune et phrase sous le champ", () => {
    expect(unresolvedDisplay(true)).toEqual({ highlight: true, message: true });
  });

  it("« highlight » : surlignage seul, le formulaire affiche sa propre alerte", () => {
    expect(unresolvedDisplay("highlight")).toEqual({ highlight: true, message: false });
  });

  it("false : aucun avertissement", () => {
    expect(unresolvedDisplay(false)).toEqual({ highlight: false, message: false });
  });
});

describe("adresse d'un lien", () => {
  it("accepte http(s) tel quel", () => {
    expect(normalizeLinkUrl(" https://go.goolink.eu/abc?x=1 ")).toEqual({
      ok: true,
      url: "https://go.goolink.eu/abc?x=1",
    });
    expect(normalizeLinkUrl("http://x.fr")).toEqual({ ok: true, url: "http://x.fr" });
  });
  it("ajoute https:// à une adresse sans protocole", () => {
    expect(normalizeLinkUrl("t.me/moncanal")).toEqual({ ok: true, url: "https://t.me/moncanal" });
    expect(normalizeLinkUrl("www.exemple.com")).toEqual({
      ok: true,
      url: "https://www.exemple.com",
    });
    expect(normalizeLinkUrl("exemple.com:8080/a")).toEqual({
      ok: true,
      url: "https://exemple.com:8080/a",
    });
    expect(normalizeLinkUrl("//x.fr")).toEqual({ ok: true, url: "https://x.fr" });
  });
  it("refuse les autres protocoles, les espaces et les adresses incomplètes", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(normalizeLinkUrl("mailto:a@b.fr")).toMatchObject({ ok: false });
    expect(normalizeLinkUrl("tg://resolve?domain=x")).toMatchObject({ ok: false });
    expect(normalizeLinkUrl("https://x.fr/a b")).toMatchObject({ ok: false });
    expect(normalizeLinkUrl("bonjour")).toMatchObject({ ok: false });
    expect(normalizeLinkUrl("  ")).toEqual({ ok: false, error: "Indiquez l'adresse du lien." });
  });
});

describe("raccourcis clavier", () => {
  const k = (key: string, o: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>> = {}) => ({
    key,
    metaKey: Boolean(o.meta),
    ctrlKey: Boolean(o.ctrl),
    shiftKey: Boolean(o.shift),
    altKey: Boolean(o.alt),
  });
  it("Mac : ⌘B ⌘I ⌘U ⌘K ⌘⇧X", () => {
    expect(shortcutCommand(k("b", { meta: true }), true)).toBe("bold");
    expect(shortcutCommand(k("I", { meta: true }), true)).toBe("italic");
    expect(shortcutCommand(k("u", { meta: true }), true)).toBe("underline");
    expect(shortcutCommand(k("k", { meta: true }), true)).toBe("link");
    expect(shortcutCommand(k("X", { meta: true, shift: true }), true)).toBe("strike");
  });
  it("Windows / Linux : Ctrl", () => {
    expect(shortcutCommand(k("b", { ctrl: true }), false)).toBe("bold");
    expect(shortcutCommand(k("b", { meta: true }), false)).toBeNull();
  });
  it("ignore les autres combinaisons (Ctrl+B sur Mac recule le curseur, Alt, Maj+B…)", () => {
    expect(shortcutCommand(k("b", { ctrl: true }), true)).toBeNull();
    expect(shortcutCommand(k("b", { meta: true, alt: true }), true)).toBeNull();
    expect(shortcutCommand(k("b", { meta: true, shift: true }), true)).toBeNull();
    expect(shortcutCommand(k("b"), true)).toBeNull();
  });
  it("libellés et aria-keyshortcuts", () => {
    expect(shortcutLabel("bold", true)).toBe("⌘B");
    expect(shortcutLabel("strike", true)).toBe("⌘⇧X");
    expect(shortcutLabel("bold", false)).toBe("Ctrl+B");
    expect(shortcutLabel("strike", false)).toBe("Ctrl+Maj+X");
    expect(shortcutLabel("spoiler", true)).toBeNull();
    expect(ariaShortcut("bold")).toBe("Control+B Meta+B");
    expect(ariaShortcut("strike")).toBe("Control+Shift+X Meta+Shift+X");
    expect(ariaShortcut("spoiler")).toBeUndefined();
  });
});

describe("barre d'outils au clavier", () => {
  it("flèches en boucle, Début, Fin", () => {
    expect(toolbarIndex(0, "ArrowRight", 4)).toBe(1);
    expect(toolbarIndex(3, "ArrowRight", 4)).toBe(0);
    expect(toolbarIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(toolbarIndex(2, "Home", 4)).toBe(0);
    expect(toolbarIndex(0, "End", 4)).toBe(3);
  });
  it("autres touches et barre vide : rien", () => {
    expect(toolbarIndex(0, "Enter", 4)).toBeNull();
    expect(toolbarIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("saisies bloquées", () => {
  it("bloque couleurs, listes, alignements ; garde gras, italique, souligné, barré", () => {
    expect(isBlockedInput("formatFontColor")).toBe(true);
    expect(isBlockedInput("formatJustifyCenter")).toBe(true);
    expect(isBlockedInput("insertUnorderedList")).toBe(true);
    expect(isBlockedInput("formatBold")).toBe(false);
    expect(isBlockedInput("formatStrikeThrough")).toBe(false);
    // Texte masqué (Safari annonce la commande de la barre d'outils) ; l'exposant reste bloqué.
    expect(isBlockedInput("formatSubscript")).toBe(false);
    expect(isBlockedInput("formatSuperscript")).toBe(true);
    expect(isBlockedInput("insertText")).toBe(false);
  });
});
