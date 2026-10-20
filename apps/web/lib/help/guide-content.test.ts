/**
 * Contrôles du guide d'utilisation (docs/GUIDE-UTILISATEUR.md), rendu dans la page /help et le volet « ? » :
 * plan (les premiers pas, puis une section par entrée du menu, dans l'ordre du menu), titres uniques (les ancres de
 * la page /help valent `slugify(titre)`), liens internes valides, vocabulaire du client et vouvoiement.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/admin/nav-logic";
import { jargonIn } from "../../tests/vocabulary/jargon-scan";
import { slugify } from "./markdown";
import { guideHeadings, guideSections } from "./sections";

const GUIDE = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "GUIDE-UTILISATEUR.md"),
  "utf8",
);
const headings = guideHeadings(GUIDE);
const h2 = headings.filter((h) => h.level === 2).map((h) => h.text);

/**
 * Sections où le terme technique est attendu : le lexique (mot affiché ↔ terme technique), la table des anciennes
 * pages (leurs anciens noms) et Réglages → Avancé (le partenaire parle de « postback » et de « sub_id »).
 */
const JARGON_ALLOWED = [
  "Petit lexique",
  "Où sont passées les anciennes pages ?",
  "Réglages → Avancé : retours du casino (postbacks)",
];

/** Le guide sans les sections où le terme technique est permis (une section va jusqu'au titre suivant de même niveau). */
function guideWithoutAllowed(): string {
  let text = GUIDE;
  for (const s of guideSections(GUIDE, JARGON_ALLOWED)) text = text.replace(s.markdown, "");
  // Le titre de Réglages → Avancé est cité ailleurs (liens) : seul le mot du client compte.
  return text.replace(/\(postbacks\)/g, "");
}

