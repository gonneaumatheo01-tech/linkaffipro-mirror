/**
 * Magic Hour (repli, VISAGE seulement : corps et cheveux restent ceux de la vidéo source), par `fetch` direct.
 * `Authorization: Bearer <clé>` ; fichiers : `POST /v1/files/upload-urls` puis `PUT` ; travail : `POST /v1/face-swap` ;
 * état : `GET /v1/video-projects/<id>`. Coût réel en crédits (`credits_charged`) converti par un taux réglable
 * (estimation : le prix d'un crédit dépend de l'abonnement).
 */
import { magicHourCents, magicHourCredits, MAGICHOUR_DEFAULT_CENTS_PER_CREDIT } from "./costs";
import { downloadBytes, ProviderError, requestJson, type HttpDeps } from "./http";
import type { ProviderFile, VideoPoll, VideoProvider } from "./video";

export const MAGICHOUR_BASE = "https://api.magichour.ai";
const LABEL = "Magic Hour";

export type MagicHourOptions = { apiKey: string; fetch?: typeof fetch; centsPerCredit?: number };

function extensionOf(file: ProviderFile): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(file.filename)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const sub = file.mimeType.split("/")[1] ?? "";
  return sub === "quicktime" ? "mov" : sub === "jpeg" ? "jpg" : sub || "bin";
}

type ProjectStatus = "draft" | "queued" | "rendering" | "complete" | "error" | "canceled";

export function createMagicHourVideoProvider(opts: MagicHourOptions): VideoProvider {
  const fetchImpl = opts.fetch ?? fetch;
  const http: HttpDeps = { fetch: fetchImpl, label: LABEL, secret: opts.apiKey };
  const auth = { Authorization: `Bearer ${opts.apiKey}` };
  const rate = opts.centsPerCredit ?? MAGICHOUR_DEFAULT_CENTS_PER_CREDIT;

  async function upload(file: ProviderFile, type: "video" | "image"): Promise<string> {
    const r = await requestJson<{ items?: Array<{ upload_url?: string; file_path?: string }> }>(http, `${MAGICHOUR_BASE}/v1/files/upload-urls`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ type, extension: extensionOf(file) }] }),
    });
    const item = r.items?.[0];
    if (!item?.upload_url || !item.file_path) throw new ProviderError(`${LABEL} : envoi du fichier refusé (réponse incomplète)`, true);
    let put: Response;
    try {
      put = await fetchImpl(item.upload_url, { method: "PUT", headers: { "Content-Type": file.mimeType }, body: file.bytes as unknown as RequestInit["body"] });
    } catch (err) {
      throw new ProviderError(`${LABEL} : envoi du fichier impossible (${(err as Error).message || "réseau"})`.slice(0, 200), true);
    }
    if (!put.ok) throw new ProviderError(`${LABEL} : envoi du fichier refusé (${put.status})`, put.status >= 500 || put.status === 429, put.status);
    return item.file_path;
  }

  return {
    name: "magichour",
    estimateCents: ({ durationSec, fps }) => magicHourCents(magicHourCredits(durationSec, fps), rate),
    async startReplace(input) {
      const videoPath = await upload(input.sourceVideo, "video");
      const imagePath = await upload(input.referenceImage, "image");
      const end = Math.max(0.1, Math.round(input.durationSec * 10) / 10);
      const r = await requestJson<{ id?: string; credits_charged?: number }>(http, `${MAGICHOUR_BASE}/v1/face-swap`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "linkaffipro",
          start_seconds: 0,
          end_seconds: end,
          assets: { video_source: "file", video_file_path: videoPath, image_file_path: imagePath, face_swap_mode: "all-faces" },
        }),
      });
      if (!r.id) throw new ProviderError(`${LABEL} : création sans identifiant`, true);
      const estimated =
        typeof r.credits_charged === "number" && r.credits_charged > 0
          ? magicHourCents(r.credits_charged, rate)
          : magicHourCents(magicHourCredits(input.durationSec, input.fps), rate);
      return { jobId: r.id, estimatedCents: estimated };
    },
    async poll(jobId): Promise<VideoPoll> {
      try {
        const r = await requestJson<{
          status?: ProjectStatus;
          downloads?: Array<{ url?: string }>;
          credits_charged?: number;
          error?: { message?: string; code?: string } | null;
        }>(http, `${MAGICHOUR_BASE}/v1/video-projects/${encodeURIComponent(jobId)}`, { method: "GET", headers: auth });
        const actualCents = typeof r.credits_charged === "number" ? magicHourCents(r.credits_charged, rate) : undefined;
        switch (r.status) {
          case "draft":
          case "queued":
            return { status: "queued" };
          case "rendering":
            return { status: "running" };
          case "complete": {
            const url = r.downloads?.find((d) => typeof d.url === "string")?.url;
            return url ? { status: "done", outputUrl: url, actualCents } : { status: "failed", error: `${LABEL} : résultat sans fichier` };
          }
          case "error":
          case "canceled":
            return { status: "failed", error: `${LABEL} : ${r.error?.message ?? (r.status === "canceled" ? "travail annulé" : "échec")}`.slice(0, 300), actualCents };
          default:
            return { status: "running", transient: true, error: `${LABEL} : état inconnu` };
        }
      } catch (err) {
        if (err instanceof ProviderError) return err.transient ? { status: "running", transient: true, error: err.message } : { status: "failed", error: err.message };
        return { status: "running", transient: true, error: `${LABEL} : ${(err as Error).message}`.slice(0, 200) };
      }
    },
    download: (url) => downloadBytes(fetchImpl, LABEL, url),
  };
}
