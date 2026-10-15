/** Phase 14 : accueils par défaut réécrits sans « puis appuie sur ✅ J'ai rejoint » (jamais un texte de l'équipe). */
import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {}, toJsonValue: (v: unknown) => v }));

import { defaultSequenceText } from "./defaults";
import {
  PHASE13_JOIN_REQUEST_TEXTS,
  PHASE14_TEXTS_ACTION,
  rewriteDefaultJoinRequestTexts,
  rewrittenJoinRequestTexts,
} from "./phase14-texts";
import { mentionsRequiredStep } from "../join-flow/texts";

const step = (texts: unknown, over: { buttons?: unknown; mediaAssetId?: string | null } = {}) => ({
  texts,
  buttons: over.buttons ?? [],
  mediaAssetId: over.mediaAssetId ?? null,
});

describe("accueils par défaut d'avant la phase 14", () => {
  it("texte d'origine exact (chaque univers) → nouveau texte du même univers, sans étape obligatoire", () => {
    for (const v of ["CASINO", "SPORTS", "DATING"] as const) {
      const next = rewrittenJoinRequestTexts(step({ fr: PHASE13_JOIN_REQUEST_TEXTS[v] }));
      expect(next).toEqual({ fr: defaultSequenceText(v, "JOIN_REQUEST") });
      expect(mentionsRequiredStep(next!.fr)).toBe(false);
      expect(mentionsRequiredStep(PHASE13_JOIN_REQUEST_TEXTS[v])).toBe(true);
    }
    expect(rewrittenJoinRequestTexts(step({ fr: PHASE13_JOIN_REQUEST_TEXTS.DEFAULT }))).toEqual({
      fr: defaultSequenceText(null, "JOIN_REQUEST"),
    });
  });

  it("jamais un accueil touché par l'équipe : texte modifié, traduction, bouton, média, ou nouveau texte", () => {
    const old = PHASE13_JOIN_REQUEST_TEXTS.DATING;
    expect(rewrittenJoinRequestTexts(step({ fr: `${old} ` }))).toBeNull();
    expect(rewrittenJoinRequestTexts(step({ fr: old, en: "Hi {prenom}" }))).toBeNull();
    expect(
      rewrittenJoinRequestTexts(step({ fr: old }, { buttons: [{ text: "x", url: "y" }] })),
    ).toBeNull();
    expect(rewrittenJoinRequestTexts(step({ fr: old }, { mediaAssetId: "media1" }))).toBeNull();
    expect(
      rewrittenJoinRequestTexts(step({ fr: defaultSequenceText("DATING", "JOIN_REQUEST") })),
    ).toBeNull();
    expect(rewrittenJoinRequestTexts(step(null))).toBeNull();
  });

  it("réécriture conditionnée au texte d'origine, résumé au journal, relançable sans effet", async () => {
    const rows = [
      { id: "s1", ...step({ fr: PHASE13_JOIN_REQUEST_TEXTS.CASINO }) },
      { id: "s2", ...step({ fr: "Bienvenue chez nous, rejoins les canaux puis J'ai rejoint" }) },
      { id: "s3", ...step({ fr: defaultSequenceText("SPORTS", "JOIN_REQUEST") }) },
      // Modifié par l'équipe pendant le passage : la mise à jour conditionnée ne passe pas.
      { id: "s4", ...step({ fr: PHASE13_JOIN_REQUEST_TEXTS.SPORTS }) },
    ];
    const audits: unknown[] = [];
    const db = {
      sequenceStep: {
        findMany: vi.fn(async () => rows.map((r) => ({ ...r }))),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; texts: { equals: unknown } };
            data: { texts: unknown };
          }) => {
            const r = rows.find((x) => x.id === where.id)!;
            if (r.id === "s4") r.texts = { fr: "Texte de l'équipe" };
            if (JSON.stringify(r.texts) !== JSON.stringify(where.texts.equals)) return { count: 0 };
            r.texts = data.texts;
            return { count: 1 };
          },
        ),
      },
      auditLog: {
        create: vi.fn(async (a: unknown) => {
          audits.push(a);
          return a;
        }),
      },
    };
    const report = await rewriteDefaultJoinRequestTexts(db as never);
    expect(report).toEqual({ updated: 1, upToDate: 1, keptByTeam: 2 });
    expect(rows[0]!.texts).toEqual({ fr: defaultSequenceText("CASINO", "JOIN_REQUEST") });
    expect(rows[1]!.texts).toEqual({
      fr: "Bienvenue chez nous, rejoins les canaux puis J'ai rejoint",
    });
    expect(rows[3]!.texts).toEqual({ fr: "Texte de l'équipe" });
    expect(audits).toEqual([
      {
        data: expect.objectContaining({
          action: PHASE14_TEXTS_ACTION,
          metadata: expect.objectContaining({ updated: 1, sequenceStepIds: ["s1"] }),
        }),
      },
    ]);
    const again = await rewriteDefaultJoinRequestTexts(db as never);
    expect(again).toEqual({ updated: 0, upToDate: 2, keptByTeam: 2 });
    expect(audits).toHaveLength(1);
  });
});
