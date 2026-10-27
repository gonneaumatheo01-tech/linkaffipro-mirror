/**
 * Phase 31 — règles pures de la page Agents → Prospection : filtres (adresse, condition Prisma, région hors Europe
 * jamais visible), vues toutes prêtes, export CSV (échappement, hors Europe absent), avancement (médianes, taux),
 * offres, réglages, propositions de repères, sources, lien d'export de Kevin.
 */
import { describe, expect, it } from "vitest";
import { prospectsCsv, exportable, type ProspectCsvRow } from "./csv";
import { additionsOf, alreadyKnown, applyProposal, dictView, parseProposalForm, proposalsOf, EMPTY_ADDITIONS } from "./dict";
import { breakdownBars, brandList, opennessOf, opennessText, publicChannelUrl, weightsOf } from "./display";
import { clientTargets, eventText, statusButtonLabel } from "./detail";
import { exportRedirect } from "./export-link";
import {
  EMPTY_FILTERS,
  currentQuickView,
  exportHref,
  filterParams,
  parseProspectFilters,
  prospectWhere,
  quickViewFilters,
  statusesOf,
  visibleRegionWhere,
} from "./filters";
import { dealText, parseOfferForm } from "./offers";
import { median, pipelineSummary } from "./pipeline";
import { parseSettingsForm, readProspectionSettings, settingsChanges } from "./settings";
import { activePause, nextDiscoveryAt, pausesOf, parisHour, sourceStatus } from "./sources";
import { DEFAULT_COUNTRIES_SCOPE } from "@linkaffipro/agents";

const SCOPE = [...DEFAULT_COUNTRIES_SCOPE];
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

describe("filtres", () => {
  it("lit l'adresse et ignore les valeurs inconnues", () => {
    const f = parseProspectFilters({ pays: "fr", niveau: "A", verticale: "CASINO", statut: "suivi", ouverture: "pub", tri: "vues", contact: "XX", q: " @nom " });
    expect(f).toMatchObject({ country: "FR", tier: "A", vertical: "CASINO", status: "suivi", openness: "pub", sort: "vues", contact: null, q: "@nom" });
    expect(parseProspectFilters({ pays: "France", statut: "N'IMPORTE" })).toMatchObject({ country: null, status: null, sort: "note" });
  });

  it("aller-retour adresse ↔ filtres, tri par défaut omis", () => {
    const f = parseProspectFilters({ pays: "IT", concurrence: "FREE" });
    expect(filterParams(f)).toEqual({ pays: "IT", concurrence: "FREE" });
    expect(parseProspectFilters(filterParams(f))).toEqual(f);
    expect(exportHref(f)).toBe("/agents/prospection/export?pays=IT&concurrence=FREE");
  });

  it("par défaut : ni écartés ni « ne plus montrer » ; « tous » : aucun filtre de statut", () => {
    expect(statusesOf({ status: null })).not.toContain("DISQUALIFIED");
    expect(statusesOf({ status: null })).not.toContain("BLACKLISTED");
    expect(statusesOf({ status: "tous" })).toBeNull();
    expect(statusesOf({ status: "suivi" })).toEqual(["CONTACTED", "RESPONDED", "NEGOTIATING"]);
  });

  it("hors Europe jamais visible avec le périmètre par défaut", () => {
    expect(visibleRegionWhere(SCOPE)).toEqual({ region: { not: "NON_EU" } });
    const w = prospectWhere({ ...EMPTY_FILTERS, status: "tous" }, SCOPE);
    expect(JSON.stringify(w)).toContain('"not":"NON_EU"');
  });

  it("périmètre élargi : seuls les canaux hors Europe des pays ajoutés reviennent", () => {
    const w = visibleRegionWhere([...SCOPE, "TR"]);
    expect(w).toEqual({ OR: [{ region: { not: "NON_EU" } }, { region: "NON_EU", countries: { array_contains: ["TR"] } }] });
  });

  it("combine pays, niveau, ouverture et recherche", () => {
    const w = prospectWhere(parseProspectFilters({ pays: "ES", niveau: "B", ouverture: "pub", q: "t.me/s/Pronos" }), SCOPE);
    const s = JSON.stringify(w);
    expect(s).toContain('"array_contains":["ES"]');
    expect(s).toContain('"tier":"B"');
    expect(s).toContain('"sellsAds"');
    expect(s).toContain('"username":{"contains":"pronos"}');
  });

  it("vues toutes prêtes reconnues", () => {
    const f = quickViewFilters("a-libres")!;
    expect(currentQuickView(f)).toBe("a-libres");
    expect(currentQuickView(EMPTY_FILTERS)).toBeNull();
  });

  it("lien d'export de Kevin : `?export=csv` renvoie vers la route d'export avec les filtres", () => {
    expect(exportRedirect({ export: "csv" })).toBe("/agents/prospection/export");
    expect(exportRedirect({ export: "csv", pays: "FR", ok: "x", vue: "avancement" })).toBe("/agents/prospection/export?pays=FR");
    expect(exportRedirect({})).toBeNull();
  });
});