describe("guide d'utilisation : plan", () => {
  it("commence par les premiers pas et « Que faire si… »", () => {
    expect(h2.slice(0, 3)).toEqual([
      "Table des matières",
      "Les 10 premières minutes",
      "Que faire si…",
    ]);
    const firstSteps = guideSections(GUIDE, ["Les 10 premières minutes"])[0]!.markdown;
    for (const step of [
      "Se connecter",
      "Suivre la visite guidée",
      "Relier votre Telegram",
      "Ajouter un canal existant",
      "Créer une campagne",
      "Programmer un message",
    ])
      expect(firstSteps).toContain(step);
  });

  it("une section par entrée du menu, dans l'ordre du menu, puis l'aide, le compte, les anciennes pages et le lexique", () => {
    const menu = NAV.filter((i) => !i.mobileOnly).map((i) => i.label);
    expect(menu).toEqual([
      "Accueil",
      "Campagnes",
      "Pages",
      "Canaux",
      "Messages",
      "Membres",
      "Conversations",
      "Statistiques",
      "Réglages",
      "Comptes Telegram",
    ]);
    const positions = menu.map((label) => h2.indexOf(label));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const after = [
      "Aide « ? » et visite guidée",
      "Mon compte",
      "Où sont passées les anciennes pages ?",
      "Petit lexique",
    ].map((t) => h2.indexOf(t));
    expect(after.every((p) => p > positions.at(-1)!)).toBe(true);
    expect([...after].sort((a, b) => a - b)).toEqual(after);
    expect(h2.at(-1)).toBe("Petit lexique");
  });

  it("Pages (phase 15) : créer une page, copier le lien, lire le tableau, vitesse, ce qui est compté", () => {
    const pages = guideSections(GUIDE, ["Pages"])[0]!.markdown;
    for (const t of [
      "### Créer une page",
      "### Copier le lien d'une source",
      "### Lire le tableau d'une page",
      "### Vitesse de la page",
      "### Ce qui est compté",
      "**Copier le lien**",
      "**Créer la page**",
      "% visite → join",
      "Coût par join",
    ])
      expect(pages).toContain(t);
  });

  it("Pages : ce que le guide promet est ce que fait le site (règles d'entrée, source retirée, coût par join)", () => {
    const pages = guideSections(GUIDE, ["Pages"])[0]!.markdown;
    // Les exceptions « pub » ne visent jamais une personne venue d'une page (provenance LANDING).
    expect(pages).not.toMatch(/s'appliquent comme pour une pub/);
    expect(pages).toMatch(/exceptions « pub » ne visent pas les pages/);
    expect(pages).toContain("n'importe quelle page d'atterrissage");
    // Source retirée : l'adresse de la pub ouvre la page avec le lien principal (jamais « inutilisable »).
    expect(pages).not.toMatch(/inutilisable \(dans la pub/);
    expect(pages).toMatch(/ouvre alors la page avec le lien principal/);
    expect(pages).toContain("**Relier à une pub**");
    expect(pages).toMatch(/source inconnue ou retirée/);
    expect(pages).toMatch(/rien n'est compté deux fois/);
  });

  it("Membres réunit la liste, Écrire à un groupe et les Relances automatiques", () => {
    const members = guideSections(GUIDE, ["Membres"])[0]!.markdown;
    for (const t of [
      "### Liste des membres",
      "### Écrire à un groupe",
      "### Relances automatiques",
    ])
      expect(members).toContain(t);
  });

  it("Conversations (phase 17) : boîte de réception, personas et chiffres, dans l'ordre des onglets", () => {
    const start = headings.findIndex((h) => h.level === 2 && h.text === "Conversations");
    const end = headings.findIndex((h, i) => i > start && h.level === 2);
    const sub = headings
      .slice(start + 1, end)
      .filter((h) => h.level === 3)
      .map((h) => h.text);
    expect(sub).toEqual(["Boîte de réception", "Personas", "Chiffres"]);
    const conversations = guideSections(GUIDE, ["Conversations"])[0]!.markdown;
    // Règles du client : jamais de prise de contact à froid, 2 relances au plus, /stop définitif, adultes seulement.
    for (const t of [
      "**Prendre la main**",
      "**Rendre à l'assistant**",
      "**Tester**",
      "au plus deux fois",
      "`/stop`",
      "moins de 18 ans",
      "Désactivé",
    ])
      expect(conversations).toContain(t);
  });

  it("« Où sont passées les anciennes pages ? » cite chaque rubrique déplacée", () => {
    const moved = guideSections(GUIDE, ["Où sont passées les anciennes pages ?"])[0]!.markdown;
    for (const old of [
      "Tableau de bord",
      "Pubs",
      "Liens",
      "Envois",
      "Automatisations",
      "Bots",
      "Journal",
      "Meilleurs horaires",
    ])
      expect(moved).toContain(old);
  });
});

describe("guide d'utilisation : ancres et liens", () => {
  it("titres uniques : l'ancre de chaque titre est son `slugify` (lien « Ouvrir le guide complet »)", () => {
    const dup = headings.filter((h) => h.id !== slugify(h.text)).map((h) => h.text);
    expect(dup).toEqual([]);
  });

  it("chaque lien interne (#ancre) mène à un titre du guide", () => {
    const ids = new Set(headings.map((h) => h.id));
    const links = [...GUIDE.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(10);
    expect(links.filter((a) => !ids.has(a))).toEqual([]);
  });

  it("la table des matières renvoie aux sections de niveau 2", () => {
    const toc = guideSections(GUIDE, ["Table des matières"])[0]!.markdown;
    const anchors = [...toc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    for (const t of h2.filter((t) => t !== "Table des matières"))
      expect(anchors, t).toContain(slugify(t));
  });
});

describe("guide d'utilisation : vocabulaire du client", () => {
  it("aucun terme technique hors du lexique, des anciennes pages et de Réglages → Avancé", () => {
    const offenders = guideWithoutAllowed()
      .split("\n")
      .map((line, i) => ({ line, i, words: jargonIn(line) }))
      .filter((l) => l.words.length > 0)
      .map((l) => `[${l.words.join(", ")}] ${l.line.slice(0, 90)}`);
    expect(offenders).toEqual([]);
  });

  it("le lexique donne le terme technique de chaque mot du client", () => {
    const lexicon = guideSections(GUIDE, ["Petit lexique"])[0]!.markdown;
    for (const term of [
      "FTD",
      "NGR",
      "sub-ID",
      "ROAS",
      "CPL",
      "CPA",
      "cohorte",
      "entonnoir",
      "segment",
      "webhook",
      "postback",
    ])
      expect(lexicon).toContain(term);
  });

  it("vouvoiement : jamais de tutoiement", () => {
    // « Ton » est aussi le réglage de l'assistant IA (le ton du message) : retiré avant le contrôle.
    const text = GUIDE.replace(/\*\*Ton\*\*/g, "");
    const tu = /(?<![\p{L}\p{N}_'’-])(tu|toi|ton|ta|tes)(?![\p{L}\p{N}_'’-])/giu;
    expect(text.match(tu) ?? []).toEqual([]);
  });

  it("univers : Casino, Paris sportifs, Rencontres", () => {
    expect(GUIDE).toContain("Casino, Paris sportifs, Rencontres");
    expect(guideWithoutAllowed()).not.toMatch(/\bdating\b/i);
  });
});
