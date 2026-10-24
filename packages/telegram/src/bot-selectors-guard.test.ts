/**
 * Phase 26, test de GARDE : un bot `role: ADMIN` (le Boss) n'est jamais choisi pour un canal, un lien, une séquence, un
 * envoi, une page, une relance, un compte réel ni mis en assistant. Tout `bot.find…` / `bot.count…` du dépôt doit
 * porter un filtre partagé (`CHANNEL_BOT_WHERE`, `ACTIVE_CHANNEL_BOT_WHERE`, `ADMIN_BOT_WHERE`, `BOSS_BOT_WHERE`, ou
 * `role: "CHANNEL"`) — sauf la liste blanche ci-dessous (lecture d'un bot précis par son identifiant, affichage,
 * webhook, choix du bot du dialogue, réglages), avec le nombre exact d'appels permis par fichier. Un nouvel appel sans
 * filtre fait échouer ce test : ajoutez le filtre, ou justifiez-le ici.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** fichier → nombre d'appels sans filtre permis (et pourquoi). */
const ALLOWED: Record<string, [number, string]> = {
  "apps/web/app/(admin)/channels/actions.ts": [1, "bot principal choisi par l'équipe, Boss refusé juste après"],
  "apps/web/app/(admin)/members/broadcasts/actions.ts": [2, "bot choisi par l'équipe, Boss refusé juste après"],
  "apps/web/app/(admin)/settings/bots/actions.ts": [2, "réglages des bots (tous les bots)"],
  "apps/web/app/(admin)/settings/bots/page.tsx": [1, "réglages des bots (liste complète)"],
  "apps/web/app/(admin)/settings/journal/events/page.tsx": [1, "filtre du journal (affichage)"],
  "apps/web/app/(admin)/stats/page.tsx": [1, "compteur affiché"],
  "apps/web/app/api/telegram/[botId]/route.ts": [1, "webhook : le bot de l'adresse"],
  "apps/web/lib/agents/boss-queries.ts": [1, "page Agents → Boss (affichage)"],
  "apps/web/lib/home/queries.ts": [1, "barre d'état (santé de tous les bots)"],
  "apps/web/lib/integrations/linkaffi/invite-links.ts": [1, "révocation par le bot qui a créé le lien"],
  "apps/web/lib/status/queries.ts": [1, "État du système (tous les bots)"],
  "apps/web/scripts/create-channel-link.ts": [1, "jeton du bot déjà choisi"],
  "apps/web/scripts/diag-bots.ts": [1, "diagnostic local (tous les bots)"],
  "apps/web/scripts/diag-demo-channels.ts": [1, "diagnostic local"],
  "apps/worker/src/agents/admin-voice.ts": [1, "bot qui a reçu le vocal de l'admin"],
  "apps/worker/src/agents/boss-text.ts": [1, "bot qui a reçu le message de l'admin"],
  "apps/worker/src/maintenance/alerts.ts": [3, "santé et noms des bots (alertes)"],
  "apps/worker/src/maintenance/blocked-rate.ts": [1, "noms des bots (alerte)"],
  "apps/worker/src/sending/api.ts": [1, "envoi par le bot déjà choisi"],
  "packages/agents/src/agents/conversations/load.ts": [1, "noms des bots (rapport)"],
  "packages/agents/src/agents/conversations/review.ts": [1, "univers d'un bot précis"],
  "packages/agents/src/boss/guide.ts": [1, "démarrage guidé : le Boss existe-t-il ?"],
  "packages/db/prisma/demo-seed.ts": [1, "données de démonstration"],
  "packages/telegram/scripts/tg-diag.ts": [1, "diagnostic (tous les bots)"],
  "packages/telegram/src/prisma-deps.ts": [1, "retrait des droits d'un bot précis"],
  "packages/telegram/src/service.ts": [7, "enregistrement, webhook, profil, Boss (bot précis ou tous les webhooks)"],
  "packages/telegram/src/webhook-repair.ts": [1, "contrôle des connexions de tous les bots, Boss compris"],
  "packages/userbot/src/shadow.ts": [1, "bot fantôme du compte (par identifiant)"],
};

const FILTER = /CHANNEL_BOT_WHERE|ADMIN_BOT_WHERE|BOSS_BOT_WHERE|role: "CHANNEL"/;
const CALL = /\.bot\.(findFirst|findMany|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\(/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".next") || n === "dist" || n === ".turbo") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !p.includes(`${"/"}tests${"/"}`)) out.push(p);
  }
  return out;
}

function unfilteredCalls(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const top of ["apps", "packages", "scripts"])
    for (const file of sources(join(ROOT, top))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(CALL)) {
        // Arguments de l'appel : jusqu'à la parenthèse fermante correspondante.
        let depth = 0;
        let end = m.index! + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "(") depth++;
          else if (src[end] === ")" && --depth === 0) break;
        }
        if (FILTER.test(src.slice(m.index!, end))) continue;
        const rel = file.slice(ROOT.length + 1);
        found[rel] = (found[rel] ?? 0) + 1;
      }
    }
  return found;
}

describe("garde : aucun sélecteur de bot sans le filtre du Boss (phase 26)", () => {
  it("chaque bot.find… porte le filtre partagé, sauf la liste blanche", () => {
    const found = unfilteredCalls();
    const unexpected = Object.entries(found)
      .filter(([f, n]) => n > (ALLOWED[f]?.[0] ?? 0))
      .map(([f, n]) => `${f} : ${n} appel(s) sans CHANNEL_BOT_WHERE (permis : ${ALLOWED[f]?.[0] ?? 0})`);
    expect(unexpected).toEqual([]);
  });

  it("aucun filtre « actif et normal » écrit à la main (il oublierait le Boss)", () => {
    const bad: string[] = [];
    for (const top of ["apps", "packages"])
      for (const file of sources(join(ROOT, top))) {
        // Les deux fichiers des filtres partagés (qui portent le rôle explicitement).
        if (file.endsWith("packages/db/src/bot-selectors.ts") || file.endsWith("packages/telegram/src/admin-bot.ts")) continue;
        if (/isActive: true,\s*mode: "STANDARD"|mode: "STANDARD"( as const)?,\s*isActive: true/.test(readFileSync(file, "utf8")))
          bad.push(file.slice(ROOT.length + 1));
      }
    expect(bad).toEqual([]);
  });

  it("la liste blanche ne garde pas d'entrée périmée", () => {
    const found = unfilteredCalls();
    const stale = Object.keys(ALLOWED).filter((f) => !found[f]);
    expect(stale).toEqual([]);
  });

  it("aucun autre code ne pose un webhook que setWebhookForBot", () => {
    const bad: string[] = [];
    for (const top of ["apps", "packages", "scripts"])
      for (const file of sources(join(ROOT, top))) {
        const rel = file.slice(ROOT.length + 1);
        if (rel === "packages/telegram/src/service.ts") continue;
        if (/\.setWebhook\(|\/setWebhook\b|deleteWebhook/.test(readFileSync(file, "utf8"))) bad.push(rel);
      }
    expect(bad).toEqual([]);
  });
});
