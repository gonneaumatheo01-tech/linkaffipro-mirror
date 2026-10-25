import { describe, expect, it } from "vitest";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  ORDER_EXAMPLE,
  addDayKey,
  canExtend,
  canManageOrders,
  canStop,
  capabilityText,
  channelOverrideTitle,
  eventLabel,
  groupUnmet,
  missionCounts,
  mixText,
  orderCostCents,
  orderEngineResult,
  orderHref,
  orderPeriod,
  orderTeamName,
  orderTimeline,
  ordersWhere,
  overrideActiveOn,
  overrideChanges,
  overrideState,
  paramsInWords,
  parseExtendDays,
  parseImpossible,
  parseOrderFilters,
  parsePlan,
  parseProgress,
  periodText,
  planLines,
  progressFigures,
  progressPercent,
  progressText,
  resolvedLines,
  safeOrderId,
  valueText,
  type OverrideRow,
} from "./orders";

// Règles pures de la page Agents → Ordres (phase 33). Aucune base.

/** La phrase du client du 24 octobre, telle que le planificateur la rend (forme du contrat `OrderPlan`). */
const clientPlan = {
  teamKey: "sports",
  asIfTeamKey: "sports",
  scope: { test: true },
  kind: "WHAT_IF",
  period: { start: "2026-10-25", days: 3 },
  perDay: 2,
  theme: "hors-jeux",
  categoryId: "cat1",
  format: null,
  mode: "simulation",
  steps: [
    { capability: "faire_comme_si", teamKey: "transverse", params: { asIfTeamKey: "sports", days: 3 } },
    { capability: "programmer_paris", teamKey: "sports", params: { picksPerDay: 2, theme: "hors-jeux", categoryId: "cat1", test: true } },
  ],
  resolved: {
    start: { value: "2026-10-25", from: "défaut du système" },
    picksPerDay: { value: 2, from: "catégorie active" },
    mode: { value: "simulation", from: "défaut du système" },
  },
  questions: [],
  impossible: [],
};

const names = {
  channels: new Map([["ch1", "Roulette"]]),
  categories: new Map([["cat1", "Hors-jeux"]]),
  personas: new Map([["p1", "Léa"]]),
  capabilities: new Map([["sports:programmer_paris", "programmer des paris sur un canal pour N jours"]]),
};

const override = (o: Partial<OverrideRow> = {}): OverrideRow => ({
  id: "ov1",
  channelId: "test",
  teamKey: "sports",
  fromDay: "2026-10-25",
  toDay: "2026-10-27",
  postsPerDay: null,
  picksPerDay: 2,
  betCategoryId: "cat1",
  themes: ["hors-jeux"],
  mix: null,
  format: null,
  windowStart: "18:00",
  windowEnd: "23:00",
  personaId: null,
  isTest: true,
  closedAt: null,
  ...o,
});

describe("adresses, droits, filtres", () => {
  it("adresse de la fiche, droits ADMIN seulement", () => {
    expect(orderHref("o 1")).toBe("/agents/orders/o%201");
    expect(canManageOrders("ADMIN")).toBe(true);
    expect(canManageOrders("MANAGER")).toBe(false);
  });

  it("filtres : équipe et statut connus seulement", () => {
    expect(parseOrderFilters({ team: "sports", status: "RUNNING" })).toEqual({ team: "sports", status: "RUNNING" });
    expect(parseOrderFilters({ team: ["casino"], status: "PIRATE" })).toEqual({ team: "casino", status: "" });
    expect(parseOrderFilters({ team: "'; drop", status: undefined })).toEqual({ team: "", status: "" });
    expect(ordersWhere({ team: "", status: "" })).toEqual({});
    expect(ordersWhere({ team: "transverse", status: "DONE" })).toEqual({ teamKey: "transverse", status: "DONE" });
  });

  it("arrêter : ordre vivant ; prolonger : ordre en cours ; jours 1 à 30", () => {
    for (const s of ["RUNNING", "WAITING_CONFIRM", "BLOCKED", "DRAFT"]) expect(canStop(s)).toBe(true);
    for (const s of ["DONE", "CANCELLED", "FAILED"]) expect(canStop(s)).toBe(false);
    expect(canExtend("RUNNING")).toBe(true);
    expect(canExtend("DONE")).toBe(false);
    expect(parseExtendDays("2")).toBe(2);
    expect(parseExtendDays("30")).toBe(30);
    for (const v of ["0", "31", "-1", "2.5", "abc", null, 3]) expect(parseExtendDays(v)).toBeNull();
    expect(safeOrderId("cl_123-x")).toBe("cl_123-x");
    expect(safeOrderId("../x")).toBeNull();
  });

  it("résultat du moteur : message du moteur, sinon le message par défaut", () => {
    expect(orderEngineResult({ ok: false, message: " Déjà fini " }, "x")).toEqual({ ok: false, message: "Déjà fini" });
    expect(orderEngineResult(undefined, "Arrêté")).toEqual({ ok: true, message: "Arrêté" });
  });

  it("noms d'équipes, y compris les équipes à venir ; jamais « Dating »", () => {
    expect(orderTeamName("sports")).toBe("Paris sportifs");
    expect(orderTeamName("dating")).toBe("Rencontres");
    expect(orderTeamName("transverse")).toBe("Toutes les équipes");
    expect(orderTeamName("montage")).toBe("Montage");
    expect(orderTeamName(null)).toBe("Équipe à définir");
  });
});

