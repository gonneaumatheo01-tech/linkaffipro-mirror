/**
 * Import des 326 posts du plan Lea (30 jours).
 * Usage : node --import tsx scripts/import-posts-lea.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = "https://app.linkaffipro.com";
const TOKEN = "081e175fea5d020cd6b1a6bd2e0e8e81b47d3cc4671dd27b67c2f3261af357ca";
const CHANNEL_ID = "cmv2h1ka2006sqy85khy9s6em";
const START_DATE = "2026-11-01";

const MEDIA_BASE = "/Users/utilisateur/Desktop/Generation/Telegram";
const FOLDERS: Record<string, string> = {
  selfie: resolve(MEDIA_BASE, "Selfie"),
  sport: resolve(MEDIA_BASE, "Sport"),
  post: resolve(MEDIA_BASE, "Posts"),
  video: resolve(MEDIA_BASE, "Vidéos"),
};

interface PostEntry {
  text: string;
  scheduledAt: string;
  mediaFilenames: string[];
}

const PLAN_PATH = resolve(__dirname, "../posts-canal-lea-30j.txt");
const planText = readFileSync(PLAN_PATH, "utf-8");

interface RawPost {
  day: number;
  time: string;
  file: string | null;
  text: string;
}

const rawPosts: RawPost[] = [];
let currentDay = 0;

for (const line of planText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  const dayMatch = trimmed.match(/^JOUR\s+(\d+)/);
  if (dayMatch) {
    currentDay = parseInt(dayMatch[1]);
    continue;
  }

  const postMatch = trimmed.match(/^(\d{2}:\d{2})\s*\|\s*(.*?)\s*\|\s*(.+)$/);
  if (postMatch && currentDay > 0) {
    rawPosts.push({
      day: currentDay,
      time: postMatch[1],
      file: postMatch[2].trim() || null,
      text: postMatch[3].trim(),
    });
  }
}

function toScheduledAt(day: number, time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const calendarDay = hh < 6 ? day + 1 : day;
  const dayOffset = calendarDay - 1;
  const base = new Date(`${START_DATE}T00:00:00`);
  base.setDate(base.getDate() + dayOffset);
  const dateStr = base.toISOString().slice(0, 10);
  const timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  const parisDate = new Date(`${dateStr}T${timeStr}+01:00`);
  return parisDate.toISOString();
}

function resolveMediaPath(filename: string): string {
  const prefix = filename.split("_")[0].toLowerCase();
  const folder = FOLDERS[prefix];
  if (!folder) throw new Error(`Préfixe média inconnu : ${filename}`);
  return resolve(folder, filename);
}

const allEntries: Array<PostEntry & { _file: string | null }> = rawPosts.map((p) => ({
  text: p.text,
  scheduledAt: toScheduledAt(p.day, p.time),
  mediaFilenames: p.file ? [p.file] : [],
  _file: p.file,
}));

console.log(`Plan lu : ${allEntries.length} posts, ${allEntries.filter((e) => e._file).length} avec média`);

const SKIP_POSTS = Number(process.env.SKIP_POSTS ?? 0);
const remaining = allEntries.slice(SKIP_POSTS);
const missing = remaining.filter((e) => e._file && !existsSync(resolveMediaPath(e._file)));
const entries = remaining.filter((e) => !missing.includes(e));
if (SKIP_POSTS) console.log(`Déjà importés, ignorés : ${SKIP_POSTS}`);
if (missing.length) {
  console.log(`Écartés (photo absente) : ${missing.length}`);
  for (const m of missing) console.log(`  ${m.scheduledAt} | ${m._file} | ${m.text}`);
  writeFileSync(
    resolve(__dirname, "../posts-lea-ecartes.json"),
    JSON.stringify(missing, null, 2),
  );
}
console.log(`À importer : ${entries.length}`);

const BATCH_SIZE = 5;

interface Batch {
  posts: PostEntry[];
  files: string[];
}

const batches: Batch[] = [];
let currentBatch: Batch = { posts: [], files: [] };

for (const entry of entries) {
  const post: PostEntry = {
    text: entry.text,
    scheduledAt: entry.scheduledAt,
    mediaFilenames: entry.mediaFilenames,
  };

  if (entry._file) {
    if (currentBatch.files.length >= BATCH_SIZE) {
      batches.push(currentBatch);
      currentBatch = { posts: [], files: [] };
    }
    currentBatch.files.push(entry._file);
  }
  currentBatch.posts.push(post);
}
if (currentBatch.posts.length > 0) batches.push(currentBatch);

console.log(`Découpé en ${batches.length} lots`);

async function run() {
  let totalCreated = 0;
  let totalMedia = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      `\nLot ${i + 1}/${batches.length} : ${batch.posts.length} posts, ${batch.files.length} médias`,
    );

    const form = new FormData();
    form.append("channelId", CHANNEL_ID);
    form.append("posts", JSON.stringify(batch.posts));

    for (const filename of batch.files) {
      const path = resolveMediaPath(filename);
      const buf = readFileSync(path);
      const ext = filename.split(".").pop()!.toLowerCase();
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "mp4"
              ? "video/mp4"
              : "application/octet-stream";
      form.append("files", new File([buf], filename, { type: mime }));
    }

    const url = `${BASE_URL}/api/integrations/batch-import/${TOKEN}`;
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        console.error(`  ERREUR ${res.status} :`, data);
        process.exit(1);
      }
      console.log(`  OK : ${data.postsCreated} posts, ${data.mediaUploaded} médias`);
      totalCreated += data.postsCreated;
      totalMedia += data.mediaUploaded;
    } catch (err) {
      console.error(`  ERREUR réseau :`, err);
      process.exit(1);
    }

    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== TERMINÉ ===`);
  console.log(`Total : ${totalCreated} posts créés, ${totalMedia} médias envoyés`);
  console.log(`Canal : Lea (${CHANNEL_ID})`);
  console.log(`Début : ${START_DATE}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
