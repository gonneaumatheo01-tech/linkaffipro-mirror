import { describe, expect, expectTypeOf, it } from "vitest";
import { PRISMA_OPTIONS, type Db } from "./client";

// Phase 15 : la petite photo d'un canal (octets JPEG, `Channel.photoSmall`) n'est lue que par le cache des pages
// d'atterrissage et la route de la photo, toujours avec `select: { photoSmall: true }`. Aucune autre requête de canal
// (liste, fiche, création d'un lien…) ne la transfère.
describe("client Prisma partagé : colonnes lourdes omises par défaut", () => {
  it("Channel.photoSmall est omise de toute requête qui ne la demande pas", () => {
    expect(PRISMA_OPTIONS.omit.channel.photoSmall).toBe(true);
    type Row = NonNullable<Awaited<ReturnType<Db["channel"]["findFirst"]>>>;
    expectTypeOf<Row>().not.toHaveProperty("photoSmall");
    expectTypeOf<Row>().toHaveProperty("title");
  });
});
