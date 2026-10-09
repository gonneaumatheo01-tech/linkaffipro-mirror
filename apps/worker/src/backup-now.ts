/**
 * Sauvegarde immédiate de la base, à lancer dans le conteneur du worker :
 *   railway ssh --service worker -- node apps/worker/dist/backup-now.js        (= pnpm db:backup:now)
 * Options : --list (liste les sauvegardes du volume sans en faire une nouvelle).
 */
import { prisma } from "@linkaffipro/db";
import { listBackups, runBackup, backupDir } from "./backups/run";

const list = process.argv.includes("--list");
try {
  if (!list) {
    const status = await runBackup();
    console.log(status.ok ? `Sauvegarde ok : ${status.file} (${(status.bytes / 1024).toFixed(0)} Ko, ${status.durationMs} ms)` : `Sauvegarde en échec : ${status.error}`);
    if (!status.ok) process.exitCode = 1;
  }
  const files = await listBackups();
  console.log(`${files.length} sauvegarde(s) dans ${backupDir()}`);
  for (const f of files) console.log(`  ${f.file}  ${(f.bytes / 1024).toFixed(0)} Ko  ${f.mtime.toISOString()}`);
} finally {
  await prisma.$disconnect();
}
