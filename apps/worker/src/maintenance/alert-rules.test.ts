import { describe, expect, it } from "vitest";
import {
  backupFileDate,
  detectConnectorReconnect,
  detectGateLinksMissing,
  DEFAULT_THRESHOLDS,
  detectBackupFailed,
  detectBotWebhook,
  detectChannelLeak,
  detectDmBlocked,
  detectJobFailures,
  detectOfferLinkInactive,
  detectPostFailed,
  detectQueueBacklog,
  detectRegistrationsDrop,
  detectSpendNoConversion,
  detectSubIdHealth,
  detectSyncFailed,
  detectWorkerDown,
  formatAlert,
  parseThresholds,
  shouldCreate,
  alertToReopen,
  detectCustomEmojiRefused,
  detectTelegramAccountReconnect,
  REOPEN_KINDS,
} from "./alert-rules";

const now = new Date("2026-10-09T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("alertes bots", () => {
  it("signale un bot en erreur", () => {
    const d = detectBotWebhook(
      [{ username: "a", isActive: true, lastWebhookAt: ago(1), lastError: "webhook 500" }],
      now,
    );
    expect(d?.kind).toBe("bot_webhook");
    expect(d?.message).toContain("@a");
  });
  it("signale un bot silencieux seulement si un autre reçoit des updates", () => {
    expect(
      detectBotWebhook(
        [{ username: "a", isActive: true, lastWebhookAt: ago(30), lastError: null }],
        now,
      ),
    ).toBeNull();
    const d = detectBotWebhook(
      [
        { username: "a", isActive: true, lastWebhookAt: ago(30), lastError: null },
        { username: "b", isActive: true, lastWebhookAt: ago(2), lastError: null },
      ],
      now,
    );
    expect(d?.payload.bots).toEqual(["a"]);
  });
  it("ignore les bots inactifs", () => {
    expect(
      detectBotWebhook(
        [{ username: "a", isActive: false, lastWebhookAt: null, lastError: "x" }],
        now,
      ),
    ).toBeNull();
  });
});

describe("autres règles", () => {
  it("synchro en échec après 3 passages", () => {
    expect(detectSyncFailed([{ source: "players", lastError: "500", errorStreak: 2 }])).toBeNull();
    const d = detectSyncFailed([{ source: "players", lastError: "500", errorStreak: 3 }]);
    expect(d?.payload.sources).toEqual(["players"]);
    // La table Link Affi est nommée en clair (« Joueurs »), le nom technique reste dans le payload.
    expect(d?.message).toBe("Synchro Link Affi en échec répété : Joueurs (500)");
  });
  it("file engorgée au-delà de 500", () => {
    expect(detectQueueBacklog(500)).toBeNull();
    expect(detectQueueBacklog(501)?.kind).toBe("queue_backlog");
  });
  it("blocages en masse au-delà de 50", () => {
    expect(detectDmBlocked(50)).toBeNull();
    expect(detectDmBlocked(51)?.severity).toBe("WARNING");
  });
  it("santé du sub-ID seulement en état alert", () => {
    expect(detectSubIdHealth("warning", "x")).toBeNull();
    expect(detectSubIdHealth("alert", "tronqué")?.message).toBe(
      "Identifiant de suivi qui ne revient pas : tronqué",
    );
  });
  it("dédoublonne sur une heure", () => {
    expect(shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(30) }], now)).toBe(
      false,
    );
    expect(
      shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(23 * 60) }], now),
    ).toBe(false);
    expect(
      shouldCreate("bot_webhook", [{ kind: "bot_webhook", createdAt: ago(25 * 60) }], now),
    ).toBe(true);
    expect(shouldCreate("bot_webhook", [{ kind: "sync_failed", createdAt: ago(1) }], now)).toBe(
      true,
    );
  });
  it("liens des canaux à rejoindre : alerte de moins de 24 h rouverte (résolue ou non), jamais pour les autres types", () => {
    const recent = [
      { id: "vieille", kind: "gate_links_missing", createdAt: ago(25 * 60) },
      { id: "a1", kind: "gate_links_missing", createdAt: ago(5 * 60) },
      { id: "a2", kind: "gate_links_missing", createdAt: ago(60) },
      { id: "autre", kind: "bot_webhook", createdAt: ago(1) },
    ];
    expect(alertToReopen("gate_links_missing", recent, now)).toBe("a2");
    expect(alertToReopen("gate_links_missing", [recent[0]!], now)).toBeNull();
    expect(alertToReopen("bot_webhook", recent, now)).toBeNull();
  });
  it("formate en HTML échappé", () => {
    const t = formatAlert({
      kind: "queue_backlog",
      severity: "WARNING",
      message: "a <b> & c",
      payload: {},
    });
    expect(t).toContain("🟠");
    expect(t).toContain("a &lt;b&gt; &amp; c");
  });
  it("titre de l'alerte en français, jamais le code technique", () => {
    const t = formatAlert({
      kind: "bot_webhook",
      severity: "CRITICAL",
      message: "Bot en difficulté : @a",
      payload: {},
    });
    expect(t.split("\n")[0]).toBe("🔴 <b>Alerte : Bot en difficulté</b>");
    expect(t).not.toContain("bot_webhook");
    expect(
      formatAlert({ kind: "subid_health", severity: "CRITICAL", message: "x", payload: {} }),
    ).toContain("Alerte : Identifiant de suivi qui ne revient pas");
  });
});

