import { describe, expect, it } from "vitest";
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_FILTERS,
  APPROVE_ALL_FALLBACK_MS,
  APPROVE_ALL_LIST_CHANGED,
  REQUESTS_SHOWN_MAX,
  approveAllConfirm,
  approveAllFallbackAt,
  approveAllMark,
  approveAllDone,
  approveAllListGrew,
  approveJobId,
  parseApproveAllForm,
  isQueuedForApproval,
  matchesRequestFilter,
  memberHandle,
  memberName,
  membersSummary,
  parseRequestFilter,
  remaining,
  requestFilterCounts,
  requestFiltersToTopUp,
  requestFilterStatuses,
  requestNext,
  requestNextNote,
  requestsCountLabel,
  requestsFilterHref,
  requestsTabLabel,
  sourceHint,
  trackedMembersLabel,
  visibleRequests,
  type RequestFilter,
} from "./requests";

const now = new Date("2026-10-10T12:00:00Z");
const inS = (s: number) => new Date(now.getTime() + s * 1000);

describe("demandes d'un canal", () => {
  it("temps restant avant l'acceptation", () => {
    expect(remaining(null, now)).toBe("—");
    expect(remaining(inS(-5), now)).toBe("imminent");
    expect(remaining(inS(45), now)).toBe("45 s");
    expect(remaining(inS(600), now)).toBe("10 min");
    expect(remaining(inS(3 * 3600), now)).toBe("3 h");
    expect(remaining(inS(2 * 86400), now)).toBe("2 j");
  });

  it("ce qui va se passer, en une phrase", () => {
    expect(requestNext("SCHEDULED", inS(600), now)).toBe("Acceptée dans 10 min");
    expect(requestNext("SCHEDULED", inS(-1), now)).toBe("Acceptée dans un instant");
    // « Tout accepter » : en file d'acceptation, sans heure (jamais « Acceptée dans — »).
    expect(requestNext("SCHEDULED", null, now)).toBe("Acceptation en cours");
    expect(requestNext("PENDING_GATE", null, now)).toBe(
      "Acceptée toute seule une fois les canaux rejoints",
    );
    expect(requestNext("REQUESTED", null, now)).toBe("À valider à la main");
    expect(requestNext("FAILED", null, now)).toBe("Réessayez « Accepter » ou refusez la demande");
    expect(requestNext("APPROVED", null, now)).toBe("—");
  });

  it("la phrase dit la suite, sans répéter la pastille d'état (« Attente canaux requis », « Échec »)", () => {
    expect(requestNext("PENDING_GATE", null, now)).not.toMatch(/attend/i);
    expect(requestNext("FAILED", null, now)).not.toMatch(/échou|échec/i);
  });

  it("explication de l'origine dans le volet de détail, seulement quand la provenance est inconnue", () => {
    // Un de nos liens (bouton « canal à rejoindre », lien de partage, pub, lien du canal) : rien à expliquer.
    for (const t of ["GATE", "SHARE", "AD", "MANUAL"]) expect(sourceHint(t)).toBeNull();
    // Lien que la plateforme n'a pas créé : rien ne ressemble à une panne, l'explication est donnée.
    expect(sourceHint("UNKNOWN")).toMatch(/lien d'invitation qui n'a pas été créé ici/);
  });

  it("résumé des membres de l'onglet : présents, puis partis et exclus s'il y en a", () => {
    expect(membersSummary({ present: 65, left: 12, kicked: 1 })).toBe(
      "65 membres présents · 12 partis · 1 exclu",
    );
    expect(membersSummary({ present: 1, left: 0, kicked: 0 })).toBe("1 membre présent");
    expect(membersSummary({ present: 0, left: 1, kicked: 2 })).toBe(
      "0 membre présent · 1 parti · 2 exclus",
    );
    expect(membersSummary({ present: 1200, left: 0, kicked: 0 })).toBe(
      "1\u202f200 membres présents",
    );
  });

  it("nom d'un membre", () => {
    expect(memberName({ firstName: "Léa", lastName: "M.", username: "lea" })).toBe("Léa M.");
    expect(memberName({ firstName: null, lastName: null, username: "lea" })).toBe("@lea");
    expect(memberName({ firstName: null, lastName: null })).toBe("Membre sans nom");
  });

  it("@nom sous le nom, jamais l'identifiant Telegram brut", () => {
    expect(memberHandle({ firstName: "Léa", lastName: null, username: "lea" })).toBe("@lea");
    // Le nom affiché est déjà le @nom : pas de répétition.
    expect(memberHandle({ firstName: null, lastName: null, username: "lea" })).toBeNull();
    expect(memberHandle({ firstName: "Léa", lastName: null, username: null })).toBeNull();
    expect(memberHandle({ firstName: null, lastName: null, username: null })).toBeNull();
  });

  it("membres suivis (pas le nombre d'abonnés du canal)", () => {
    expect(trackedMembersLabel(0)).toBe("0 membre suivi");
    expect(trackedMembersLabel(1)).toBe("1 membre suivi");
    expect(trackedMembersLabel(1234)).toBe(`${(1234).toLocaleString("fr-FR")} membres suivis`);
  });

  it("libellé de l'onglet pour les lecteurs d'écran", () => {
    expect(requestsTabLabel(3)).toBe("Demandes, 3 en attente");
    expect(requestsTabLabel(0)).toBe("Demandes, aucune en attente");
  });
});

