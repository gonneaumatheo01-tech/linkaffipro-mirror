import { describe, expect, it } from "vitest";
import {
  ALERT_SETTINGS_KEY,
  DEFAULT_ALERT_SWITCHES,
  SWITCHABLE_ALERT_KINDS,
  disabledAlertKinds,
  isAlertKindEnabled,
  isSwitchableAlertKind,
  parseAlertSwitches,
} from "./alert-switches";
import { ALERT_KIND_LABELS } from "./team-labels";

describe("interrupteurs des alertes sur les chiffres", () => {
  it("trois alertes, même réglage que les seuils, chacune avec un libellé", () => {
    expect(ALERT_SETTINGS_KEY).toBe("alerts.thresholds");
    expect([...SWITCHABLE_ALERT_KINDS]).toEqual([
      "registrations_drop",
      "spend_no_conversion",
      "channel_leak",
      "agents_channel_drop",
      "agents_persona_drop",
      "agents_media_low",
      "ads_spend_spike",
      "ads_conversion_drop",
      "ads_cost_over_threshold",
      "ads_budget_exhausted",
      "bookmaker_blocked",
      "bookmaker_degraded",
    ]);
    for (const kind of SWITCHABLE_ALERT_KINDS) expect(ALERT_KIND_LABELS[kind]).toBeTruthy();
  });

  it("absent = activée (réglage d'avant les interrupteurs, réglage vide ou abîmé)", () => {
    const all = {
      registrations_drop: true,
      spend_no_conversion: true,
      channel_leak: true,
      agents_channel_drop: true,
      agents_persona_drop: true,
      agents_media_low: true,
      ads_spend_spike: true,
      ads_conversion_drop: true,
      ads_cost_over_threshold: true,
      ads_budget_exhausted: true,
      bookmaker_blocked: true,
      bookmaker_degraded: true,
    };
    expect(parseAlertSwitches(null)).toEqual(all);
    expect(parseAlertSwitches(undefined)).toEqual(all);
    expect(parseAlertSwitches("x")).toEqual(all);
    expect(parseAlertSwitches([])).toEqual(all);
    expect(parseAlertSwitches({ registrationsDropPct: 30 })).toEqual(all);
    expect(parseAlertSwitches({ enabled: null })).toEqual(all);
    expect(parseAlertSwitches({ enabled: [false] })).toEqual(all);
    expect(DEFAULT_ALERT_SWITCHES).toEqual(all);
  });

  it("seul un false explicite désactive ; une valeur non booléenne reste activée", () => {
    expect(
      parseAlertSwitches({
        registrationsDropPct: 50,
        enabled: { registrations_drop: false, spend_no_conversion: "false", channel_leak: 0 },
      }),
    ).toEqual({ registrations_drop: false, spend_no_conversion: true, channel_leak: true, agents_channel_drop: true, agents_persona_drop: true, agents_media_low: true, ads_spend_spike: true, ads_conversion_drop: true, ads_cost_over_threshold: true, ads_budget_exhausted: true, bookmaker_blocked: true, bookmaker_degraded: true });
    expect(
      parseAlertSwitches({
        enabled: { registrations_drop: true, spend_no_conversion: false, channel_leak: false },
      }),
    ).toEqual({ registrations_drop: true, spend_no_conversion: false, channel_leak: false, agents_channel_drop: true, agents_persona_drop: true, agents_media_low: true, ads_spend_spike: true, ads_conversion_drop: true, ads_cost_over_threshold: true, ads_budget_exhausted: true, bookmaker_blocked: true, bookmaker_degraded: true });
  });

  it("ne modifie jamais les valeurs par défaut partagées", () => {
    parseAlertSwitches({ enabled: { channel_leak: false } });
    expect(DEFAULT_ALERT_SWITCHES.channel_leak).toBe(true);
    expect(Object.isFrozen(DEFAULT_ALERT_SWITCHES)).toBe(true);
  });

  it("types avec interrupteur ; les autres alertes ne se coupent jamais", () => {
    const switches = parseAlertSwitches({ enabled: { spend_no_conversion: false } });
    expect(isSwitchableAlertKind("spend_no_conversion")).toBe(true);
    expect(isSwitchableAlertKind("bot_webhook")).toBe(false);
    expect(isAlertKindEnabled(switches, "spend_no_conversion")).toBe(false);
    expect(isAlertKindEnabled(switches, "registrations_drop")).toBe(true);
    expect(isAlertKindEnabled(switches, "bot_webhook")).toBe(true);
    expect(disabledAlertKinds(switches)).toEqual(["spend_no_conversion"]);
    expect(disabledAlertKinds(DEFAULT_ALERT_SWITCHES)).toEqual([]);
  });
});
