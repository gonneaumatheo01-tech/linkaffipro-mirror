import { describe, expect, it } from "vitest";
import {
  DELAY_PRESETS,
  MAX_REMINDER_MINUTES,
  NO_RULE_SENTENCE,
  REMINDER_PRESETS,
  REMINDER_UNITS,
  advancedModifiedCount,
  channelList,
  chooseEntry,
  customReminderMinutes,
  delayFromParts,
  delayLabel,
  effectiveDelay,
  entryFormFields,
  entryProblem,
  entryRuleFromRow,
  entrySentence,
  entryShort,
  expirationSentence,
  gateChannelChoices,
  initialEntryState,
  parseReminders,
  presetForSeconds,
  reminderChips,
  remindersSentence,
  ruleFromState,
  splitDelay,
  stateDelaySeconds,
  toggleReminder,
  type EntryRule,
} from "./entry-rule";

const base: EntryRule = {
  mode: "DELAY",
  delaySeconds: 600,
  gateMode: "NONE",
  gateChannelIds: [],
  reminderAfterMinutes: [60, 1440],
  maxReminders: 2,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
  isActive: true,
};
const titles = { a: "Bonus du jour", b: "Preuves de gains", c: "VIP", d: "Live" };

/** Champs du formulaire regroupés par nom (`gateChannelIds` peut revenir plusieurs fois). */
function fieldsOf(state: Parameters<typeof entryFormFields>[0]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of entryFormFields(state)) (out[k] ??= []).push(v);
  return out;
}

describe("délais", () => {
  it("les délais proposés sont ceux que comprend l'action serveur", () => {
    expect(Object.fromEntries(DELAY_PRESETS.map((p) => [p.key, p.seconds]))).toEqual({
      immediate: 0,
      "1m": 60,
      "10m": 600,
      "1h": 3600,
      "1d": 86400,
      "2d": 172800,
    });
    expect(presetForSeconds(600)).toBe("10m");
    expect(presetForSeconds(90)).toBe("custom");
  });

  it("découpe une durée dans l'unité la plus lisible", () => {
    expect(splitDelay(5400)).toEqual({ amount: 90, unit: "minutes" });
    expect(splitDelay(7200)).toEqual({ amount: 2, unit: "hours" });
    expect(splitDelay(3 * 86400)).toEqual({ amount: 3, unit: "days" });
    expect(splitDelay(45)).toEqual({ amount: 45, unit: "seconds" });
    expect(splitDelay(0)).toEqual({ amount: 0, unit: "seconds" });
    expect(delayFromParts(90, "minutes")).toBe(5400);
    expect(delayFromParts(-3, "hours")).toBe(0);
    expect(delayFromParts(Number.NaN, "days")).toBe(0);
  });

  it("écrit une durée en français", () => {
    expect(delayLabel(60)).toBe("1 minute");
    expect(delayLabel(600)).toBe("10 minutes");
    expect(delayLabel(3600)).toBe("1 heure");
    expect(delayLabel(172800)).toBe("2 jours");
    expect(delayLabel(90)).toBe("90 secondes");
    expect(delayLabel(1)).toBe("1 seconde");
  });

  it("le mode « Immédiat » ignore le délai enregistré", () => {
    expect(effectiveDelay({ mode: "IMMEDIATE", delaySeconds: 600 })).toBe(0);
    expect(effectiveDelay({ mode: "DELAY", delaySeconds: 600 })).toBe(600);
  });
});

