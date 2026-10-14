import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    // Nos liens d'affiliés (font foi pour « inconnue ici ») : aucun dans ces tests.
    inviteLink: { findMany: vi.fn(async () => []) },
    setting: {
      findUnique: vi.fn(async () => (h.value === undefined ? null : { value: h.value })),
    },
  },
}));

import { telegramCampaignsView } from "@/lib/linkaffi/telegram-campaigns";
import { LinkaffiDivergences, LinkaffiDivergencesView } from "./linkaffi-divergences";

const NOW = new Date("2026-10-14T12:00:00Z");

/** Texte visible (balises et phrases pour lecteurs d'écran retirées, entités décodées, espaces repliés). */
function visible(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const entry = (over: Record<string, unknown> = {}) => ({
  affiliateName: "Paul",
  name: "Paul VIP",
  clicks: 57,
  registrations: 4,
  ftds: 2,
  members: 10,
  ours: { members: 10, registrations: 4, ftds: 2 },
  linkaffi: true,
  platform: true,
  ...over,
});

const setting = (over: Record<string, unknown> = {}) => ({
  syncedAt: "2026-10-14T11:55:00.000Z",
  checkedAt: "2026-10-14T11:55:00.000Z",
  available: true,
  error: null,
  sources: { campaigns: "campaigns", members: true, registrations: "players", clicks: "clicks" },
  campaigns: { tgPaul01: entry() },
  divergences: [],
  ...over,
});

const render = (value: unknown) =>
  renderToStaticMarkup(
    createElement(LinkaffiDivergencesView, { view: telegramCampaignsView(value, NOW), now: NOW }),
  );

describe("bloc « Écarts avec Link Affi »", () => {
  it("jamais comparé : titre, état et explication, sans tableau", () => {
    const html = render(undefined);
    const text = visible(html);
    expect(text).toContain("Écarts avec Link Affi");
    expect(text).toContain("Pas encore comparé");
    expect(text).toContain("La première comparaison se fera au prochain passage");
    expect(html).not.toContain("<table");
    expect(html).toContain('aria-labelledby="linkaffi-divergences-title"');
  });

  it("Link Affi ne donne rien encore : en attente, démarrage automatique annoncé", () => {
    const text = visible(
      render(
        setting({
          available: false,
          sources: { campaigns: null, members: false, registrations: null, clicks: null },
          campaigns: {
            tgPaul01: entry({ clicks: null, members: null, registrations: null, ftds: null }),
          },
        }),
      ),
    );
    expect(text).toContain("En attente de Link Affi");
    expect(text).toContain("la comparaison démarrera toute seule dès qu'il les donnera");
    expect(text).toContain("Dernière vérification il y a 5 min");
    expect(text).not.toContain("ne donne pas encore :");
  });

  it("tout concorde : aucun écart, nombre de campagnes et date de lecture", () => {
    const text = visible(render(setting()));
    expect(text).toContain("Aucun écart");
    expect(text).toContain(
      "Nos chiffres et ceux de Link Affi concordent sur 1 campagne (relu il y a 5 min).",
    );
  });

  it("écarts : tableau en mots du client, signe de l'écart, campagne inconnue, causes possibles", () => {
    const html = render(
      setting({
        campaigns: {
          tgPaul01: entry(),
          autreCle: entry({ name: null, affiliateName: null, platform: false, linkaffi: false }),
        },
        divergences: [
          { campaignKey: "tgPaul01", field: "members", ours: 15, theirs: 10 },
          { campaignKey: "autreCle", field: "ftds", ours: 0, theirs: 1 },
        ],
      }),
    );
    const text = visible(html);
    expect(text).toContain("Écarts à regarder");
    expect(text).toContain("2 écarts sur 2 campagnes comparées, relu il y a 5 min.");
    expect(html).toContain("<table");
    for (const header of ["Campagne", "Chiffre", "Chez nous", "Chez Link Affi", "Écart"])
      expect(text).toContain(header);
    expect(text).toContain("Paul VIP · Paul");
    expect(text).toContain("+5");
    expect(text).toContain("−1");
    expect(text).toContain("autreCle");
    expect(text).toContain("Inconnue ici : aucun lien d'invitation chez nous");
    expect(text).toContain("D'où peut venir un écart ?");
    // Le terme technique n'est qu'au survol / pour les lecteurs d'écran.
    expect(text).toContain("Premiers dépôts");
    expect(text).not.toMatch(/\bFTD\b/);
    expect(html).toContain("(FTD)");
  });

  it("chiffres partiels : ce que Link Affi ne donne pas encore est dit simplement", () => {
    const text = visible(
      render(
        setting({
          sources: { campaigns: null, members: true, registrations: null, clicks: null },
          campaigns: { tgPaul01: entry({ clicks: null, registrations: null, ftds: null }) },
        }),
      ),
    );
    expect(text).toContain(
      "Link Affi ne donne pas encore : inscriptions et premiers dépôts, clics. Ces chiffres seront comparés dès qu'il les donnera.",
    );
  });

  it("lecture en échec : raison lisible et chiffres de la dernière lecture réussie", () => {
    const html = render(
      setting({ error: "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes." }),
    );
    const text = visible(html);
    expect(text).toContain("Lecture impossible");
    expect(text).toContain(
      "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes.",
    );
    expect(text).toContain("Chiffres de la dernière lecture réussie (relu il y a 5 min).");
    expect(html).toContain('role="alert"');
  });

  it("comparaison en retard : renvoi vers l'état du système", () => {
    const text = visible(
      render(
        setting({ syncedAt: "2026-10-14T09:00:00.000Z", checkedAt: "2026-10-14T09:00:00.000Z" }),
      ),
    );
    expect(text).toContain(
      "Dernière comparaison il y a 3 h : vérifiez que le service d'arrière-plan tourne (Réglages → État du système).",
    );
  });

  it("composant serveur : lit le réglage lui-même", async () => {
    h.value = setting();
    const html = renderToStaticMarkup(await LinkaffiDivergences({ now: NOW }));
    expect(visible(html)).toContain("Aucun écart");
    h.value = undefined;
    const empty = renderToStaticMarkup(await LinkaffiDivergences({ now: NOW }));
    expect(visible(empty)).toContain("Pas encore comparé");
  });
});
