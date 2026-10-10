import { describe, expect, it } from "vitest";
import { fmtNum } from "@/lib/format";
import { parseSegmentForm } from "./schema";
import {
  CRITERIA,
  GROUP_QUESTIONS,
  activeCriteria,
  countLines,
  countSentence,
  describeGroup,
  groupCriteriaCount,
  joinAnd,
  joinOr,
  membersPhrase,
  openCriteria,
  pendingCriteria,
  pendingCriterionError,
  pendingSentence,
  reachableSentence,
  segmentFormFields,
  segmentFromSearchParams,
  splitTags,
  toggleValue,
  withInactiveDays,
  withoutCriterion,
} from "./group";

const names = {
  channels: { c1: "Casino VIP", c2: "Casino FR", c3: "Foot", c4: "Rencontres" },
  campaigns: { k1: "Casino octobre" },
  inviteLinks: { l1: "Vidéo bonus" },
  categories: { cat1: "Bonus" },
};

describe("groupe de membres en une phrase", () => {
  it("sans critère : tous les membres", () => {
    expect(describeGroup({})).toBe("Tous les membres");
    expect(groupCriteriaCount({})).toBe(0);
  });

  it("un canal, un niveau, rien fait depuis 7 jours", () => {
    expect(
      describeGroup({ channelIds: ["c1"], spendLevels: ["VIP"], inactiveDays: 7 }, names),
    ).toBe(
      "Membres du canal «\u00a0Casino VIP\u00a0», de niveau «\u00a0VIP\u00a0» et qui n'ont rien fait depuis 7 jours",
    );
  });

  it("plusieurs canaux : «\u00a0ou\u00a0», puis «\u00a0et N autres\u00a0» au-delà de 3", () => {
    expect(describeGroup({ channelIds: ["c1", "c2"] }, names)).toBe(
      "Membres des canaux «\u00a0Casino VIP\u00a0» ou «\u00a0Casino FR\u00a0»",
    );
    expect(describeGroup({ channelIds: ["c1", "c2", "c3", "c4"] }, names)).toBe(
      "Membres des canaux «\u00a0Casino VIP\u00a0», «\u00a0Casino FR\u00a0», «\u00a0Foot\u00a0» ou 1 autre",
    );
  });

  it("toutes les questions, dans l'ordre et en mots simples", () => {
    const s = describeGroup(
      {
        channelIds: ["c1"],
        campaignIds: ["k1"],
        inviteLinkIds: ["l1"],
        membershipStatuses: ["APPROVED", "LEFT"],
        spendLevels: ["DEPOSANT", "VIP"],
        clickedCategoryIds: ["cat1"],
        inactiveDays: 1,
        languages: ["fr", "en"],
        tags: ["Gros joueur"],
      },
      names,
    );
    expect(s).toBe(
      "Membres du canal «\u00a0Casino VIP\u00a0», venus de la campagne «\u00a0Casino octobre\u00a0», venus de la pub «\u00a0Vidéo bonus\u00a0», " +
        "au statut «\u00a0Accepté\u00a0» ou «\u00a0Parti\u00a0», de niveau «\u00a0Déposant\u00a0» ou «\u00a0VIP\u00a0», qui ont cliqué un message «\u00a0Bonus\u00a0», " +
        "qui n'ont rien fait depuis 1 jour, qui parlent français ou anglais et avec l'étiquette «\u00a0Gros joueur\u00a0»",
    );
  });

  it("identifiant inconnu : «\u00a0introuvable\u00a0» plutôt que l'identifiant technique", () => {
    expect(describeGroup({ campaignIds: ["zz"] }, names)).toBe(
      "Membres venus de la campagne «\u00a0introuvable\u00a0»",
    );
  });

  it("jointures et phrases du compteur", () => {
    expect(joinOr(["a"])).toBe("a");
    expect(joinOr(["a", "b", "c"])).toBe("a, b ou c");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b et c");
    expect(membersPhrase(0)).toBe("aucun membre");
    expect(membersPhrase(1)).toBe("1 membre");
    expect(countSentence(1240)).toBe(`${membersPhrase(1240)} recevront ce message.`);
    expect(countSentence(1240)).toMatch(/^1\s240 membres recevront ce message\.$/u);
    expect(countSentence(1)).toBe("1 membre recevra ce message.");
    expect(countSentence(0)).toBe("Aucun membre ne recevrait ce message pour l'instant.");
    expect(countSentence(null)).toBe("Nombre de membres indisponible pour l'instant.");
    expect(reachableSentence("casino_bot")).toBe(
      "Seuls ceux qui peuvent recevoir un message privé de @casino_bot le recevront.",
    );
  });
});