describe("règles de solidité", () => {
  it("worker arrêté seulement au-delà de 3 minutes sans battement", () => {
    expect(detectWorkerDown(null, now)).toBeNull();
    expect(detectWorkerDown(ago(2), now)).toBeNull();
    const d = detectWorkerDown(ago(12), now);
    expect(d?.kind).toBe("worker_down");
    expect(d?.severity).toBe("CRITICAL");
    expect(d?.payload.downMinutes).toBe(12);
    expect(d?.message).toContain("12 min");
    expect(d?.message).toMatch(/^Service d'arrière-plan arrêté : /);
  });
  it("sauvegarde en échec seulement sans succès depuis 36 h", () => {
    expect(detectBackupFailed(null, now)).toBeNull();
    expect(
      detectBackupFailed(
        { at: now.toISOString(), file: "linkaffipro-2026-10-09T02-00-00.sql.gz", ok: true },
        now,
      ),
    ).toBeNull();
    // Échec mais un succès de la nuit est conservé : pas encore d'alerte.
    expect(
      detectBackupFailed(
        {
          at: now.toISOString(),
          file: "linkaffipro-2026-10-09T02-00-00.sql.gz",
          ok: false,
          error: "pg_dump absent",
        },
        now,
      ),
    ).toBeNull();
    // Échec et dernier succès vieux de 2 jours.
    const d = detectBackupFailed(
      {
        at: now.toISOString(),
        file: "linkaffipro-2026-10-07T02-00-00.sql.gz",
        ok: false,
        error: "pg_dump absent",
      },
      now,
    );
    expect(d?.kind).toBe("backup_failed");
    expect(d?.message).toBe("La sauvegarde automatique de la base a échoué : pg_dump absent");
    // Échec sans aucun succès connu.
    expect(
      detectBackupFailed({ at: now.toISOString(), file: null, ok: false }, now)?.message,
    ).toContain("erreur inconnue");
    expect(backupFileDate("linkaffipro-2026-10-07T02-30-15.sql.gz")?.toISOString()).toBe(
      "2026-10-07T02:30:15.000Z",
    );
    expect(backupFileDate("autre.sql.gz")).toBeNull();
  });
  it("erreurs répétées à partir de 10 échecs sur une même file", () => {
    expect(detectJobFailures({ stats: 9, "telegram-send": 3 })).toBeNull();
    const d = detectJobFailures({ stats: 10, "telegram-send": 3 });
    expect(d?.kind).toBe("job_failures");
    expect(d?.message).toContain("Statistiques (10)");
    expect(d?.message).not.toContain("Envois Telegram");
    expect(d?.message).not.toMatch(/worker|stats \(/);
    expect(d?.payload.queues).toEqual({ stats: 10 });
  });
});

describe("règles métier à seuils (phase 6)", () => {
  it("lit les seuils avec valeurs par défaut et bornes", () => {
    expect(parseThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
    expect(
      parseThresholds({ registrationsDropPct: 30, spendNoConversionEur: 120, channelLeakPct: 5 }),
    ).toEqual({ registrationsDropPct: 30, spendNoConversionEur: 120, channelLeakPct: 5 });
    expect(
      parseThresholds({ registrationsDropPct: 0, spendNoConversionEur: "x", channelLeakPct: 200 }),
    ).toEqual(DEFAULT_THRESHOLDS);
  });
  it("chute des inscriptions : seulement sous 50 % de la moyenne et avec au moins 10 par jour", () => {
    expect(detectRegistrationsDrop({ last24h: 2, previous7dTotal: 35 })).toBeNull(); // moyenne 5/j : trop peu
    expect(detectRegistrationsDrop({ last24h: 10, previous7dTotal: 140 })).toBeNull(); // 10 = 50 % de 20 : pas sous le seuil
    const d = detectRegistrationsDrop({ last24h: 4, previous7dTotal: 140 });
    expect(d?.kind).toBe("registrations_drop");
    expect(d?.payload).toMatchObject({ last24h: 4, dailyAverage: 20, dropPct: 80 });
    expect(d?.message).toContain("−80 %");
    // Seuil réglé à 30 % : 15 inscriptions pour une moyenne de 20 déclenchent (sous 14 ? non) → 13 oui.
    const t = { ...DEFAULT_THRESHOLDS, registrationsDropPct: 30 };
    expect(detectRegistrationsDrop({ last24h: 15, previous7dTotal: 140 }, t)).toBeNull();
    expect(detectRegistrationsDrop({ last24h: 13, previous7dTotal: 140 }, t)?.kind).toBe(
      "registrations_drop",
    );
  });
  it("dépense sans conversion : au-dessus du seuil et zéro inscription", () => {
    expect(detectSpendNoConversion([{ name: "A", spend: 50, registrations: 0 }])).toBeNull();
    expect(detectSpendNoConversion([{ name: "A", spend: 80, registrations: 1 }])).toBeNull();
    const d = detectSpendNoConversion([
      { name: "A", spend: 80.5, registrations: 0 },
      { name: "B", spend: 20, registrations: 0 },
    ]);
    expect(d?.kind).toBe("spend_no_conversion");
    expect(d?.message).toContain("A (80,50 €)");
    expect(d?.message).not.toContain("B (");
    expect(
      detectSpendNoConversion([{ name: "B", spend: 20, registrations: 0 }], {
        ...DEFAULT_THRESHOLDS,
        spendNoConversionEur: 10,
      })?.kind,
    ).toBe("spend_no_conversion");
  });
  it("dépense sans inscription : gains de la campagne (commissions − dépense) quand ils sont connus", () => {
    const d = detectSpendNoConversion([
      { name: "A", spend: 80.5, registrations: 0, commissions: 20 },
    ]);
    expect(d?.message).toContain("A (80,50 € dépensés, gains −60,50 €)");
    expect(d?.message).not.toMatch(/bénéfice/i);
    expect(d?.payload.campaigns).toEqual([
      { name: "A", spend: 80.5, commissions: 20, gains: -60.5 },
    ]);
  });
  it("canal qui fuit : plus de 10 % de départs, 20 membres minimum", () => {
    expect(detectChannelLeak([{ title: "Petit", activeMembers: 15, left24h: 10 }])).toBeNull();
    expect(detectChannelLeak([{ title: "Stable", activeMembers: 100, left24h: 10 }])).toBeNull();
    const d = detectChannelLeak([{ title: "Fuite", activeMembers: 100, left24h: 11 }]);
    expect(d?.kind).toBe("channel_leak");
    expect(d?.message).toContain("Fuite (11 départs sur 100 membres, 11 %)");
    expect(
      detectChannelLeak([{ title: "Stable", activeMembers: 100, left24h: 6 }], {
        ...DEFAULT_THRESHOLDS,
        channelLeakPct: 5,
      })?.kind,
    ).toBe("channel_leak");
  });
  it("message programmé en échec", () => {
    expect(detectPostFailed([])).toBeNull();
    const d = detectPostFailed([
      { code: "p1", channelTitle: "Casino FR", lastError: "chat not found" },
    ]);
    expect(d?.kind).toBe("post_failed");
    expect(d?.message).toContain("1 message programmé en échec");
    expect(d?.message).toContain("Casino FR / p1 (chat not found)");
    const many = detectPostFailed(
      Array.from({ length: 7 }, (_, i) => ({ code: `p${i}`, channelTitle: "C", lastError: null })),
    );
    expect(many?.message).toContain("7 messages programmés");
    expect(many?.message).toContain("et 2 autre(s)");
  });
  it("lien désactivé encore cliqué", () => {
    expect(detectOfferLinkInactive([])).toBeNull();
    expect(detectOfferLinkInactive([{ slug: "abc", label: "Bonus", clicks: 0 }])).toBeNull();
    const d = detectOfferLinkInactive([{ slug: "abc", label: "Bonus", clicks: 3 }]);
    expect(d?.kind).toBe("offer_link_inactive");
    expect(d?.message).toContain("Bonus (/abc, 3 clics)");
  });
});

describe("comptes publicitaires à reconnecter", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  it("rien si tout est connecté avec un jeton lointain ou sans expiration", () => {
    expect(
      detectConnectorReconnect(
        [
          {
            platform: "META",
            name: "A",
            status: "ACTIVE",
            tokenExpiresAt: new Date("2026-12-01T00:00:00Z"),
            lastError: null,
          },
          {
            platform: "TIKTOK",
            name: "B",
            status: "ACTIVE",
            tokenExpiresAt: null,
            lastError: null,
          },
        ],
        now,
      ),
    ).toBeNull();
  });
  it("critique si un compte est à reconnecter, attention si un jeton expire sous 7 jours", () => {
    const d = detectConnectorReconnect(
      [
        {
          platform: "META",
          name: "A",
          status: "NEEDS_RECONNECT",
          tokenExpiresAt: null,
          lastError: "190",
        },
      ],
      now,
    );
    expect(d?.severity).toBe("CRITICAL");
    expect(d?.message).toContain("Meta « A »");
    const w = detectConnectorReconnect(
      [
        {
          platform: "META",
          name: "A",
          status: "ACTIVE",
          tokenExpiresAt: new Date("2026-10-13T00:00:00Z"),
          lastError: null,
        },
      ],
      now,
    );
    expect(w?.severity).toBe("WARNING");
    expect(w?.payload.expiringSoon).toEqual(["A"]);
  });
});

describe("liens des canaux à rejoindre impossibles à créer", () => {
  const row = (channelTitle: string, status: string, missing: Array<[string, string | null]>) => ({
    channelTitle,
    status,
    missing: missing.map(([title, suggestedBot]) => ({ title, suggestedBot })),
  });
  it("rien sans demande concernée", () => {
    expect(detectGateLinksMissing([])).toBeNull();
  });
  it("demandes regroupées par canal, canaux sans lien et solution avec le bot à ajouter", () => {
    const d = detectGateLinksMissing([
      row("Zone Interdite 🔞", "PENDING_GATE", [
        ["LA ZONE ROULETTE 🎰", "womendatingoobot"],
        ["🎯 TIR CADRÉ ⚡", "womendatingoobot"],
      ]),
      row("Zone Interdite 🔞", "PENDING_GATE", [["LA ZONE ROULETTE 🎰", "womendatingoobot"]]),
    ]);
    expect(d?.kind).toBe("gate_links_missing");
    // Des personnes sont bloquées (canaux obligatoires) : alerte critique.
    expect(d?.severity).toBe("CRITICAL");
    expect(d?.message).toBe(
      "2 demandes attendent les liens des canaux à rejoindre dans « Zone Interdite 🔞 » : « LA ZONE ROULETTE 🎰 », « 🎯 TIR CADRÉ ⚡ ». Ajoutez @womendatingoobot comme administrateur de ces canaux avec le droit « Inviter via un lien », puis cliquez « Renvoyer l'accueil avec les liens » dans « À faire » sur l'accueil du site.",
    );
    expect(d?.payload).toEqual({ requests: 2, channels: ["Zone Interdite 🔞"] });
  });
  it("canaux seulement proposés (demandes acceptées de toute façon) : simple avertissement", () => {
    const d = detectGateLinksMissing([row("Canal A", "SCHEDULED", [["Canal B", null]])]);
    expect(d?.severity).toBe("WARNING");
    expect(d?.message).toContain(
      "1 demande attend les liens des canaux à rejoindre dans « Canal A » : « Canal B ».",
    );
    expect(d?.message).toContain("Ajoutez un de nos bots comme administrateur");
  });
});

describe("canaux obligatoires impossibles à vérifier", () => {
  it("personnes bloquées au « J'ai rejoint » : même alerte, mots clairs, même solution", () => {
    const d = detectGateLinksMissing([
      {
        channelTitle: "Paris public",
        status: "PENDING_GATE",
        missing: [{ title: "Canal public", suggestedBot: "datingbot", reason: "cannot_verify" }],
      },
      {
        channelTitle: "Zone",
        status: "PENDING_GATE",
        missing: [
          { title: "Roulette", suggestedBot: "datingbot" },
          { title: "Canal public", suggestedBot: "datingbot", reason: "cannot_verify" },
        ],
      },
      {
        channelTitle: "Zone",
        status: "PENDING_GATE",
        missing: [{ title: "Roulette", suggestedBot: "datingbot", reason: "no_link" }],
      },
    ]);
    expect(d?.severity).toBe("CRITICAL");
    expect(d?.message).toBe(
      "1 demande est bloquée dans « Paris public » : le bot ne peut pas vérifier « Canal public ». 2 demandes attendent les liens des canaux à rejoindre dans « Zone » : « Roulette » ; le bot ne peut pas vérifier « Canal public ». Ajoutez @datingbot comme administrateur de ces canaux avec le droit « Inviter via un lien », puis cliquez « Renvoyer l'accueil avec les liens » dans « À faire » sur l'accueil du site.",
    );
    const two = detectGateLinksMissing([
      {
        channelTitle: "P",
        status: "PENDING_GATE",
        missing: [{ title: "C", suggestedBot: null, reason: "cannot_verify" }],
      },
      {
        channelTitle: "P",
        status: "PENDING_GATE",
        missing: [{ title: "C", suggestedBot: null, reason: "cannot_verify" }],
      },
    ]);
    expect(two?.message).toContain(
      "2 demandes sont bloquées dans « P » : le bot ne peut pas vérifier « C ».",
    );
  });
});

describe("vocabulaire des alertes (docs/REFONTE-UX.md)", () => {
  const JARGON =
    /\b(FTDs?|NGR|ROAS|CPL|CPA)\b|sub[-_ ]?id|webhook|postback|worker|segment|séquence|automatisation|cohorte|entonnoir|\b[a-z]+_[a-z_]+\b/i;
  it("aucune alerte détectée ne montre de terme technique ni de code (bot_webhook, telegram-send…)", () => {
    const all = [
      detectBotWebhook(
        [
          {
            username: "casino_bot",
            isActive: true,
            lastWebhookAt: ago(1),
            lastError: "Erreur Telegram",
          },
        ],
        now,
      ),
      detectSyncFailed([{ source: "player_events", lastError: "500", errorStreak: 3 }]),
      detectQueueBacklog(900),
      detectDmBlocked(80),
      detectSubIdHealth("alert", "valeur tronquée"),
      detectWorkerDown(ago(12), now),
      detectJobFailures({ "telegram-send": 12, "sync-linkaffi": 10 }),
      detectBackupFailed(
        { at: now.toISOString(), file: null, ok: false, error: "disque plein" },
        now,
      ),
      detectRegistrationsDrop({ last24h: 1, previous7dTotal: 140 }),
      detectSpendNoConversion([{ name: "Campagne A", spend: 90, registrations: 0 }]),
      detectChannelLeak([{ title: "Canal A", activeMembers: 100, left24h: 30 }]),
      detectPostFailed([{ code: "p1", channelTitle: "Canal A", lastError: null }]),
      detectOfferLinkInactive([{ slug: "abc", label: "Bonus", clicks: 2 }]),
      detectConnectorReconnect(
        [
          {
            platform: "META",
            name: "Compte A",
            status: "NEEDS_RECONNECT",
            tokenExpiresAt: null,
            lastError: null,
          },
        ],
        now,
      ),
      detectGateLinksMissing([
        {
          channelTitle: "Canal A",
          status: "PENDING_GATE",
          missing: [{ title: "Canal B", suggestedBot: "dating_bot" }],
        },
      ]),
      detectTelegramAccountReconnect({ status: "ERROR", pendingAccountPosts: 1 }),
    ];
    for (const d of all) {
      expect(d).not.toBeNull();
      // Le pseudo du bot (« @casino_bot ») est un nom propre : retiré avant le contrôle.
      const text = formatAlert(d!).replace(/@\w+/g, "@bot");
      expect(text, d!.kind).not.toMatch(JARGON);
    }
  });
});

describe("emojis animés refusés (phase 12)", () => {
  it("rien sans message parti avec les emojis normaux", () => {
    expect(detectCustomEmojiRefused([])).toBeNull();
  });

  it("compte les messages, nomme les bots, conseille de vérifier Premium", () => {
    const d = detectCustomEmojiRefused([
      { botUsername: "casinogamblingoobot", resent: true },
      { botUsername: "casinogamblingoobot", resent: false },
      { botUsername: "sportbettingoobot", resent: true },
      { botUsername: null, resent: true },
    ]);
    expect(d).toMatchObject({
      kind: "custom_emoji_refused",
      severity: "WARNING",
      payload: { messages: 4, bots: ["casinogamblingoobot", "sportbettingoobot"], resent: 3 },
    });
    expect(d?.message).toBe(
      "4 messages privés de la dernière heure sont partis avec les emojis normaux au lieu des emojis animés (@casinogamblingoobot, @sportbettingoobot). Vérifiez que le compte Telegram propriétaire des bots a toujours Telegram Premium.",
    );
    expect(detectCustomEmojiRefused([{ botUsername: null, resent: true }])?.message).toMatch(
      /^1 message privé de la dernière heure est parti avec les emojis normaux au lieu des emojis animés\. /,
    );
  });

  it("messages programmés publiés par un bot (groupes) : comptés et nommés comme tels", () => {
    const one = detectCustomEmojiRefused([
      { botUsername: "sportbettingoobot", resent: true, kind: "post" },
    ]);
    expect(one?.message).toBe(
      "1 message programmé de la dernière heure est parti avec les emojis normaux au lieu des emojis animés (@sportbettingoobot). Vérifiez que le compte Telegram propriétaire des bots a toujours Telegram Premium.",
    );
    expect(one?.payload).toMatchObject({ messages: 1, posts: 1, dms: 0 });
    expect(
      detectCustomEmojiRefused([
        { botUsername: null, resent: true, kind: "post" },
        { botUsername: null, resent: false, kind: "post" },
      ])?.message,
    ).toMatch(/^2 messages programmés de la dernière heure sont partis avec les emojis normaux/);
    const mixed = detectCustomEmojiRefused([
      { botUsername: null, resent: true, kind: "post" },
      { botUsername: null, resent: true },
      { botUsername: null, resent: true, kind: "dm" },
    ]);
    expect(mixed?.message).toMatch(
      /^3 messages de la dernière heure \(2 messages privés, 1 message programmé\) sont partis avec les emojis normaux/,
    );
    expect(mixed?.payload).toMatchObject({ messages: 3, posts: 1, dms: 2, resent: 3 });
  });

  it("une notification par 24 h au plus : l'alerte est rouverte en silence", () => {
    expect(REOPEN_KINDS.has("custom_emoji_refused")).toBe(true);
  });
});

describe("compte Telegram connecté à reconnecter (phase 12)", () => {
  it("rien tant que la session est active ou absente", () => {
    expect(detectTelegramAccountReconnect(null)).toBeNull();
    expect(detectTelegramAccountReconnect({ status: "ACTIVE", pendingAccountPosts: 3 })).toBeNull();
    expect(
      detectTelegramAccountReconnect({ status: "DISCONNECTED", pendingAccountPosts: 0 }),
    ).toBeNull();
  });
  it("session en erreur : avertissement, critique si des messages avec emojis animés attendent", () => {
    const quiet = detectTelegramAccountReconnect({ status: "ERROR", pendingAccountPosts: 0 });
    expect(quiet).toMatchObject({ kind: "telegram_account_reconnect", severity: "WARNING" });
    expect(quiet?.message).toBe(
      "Le compte Telegram connecté est à reconnecter (session expirée ou révoquée) : les vues des messages ne sont plus relevées et les messages avec emojis animés ne peuvent pas être publiés. Réglages → Connexions → Telegram → Reconnecter.",
    );
    const urgent = detectTelegramAccountReconnect({ status: "ERROR", pendingAccountPosts: 1 });
    expect(urgent).toMatchObject({ severity: "CRITICAL", payload: { pendingAccountPosts: 1 } });
    expect(urgent?.message).toContain(" 1 message programmé avec emojis animés ne partira pas. ");
  });
});
