/** Lecture par morceaux des vidéos servies par `/api/agents/media/[id]` (pur, testé dans media-range.test.ts). */

/** Plage d'octets demandée (`Range: bytes=a-b`, une seule plage) ; null si absente ou illisible. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // « bytes=-500 » : les 500 derniers octets.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}
