import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { withBuiltinSections } from "./builtin-sections";
import {
  DEFAULT_HELP,
  PAGE_HELP,
  guideHref,
  matchesPath,
  normalizePath,
  pageHelpFor,
} from "./page-help";
import { findHeading, guideHeadings, guideSections } from "./sections";

const GUIDE = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "GUIDE-UTILISATEUR.md"),
  "utf8",
);

/** Adresses de toutes les pages de l'espace connecté (`app/(admin)/**\/page.tsx`), segments dynamiques remplis. */
function adminPages(): string[] {
  const root = join(__dirname, "..", "..", "app", "(admin)");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") {
        const rel = relative(root, dir).split(sep).filter(Boolean);
        // Dossiers privés (« _views ») : pas des pages. Segments dynamiques ([id], [groupId]) : une valeur d'exemple.
        if (rel.some((s) => s.startsWith("_"))) continue;
        out.push(
          `/${rel.map((s) => (s.startsWith("[") ? "x1" : s)).join("/")}`.replace(/\/$/, "") || "/",
        );
      }
    }
  };
  walk(root);
  return out.sort();
}

describe("aide de la page courante : table adresse → sections du guide", () => {
  it("l'entrée la plus précise gagne, sous-pages comprises", () => {
    expect(pageHelpFor("/campaigns").help.path).toBe("/campaigns");
    expect(pageHelpFor("/campaigns/abc123?tab=ads").help.path).toBe("/campaigns/:id");
    expect(pageHelpFor("/campaigns/links").help.label).toBe("Tous les liens");
    expect(pageHelpFor("/campaigns/affiliates").help.label).toBe("Affiliés Link Affi");
    expect(pageHelpFor("/campaigns/affiliates/export").help.sections).toEqual([
      "Affiliés sur vos canaux",
    ]);
    expect(pageHelpFor("/campaigns/new").help.label).toBe("Nouvelle campagne");
    // Phase 27 : canaux d'inspiration (la fiche d'une référence n'est pas une fiche d'équipe).
    expect(pageHelpFor("/agents/inspiration").help.label).toBe("Inspiration");
    expect(pageHelpFor("/agents/inspiration/r1").help.label).toBe("Canal d'inspiration");
    expect(pageHelpFor("/agents/inspiration/r1").help.sections[0]).toBe("S'inspirer d'un canal");
    // Phase 28 : équipe Montage (la fiche d'un montage n'est pas une fiche d'équipe).
    expect(pageHelpFor("/agents/montage").help.label).toBe("Montage");
    expect(pageHelpFor("/agents/montage?vue=mediatheque").help.sections).toContain("Où retrouver les shorts");
    expect(pageHelpFor("/agents/montage/j1").help.label).toBe("Fiche d'un montage");
    expect(pageHelpFor("/agents/montage/j1").help.sections[0]).toBe("Le plan de coupe");
    // Phase 29 : équipe Analystes (la lecture d'un rapport n'est pas une fiche d'équipe).
    expect(pageHelpFor("/agents/analyses?vue=regles").help.label).toBe("Analyses");
    expect(pageHelpFor("/agents/analyses").help.sections).toContain("Les règles publicitaires");
    expect(pageHelpFor("/agents/analyses/rapports/r1").help.label).toBe("Rapport d'analyse");
    // Phase 33 : ordres de Kevin (la fiche d'un ordre n'est pas une fiche d'équipe).
    expect(pageHelpFor("/agents/orders").help.label).toBe("Ordres");
    expect(pageHelpFor("/agents/orders/o1?ok=x").help.label).toBe("Fiche d'un ordre");
    expect(pageHelpFor("/agents/orders/o1").help.sections[0]).toBe("Donner un ordre à une équipe");
    // Phase 15 : rubrique « Pages » (liste, nouvelle page, fiche d'une page et ses chiffres).
    expect(pageHelpFor("/pages").help.label).toBe("Pages");
    expect(pageHelpFor("/pages/new").help.label).toBe("Nouvelle page");
    expect(pageHelpFor("/pages/p1?range=30d").help.label).toBe("Fiche d'une page");
    // Phase 16 : la sortie de TikTok (aide « Ouvrir dans le navigateur ») est expliquée dans la fiche.
    expect(pageHelpFor("/pages/p1").help.sections).toEqual([
      "Copier le lien d'une source",
      "Lire le tableau d'une page",
      "Ouvrir Telegram depuis TikTok",
      "Ce qui est compté",
      "Créer une page",
    ]);
    expect(pageHelpFor("/members/broadcasts/new").help.label).toBe("Écrire à un groupe");
    expect(pageHelpFor("/members/broadcasts/ab/g1").help.label).toBe(
      "Test A/B d'un message à un groupe",
    );
    expect(pageHelpFor("/members/automations").help.label).toBe("Relances automatiques");
    expect(pageHelpFor("/members/automations/r1").help.label).toBe("Fiche d'une relance");
    expect(pageHelpFor("/members/automations/r1/edit").help.label).toBe("Éditeur avancé");
    expect(pageHelpFor("/members/automations/new").help.label).toBe("Éditeur avancé");
    expect(pageHelpFor("/members/m1").help.label).toBe("Fiche d'un membre");
    expect(pageHelpFor("/channels/c1").help.label).toBe("Fiche du canal");
    expect(pageHelpFor("/channels/import").help.label).toBe("Importer mes canaux");
    expect(pageHelpFor("/messages/p1").help.label).toBe("Fiche d'un message");
    expect(pageHelpFor("/messages/p1/edit").help.label).toBe("Modifier un message");
    expect(pageHelpFor("/messages/ab/g1").help.label).toBe("Test A/B");
    expect(pageHelpFor("/messages/emojis").help.label).toBe("Emojis animés");
    expect(pageHelpFor("/messages/emojis").help.sections).toEqual(["Ajouter des emojis animés"]);
    expect(pageHelpFor("/settings/connectors/meta/choose").help.label).toBe("Meta et TikTok");
    expect(pageHelpFor("/settings/connectors/telegram").help.label).toBe("Telegram (vues)");
    expect(pageHelpFor("/settings/journal/events").help.label).toBe("Journal");
    expect(pageHelpFor("/settings/postbacks/import").help.label).toBe("Retours du casino");
    expect(pageHelpFor("/stats").help.label).toBe("Statistiques");
    expect(pageHelpFor("/stats/cohorts").help.label).toBe("Membres dans le temps");
    // Phase 14 : parcours des demandes sur la période choisie, avec la comparaison.
    expect(pageHelpFor("/stats/channels?range=30d").help.sections).toEqual([
      "Statistiques → Canaux",
      "Période et comparaison",
      "Meilleurs créneaux",
    ]);
  });

  it("segment « :id » : un segment quelconque, jamais vide ; un segment fixe l'emporte", () => {
    expect(matchesPath("/channels/c1", "/channels/:id")).toBe(true);
    expect(matchesPath("/channels/c1/x", "/channels/:id")).toBe(true);
    expect(matchesPath("/channels", "/channels/:id")).toBe(false);
    expect(matchesPath("/channelsx/c1", "/channels/:id")).toBe(false);
    expect(matchesPath("/", "/")).toBe(true);
    expect(matchesPath("/campaigns", "/")).toBe(false);
    // « /channels/import » est aussi une valeur possible de « :id » : l'adresse fixe gagne.
    expect(pageHelpFor("/channels/import").help.path).toBe("/channels/import");
    expect(pageHelpFor("/campaigns/imports").help.path).toBe("/campaigns/imports");
  });

  it("« / » ne vaut que pour l'accueil ; repli sur « Les 10 premières minutes »", () => {
    expect(pageHelpFor("/")).toEqual({ help: PAGE_HELP[0], fallback: false });
    expect(pageHelpFor("/styleguide")).toEqual({ help: DEFAULT_HELP, fallback: true });
    expect(pageHelpFor("/campaignsx").fallback).toBe(true);
    expect(DEFAULT_HELP.sections).toEqual(["Les 10 premières minutes"]);
  });

  it("adresses normalisées", () => {
    expect(normalizePath("/campaigns/")).toBe("/campaigns");
    expect(normalizePath("/members?x=1#y")).toBe("/members");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("javascript:alert(1)")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("une seule ligne par adresse ; libellés courts et sans jargon", () => {
    const paths = PAGE_HELP.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of PAGE_HELP) {
      expect(p.label.length, p.path).toBeLessThanOrEqual(40);
      expect(p.sections.length, p.path).toBeGreaterThan(0);
      expect(p.label).not.toMatch(
        /\b(FTD|NGR|sub-?ID|ROAS|CPL|CPA|webhook|postback|cohorte|entonnoir|segment)\b/i,
      );
    }
  });

  it("chaque titre de la table existe dans docs/GUIDE-UTILISATEUR.md", () => {
    const headings = guideHeadings(withBuiltinSections(GUIDE));
    const missing: string[] = [];
    for (const entry of [...PAGE_HELP, DEFAULT_HELP])
      for (const ref of entry.sections)
        if (!findHeading(headings, ref))
          missing.push(`${entry.path || "(repli)"} → ${typeof ref === "string" ? ref : ref.title}`);
    expect(missing).toEqual([]);
  });

  it("chaque page de l'espace connecté a une aide propre (sauf la page interne /styleguide)", () => {
    const pages = adminPages();
    // Garde-fou : la recherche des pages fonctionne (accueil, fiches, sous-pages de Réglages…).
    expect(pages).toContain("/");
    expect(pages).toContain("/channels/x1");
    expect(pages).toContain("/members/automations/x1/edit");
    expect(pages.length).toBeGreaterThan(40);
    expect(pages.filter((p) => p !== "/styleguide" && pageHelpFor(p).fallback)).toEqual([]);
  });

  it("fiche d'un canal : « Qui peut entrer et quand » d'abord, puis le dépannage et les autres onglets", () => {
    const channel = guideSections(GUIDE, pageHelpFor("/channels/c1").help.sections);
    expect(channel.map((s) => s.title)).toEqual([
      "Fiche d'un canal",
      "Qui peut entrer et quand",
      "Un membre n'est pas accepté",
      "Ce que dit le bot",
      "Demandes",
      "Pourquoi des demandes restent sur « Attend les canaux »",
      "Membres du canal",
      "Le bot ne répond pas",
    ]);
    // L'introduction seule : les onglets ne sont pas répétés deux fois dans le volet.
    expect(channel[0]!.markdown).not.toContain("#### Qui peut entrer et quand");
    expect(channel[1]!.markdown).toContain("Après avoir rejoint ces canaux");
  });

  it("accueil : sa propre section « Accueil » ; l'aide et la visite ont la leur", () => {
    const home = guideSections(GUIDE, pageHelpFor("/").help.sections);
    expect(home.map((s) => s.id)).toEqual(["accueil"]);
    expect(home[0]!.markdown).toContain("Gains du jour");
    const help = guideSections(GUIDE, pageHelpFor("/help").help.sections);
    expect(help.map((s) => s.id)).toEqual(["aide-et-visite-guidee"]);
    expect(help[0]!.markdown).toContain("Revoir la visite guidée");
    expect(help[0]!.markdown).toContain("Ouvrir le guide complet");
  });

  it("les sections de chaque page se retrouvent dans le guide réel, dans l'ordre de la table", () => {
    const campaigns = guideSections(GUIDE, pageHelpFor("/campaigns/abc").help.sections);
    expect(campaigns.map((s) => s.id)).toEqual([
      "campagnes",
      "fiche-d-une-campagne",
      "une-pub-ne-remonte-pas",
    ]);
    // Introduction seulement : pas les sous-sections de Campagnes (elles viennent à la demande).
    expect(campaigns[0]!.markdown.startsWith("## Campagnes")).toBe(true);
    expect(campaigns[0]!.markdown).not.toContain("### ");
    // Réglages : seulement l'introduction (l'écran en cartes), sans les sous-sections.
    const settings = guideSections(GUIDE, pageHelpFor("/settings").help.sections);
    expect(settings).toHaveLength(1);
    expect(settings[0]!.markdown).not.toContain("### ");
    // Équipe : l'introduction de la section, puis sa sous-section (même découpage que l'API d'aide).
    const team = guideSections(GUIDE, pageHelpFor("/settings/team").help.sections);
    expect(team.map((s) => s.id)).toEqual(["reglages-equipe", "utilisateurs-et-invitations"]);
    expect(team[0]!.markdown).not.toContain("#### ");
  });

  it("pages d'atterrissage : introduction de la rubrique, puis ses sous-sections du guide", () => {
    const list = guideSections(GUIDE, pageHelpFor("/pages").help.sections);
    expect(list.map((s) => s.id)).toEqual([
      "pages",
      "creer-une-page",
      "copier-le-lien-d-une-source",
    ]);
    expect(list[0]!.markdown.startsWith("## Pages")).toBe(true);
    expect(list[0]!.markdown).not.toContain("### ");
    expect(guideHref(pageHelpFor("/pages/p1").help)).toBe("/help#copier-le-lien-d-une-source");
  });

  it("Conversations (phase 17) : boîte de réception, fil, personas et chiffres ont chacun leur aide", () => {
    expect(pageHelpFor("/conversations").help.label).toBe("Conversations");
    expect(pageHelpFor("/conversations?stage=CHAT").help.label).toBe("Conversations");
    expect(pageHelpFor("/conversations/c1").help.label).toBe("Fil d'une conversation");
    // Adresses fixes : elles l'emportent sur la fiche d'une conversation (« :id »).
    expect(pageHelpFor("/conversations/personas").help.label).toBe("Personas");
    expect(pageHelpFor("/conversations/personas/new").help.label).toBe("Nouvelle persona");
    expect(pageHelpFor("/conversations/personas/p1").help.label).toBe("Fiche d'une persona");
    expect(pageHelpFor("/conversations/stats?range=30d").help.label).toBe(
      "Chiffres des conversations",
    );
    const inbox = guideSections(GUIDE, pageHelpFor("/conversations").help.sections);
    expect(inbox.map((s) => s.id)).toEqual(["conversations", "boite-de-reception"]);
    expect(inbox[0]!.markdown.startsWith("## Conversations")).toBe(true);
    expect(inbox[0]!.markdown).not.toContain("### ");
    expect(guideHref(pageHelpFor("/conversations/c1").help)).toBe("/help#boite-de-reception");
    expect(guideHref(pageHelpFor("/conversations/personas/p1").help)).toBe("/help#personas");
    expect(guideHref(pageHelpFor("/conversations/stats").help)).toBe("/help#chiffres");
    // Les chiffres utilisent le sélecteur de période commun : son aide est jointe, comme pour les Statistiques.
    const stats = guideSections(GUIDE, pageHelpFor("/conversations/stats").help.sections);
    expect(stats.map((s) => s.id)).toEqual(["chiffres", "periode-et-comparaison"]);
  });

  it("lien « Ouvrir le guide complet » : ancre de la première section de la page", () => {
    expect(guideHref(pageHelpFor("/").help)).toBe("/help#accueil");
    expect(guideHref(pageHelpFor("/settings/team").help)).toBe("/help#reglages-equipe");
    expect(guideHref(pageHelpFor("/styleguide").help)).toBe("/help#les-10-premieres-minutes");
    expect(guideHref({ path: "/x", label: "X", sections: [] })).toBe("/help");
    // Chaque ancre existe dans la page /help (mêmes identifiants que le rendu du guide, sections intégrées comprises).
    const ids = new Set(guideHeadings(withBuiltinSections(GUIDE)).map((h) => h.id));
    for (const entry of [...PAGE_HELP, DEFAULT_HELP])
      expect(ids.has(guideHref(entry).slice("/help#".length)), entry.path).toBe(true);
  });
});
