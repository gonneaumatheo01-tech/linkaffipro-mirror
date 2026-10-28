import { encrypt } from "@linkaffipro/core";
import { PrismaClient } from "@prisma/client";

const proxyUrl = process.argv[2];
if (!proxyUrl) { console.error("Usage: set-proxy.ts <proxy-url>"); process.exit(1); }
const v = proxyUrl.trim();
let u: URL;
try { u = new URL(/^[a-z0-9]+:\/\//i.test(v) ? v : "http://" + v); } catch { console.error("Invalid proxy URL"); process.exit(1); }
if (!u.hostname || !u.port) { console.error("Need hostname and port"); process.exit(1); }
console.log("Proxy:", u.protocol + "//" + u.hostname + ":" + u.port, "(user:", u.username ? "yes" : "no", ")");

const prisma = new PrismaClient();
try {
  const settingKey = "agents.secret.providers.screenshotProxy";
  const stored = { enc: encrypt(v), last4: v.slice(-4), updatedAt: new Date().toISOString() };
  await prisma.setting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: stored }, update: { value: stored } });
  console.log("✅ Proxy saved (encrypted).");
  const result = await prisma.bookmakerSite.updateMany({ where: { isActive: true }, data: { readTarget: "server" } });
  console.log("✅", result.count, "site(s) switched to server mode.");
} finally { await prisma.$disconnect(); }
