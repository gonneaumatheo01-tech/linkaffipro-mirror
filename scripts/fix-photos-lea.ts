/**
 * Remplace les photos refusées du plan Lea et crée les 4 posts manquants.
 * Usage : DRY=1 node --import tsx scripts/fix-photos-lea.ts   (essai à blanc)
 *         node --import tsx scripts/fix-photos-lea.ts
 * Le jeton est lu dans le fichier dont le chemin est donné par FIX_TOKEN_FILE.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = "https://app.linkaffipro.com";
const TOKEN = readFileSync(process.env.FIX_TOKEN_FILE!, "utf-8").trim();
const CHANNEL_ID = "cmv2h1ka2006sqy85khy9s6em";
const START_DATE = "2026-11-01";
const DRY = process.env.DRY === "1";

const MEDIA_BASE = "/Users/utilisateur/Desktop/Generation/Telegram";
const FOLDERS: Record<string, string> = {
  selfie: resolve(MEDIA_BASE, "Selfie"),
  sport: resolve(MEDIA_BASE, "Sport"),
  post: resolve(MEDIA_BASE, "Posts"),
  video: resolve(MEDIA_BASE, "Vidéos"),
};

const PHOTO_FIX: Record<string, string> = {
  "selfie_65.png": "selfie_123.png",
  "selfie_52.png": "selfie_118.png",
  "sport_12.png": "sport_1.png",
  "selfie_45.png": "selfie_15.png",
  "selfie_100.png": "selfie_2.png",
  "selfie_103.png": "selfie_80.png",
  "selfie_119.png": "selfie_124.png",
  "selfie_21.png": "selfie_43.png",
  "selfie_104.png": "selfie_17.png",
  "selfie_95.png": "selfie_84.png",
  "selfie_108.png": "selfie_88.png",
  "selfie_102.png": "sport_3.png",
  "sport_50.png": "sport_45.png",
  "selfie_60.png": "selfie_130.png",
  "selfie_59.png": "selfie_35.png",
  "sport_28.png": "sport_41.png",
  "selfie_70.png": "selfie_61.png",
  "selfie_125.png": "selfie_39.png",
  "selfie_106.png": "selfie_81.png",
};

const POSTS_MODE = process.env.MODE === "posts";
const PLAN_TEXT = readFileSync(resolve(__dirname, "../posts-canal-lea-30j.txt"), "utf-8");
const REPLACE: Record<string, string> = POSTS_MODE
  ? Object.fromEntries([...PLAN_TEXT.matchAll(/\|\s*(post_\d+\.jpg)\s*\|/g)].map((m) => [m[1]!, m[1]!]))
  : PHOTO_FIX;
const NEW_TEXT: Record<string, string> = POSTS_MODE ? {} : {
  "selfie_52.png": "la voila, en rouge",
  "selfie_119.png": "rose satine, bientot au lit",
  "selfie_104.png": "noir et rose, a genoux",
  "sport_50.png": "brassiere noire, avant la seance",
  "selfie_60.png": "rouge, gros plan",
  "selfie_125.png": "tout en blanc",
};

function resolveMediaPath(filename: string): string {
  const folder = FOLDERS[filename.split("_")[0]!.toLowerCase()];
  if (!folder) throw new Error(`Préfixe média inconnu : ${filename}`);
  return resolve(folder, filename);
}

function toScheduledAt(day: number, time: string): string {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const calendarDay = hh < 6 ? day + 1 : day;
  const base = new Date(`${START_DATE}T00:00:00`);
  base.setDate(base.getDate() + calendarDay - 1);
  const dateStr = base.toISOString().slice(0, 10);
  const timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  return new Date(`${dateStr}T${timeStr}+01:00`).toISOString();
}

const plan = readFileSync(resolve(__dirname, "../posts-canal-lea-30j.txt"), "utf-8");
const ops: Array<{ scheduledAt: string; text: string; file: string; create: boolean; newText?: string }> = [];
let day = 0;
for (const line of plan.split("\n")) {
  const t = line.trim();
  const d = t.match(/^JOUR\s+(\d+)/);
  if (d) {
    day = parseInt(d[1]!);
    continue;
  }
  const m = t.match(/^(\d{2}:\d{2})\s*\|\s*(.*?)\s*\|\s*(.+)$/);
  if (!m || !day) continue;
  const oldFile = m[2]!.trim();
  const newFile = REPLACE[oldFile];
  if (!newFile) continue;
  ops.push({
    scheduledAt: toScheduledAt(day, m[1]!),
    text: m[3]!.trim(),
    file: newFile,
    create: !existsSync(resolveMediaPath(oldFile)),
    ...(NEW_TEXT[oldFile] ? { newText: NEW_TEXT[oldFile] } : {}),
  });
}

async function run() {
  console.log(`Opérations : ${ops.length} (${ops.filter((o) => o.create).length} créations)`);
  if (ops.length !== Object.keys(REPLACE).length) throw new Error("Nombre d'opérations inattendu");
  const chunks = DRY ? [ops] : Array.from({ length: Math.ceil(ops.length / 4) }, (_, i) => ops.slice(i * 4, i * 4 + 4));
  for (const [i, chunk] of chunks.entries()) {
    const form = new FormData();
    form.append("channelId", CHANNEL_ID);
    form.append("ops", JSON.stringify(chunk));
    if (DRY) form.append("dryRun", "1");
    else
      for (const f of new Set(chunk.map((o) => o.file)))
        form.append("files", new File([readFileSync(resolveMediaPath(f))], f, { type: f.endsWith(".jpg") ? "image/jpeg" : "image/png" }));
    const res = await fetch(`${BASE_URL}/api/integrations/batch-fix/${TOKEN}`, { method: "POST", body: form });
    const body = await res.text();
    console.log(`Paquet ${i + 1}/${chunks.length} :`, res.status, body);
    if (!res.ok || !JSON.parse(body).ok) process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