describe("onglet Demandes : filtre par statut et « Tout accepter » (phase 14)", () => {
  it("quatre filtres : Toutes, Attend les canaux, Acceptation programmée, À valider à la main", () => {
    expect(REQUEST_FILTERS.map((f) => f.label)).toEqual([
      "Toutes",
      "Attend les canaux",
      "Acceptation programmée",
      "À valider à la main",
    ]);
    expect(requestFilterStatuses("all")).toEqual([...OPEN_REQUEST_STATUSES]);
    expect(requestFilterStatuses("gate")).toEqual(["PENDING_GATE"]);
    expect(requestFilterStatuses("scheduled")).toEqual(["SCHEDULED"]);
    expect(requestFilterStatuses("manual")).toEqual(["REQUESTED"]);
  });

  it("lit le filtre de l'adresse (inconnu : toutes)", () => {
    expect(parseRequestFilter("gate")).toBe("gate");
    expect(parseRequestFilter(["manual"])).toBe("manual");
    expect(parseRequestFilter("PENDING_GATE")).toBe("all");
    expect(parseRequestFilter(null)).toBe("all");
    expect(parseRequestFilter(undefined)).toBe("all");
  });

  it("compte chaque filtre à partir des nombres par statut (échecs seulement dans « Toutes »)", () => {
    expect(
      requestFilterCounts({ PENDING_GATE: 30, SCHEDULED: 5, REQUESTED: 2, FAILED: 1, APPROVED: 9 }),
    ).toEqual({ all: 38, gate: 30, scheduled: 5, manual: 2 });
    expect(requestFilterCounts({})).toEqual({ all: 0, gate: 0, scheduled: 0, manual: 0 });
  });

  it("adresse d'un filtre : onglet Demandes, sans paramètre pour « Toutes »", () => {
    expect(requestsFilterHref("c 1", "all")).toBe("/channels/c%201?tab=requests");
    expect(requestsFilterHref("c1", "gate")).toBe("/channels/c1?tab=requests&status=gate");
  });

  it("une demande garde-t-elle sa place dans le filtre choisi ?", () => {
    expect(matchesRequestFilter("PENDING_GATE", "all")).toBe(true);
    expect(matchesRequestFilter("FAILED", "all")).toBe(true);
    expect(matchesRequestFilter("FAILED", "gate")).toBe(false);
    expect(matchesRequestFilter("PENDING_GATE", "gate")).toBe(true);
    expect(matchesRequestFilter("SCHEDULED", "manual")).toBe(false);
  });

  it("« Attend les canaux » : acceptée toute seule, ou dès « ✅ J'ai rejoint » (en petit)", () => {
    expect(requestNext("PENDING_GATE", null, now)).toBe(
      "Acceptée toute seule une fois les canaux rejoints",
    );
    expect(requestNextNote("PENDING_GATE")).toBe("ou dès qu'elle appuie sur « ✅ J'ai rejoint »");
    expect(requestNextNote("SCHEDULED")).toBeNull();
    expect(requestNextNote("REQUESTED")).toBeNull();
  });

  it("titre de la liste : nombre de demandes du filtre", () => {
    expect(requestsCountLabel(37, "all")).toBe("37 demandes en cours");
    expect(requestsCountLabel(1, "all")).toBe("1 demande en cours");
    expect(requestsCountLabel(30, "gate")).toBe("30 demandes « Attend les canaux »");
    expect(requestsCountLabel(1, "manual")).toBe("1 demande « À valider à la main »");
    expect(requestsCountLabel(0, "scheduled")).toBe("Aucune demande « Acceptation programmée »");
  });

  it("confirmation de « Tout accepter » avec le nombre, puis le message de retour", () => {
    expect(approveAllConfirm("all", 37)).toEqual({
      title: "Accepter les 37 demandes ?",
      description:
        "Elles entrent dans le canal dans les prochaines minutes, au rythme permis par Telegram. Le bot envoie le message « Accepté » aux personnes à qui il peut encore écrire.",
      confirmLabel: "Tout accepter",
    });
    expect(approveAllConfirm("gate", 1).title).toBe("Accepter la demande « Attend les canaux » ?");
    expect(approveAllConfirm("gate", 30).title).toBe(
      "Accepter les 30 demandes « Attend les canaux » ?",
    );
    expect(approveAllDone(37)).toBe(
      "37 demandes seront acceptées dans les prochaines minutes, au rythme permis par Telegram.",
    );
    expect(approveAllDone(1)).toBe(
      "1 demande sera acceptée dans les prochaines minutes, au rythme permis par Telegram.",
    );
    expect(approveAllDone(0)).toBe("Aucune demande à accepter : la liste a changé entre-temps.");
  });

  it("« Tout accepter » : liste affichée (date et nombre annoncé) relue depuis le formulaire", () => {
    const form = (v: Record<string, string>) => (name: string) => v[name] ?? null;
    const asOf = new Date(now.getTime() - 60_000);
    expect(
      parseApproveAllForm(form({ filter: "gate", asOf: asOf.toISOString(), expected: "37" }), now),
    ).toEqual({ filter: "gate", asOf, expected: 37 });
    // Champs absents ou illisibles : maintenant, sans nombre annoncé ; jamais une date future.
    expect(parseApproveAllForm(form({}), now)).toEqual({
      filter: "all",
      asOf: now,
      expected: null,
    });
    expect(parseApproveAllForm(form({ asOf: "pas une date", expected: "-2" }), now)).toEqual({
      filter: "all",
      asOf: now,
      expected: null,
    });
    expect(
      parseApproveAllForm(form({ asOf: new Date(now.getTime() + 3_600_000).toISOString() }), now)
        .asOf,
    ).toEqual(now);
  });

  it("« Tout accepter » : refusé si la liste a grossi depuis l'affichage, jamais plus que le nombre annoncé", () => {
    expect(approveAllListGrew(38, 37)).toBe(true);
    expect(approveAllListGrew(37, 37)).toBe(false);
    // Moins de demandes (acceptées entre-temps) : on accepte celles qui restent.
    expect(approveAllListGrew(30, 37)).toBe(false);
    expect(approveAllListGrew(5, null)).toBe(false);
    expect(APPROVE_ALL_LIST_CHANGED).toBe(
      "La liste a changé depuis l'affichage : vérifiez les demandes, puis cliquez à nouveau « Tout accepter ».",
    );
  });
});

