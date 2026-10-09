import { describe, expect, it } from "vitest";
import { backupFileName, describeBackup, filesToDelete, isBackupDue } from "./plan";

describe("sauvegardes : planification", () => {
  it("est due à partir de 4 h Paris et une seule fois par jour", () => {
    // 2026-10-10 02:30 UTC = 04:30 Paris (été)
    const r = isBackupDue(new Date("2026-10-10T02:30:00Z"), null);
    expect(r).toEqual({ due: true, dayKey: "2026-10-10" });
    expect(isBackupDue(new Date("2026-10-10T02:30:00Z"), "2026-10-10").due).toBe(false);
    expect(isBackupDue(new Date("2026-10-10T01:30:00Z"), null).due).toBe(false); // 03:30 Paris
    expect(isBackupDue(new Date("2026-10-10T20:00:00Z"), "2026-10-09").due).toBe(true);
  });
  it("nomme le fichier sans caractères spéciaux", () => {
    expect(backupFileName(new Date("2026-10-10T02:30:15.123Z"))).toBe("linkaffipro-2026-10-10T02-30-15.sql.gz");
  });
  it("ne garde que les 14 plus récentes et ignore les autres fichiers", () => {
    const files = Array.from({ length: 16 }, (_, i) => `linkaffipro-2026-10-${String(i + 1).padStart(2, "0")}T02-00-00.sql.gz`);
    const del = filesToDelete([...files, "autre.txt", "linkaffipro-notes.md"]);
    expect(del).toEqual([files[0], files[1]]);
    expect(filesToDelete(files.slice(0, 5))).toEqual([]);
  });
  it("décrit l'état en français", () => {
    expect(describeBackup(null)).toMatch(/aucune sauvegarde/);
    expect(describeBackup({ at: "2026-10-10T02:30:00Z", file: "x", bytes: 20480, ok: true, durationMs: 10, dir: "/data/backups" })).toMatch(/ok le .* \(20 Ko\)/);
    expect(describeBackup({ at: "2026-10-10T02:30:00Z", file: null, bytes: 0, ok: false, error: "pg_dump absent", durationMs: 10, dir: "/data/backups" })).toMatch(/échec .*pg_dump absent/);
  });
});