describe("compteur compact (téléphone, en bas de l'écran)", () => {
  it("le nombre en gras, puis la fin de la phrase accordée", () => {
    expect(countLines(75)).toEqual({ figure: "75 membres", rest: "recevront ce message" });
    expect(countLines(1240).figure).toBe(`${fmtNum(1240)} membres`);
    expect(countLines(1)).toEqual({ figure: "1 membre", rest: "recevra ce message" });
    expect(countLines(0)).toEqual({ figure: "Aucun membre", rest: "ne recevrait ce message" });
    expect(countLines(null)).toEqual({ figure: "—", rest: "nombre indisponible pour l'instant" });
  });
});

describe("groupe préparé par la liste des membres", () => {
  it("lit les paramètres de broadcastLink (listes répétées), garde seulement les valeurs connues", () => {
    const r = segmentFromSearchParams(
      {
        channelIds: ["c1", "inconnu"],
        membershipStatuses: "APPROVED",
        spendLevels: ["DEPOSANT", "REGULIER", "VIP", "PIRATE"],
        campaignIds: "k1",
        inviteLinkIds: "l1",
        languages: "FR",
        inactiveDays: "30",
        tags: "Gros joueur",
      },
      { channelIds: ["c1", "c2"], campaignIds: ["k1"], inviteLinkIds: ["l1"] },
    );
    expect(r.segment).toEqual({
      channelIds: ["c1"],
      membershipStatuses: ["APPROVED"],
      spendLevels: ["DEPOSANT", "REGULIER", "VIP"],
      inviteLinkIds: ["l1"],
      campaignIds: ["k1"],
      languages: ["fr"],
      inactiveDays: 30,
      tags: ["Gros joueur"],
    });
    expect(r.dropped).toBe(2);
    expect(r.carried).toBe(true);
  });

  it("adresse sans paramètre : groupe vide", () => {
    expect(segmentFromSearchParams({})).toEqual({ segment: {}, dropped: 0, carried: false });
    expect(segmentFromSearchParams({ inactiveDays: "zéro" }).segment).toEqual({});
  });

  it("champs du formulaire : relus à l'identique par le serveur (étiquette avec une espace comprise)", () => {
    const segment = {
      channelIds: ["c1", "c2"],
      membershipStatuses: ["APPROVED"],
      spendLevels: ["VIP" as const],
      campaignIds: ["k1"],
      clickedCategoryIds: ["cat1"],
      languages: ["fr", "en"],
      inactiveDays: 14,
      tags: ["Gros joueur", "vip"],
    };
    const fd = new FormData();
    for (const [k, v] of segmentFormFields(segment)) fd.append(k, v);
    expect(parseSegmentForm(fd)).toEqual(segment);
    const empty = new FormData();
    for (const [k, v] of segmentFormFields({})) empty.append(k, v);
    expect(parseSegmentForm(empty)).toEqual({});
  });
});