describe("choix principal ↔ champs de la règle", () => {
  it("sans règle : « Après un délai » de 10 minutes, réglages par défaut", () => {
    const s = initialEntryState(null);
    expect(s.choice).toBe("delay");
    expect(s.delayPreset).toBe("10m");
    expect(s.manual).toBe(false);
    expect(advancedModifiedCount(s)).toBe(0);
    expect(fieldsOf(s)).toEqual({
      mode: ["DELAY"],
      delayPreset: ["10m"],
      delayCustomSeconds: [""],
      gateMode: ["NONE"],
      reminderAfterMinutes: ["60, 1440"],
      maxReminders: ["2"],
      expireAfterHours: ["0"],
      expireAction: ["KEEP"],
      sendAcceptedMessage: ["on"],
    });
  });

  it("« Tout de suite » envoie le mode Immédiat, sans délai ni canaux", () => {
    const s = chooseEntry({ ...initialEntryState(null), gateIds: ["a"] }, "now");
    const f = fieldsOf(s);
    expect(f.mode).toEqual(["IMMEDIATE"]);
    expect(f.delayPreset).toEqual(["immediate"]);
    expect(f.gateMode).toEqual(["NONE"]);
    expect(f.gateChannelIds).toBeUndefined();
    expect(stateDelaySeconds(s)).toBe(0);
  });

  it("« Après un délai » : délai proposé ou autre durée en secondes", () => {
    const s = { ...initialEntryState(null), delayPreset: "1h" as const };
    expect(fieldsOf(s).delayPreset).toEqual(["1h"]);
    const custom = {
      ...s,
      delayPreset: "custom" as const,
      customAmount: 90,
      customUnit: "minutes" as const,
    };
    expect(fieldsOf(custom).delayPreset).toEqual(["custom"]);
    expect(fieldsOf(custom).delayCustomSeconds).toEqual(["5400"]);
    expect(stateDelaySeconds(custom)).toBe(5400);
  });

  it("« Après un délai » depuis « Tout de suite » repart sur 10 minutes", () => {
    const now = initialEntryState({ ...base, mode: "IMMEDIATE", delaySeconds: 0 });
    expect(now.choice).toBe("now");
    const delay = chooseEntry({ ...now, delayPreset: "immediate" }, "delay");
    expect(delay.delayPreset).toBe("10m");
  });

  it("« Après avoir rejoint ces canaux » envoie les canaux et l'exigence", () => {
    const s = {
      ...chooseEntry(initialEntryState(null), "gate"),
      gateIds: ["a", "b"],
      gateMode: "SOFT" as const,
      delayPreset: "immediate" as const,
    };
    const f = fieldsOf(s);
    expect(f.mode).toEqual(["DELAY"]);
    expect(f.delayPreset).toEqual(["immediate"]);
    expect(f.gateMode).toEqual(["SOFT"]);
    expect(f.gateChannelIds).toEqual(["a", "b"]);
  });

  it("la validation à la main passe le mode à « Validation manuelle » quel que soit le choix", () => {
    for (const choice of ["now", "delay", "gate"] as const) {
      const s = { ...initialEntryState(null), choice, manual: true, gateIds: ["a"] };
      expect(fieldsOf(s).mode).toEqual(["MANUAL"]);
    }
  });

  it("le message « accepté » décoché n'envoie pas la case", () => {
    const s = { ...initialEntryState(null), sendAcceptedMessage: false };
    expect(fieldsOf(s).sendAcceptedMessage).toBeUndefined();
    expect(advancedModifiedCount(s)).toBe(1);
  });

  it("relit une règle enregistrée puis la renvoie à l'identique", () => {
    const cases: EntryRule[] = [
      { ...base, mode: "IMMEDIATE", delaySeconds: 0 },
      { ...base, delaySeconds: 600 },
      { ...base, delaySeconds: 5400 },
      { ...base, mode: "MANUAL", delaySeconds: 0 },
      { ...base, gateMode: "REQUIRED", gateChannelIds: ["a", "b"], delaySeconds: 0 },
      {
        ...base,
        gateMode: "SOFT",
        gateChannelIds: ["c"],
        delaySeconds: 3600,
        reminderAfterMinutes: [30],
        maxReminders: 1,
        expireAfterHours: 48,
        expireAction: "DECLINE",
        sendAcceptedMessage: false,
      },
    ];
    for (const rule of cases) {
      const back = ruleFromState(initialEntryState(rule));
      expect({ ...back, delaySeconds: effectiveDelay(back) }).toEqual({
        ...rule,
        isActive: undefined,
        delaySeconds: effectiveDelay(rule),
        mode: rule.mode === "IMMEDIATE" ? "IMMEDIATE" : rule.mode,
      });
    }
  });

  it("une règle « Immédiat » avec des canaux devient « Après avoir rejoint » sans délai", () => {
    const s = initialEntryState({
      ...base,
      mode: "IMMEDIATE",
      delaySeconds: 600,
      gateMode: "REQUIRED",
      gateChannelIds: ["a"],
    });
    expect(s.choice).toBe("gate");
    expect(s.delayPreset).toBe("immediate");
    expect(fieldsOf(s).mode).toEqual(["DELAY"]);
  });

  it("des canaux enregistrés sans exigence ne comptent pas comme « Après avoir rejoint »", () => {
    const s = initialEntryState({ ...base, gateMode: "NONE", gateChannelIds: ["a"] });
    expect(s.choice).toBe("delay");
    expect(s.gateIds).toEqual([]);
  });
});

