/**
 * Journal : la vue « Événements » a sa propre adresse (`/journal/events`). Sans paramètre `view` dans l'adresse, les
 * filtres mémorisés (RememberFilters) reviennent et « Réinitialiser » reste sur cette vue ; l'ancienne adresse
 * `/journal?view=events` y renvoie en gardant les filtres.
 */
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/journal/events",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    event: { count: async () => 0, findMany: async () => [] },
    channel: { findMany: async () => [] },
    bot: { findMany: async () => [] },
  },
}));

import JournalPage from "./page";
import JournalEventsPage from "./events/page";

type Props = Record<string, unknown> & { children?: ReactNode };

/** Parcourt l'arbre d'éléments rendu par la page (sans exécuter les sous-composants). */
function collect(node: ReactNode, out: Props[] = []): Props[] {
  if (Array.isArray(node)) for (const n of node) collect(n, out);
  else if (isValidElement(node)) {
    const props = node.props as Props;
    out.push({ ...props, __type: node.type });
    collect(props.children, out);
  }
  return out;
}

describe("Journal → Événements", () => {
  it("l'ancienne adresse /journal?view=events renvoie vers /journal/events avec les filtres", async () => {
    await expect(
      JournalPage({
        searchParams: Promise.resolve({ view: "events", type: "telegram.", channelId: "c1" }),
      } as never),
    ).rejects.toMatchObject({ url: "/journal/events?type=telegram.&channelId=c1" });
    await expect(
      JournalPage({ searchParams: Promise.resolve({ view: "events" }) } as never),
    ).rejects.toMatchObject({ url: "/journal/events" });
  });

  it("le formulaire de la vue n'ajoute pas de paramètre « view » et la pagination reste sur /journal/events", async () => {
    const tree = await JournalEventsPage({
      searchParams: Promise.resolve({ type: "telegram." }),
    } as never);
    const nodes = collect(tree as ReactNode);
    expect(nodes.some((p) => p.name === "view")).toBe(false);
    const pagination = nodes.find((p) => typeof p.hrefFor === "function");
    expect((pagination?.hrefFor as (n: number) => string)(2)).toBe(
      "/journal/events?type=telegram.&page=2",
    );
    expect(nodes.some((p) => p.storageKey === "journal-events")).toBe(true);
  });
});