describe("critères du groupe (étape «\u00a0Qui\u00a0»)", () => {
  it("chaque critère du Segment est rangé sous une question, avec un libellé et une aide", () => {
    const keys = GROUP_QUESTIONS.flatMap((q) => q.keys).sort();
    expect(keys).toEqual(Object.keys(CRITERIA).sort());
    expect(keys).toHaveLength(9);
    for (const c of Object.values(CRITERIA)) {
      expect(c.add).not.toMatch(/segment/i);
      expect(c.help.endsWith(".")).toBe(true);
    }
  });

  it("critères actifs, ajout et retrait de valeurs", () => {
    let s = toggleValue({}, "channelIds", "c1", true);
    s = toggleValue(s, "channelIds", "c1", true);
    s = toggleValue(s, "spendLevels", "VIP", true);
    s = withInactiveDays(s, 7);
    expect(s).toEqual({ channelIds: ["c1"], spendLevels: ["VIP"], inactiveDays: 7 });
    expect(activeCriteria(s)).toEqual(["channelIds", "spendLevels", "inactiveDays"]);
    s = toggleValue(s, "channelIds", "c1", false);
    expect(s).toEqual({ spendLevels: ["VIP"], inactiveDays: 7 });
    expect(withInactiveDays(s, null)).toEqual({ spendLevels: ["VIP"] });
    expect(withoutCriterion(s, "spendLevels")).toEqual({ inactiveDays: 7 });
    expect(activeCriteria({})).toEqual([]);
  });

  it("blocs ouverts : ceux qui ont une valeur et ceux ajoutés, dans l'ordre des questions", () => {
    expect(openCriteria([], {})).toEqual([]);
    expect(openCriteria(["languages", "inactiveDays"], { channelIds: ["c1"] })).toEqual([
      "channelIds",
      "inactiveDays",
      "languages",
    ]);
    // Pas de doublon quand un critère ajouté reçoit une valeur.
    expect(openCriteria(["channelIds"], { channelIds: ["c1"] })).toEqual(["channelIds"]);
  });

  it("critère ouvert sans valeur : signalé, il ne compte pas dans le groupe", () => {
    const s = { channelIds: ["c1"] };
    expect(pendingCriteria(["inactiveDays", "languages", "channelIds"], s)).toEqual([
      "inactiveDays",
      "languages",
    ]);
    expect(pendingCriteria(["channelIds"], s)).toEqual([]);
    expect(pendingCriteria([], {})).toEqual([]);
    // Le groupe envoyé et sa phrase ignorent les blocs vides : d'où l'avertissement.
    expect(describeGroup(s, names)).toBe("Membres du canal «\u00a0Casino VIP\u00a0»");
  });

  it("message de chaque critère pas encore réglé (une consigne, puis « ou retirez ce critère »)", () => {
    expect(pendingCriterionError("inactiveDays")).toBe(
      "«\u00a0Rien fait depuis\u00a0» : choisissez une durée, ou retirez ce critère.",
    );
    expect(pendingCriterionError("languages")).toBe(
      "«\u00a0Langue de leur Telegram\u00a0» : cochez au moins une langue, ou retirez ce critère.",
    );
    expect(pendingCriterionError("membershipStatuses")).toBe(
      "«\u00a0Statut dans le canal\u00a0» : cochez au moins un statut, ou retirez ce critère.",
    );
    for (const key of GROUP_QUESTIONS.flatMap((q) => q.keys)) {
      expect(CRITERIA[key].missing).toMatch(/^(cochez|choisissez|écrivez) /);
      expect(pendingCriterionError(key)).toMatch(/, ou retirez ce critère\.$/);
    }
  });

  it("phrase des critères pas encore réglés (récapitulatif du groupe)", () => {
    expect(pendingSentence(0)).toBeNull();
    expect(pendingSentence(1)).toBe("Un critère n'est pas encore réglé : il ne compte pas.");
    expect(pendingSentence(2)).toBe("2 critères ne sont pas encore réglés : ils ne comptent pas.");
  });
});

describe("étiquettes saisies", () => {
  it("virgules dès qu'il y en a une (étiquette avec une espace), espaces sinon (comme avant)", () => {
    expect(splitTags("vip test")).toEqual(["vip", "test"]);
    expect(splitTags("Gros joueur,")).toEqual(["Gros joueur"]);
    expect(splitTags(" Gros   joueur , vip,")).toEqual(["Gros joueur", "vip"]);
    expect(splitTags("")).toEqual([]);
  });
});