describe("contrôles avant d'enregistrer", () => {
  it("demande au moins un canal pour le troisième choix", () => {
    const s = chooseEntry(initialEntryState(null), "gate");
    expect(entryProblem(s)).toMatch(/au moins un canal/);
    expect(entryProblem({ ...s, gateIds: ["a"] })).toBeNull();
  });

  it("refuse une autre durée nulle ou au-delà de 30 jours", () => {
    const s = {
      ...initialEntryState(null),
      delayPreset: "custom" as const,
      customUnit: "days" as const,
    };
    expect(entryProblem({ ...s, customAmount: 0 })).toMatch(/supérieure à zéro/);
    expect(entryProblem({ ...s, customAmount: 31 })).toMatch(/30 jours/);
    expect(entryProblem({ ...s, customAmount: 30 })).toBeNull();
  });

  it("borne les rappels et l'expiration comme l'action serveur", () => {
    const s = initialEntryState(null);
    expect(entryProblem({ ...s, maxReminders: 11 })).toMatch(/0 et 10/);
    expect(entryProblem({ ...s, expireAfterHours: 2000 })).toMatch(/1 440/);
    expect(entryProblem({ ...s, expireAfterHours: 1.5 })).toMatch(/1 440/);
  });
});

describe("phrases de résumé", () => {
  it("sans règle ou règle inactive : les demandes attendent la validation", () => {
    expect(entrySentence(null)).toBe(NO_RULE_SENTENCE);
    expect(entrySentence({ ...base, isActive: false })).toBe(NO_RULE_SENTENCE);
    expect(entryShort(null)).toBe("Aucune règle : validation à la main");
  });

  it("tout de suite, après un délai", () => {
    expect(entrySentence({ ...base, mode: "IMMEDIATE" })).toBe(
      "Les demandes sont acceptées tout de suite, sans condition.",
    );
    expect(entrySentence(base)).toBe(
      "Les demandes sont acceptées 10 minutes après, sans condition.",
    );
    expect(entryShort({ ...base, delaySeconds: 0 })).toBe("Acceptés tout de suite");
    expect(entryShort(base)).toBe("Acceptés après 10 minutes");
  });

  it("canaux obligatoires ou proposés", () => {
    const required = { ...base, gateMode: "REQUIRED" as const, gateChannelIds: ["a", "b"] };
    expect(entrySentence({ ...required, delaySeconds: 0 }, titles)).toBe(
      "Les demandes sont acceptées dès que la personne a rejoint « Bonus du jour » et « Preuves de gains ».",
    );
    expect(entrySentence(required, titles)).toBe(
      "Les demandes sont acceptées 10 minutes après que la personne a rejoint « Bonus du jour » et « Preuves de gains ».",
    );
    expect(entryShort(required)).toBe("Acceptés 10 minutes après avoir rejoint 2 canaux");
    expect(entryShort({ ...required, delaySeconds: 0 })).toBe(
      "Acceptés après avoir rejoint 2 canaux",
    );
    const soft = { ...base, gateMode: "SOFT" as const, gateChannelIds: ["c"], delaySeconds: 3600 };
    expect(entrySentence(soft, titles)).toBe(
      "Les demandes sont acceptées 1 heure après ; le bot propose aussi de rejoindre « VIP ».",
    );
    expect(entryShort(soft)).toBe("Acceptés après 1 heure, 1 canal proposé");
  });

  it("validation à la main, avec ou sans canaux", () => {
    expect(entrySentence({ ...base, mode: "MANUAL" })).toBe(
      "Les demandes attendent votre validation (onglet Demandes).",
    );
    expect(
      entrySentence(
        { ...base, mode: "MANUAL", gateMode: "REQUIRED", gateChannelIds: ["c"] },
        titles,
      ),
    ).toBe(
      "Les demandes attendent votre validation (onglet Demandes). Le bot demande d'abord de rejoindre « VIP ».",
    );
    expect(entryShort({ ...base, mode: "MANUAL" })).toBe("Validation à la main");
  });

  it("un canal inconnu reste compté", () => {
    expect(
      entrySentence(
        { ...base, gateMode: "REQUIRED", gateChannelIds: ["zz"], delaySeconds: 0 },
        titles,
      ),
    ).toBe("Les demandes sont acceptées dès que la personne a rejoint « un autre canal ».");
  });

  it("liste de canaux lisible", () => {
    expect(channelList([])).toBe("aucun canal");
    expect(channelList(["A"])).toBe("« A »");
    expect(channelList(["A", "B", "C"])).toBe("« A », « B » et « C »");
    expect(channelList(["A", "B", "C", "D"])).toBe("« A », « B » et 2 autres canaux");
  });

  it("rappels et expiration", () => {
    expect(parseReminders("60, 1440")).toEqual([60, 1440]);
    expect(parseReminders(" 30 ,, x 90")).toEqual([30, 90]);
    expect(remindersSentence([60, 1440], 2)).toBe(
      "2 rappels : 1 heure puis 1 jour après la demande.",
    );
    expect(remindersSentence([60, 1440, 2880], 1)).toBe("1 rappel : 1 heure après la demande.");
    expect(remindersSentence([60], 0)).toBe("Aucun rappel.");
    expect(remindersSentence([10, 60, 120], 3)).toBe(
      "3 rappels : 10 minutes, 1 heure puis 2 heures après la demande.",
    );
    expect(expirationSentence({ expireAfterHours: null, expireAction: "DECLINE" })).toBeNull();
    expect(expirationSentence({ expireAfterHours: 48, expireAction: "DECLINE" })).toBe(
      "Une demande toujours en attente après 2 jours est refusée.",
    );
    expect(expirationSentence({ expireAfterHours: 5, expireAction: "APPROVE" })).toBe(
      "Une demande toujours en attente après 5 heures est acceptée quand même.",
    );
  });
});

