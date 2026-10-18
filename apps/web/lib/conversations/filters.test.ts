import { describe, expect, it } from "vitest";
import {
  activeInboxFilterCount,
  clearedInboxFilters,
  hasInboxFilters,
  inboxExportHref,
  inboxHref,
  parseInboxFilters,
} from "./filters";
import { NONE_KEY } from "./labels";

describe("filtres de la boîte de réception", () => {
  it("lecture tolérante : valeurs inconnues ignorées", () => {
    expect(
      parseInboxFilters({
        stage: "LINK_SENT",
        status: "HUMAN",
        source: "tk01",
        persona: "clpersona0001",
        unread: "1",
        page: "3",
      }),
    ).toEqual({
      stage: "LINK_SENT",
      status: "HUMAN",
      source: "tk01",
      persona: "clpersona0001",
      unread: true,
      page: 3,
    });
    expect(
      parseInboxFilters({
        stage: "BIDON",
        status: "x",
        source: "pas une source !",
        persona: "<script>",
        unread: "0",
        page: "-2",
      }),
    ).toEqual(clearedInboxFilters());
    expect(parseInboxFilters({ stage: ["CHAT", "WELCOME"] }).stage).toBe("CHAT");
  });

  it("« Sans source » et « Sans persona »", () => {
    const f = parseInboxFilters({ source: NONE_KEY, persona: NONE_KEY });
    expect(f.source).toBe(NONE_KEY);
    expect(f.persona).toBe(NONE_KEY);
  });

  it("nombre de filtres posés (la page n'en est pas un)", () => {
    expect(activeInboxFilterCount(clearedInboxFilters())).toBe(0);
    expect(hasInboxFilters({ ...clearedInboxFilters(), page: 4 })).toBe(false);
    expect(activeInboxFilterCount(parseInboxFilters({ stage: "CHAT", unread: "1" }))).toBe(2);
  });

  it("liens : les autres filtres gardés, retour page 1 à chaque changement de filtre", () => {
    const f = parseInboxFilters({ stage: "CHAT", source: "tk01", page: "3" });
    expect(inboxHref(f, { unread: true })).toBe("/conversations?stage=CHAT&source=tk01&unread=1");
    expect(inboxHref(f, { page: 2 })).toBe("/conversations?stage=CHAT&source=tk01&page=2");
    // Toute la liste : jamais l'adresse nue (les filtres mémorisés y reviendraient).
    expect(inboxHref(f, clearedInboxFilters())).toBe("/conversations?stage=");
    expect(parseInboxFilters({ stage: "" })).toEqual(clearedInboxFilters());
    expect(inboxHref(f, { source: NONE_KEY })).toBe("/conversations?stage=CHAT&source=%7E");
  });

  it("export : mêmes filtres, sans la page", () => {
    const f = parseInboxFilters({ status: "HUMAN", page: "5" });
    expect(inboxExportHref(f)).toBe("/api/conversations/export?status=HUMAN");
    expect(inboxExportHref(clearedInboxFilters())).toBe("/api/conversations/export");
  });
});
