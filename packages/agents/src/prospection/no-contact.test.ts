/**
 * Phase 31 — relecture adverse : l'équipe Prospection ne peut contacter personne. Aucun fichier de `prospection/`
 * n'importe grammY, le paquet Telegram, le compte connecté (MTProto) ni les fonctions d'envoi de la file ; aucun appel
 * d'envoi Telegram (`sendMessage`, `sendDm`, `enqueueDm`, `joinChannel`…) ; aucun lien d'invitation n'est ouvert.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeProspectUrl } from "./discover/normalize";

const ROOT = import.meta.dirname;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/testing\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Retire les commentaires pour ne juger que le code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

const FILES = sources(ROOT);

describe("Prospection : aucun contact direct", () => {
  it("trouve les fichiers de l'équipe", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it("n'importe aucun module capable d'écrire à un tiers", () => {
    const forbidden = [/from\s+["']grammy/, /from\s+["']@linkaffipro\/telegram/, /from\s+["']@linkaffipro\/mtproto/, /from\s+["']@linkaffipro\/userbot/, /from\s+["']telegram["']/];
    const bad: string[] = [];
    for (const f of FILES) {
      const c = code(f);
      for (const re of forbidden) if (re.test(c)) bad.push(`${f.replace(ROOT, "")} : ${re}`);
    }
    expect(bad).toEqual([]);
  });

  it("n'appelle aucune méthode d'envoi ni d'adhésion", () => {
    const forbidden = /\b(sendMessage|sendDm|enqueueDm|sendPhoto|sendVideo|forwardMessage|copyMessage|joinChannel|JoinChannel|ImportChatInvite|importChatInvite|joinChat|sendChatJoinRequest|approveChatJoinRequest)\s*\(/;
    const bad = FILES.filter((f) => forbidden.test(code(f))).map((f) => f.replace(ROOT, ""));
    expect(bad).toEqual([]);
  });

  it("les seuls envois passent par le messager de l'admin", () => {
    const sends = FILES.flatMap((f) => [...code(f).matchAll(/\.send(?:To)?\s*\(/g)].map(() => f.replace(ROOT, "")));
    const viaAdmin = FILES.filter((f) => /\.send(?:To)?\s*\(/.test(code(f))).every((f) => /admin/.test(code(f)));
    expect(viaAdmin, `envois hors messager admin : ${sends.join(", ")}`).toBe(true);
  });

  it("un lien d'invitation privé n'est jamais une adresse à lire", () => {
    for (const link of ["https://t.me/+AbCdEf123", "t.me/joinchat/AbCdEf123", "https://telegram.me/+xyz987"]) {
      const n = normalizeProspectUrl(link);
      expect(n?.invite ?? true).toBe(true);
      expect(n?.username ?? null).toBeNull();
    }
  });
});