const row = (o: Partial<ProspectCsvRow>): ProspectCsvRow => ({
  id: "c1",
  username: "parisfoot",
  channelUrl: "https://t.me/parisfoot",
  title: "Paris Foot",
  kind: "CHANNEL",
  tier: "A",
  score: 78,
  vertical: "SPORTS",
  region: "EU",
  countries: ["FR"],
  language: "fr",
  subscribers: 17000,
  medianViews: 2100,
  viewRate: 0.12,
  postsPerDay: 3.5,
  competitiveState: "ROTATING",
  brands: [{ brand: "1xbet", promoCode: "XYZ", intensity: "HEAVY", links: 7 }],
  monetization: { sellsAds: true, adPrice: "40 €" },
  contactConfidence: "HIGH",
  bestContact: "@admin_pub",
  status: "QUALIFIED",
  sourceType: "DIRECTORY",
  statusChangedAt: null,
  discoveredAt: new Date("2026-10-20T10:00:00Z"),
  tierReason: "audience FR réelle",
  ...o,
});

describe("export CSV", () => {
  it("en-tête, séparateur point-virgule, lien public, libellés français", () => {
    const csv = prospectsCsv([row({})], SCOPE);
    const [head, line] = csv.replace(/^﻿/, "").split(/\r?\n/);
    expect(head).toContain("Canal;Lien;Niveau");
    expect(line).toContain("https://t.me/parisfoot");
    expect(line).toContain("1xbet (code XYZ)");
    expect(line).toContain("À contacter");
    expect(line).toContain("Contact direct");
  });

  it("échappe les guillemets, points-virgules et formules", () => {
    const csv = prospectsCsv([row({ title: '=HYPERLINK("x";"y")', tierReason: "a; b" })], SCOPE);
    expect(csv).toContain(`"'=HYPERLINK(""x"";""y"")"`);
    expect(csv).toContain('"a; b"');
  });

  it("aucune ligne hors Europe, sauf un pays ajouté au périmètre", () => {
    const latam = row({ id: "c2", title: "Pronos MX", region: "NON_EU", countries: ["MX"] });
    expect(prospectsCsv([row({}), latam], SCOPE)).not.toContain("Pronos MX");
    expect(exportable(latam, [...SCOPE, "MX"])).toBe(true);
  });
});