describe("« Tout accepter » : jamais de demande bloquée sur « Acceptation en cours »", () => {
  it("heure de secours : le passage des 20 secondes rattrape une acceptation qui n'a pas abouti", () => {
    expect(APPROVE_ALL_FALLBACK_MS).toBe(10 * 60_000);
    expect(approveAllFallbackAt(now)).toEqual(inS(600));
  });

  it("identifiant de tâche : le même pour un double envoi du formulaire, un nouveau à chaque nouveau clic", () => {
    const shownAt = new Date(now.getTime() - 60_000);
    expect(approveJobId("m1", shownAt)).toBe(`approve:m1:${shownAt.getTime()}`);
    expect(approveJobId("m1", shownAt)).toBe(approveJobId("m1", new Date(shownAt)));
    // Nouveau clic (liste réaffichée après le premier) : une nouvelle tâche, jamais ignorée par la file.
    expect(approveJobId("m1", now)).not.toBe(approveJobId("m1", shownAt));
  });

  it("marque « Tout accepter » : la carte dit « Acceptation en cours », sans heure prévue", () => {
    const fallbackAt = approveAllFallbackAt(now);
    const mark = approveAllMark(now, "u1");
    expect(mark).toEqual({
      at: now.toISOString(),
      byUserId: "u1",
      fallbackAt: fallbackAt.toISOString(),
    });
    const queued = {
      status: "SCHEDULED" as const,
      approveAt: fallbackAt,
      source: { approveAll: mark },
    };
    expect(isQueuedForApproval(queued)).toBe(true);
    // File indisponible : programmée pour maintenant, toujours en cours d'acceptation.
    expect(isQueuedForApproval({ ...queued, approveAt: now })).toBe(true);
    // Reprogrammée depuis (autre heure, plus tard que l'heure de secours) : de nouveau une acceptation programmée.
    expect(isQueuedForApproval({ ...queued, approveAt: inS(3600) })).toBe(false);
    // Acceptée, refusée… : plus en cours.
    expect(isQueuedForApproval({ ...queued, status: "FAILED" })).toBe(false);
    // Acceptation programmée par la règle : pas de marque.
    expect(isQueuedForApproval({ status: "SCHEDULED", approveAt: inS(600), source: {} })).toBe(
      false,
    );
    expect(isQueuedForApproval({ status: "SCHEDULED", approveAt: inS(600), source: null })).toBe(
      false,
    );
    expect(requestNext("SCHEDULED", fallbackAt, now, true)).toBe("Acceptation en cours");
    expect(requestNext("SCHEDULED", fallbackAt, now, false)).toBe("Acceptée dans 10 min");
  });
});