describe("plan validé en mots (jamais de JSON)", () => {
  it("lit le plan de la phrase du client", () => {
    const p = parsePlan(clientPlan);
    expect(p.scope).toEqual({ kind: "test" });
    expect(p.period).toEqual({ start: "2026-10-25", days: 3 });
    expect(p.steps).toHaveLength(2);
    expect(p.resolved.map((r) => r.key)).toEqual(["start", "picksPerDay", "mode"]);
  });

  it("tolère un plan vide ou abîmé", () => {
    const p = parsePlan("n'importe quoi");
    expect(p).toMatchObject({ teamKey: null, scope: null, period: null, mode: null, steps: [], resolved: [], questions: [] });
    expect(parsePlan({ period: { start: "demain", days: 3 }, steps: [{ params: {} }, 4] }).period).toBeNull();
    expect(parsePlan({ steps: [{ params: {} }] }).steps).toEqual([]);
  });

  it("lignes principales", () => {
    const lines = planLines(parsePlan(clientPlan), names);
    const text = lines.map((l) => `${l.label} : ${l.value}`).join("\n");
    expect(text).toContain("Équipe : Paris sportifs");
    expect(text).toContain("Faire comme si : Le canal Test est traité comme un canal Paris sportifs pendant la période");
    expect(text).toContain("Où : Canal Test");
    expect(text).toContain("Genre d'ordre : Faire comme si");
    expect(text).toContain("Période : Du 25 oct. au 27 oct. 2026 (3 jours)");
    expect(text).toContain("Par jour : 2");
    expect(text).toContain("Thème : hors-jeux");
    expect(text).toContain("Catégorie de paris : Hors-jeux");
    expect(text).toContain("Mode : Pour de faux (sur le canal Test)");
    expect(text).not.toMatch(/[{}[\]"]/);
    expect(jargonIn(text)).toEqual([]);
  });

  it("étapes : description du registre, sinon la clé en mots ; paramètres nommés", () => {
    expect(capabilityText("sports", "programmer_paris", names)).toBe("Programmer des paris sur un canal pour N jours");
    expect(capabilityText("transverse", "faire_comme_si", names)).toBe("Faire comme si");
    expect(paramsInWords({ picksPerDay: 2, theme: "hors-jeux", categoryId: "cat1", test: true, channelIds: ["ch1"], empty: [] }, names)).toEqual([
      "Paris par jour : 2",
      "Thème : hors-jeux",
      "Catégorie de paris : Hors-jeux",
      "Canal Test : oui",
      "Canaux : Roulette",
    ]);
    expect(paramsInWords({ personaId: "p1", mode: "real", mix: { video: 1, photo: 2, text: 1 } }, names)).toEqual([
      "Persona : Léa",
      "Mode : En vrai (sur les vrais canaux)",
      "Mélange : 1 vidéo, 2 photos, 1 texte",
    ]);
    expect(paramsInWords({ someThing_new: { a: 1 } })).toEqual(["Some thing new : a 1"]);
  });

  it("valeurs résolues avec leur provenance", () => {
    expect(resolvedLines(parsePlan(clientPlan), names)).toEqual([
      { label: "Début", value: "25 oct. 2026 (défaut du système)" },
      { label: "Paris par jour", value: "2 (catégorie active)" },
      { label: "Mode", value: "Pour de faux (sur le canal Test) (défaut du système)" },
    ]);
    expect(valueText(null)).toBe("—");
    expect(valueText(1.5)).toBe("1,5");
    expect(valueText({ start: "2026-10-25", days: 1 }, "period")).toBe("Le 25 oct. 2026");
    expect(valueText({ channelIds: ["ch1"] }, "scope", names)).toBe("Roulette");
    expect(mixText({ video: 0, photo: 1 })).toBe("1 photo");
  });

  it("impossibles et replis numérotés", () => {
    expect(
      parseImpossible([
        { part: "thème hors-jeux", reason: "aucune cote chez le fournisseur", alternatives: [{ label: "thème corners" }, "thème cartons", { nope: 1 }] },
        { nothing: true },
        "texte",
      ]),
    ).toEqual([{ part: "thème hors-jeux", reason: "aucune cote chez le fournisseur", alternatives: ["thème corners", "thème cartons"] }]);
    expect(parseImpossible(null)).toEqual([]);
  });
});

describe("période, progression, coût", () => {
  it("période du plan, sinon des dates de l'ordre", () => {
    expect(addDayKey("2026-10-31", 1)).toBe("2026-11-01");
    const toDay = (d: Date) => d.toISOString().slice(0, 10);
    expect(orderPeriod(parsePlan(clientPlan), null, null, toDay)).toEqual({ from: "2026-10-25", to: "2026-10-27", days: 3 });
    expect(orderPeriod(parsePlan({}), new Date("2026-10-25T10:00:00Z"), new Date("2026-10-26T20:00:00Z"), toDay)).toEqual({
      from: "2026-10-25",
      to: "2026-10-26",
      days: 2,
    });
    expect(periodText({ from: null, to: null, days: null })).toBe("Tout de suite");
    expect(periodText({ from: "2026-10-25", to: "2026-10-25", days: 1 })).toBe("Le 25 oct. 2026");
    expect(periodText({ from: "2026-12-30", to: "2027-01-02", days: 4 })).toBe("Du 30 déc. 2026 au 2 janv. 2027 (4 jours)");
  });

  it("progression : le plus grand des chiffres de l'ordre et des missions", () => {
    const p = parseProgress({
      missionsPlanned: 6,
      missionsDone: 2,
      missionsFailed: 0,
      lastReportAt: "2026-10-25T20:00:00Z",
      perDay: [{ day: "2026-10-26", done: 1, failed: 0, postIds: ["p2"] }, { day: "2026-10-25", done: 2, failed: 0, postIds: ["p1"] }, { day: "x" }],
    });
    expect(p.perDay.map((d) => d.day)).toEqual(["2026-10-25", "2026-10-26"]);
    expect(p.lastReportAt?.toISOString()).toBe("2026-10-25T20:00:00.000Z");
    const c = missionCounts(["DONE", "DONE", "DONE", "FAILED", "WAITING_VALIDATION", "CANCELLED", "PENDING"]);
    expect(c).toEqual({ total: 7, done: 3, failed: 1, waiting: 1, cancelled: 1 });
    const f = progressFigures(p, c);
    expect(f).toEqual({ planned: 6, done: 3, failed: 1, waiting: 1 });
    expect(progressText(f, "RUNNING")).toBe("3 sur 6 faites · 1 à valider · 1 en échec");
    expect(progressPercent(f)).toBe(50);
    expect(progressText({ planned: 0, done: 0, failed: 0, waiting: 0 }, "WAITING_CONFIRM")).toBe("Attend votre OUI");
    expect(progressText({ planned: 0, done: 0, failed: 0, waiting: 0 }, "RUNNING")).toBe("Première production à venir");
    expect(progressPercent({ planned: 0, done: 0 })).toBe(0);
    expect(parseProgress(undefined)).toEqual({ planned: 0, done: 0, failed: 0, lastReportAt: null, perDay: [] });
  });

  it("coût : celui de l'ordre, sinon la somme des missions", () => {
    expect(orderCostCents(120, [10, 20])).toBe(120);
    expect(orderCostCents(0, [10, 20])).toBe(30);
  });
});

describe("réglage temporaire du canal", () => {
  it("actif sur la période, ni avant, ni après, ni une fois arrêté", () => {
    const o = override();
    expect(overrideActiveOn(o, "2026-10-24")).toBe(false);
    expect(overrideActiveOn(o, "2026-10-25")).toBe(true);
    expect(overrideActiveOn(o, "2026-10-27")).toBe(true);
    expect(overrideActiveOn(o, "2026-10-28")).toBe(false);
    expect(overrideActiveOn(override({ closedAt: new Date() }), "2026-10-26")).toBe(false);
    expect(overrideState(o, "2026-10-26").label).toBe("En cours");
    expect(overrideState(o, "2026-10-20").label).toBe("À venir (dès le 25 oct. 2026)");
    expect(overrideState(o, "2026-10-30").label).toBe("Terminé");
    expect(overrideState(override({ closedAt: new Date() }), "2026-10-26").label).toBe("Arrêté avant la fin");
  });

  it("ce qui change, en mots", () => {
    expect(overrideChanges(override(), names, null)).toEqual([
      "Travaillé comme un canal Paris sportifs",
      "2 paris par jour",
      "Catégorie de paris : Hors-jeux",
      "Thème : hors-jeux",
      "Fenêtre : 18 h – 23 h",
      "Pour de faux : tout part sur le canal Test",
    ]);
    expect(
      overrideChanges(
        override({ isTest: false, teamKey: "dating", picksPerDay: null, betCategoryId: null, themes: null, postsPerDay: 3, personaId: "p1", mix: { video: 1 }, format: "photo", windowStart: null, windowEnd: null }),
        names,
        "dating",
      ),
    ).toEqual(["Équipe : Rencontres", "3 posts par jour", "Mélange : 1 vidéo", "Format : photo", "Persona : Léa"]);
    expect(channelOverrideTitle("2026-10-27", 12)).toBe("Réglage temporaire en cours jusqu'au 27 oct. 2026 (ordre n°12)");
  });
});

describe("chronologie", () => {
  const base = {
    createdAt: new Date("2026-10-25T08:00:00Z"),
    updatedAt: new Date("2026-10-27T21:00:00Z"),
    startsAt: new Date("2026-10-25T08:01:00Z"),
    status: "DONE",
    progress: parseProgress({}),
  };
  const now = new Date("2026-10-28T08:00:00Z");

  it("événements du Grand Chef, actions du site, dates de l'ordre, dans l'ordre", () => {
    const t = orderTimeline(
      base,
      [
        { type: "agents.order.day_done", occurredAt: new Date("2026-10-25T21:00:00Z"), payload: { orderId: "o1", day: "2026-10-25" } },
        { type: "agents.order.started", occurredAt: new Date("2026-10-25T08:01:00Z"), payload: { orderId: "o1" } },
        { type: "agents.order.failures", occurredAt: new Date("2026-10-26T12:00:00Z"), payload: { orderId: "o1", failures: 3 } },
        { type: "agents.order.finished", occurredAt: new Date("2026-10-27T21:00:00Z"), payload: { orderId: "o1" } },
      ],
      [{ action: "agents.order_extended", createdAt: new Date("2026-10-26T09:00:00Z"), metadata: { days: 2 }, userName: "Matheo" }],
      now,
    );
    expect(t.map((e) => e.label)).toEqual(["Demandé à Kevin", "Lancé", "Rapport du jour", "Prolongé depuis le site", "Échecs signalés", "Fini"]);
    expect(t[2]!.detail).toBe("Jour du 25 oct. 2026");
    expect(t[3]!.detail).toBe("par Matheo · 2 jours de plus");
    expect(t[4]!.detail).toBe("3 missions en échec");
  });

  it("sans événement : création, début de période, dernier rapport, statut final", () => {
    const t = orderTimeline({ ...base, status: "CANCELLED", progress: parseProgress({ lastReportAt: "2026-10-26T20:00:00Z" }) }, [], [], now);
    expect(t.map((e) => e.label)).toEqual(["Demandé à Kevin", "Début de la période", "Dernier rapport de Kevin", "Arrêté"]);
    const stopped = orderTimeline({ ...base, status: "CANCELLED" }, [], [{ action: "agents.order_stopped", createdAt: base.updatedAt, metadata: {} }], now);
    expect(stopped.filter((e) => e.label.startsWith("Arrêté"))).toHaveLength(1);
    const waiting = orderTimeline({ ...base, status: "WAITING_CONFIRM" }, [], [], now);
    expect(waiting.map((e) => e.label)).toEqual(["Demandé à Kevin"]);
  });

  it("type d'événement inconnu : libellé par mots-clés, jamais le type brut", () => {
    expect(eventLabel("boss.order_confirmed")).toBe("Confirmé par OUI");
    expect(eventLabel("agents.order.modified")).toBe("Modifié");
    expect(eventLabel("x.y")).toBe("Étape de l'ordre");
  });
});

describe("Pas encore possible : regroupement par équipe et capacité", () => {
  it("additionne, garde 3 exemples, du plus demandé au moins demandé", () => {
    const at = (d: string) => new Date(`2026-10-${d}T08:00:00Z`);
    const g = groupUnmet([
      { id: "1", text: "programme des shorts", count: 2, lastAt: at("20"), teamKey: "montage", suggestedCapability: "programmer des shorts" },
      { id: "2", text: "fais des shorts tiktok", count: 2, lastAt: at("22"), teamKey: "montage", suggestedCapability: "Programmer des shorts" },
      { id: "3", text: "export des dépôts", count: 1, lastAt: at("21"), teamKey: null, suggestedCapability: null },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ team: "Montage", capability: "programmer des shorts", count: 4, examples: ["programme des shorts", "fais des shorts tiktok"] });
    expect(g[0]!.lastAt).toEqual(at("22"));
    expect(g[1]).toMatchObject({ team: "Aucune équipe", capability: "À classer", count: 1 });
  });
});

it("l'exemple de l'état vide est la phrase du client, sans jargon", () => {
  expect(ORDER_EXAMPLE).toContain("faisons comme si c'était un canal Paris sportifs");
  expect(jargonIn(ORDER_EXAMPLE)).toEqual([]);
});