describe("affichage", () => {
  it("lien public t.me seulement", () => {
    expect(publicChannelUrl({ username: "abc_def", channelUrl: "x" })).toBe("https://t.me/abc_def");
    expect(publicChannelUrl({ username: null, channelUrl: "https://evil.example/x" })).toBeNull();
    expect(publicChannelUrl({ username: null, channelUrl: "https://t.me/+hash" })).toBe("https://t.me/+hash");
  });

  it("ouverture, marques, détail de la note", () => {
    expect(opennessOf({ sellsAds: true, sellsVip: true })).toEqual(["pub", "vip"]);
    expect(opennessText(null)).toBe("—");
    expect(brandList([{ brand: "b", intensity: "LIGHT" }, { brand: "a", intensity: "HEAVY" }]).map((b) => b.brand)).toEqual(["a", "b"]);
    const bars = breakdownBars({ audience: 15, engagement: 15, penalties: -6 }, weightsOf(null));
    expect(bars.find((b) => b.key === "audience")).toMatchObject({ value: 15, max: 30, ratio: 0.5 });
    expect(bars.find((b) => b.key === "penalties")).toMatchObject({ value: -6 });
  });

  it("boutons de la fiche : seulement les gestes du client, jamais ceux de l'équipe", () => {
    expect(clientTargets("QUALIFIED")).toEqual(["CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "SKIPPED", "BLACKLISTED"]);
    expect(clientTargets("DISCOVERED")).toEqual(["BLACKLISTED"]);
    expect(clientTargets("BLACKLISTED")).toEqual([]);
    expect(clientTargets("SKIPPED")).toContain("QUALIFIED");
    expect(statusButtonLabel("QUALIFIED")).toBe("Remettre à contacter");
    expect(eventText("STATUS_CHANGED", { from: "QUALIFIED", to: "CONTACTED", by: "client" })).toBe("À contacter → Contacté (par vous)");
  });
});

describe("avancement", () => {
  it("médiane", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("compteurs, délais et taux", () => {
    const d = (s: string) => new Date(`2026-10-${s}T09:00:00Z`);
    const now = d("20");
    const s = pipelineSummary(
      [
        { status: "CONTACTED", statusChangedAt: d("14"), discoveredAt: d("01"), contactedAt: d("14"), respondedAt: null, signedAt: null },
        { status: "SIGNED", statusChangedAt: d("12"), discoveredAt: d("01"), contactedAt: d("02"), respondedAt: d("04"), signedAt: d("12") },
        { status: "QUALIFIED", statusChangedAt: null, discoveredAt: d("10"), contactedAt: null, respondedAt: null, signedAt: null },
      ],
      now,
    );
    expect(s.counts).toEqual({ CONTACTED: 1, SIGNED: 1, QUALIFIED: 1 });
    expect(s.medianDaysInStatus.QUALIFIED).toBe(10);
    expect(s.contactToResponse).toBe(2);
    expect(s.contactToSigned).toBe(10);
    expect(s.responseRate).toBe(0.5);
    expect(s.signRate).toBe(0.5);
  });
});

describe("offres", () => {
  it("lit marque, pays, conditions", () => {
    const r = parseOfferForm(fd({ brand: " Celsius ", vertical: "casino", countries: "fr, be", cpa: "120", revshare: "30,5" }));
    expect(r).toEqual({ ok: true, offer: { id: null, brand: "Celsius", vertical: "CASINO", countries: ["FR", "BE"], dealTypes: { cpa: 120, revshare: 30.5 }, trackingHint: null, notes: null } });
    expect(dealText({ cpa: 120, revshare: 30.5 })).toBe("Prime par joueur 120 € · part du revenu 30,5 %");
  });

  it("refuse sans condition, sans pays, ou mixte incomplet", () => {
    expect(parseOfferForm(fd({ brand: "X", vertical: "SPORTS", countries: "FR" }))).toMatchObject({ ok: false, field: "cpa" });
    expect(parseOfferForm(fd({ brand: "X", vertical: "SPORTS", countries: "", cpa: "1" }))).toMatchObject({ ok: false, field: "countries" });
    expect(parseOfferForm(fd({ brand: "X", vertical: "SPORTS", countries: "FR", hybridCpa: "50" }))).toMatchObject({ ok: false, field: "hybridRevshare" });
    expect(parseOfferForm(fd({ brand: "X", vertical: "SPORTS", countries: "FR", revshare: "120" }))).toMatchObject({ ok: false, field: "revshare" });
  });
});

describe("réglages", () => {
  const current = readProspectionSettings({});
  it("valeurs par défaut du contrat", () => {
    expect(current.numbers.dailyTopCount).toBe(10);
    expect(current.numbers.monthlyBudget).toBe(30);
    expect(current.bools.enabled).toBe(true);
    expect(current.weights.audience).toBe(30);
  });

  it("enregistre seulement ce qui est donné ; budget en centimes", () => {
    const r = parseSettingsForm(fd({ dailyTopCount: "15", monthlyBudget: "45" }), current);
    expect(r).toEqual({ ok: true, values: { "prospection.daily_top_count": 15, "prospection.monthly_budget_cents": 4500 } });
    if (r.ok) expect(settingsChanges(current, r.values)).toEqual(["Canaux dans la liste du matin : 10 → 15", "Dépense mensuelle de l'IA au plus : 30 → 45 €"]);
  });

  it("bornes, ordre des niveaux et poids à 100", () => {
    expect(parseSettingsForm(fd({ dailyTopHour: "25" }), current)).toMatchObject({ ok: false, field: "dailyTopHour" });
    expect(parseSettingsForm(fd({ tierBThreshold: "80" }), current)).toMatchObject({ ok: false, field: "tierBThreshold" });
    expect(parseSettingsForm(fd({ weight_audience: "50" }), current)).toMatchObject({ ok: false, field: "weight_audience" });
    expect(parseSettingsForm(fd({ weight_audience: "40", weight_reach: "0" }), current)).toMatchObject({ ok: true });
  });

  it("formulaire complet : cases décochées = non ; pays ajoutés", () => {
    const r = parseSettingsForm(fd({ withBools: "on", verticals: ["CASINO"], countries: ["FR", "TR"] }), current);
    expect(r.ok && r.values["prospection.enabled"]).toBe(false);
    if (r.ok) expect(settingsChanges(current, r.values)).toContain("Pays ajoutés : TR");
  });
});

describe("marques et repères", () => {
  it("lit et normalise une proposition", () => {
    expect(parseProposalForm(fd({ kind: "shortener", value: "https://Lnk.to/abc" }))).toMatchObject({ ok: true, proposal: { value: "lnk.to" } });
    expect(parseProposalForm(fd({ kind: "affiliate_param", value: "?aff_id=12" }))).toMatchObject({ ok: true, proposal: { value: "aff_id" } });
    expect(parseProposalForm(fd({ kind: "brand", value: "Celsius", country: "fr" }))).toMatchObject({ ok: true, proposal: { country: "FR", brandType: "both" } });
    expect(parseProposalForm(fd({ kind: "promo_word", value: "Kod" }))).toMatchObject({ ok: false, field: "language" });
  });

  it("doublon refusé ; validation ajoutée aux ajouts sans doublon", () => {
    const view = dictView({ brands: [{ name: "Winamax", country: "FR" }], patterns: { shorteners: ["bit.ly"] }, contactLabels: { fr: ["pub"] } }, EMPTY_ADDITIONS);
    const known = { brands: view.brands.map((b) => b.name), queryParams: [], pathMarkers: [], shorteners: view.shorteners, promoWords: [], contactLabels: ["pub"] };
    expect(alreadyKnown({ kind: "brand", value: "winamax" }, known, [])).toBe(true);
    expect(alreadyKnown({ kind: "shortener", value: "lnk.to" }, known, [])).toBe(false);
    const [p] = proposalsOf([{ id: "p1", kind: "brand", value: "Celsius", country: "FR", status: "PENDING", proposedAt: "2026-10-26T00:00:00Z" }]);
    const add = applyProposal(additionsOf(null), p!);
    expect(applyProposal(add, p!).brands).toEqual([{ name: "Celsius", country: "FR", type: "both", status: "local" }]);
    expect(dictView({ brands: [] }, add).brands[0]).toMatchObject({ name: "Celsius", added: true });
  });
});

describe("sources", () => {
  it("pauses, état", () => {
    const pauses = pausesOf({ directories: { until: "2026-10-30T00:00:00Z", reason: "403" }, bad: { until: "x" } });
    expect(Object.keys(pauses)).toEqual(["directories"]);
    expect(activePause(pauses, "directories", new Date("2026-10-27T00:00:00Z"))).not.toBeNull();
    expect(activePause(pauses, "directories", new Date("2026-11-01T00:00:00Z"))).toBeNull();
    expect(sourceStatus({ enabled: false, paused: null, lastRunErrors: 0 })).toBe("OFF");
    expect(sourceStatus({ enabled: true, paused: null, lastRunErrors: 2 })).toBe("ERROR");
  });

  it("prochain passage entre 2 h et 6 h, heure de Paris, après la pause", () => {
    const next = nextDiscoveryAt(new Date("2026-10-27T10:00:00Z"), null)!;
    expect(parisHour(next)).toBe(2);
    expect(next.getTime()).toBeGreaterThan(Date.parse("2026-10-27T10:00:00Z"));
    const after = nextDiscoveryAt(new Date("2026-10-27T10:00:00Z"), new Date("2026-10-30T12:00:00Z"))!;
    expect(after.getTime()).toBeGreaterThan(Date.parse("2026-10-30T12:00:00Z"));
  });
});