describe("lecture de la base", () => {
  it("relit prudemment les listes JSON", () => {
    const r = entryRuleFromRow({
      mode: "DELAY",
      delaySeconds: -5,
      gateMode: "REQUIRED",
      gateChannelIds: ["a", 3, null],
      reminderAfterMinutes: [60, "x", -1, "90"],
      maxReminders: 2,
      expireAfterHours: null,
      expireAction: "KEEP",
      sendAcceptedMessage: true,
      isActive: true,
    });
    expect(r.delaySeconds).toBe(0);
    expect(r.gateChannelIds).toEqual(["a"]);
    expect(r.reminderAfterMinutes).toEqual([60, 90]);
  });
});

describe("rappels en pastilles", () => {
  it("coche et décoche sans doublon, du plus tôt au plus tard", () => {
    expect(toggleReminder("60, 1440", 30, true)).toBe("30, 60, 1440");
    expect(toggleReminder("60, 1440", 60, false)).toBe("1440");
    expect(toggleReminder("60, 1440", 60, true)).toBe("60, 1440");
    expect(toggleReminder("", 360, true)).toBe("360");
    expect(toggleReminder("60", 60, false)).toBe("");
    // Toujours relu à l'identique par l'action serveur.
    expect(parseReminders(toggleReminder("1440, 60", 2880, true))).toEqual([60, 1440, 2880]);
  });

  it("montre les rappels proposés puis les autres rappels enregistrés", () => {
    const chips = reminderChips("60, 90, 1440");
    expect(chips.map((c) => c.label)).toEqual([
      "30 minutes",
      "1 heure",
      "6 heures",
      "1 jour",
      "2 jours",
      "90 minutes",
    ]);
    expect(chips.filter((c) => c.checked).map((c) => c.minutes)).toEqual([60, 1440, 90]);
    expect(REMINDER_PRESETS.every((p) => p.minutes <= MAX_REMINDER_MINUTES)).toBe(true);
  });
});

describe("canaux à rejoindre inactifs ou supprimés", () => {
  const active = [{ id: "g1", title: "VIP", vertical: "CASINO", isMediaLibrary: false }];
  it("les montre en tête, cochables et décochables, pour que le compteur corresponde", () => {
    const choices = gateChannelChoices(
      active,
      ["g1", "g2", "g3"],
      [
        { id: "g1", title: "VIP", vertical: "CASINO", isMediaLibrary: false, isActive: true },
        { id: "g2", title: "Ancien", vertical: null, isMediaLibrary: false, isActive: false },
      ],
    );
    expect(choices.map((c) => [c.id, c.title, c.unavailable ?? null])).toEqual([
      ["g2", "Ancien", "inactive"],
      ["g3", "Canal supprimé", "deleted"],
      ["g1", "VIP", null],
    ]);
    const visible = new Set(choices.map((c) => c.id));
    expect(["g1", "g2", "g3"].every((id) => visible.has(id))).toBe(true);
  });

  it("sans canal manquant : la liste des canaux actifs telle quelle", () => {
    expect(gateChannelChoices(active, ["g1"], [])).toEqual(active);
    expect(gateChannelChoices(active, [], [])).toEqual(active);
  });
});

describe("rappel « Autre délai »", () => {
  it("convertit en minutes et refuse une durée vide, nulle ou au-delà de 30 jours", () => {
    expect(customReminderMinutes(45, "minutes")).toBe(45);
    expect(customReminderMinutes(3, "hours")).toBe(180);
    expect(customReminderMinutes(3, "days")).toBe(4320);
    expect(customReminderMinutes(0, "hours")).toBeNull();
    expect(customReminderMinutes(Number.NaN, "hours")).toBeNull();
    expect(customReminderMinutes(31, "days")).toBeNull();
    expect(REMINDER_UNITS.map((u) => u.label)).toEqual(["minutes", "heures", "jours"]);
  });
});