describe("filtre de l'onglet Demandes au-delà des demandes montrées", () => {
  const counts = (over: Partial<Record<RequestFilter, number>>): Record<RequestFilter, number> => ({
    all: 0,
    gate: 0,
    scheduled: 0,
    manual: 0,
    ...over,
  });

  it("filtres à compléter : ceux dont les demandes les plus récentes ne sont pas toutes montrées", () => {
    // 3 demandes montrées (les plus récentes, toutes « Attend les canaux ») sur 5 ; les 2 à valider sont plus anciennes.
    expect(
      requestFiltersToTopUp(
        ["PENDING_GATE", "PENDING_GATE", "PENDING_GATE"],
        counts({ all: 5, gate: 3, manual: 2 }),
        3,
      ),
    ).toEqual(["manual"]);
    // Tout est montré : rien à relire.
    expect(
      requestFiltersToTopUp(
        ["PENDING_GATE", "REQUESTED"],
        counts({ all: 2, gate: 1, manual: 1 }),
        3,
      ),
    ).toEqual([]);
    // Un filtre plus long que la limite : complété jusqu'à la limite seulement s'il en manque.
    expect(
      requestFiltersToTopUp(
        ["SCHEDULED", "SCHEDULED", "PENDING_GATE"],
        counts({ all: 9, gate: 1, scheduled: 8 }),
        3,
      ),
    ).toEqual(["scheduled"]);
    expect(
      requestFiltersToTopUp(
        ["SCHEDULED", "SCHEDULED", "SCHEDULED"],
        counts({ all: 9, gate: 1, scheduled: 8 }),
        3,
      ),
    ).toEqual(["gate"]);
  });

  it("cartes d'un filtre : les plus récentes du filtre, jamais plus que la limite", () => {
    const items = [
      { id: "g1", status: "PENDING_GATE" as const },
      { id: "g2", status: "PENDING_GATE" as const },
      { id: "s1", status: "SCHEDULED" as const },
      { id: "r1", status: "REQUESTED" as const },
      { id: "r2", status: "REQUESTED" as const },
    ];
    expect(visibleRequests(items, "all", 3).map((r) => r.id)).toEqual(["g1", "g2", "s1"]);
    expect(visibleRequests(items, "manual", 3).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(visibleRequests(items, "manual", 1).map((r) => r.id)).toEqual(["r1"]);
    expect(REQUESTS_SHOWN_MAX).toBe(200);
  });
});
